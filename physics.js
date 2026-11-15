/**
 * 6-DoF Quadcopter Rigid-Body Physics & Flight Control System (physics.js)
 *
 * Features:
 * - True 6-DoF rigid-body dynamics in Three.js coordinate space (+X Right, +Y Up, -Z Forward)
 * - Gravity (9.81 m/s^2), local-to-world 4-motor thrust vector transformation via Quaternion
 * - Principal Moment of Inertia Tensor (Ixx, Iyy, Izz) & Euler gyroscopic precession
 * - Center-Stick Hover Curve (50% throttle = 1G Hover) + Tilt Compensation & Vertical Velocity Damping
 * - Physically-scaled Cascaded PID Flight Controller (Inverse-Dynamics Torque Mixer)
 *   for rock-solid, zero-jitter stability across all frame rates
 * - Dual Flight Modes (M key):
 *   1. Angle Mode (Self-Leveling): Quaternion projected gravity leveling, max tilt 45 deg, Yaw uses Betaflight Rates
 *   2. Acro / Rate Mode: Pure rate control on Roll, Pitch, Yaw using Betaflight Classic Rates (rad/s)
 * - Multi-point 3D AABB collision detection & response with smooth restitution & friction
 */

import * as THREE from 'three';

export class DronePhysics {
  constructor(ratesModel, colliders = []) {
    this.ratesModel = ratesModel;
    this.colliders = colliders;

    // Physical & Configurable Parameters
    this.params = {
      mass: 0.58,              // kg (5-inch 6S FPV Quadcopter)
      gravity: 9.81,           // m/s^2
      armLength: 0.125,        // m (250mm wheelbase)
      rotorRadius: 0.0635,     // m (5-inch propeller)
      thrustToWeight: 5.5,     // Configurable Thrust-to-Weight ratio (TWR)
      linearDragXY: 0.75,      // Horizontal linear air resistance (raised for stable hover / quick settle)
      linearDragY: 0.95,       // Vertical linear air resistance (raised)
      quadraticDrag: 0.058,    // High-speed aerodynamic drag
      angularDamping: 2.5,     // Aerodynamic rotational damping
      Ixx: 0.0026,             // Pitch moment of inertia (kg*m^2)
      Iyy: 0.0046,             // Yaw moment of inertia (kg*m^2)
      Izz: 0.0024,             // Roll moment of inertia (kg*m^2)
      motorTauUp: 0.016,       // Brushless motor spin-up time constant (s)
      motorTauDown: 0.024,     // Active braking spin-down time constant (s)
      maxMotorRPM: 29500,      // 6S 1950KV peak RPM
      idleMotorRPM: 2000,      // Armed idle RPM
      maxTiltAngleDeg: 45,     // Angle mode max tilt limit (45 deg)
      cameraUptiltDeg: 15,     // FPV Camera Uptilt (default 15 deg)
      rateScale: 0.7,          // Global pitch/roll/yaw max angular-rate sensitivity (-30%)
      brakeAssist: 3.2,        // ANGLE mode: horizontal velocity damping (1/s) when right stick is centered
      altHoldKp: 4.0,          // ANGLE mode auto-hover: altitude-hold spring (1/s^2)
      altHoldKd: 4.5           // ANGLE mode auto-hover: vertical velocity damping (1/s)
    };

    // Altitude-hold target (m) captured when the throttle enters the hover deadband in ANGLE mode
    this.altHoldTarget = null;

    this.droneHalfHeight = 0.09;
    this.droneRadius = 0.22;

    // Flight Mode: 'ANGLE' (Self-Leveling, 45 deg limit) or 'ACRO' (Rate / Manual Freestyle)
    this.flightMode = 'ANGLE';

    // 6-DoF State Vectors
    this.position = new THREE.Vector3(0, 0.13, 18);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.acceleration = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion();
    this.angularVelocity = new THREE.Vector3(0, 0, 0);

    // 4 Motors: [M1: Front-Right CCW, M2: Rear-Right CW, M3: Rear-Left CCW, M4: Front-Left CW]
    this.motorNormalized = [0.0, 0.0, 0.0, 0.0];
    this.motorRPM = [2000, 2000, 2000, 2000];
    this.motorThrust = [0, 0, 0, 0];

    // Physically-Scaled Rate PID Controller State (rad/s^2 target angular acceleration)
    this.pid = {
      integral: new THREE.Vector3(0, 0, 0),
      prevError: new THREE.Vector3(0, 0, 0),
      dFiltered: new THREE.Vector3(0, 0, 0),
      kp: new THREE.Vector3(24.0, 20.0, 24.0),
      ki: new THREE.Vector3(10.0, 8.0, 10.0),
      kd: new THREE.Vector3(0.35, 0.15, 0.35),
      angleKp: 6.2 // Smooth self-leveling outer P gain
    };

    // Virtual 6S LiPo Battery State
    this.battery = {
      cells: 6,
      capacityMah: 1300,
      usedMah: 0,
      voltage: 25.2,
      cellVoltage: 4.20,
      currentAmps: 1.2
    };

    // Telemetry Readouts for HUD
    this.telemetry = {
      throttlePct: 0,
      altitude: 0.0,
      speed: 0,
      verticalSpeed: 0,
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      gForce: 1.0,
      groundEffect: 1.0,
      collisionIntensity: 0
    };

    this.spawnPoint = new THREE.Vector3(0, 0.13, 18);
    this.reset();
  }

  setColliders(colliders) {
    this.colliders = colliders;
  }

  toggleFlightMode() {
    this.flightMode = this.flightMode === 'ANGLE' ? 'ACRO' : 'ANGLE';
    this.pid.integral.set(0, 0, 0);
    this.pid.dFiltered.set(0, 0, 0);
    return this.flightMode;
  }

  reset() {
    this.position.copy(this.spawnPoint);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);
    this.altHoldTarget = null;

    this.pid.integral.set(0, 0, 0);
    this.pid.prevError.set(0, 0, 0);
    this.pid.dFiltered.set(0, 0, 0);

    const p = this.params;
    if (this.spawnPoint.y > 0.5) {
      const hoverNorm = Math.sqrt(1.0 / p.thrustToWeight);
      const hoverRPM = p.idleMotorRPM + hoverNorm * (p.maxMotorRPM - p.idleMotorRPM);
      this.motorRPM = [hoverRPM, hoverRPM, hoverRPM, hoverRPM];
      this.motorNormalized = [hoverNorm, hoverNorm, hoverNorm, hoverNorm];
    } else {
      const idle = p.idleMotorRPM;
      this.motorRPM = [idle, idle, idle, idle];
      this.motorNormalized = [0, 0, 0, 0];
    }
    this.motorThrust = [0, 0, 0, 0];

    this.battery.usedMah = 0;
    this.battery.voltage = 25.2;
    this.battery.cellVoltage = 4.20;
    this.battery.currentAmps = 1.2;
    this.telemetry.collisionIntensity = 0;
    this.updateTelemetry();
  }

  getAttitudeAngles() {
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    return {
      pitchRad: euler.x,
      rollRad: -euler.z,
      yawRad: euler.y
    };
  }

  /**
   * Main Physics Update with 480Hz Fixed Sub-Stepping
   */
  update(frameDt, controls) {
    const dtClamped = Math.min(frameDt, 0.04);
    const subSteps = 8;
    const dt = dtClamped / subSteps;

    this.telemetry.collisionIntensity *= Math.pow(0.03, dtClamped);

    for (let i = 0; i < subSteps; i++) {
      this.stepSubPhysics(dt, controls);
    }

    this.updateTelemetry();
  }

  stepSubPhysics(dt, controls) {
    const p = this.params;
    const throttle = Math.max(0, Math.min(1, controls.throttle));
    this.telemetry.throttlePct = Math.round(throttle * 100);

    const isGroundedIdle = this.position.y <= 0.145 && throttle < 0.06;

    // Project World Up (0, 1, 0) into Drone Body Frame
    const invQuat = this.quaternion.clone().invert();
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(invQuat);

    // 1. Compute Target Body Angular Velocity (rad/s) based on Flight Mode
    const rateScale = p.rateScale || 0.7;
    let targetOmegaX = 0;
    let targetOmegaY = 0;
    let targetOmegaZ = 0;

    if (this.flightMode === 'ACRO') {
      targetOmegaX = -this.ratesModel.getRateRad('pitch', controls.pitch) * rateScale;
      targetOmegaZ = -this.ratesModel.getRateRad('roll', controls.roll) * rateScale;
      targetOmegaY = -this.ratesModel.getRateRad('yaw', controls.yaw) * rateScale;
    } else {
      // Angle Mode (Self-Leveling): max tilt 45 deg, rate scaled down 30%
      const currentPitchX = Math.atan2(-bodyUp.z, Math.max(0.15, bodyUp.y));
      const currentRollZ  = Math.atan2(bodyUp.x, Math.max(0.15, bodyUp.y));

      const maxTiltRad = THREE.MathUtils.degToRad(p.maxTiltAngleDeg);
      const targetPitchX = -controls.pitch * maxTiltRad;
      const targetRollZ  = -controls.roll  * maxTiltRad;

      const maxLevelRate = 6.0 * rateScale;
      targetOmegaX = THREE.MathUtils.clamp((targetPitchX - currentPitchX) * this.pid.angleKp, -maxLevelRate, maxLevelRate);
      targetOmegaZ = THREE.MathUtils.clamp((targetRollZ  - currentRollZ)  * this.pid.angleKp, -maxLevelRate, maxLevelRate);
      targetOmegaY = -this.ratesModel.getRateRad('yaw', controls.yaw) * rateScale;
    }

    // 2. Inner Angular Velocity PID Controller (desired angular acceleration in rad/s^2)
    const errX = targetOmegaX - this.angularVelocity.x;
    const errY = targetOmegaY - this.angularVelocity.y;
    const errZ = targetOmegaZ - this.angularVelocity.z;

    if (isGroundedIdle) {
      this.pid.integral.set(0, 0, 0);
      this.pid.prevError.set(errX, errY, errZ);
      this.pid.dFiltered.set(0, 0, 0);
    } else {
      this.pid.integral.x = THREE.MathUtils.clamp(this.pid.integral.x + errX * this.pid.ki.x * dt, -8.0, 8.0);
      this.pid.integral.y = THREE.MathUtils.clamp(this.pid.integral.y + errY * this.pid.ki.y * dt, -6.0, 6.0);
      this.pid.integral.z = THREE.MathUtils.clamp(this.pid.integral.z + errZ * this.pid.ki.z * dt, -8.0, 8.0);
    }

    const rawDx = (errX - this.pid.prevError.x) / dt;
    const rawDy = (errY - this.pid.prevError.y) / dt;
    const rawDz = (errZ - this.pid.prevError.z) / dt;
    this.pid.prevError.set(errX, errY, errZ);

    const dAlpha = 1.0 - Math.exp(-2.0 * Math.PI * 80.0 * dt);
    this.pid.dFiltered.x += (rawDx - this.pid.dFiltered.x) * dAlpha;
    this.pid.dFiltered.y += (rawDy - this.pid.dFiltered.y) * dAlpha;
    this.pid.dFiltered.z += (rawDz - this.pid.dFiltered.z) * dAlpha;

    const alphaDesX = this.pid.kp.x * errX + this.pid.integral.x + this.pid.kd.x * this.pid.dFiltered.x;
    const alphaDesY = this.pid.kp.y * errY + this.pid.integral.y + this.pid.kd.y * this.pid.dFiltered.y;
    const alphaDesZ = this.pid.kp.z * errZ + this.pid.integral.z + this.pid.kd.z * this.pid.dFiltered.z;

    // 3. Convert Desired Angular Acceleration into Physical Motor Thrust Differentials
    const armDiag = p.armLength * Math.SQRT1_2;
    const yawCoeff = 0.015;

    const tauCmdX = p.Ixx * alphaDesX;
    const tauCmdY = p.Iyy * alphaDesY;
    const tauCmdZ = p.Izz * alphaDesZ;

    // 4. Virtual 6S LiPo Battery Voltage Sag & Ground Effect
    const avgNorm = 0.25 * (this.motorNormalized[0] + this.motorNormalized[1] + this.motorNormalized[2] + this.motorNormalized[3]);
    const currentDraw = isGroundedIdle ? 0.8 : (1.4 + 98.0 * Math.pow(avgNorm, 2.1));
    this.battery.currentAmps += (currentDraw - this.battery.currentAmps) * Math.min(1, dt * 15);
    this.battery.usedMah += (this.battery.currentAmps * 1000 * dt) / 3600;
    const soc = Math.max(0.05, 1.0 - this.battery.usedMah / this.battery.capacityMah);
    const ocvCell = 3.52 + 0.68 * Math.pow(soc, 0.85);
    const loadedPackV = Math.max(19.5, ocvCell * 6 - this.battery.currentAmps * 0.038);
    this.battery.voltage += (loadedPackV - this.battery.voltage) * Math.min(1, dt * 16);
    this.battery.cellVoltage = this.battery.voltage / 6.0;

    const agl = Math.max(0.08, this.position.y - 0.04);
    const rEff = 2.0 * p.rotorRadius;
    const igeRatio = rEff / (4.0 * Math.max(agl, 0.35 * rEff));
    const groundEffect = 1.0 / (1.0 - Math.min(0.25, igeRatio * igeRatio));
    this.telemetry.groundEffect = groundEffect;

    // 5. Center-Stick Hover Curve (50% Throttle = 1.0G Hover) + Tilt Compensation in Angle Mode
    const hoverTotalThrust = p.mass * p.gravity;
    const maxTotalThrust = hoverTotalThrust * p.thrustToWeight * (this.battery.voltage / 25.2);
    const maxThrustPerMotor = maxTotalThrust * 0.25;

    let targetTotalThrust = 0;
    if (throttle <= 0.5) {
      // [0.0, 0.5] maps smoothly from 0 to 1.0G Hover Thrust
      targetTotalThrust = (throttle / 0.5) * (hoverTotalThrust / groundEffect);
    } else {
      // [0.5, 1.0] maps smoothly from 1.0G Hover Thrust to Max Thrust
      const normUp = (throttle - 0.5) / 0.5;
      targetTotalThrust = hoverTotalThrust + Math.pow(normUp, 1.35) * (maxTotalThrust - hoverTotalThrust);
    }

    // In Angle Mode, compensate for tilt cosine so forward flight doesn't lose altitude,
    // and hold altitude with strong vertical velocity damping when throttle is centered in deadzone
    if (this.flightMode === 'ANGLE' && !isGroundedIdle) {
      const tiltCos = Math.max(0.55, bodyUp.y);
      targetTotalThrust /= tiltCos;

      if (Math.abs(throttle - 0.5) < 0.08 && this.position.y > 0.25) {
        if (this.altHoldTarget === null) {
          this.altHoldTarget = this.position.y;
        }
        const altErr = this.altHoldTarget - this.position.y;
        targetTotalThrust += (altErr * (p.altHoldKp || 4.0) - this.velocity.y * (p.altHoldKd || 4.5)) * p.mass;
      } else {
        this.altHoldTarget = null;
      }
    } else {
      this.altHoldTarget = null;
    }

    const collectiveThrustPerMotor = THREE.MathUtils.clamp(targetTotalThrust * 0.25, 0, maxThrustPerMotor * 0.92);

    const dF_pitch = tauCmdX / (4.0 * armDiag);
    const dF_roll  = tauCmdZ / (4.0 * armDiag);
    const dF_yaw   = tauCmdY / (4.0 * yawCoeff);

    let f1 = collectiveThrustPerMotor + dF_pitch + dF_roll - dF_yaw;
    let f2 = collectiveThrustPerMotor - dF_pitch + dF_roll + dF_yaw;
    let f3 = collectiveThrustPerMotor - dF_pitch - dF_roll - dF_yaw;
    let f4 = collectiveThrustPerMotor + dF_pitch - dF_roll + dF_yaw;

    if (isGroundedIdle) {
      f1 = f2 = f3 = f4 = 0;
    } else {
      const minF = Math.min(f1, f2, f3, f4);
      const maxF = Math.max(f1, f2, f3, f4);
      const floorF = 0.02 * maxThrustPerMotor;
      if (minF < floorF) {
        const shift = Math.min(floorF - minF, 0.22 * maxThrustPerMotor);
        f1 += shift; f2 += shift; f3 += shift; f4 += shift;
      }
      if (maxF > maxThrustPerMotor) {
        const shift = maxF - maxThrustPerMotor;
        f1 -= shift; f2 -= shift; f3 -= shift; f4 -= shift;
      }
    }

    const commandedThrust = [
      THREE.MathUtils.clamp(f1, 0, maxThrustPerMotor),
      THREE.MathUtils.clamp(f2, 0, maxThrustPerMotor),
      THREE.MathUtils.clamp(f3, 0, maxThrustPerMotor),
      THREE.MathUtils.clamp(f4, 0, maxThrustPerMotor)
    ];

    // 6. Brushless Motor First-Order Lag & Actual Thrust
    let totalLocalThrustY = 0;
    for (let i = 0; i < 4; i++) {
      const normThrust = commandedThrust[i] / maxThrustPerMotor;
      this.motorNormalized[i] = Math.sqrt(normThrust);

      const targetRPM = isGroundedIdle
        ? p.idleMotorRPM
        : p.idleMotorRPM + this.motorNormalized[i] * (p.maxMotorRPM - p.idleMotorRPM);
      const tau = targetRPM >= this.motorRPM[i] ? p.motorTauUp : p.motorTauDown;
      this.motorRPM[i] += ((targetRPM - this.motorRPM[i]) / tau) * dt;

      const actualNormRPM = Math.max(0, (this.motorRPM[i] - p.idleMotorRPM) / (p.maxMotorRPM - p.idleMotorRPM));
      this.motorThrust[i] = actualNormRPM * actualNormRPM * maxThrustPerMotor * groundEffect;
      totalLocalThrustY += this.motorThrust[i];
    }

    // 7. Transform Local Thrust Vector to World Space via Quaternion
    const thrustWorld = new THREE.Vector3(0, totalLocalThrustY, 0).applyQuaternion(this.quaternion);

    // 8. Compute Aerodynamic Drag in Local Body Frame & Transform to World Space
    const velLocal = this.velocity.clone().applyQuaternion(invQuat);
    const dragLocal = new THREE.Vector3(
      -p.linearDragXY * velLocal.x - p.quadraticDrag * Math.abs(velLocal.x) * velLocal.x,
      -p.linearDragY  * velLocal.y - p.quadraticDrag * 2.0 * Math.abs(velLocal.y) * velLocal.y,
      -p.linearDragXY * velLocal.z - p.quadraticDrag * Math.abs(velLocal.z) * velLocal.z
    );
    const dragWorld = dragLocal.applyQuaternion(this.quaternion);

    // 8b. Active Horizontal Brake Assist when pitch & roll sticks are centered in ANGLE mode
    let brakeForceX = 0;
    let brakeForceZ = 0;
    if (this.flightMode === 'ANGLE' && !isGroundedIdle) {
      if (Math.abs(controls.pitch) < 0.05 && Math.abs(controls.roll) < 0.05) {
        const brakeK = (p.brakeAssist || 3.2) * p.mass;
        brakeForceX = -this.velocity.x * brakeK;
        brakeForceZ = -this.velocity.z * brakeK;
      }
    }

    // 9. Net World Force & Linear Integration (No Boost; pure realistic throttle & tilt)
    const netForce = new THREE.Vector3(
      thrustWorld.x + dragWorld.x + brakeForceX,
      thrustWorld.y + dragWorld.y - p.mass * p.gravity,
      thrustWorld.z + dragWorld.z + brakeForceZ
    );

    this.acceleration.copy(netForce).divideScalar(p.mass);
    this.velocity.addScaledVector(this.acceleration, dt);
    this.position.addScaledVector(this.velocity, dt);

    // 10. Rigid-Body Torques & Inertia Tensor Integration
    const F1 = this.motorThrust[0];
    const F2 = this.motorThrust[1];
    const F3 = this.motorThrust[2];
    const F4 = this.motorThrust[3];

    const tauX = armDiag * (F1 + F4 - F2 - F3) - p.angularDamping * p.Ixx * this.angularVelocity.x;
    const tauZ = armDiag * (F1 + F2 - F3 - F4) - p.angularDamping * p.Izz * this.angularVelocity.z;
    const tauY = yawCoeff * (F2 + F4 - F1 - F3) - p.angularDamping * p.Iyy * this.angularVelocity.y;

    const wx = this.angularVelocity.x;
    const wy = this.angularVelocity.y;
    const wz = this.angularVelocity.z;

    const gyroX = wy * (p.Izz * wz) - wz * (p.Iyy * wy);
    const gyroY = wz * (p.Ixx * wx) - wx * (p.Izz * wz);
    const gyroZ = wx * (p.Iyy * wy) - wy * (p.Ixx * wx);

    this.angularVelocity.x += ((tauX - gyroX) / p.Ixx) * dt;
    this.angularVelocity.y += ((tauY - gyroY) / p.Iyy) * dt;
    this.angularVelocity.z += ((tauZ - gyroZ) / p.Izz) * dt;

    const omegaMag = this.angularVelocity.length();
    if (omegaMag > 1e-7) {
      const axis = this.angularVelocity.clone().divideScalar(omegaMag);
      const deltaQ = new THREE.Quaternion().setFromAxisAngle(axis, omegaMag * dt);
      this.quaternion.multiply(deltaQ).normalize();
    }

    // 11. 3D Collision Detection & Physical Response
    this.resolveCollisions(dt, throttle);
  }

  resolveCollisions(dt, throttle) {
    const droneRadius = this.droneRadius;
    const droneHalfHeight = this.droneHalfHeight;

    const onHelipad = Math.abs(this.position.x) <= 1.1 && Math.abs(this.position.z - 18) <= 1.1;
    const floorY = onHelipad ? 0.04 : 0.0;

    // 1. Floor / Helipad Collision
    if (this.position.y - droneHalfHeight < floorY) {
      this.position.y = floorY + droneHalfHeight;
      if (this.velocity.y < 0) {
        const impactSpeed = -this.velocity.y;
        if (impactSpeed > 1.5) {
          this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, impactSpeed);
        }
        this.velocity.y = impactSpeed > 2.2 ? impactSpeed * 0.20 : 0;
        const frictionDecay = Math.exp(-14.0 * dt);
        this.velocity.x *= frictionDecay;
        this.velocity.z *= frictionDecay;
      }

      // Negative-feedback landing skid leveling on floor
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion.clone().invert());
      this.angularVelocity.x +=  localUp.z * 12.0 * dt;
      this.angularVelocity.z += -localUp.x * 12.0 * dt;
      this.angularVelocity.multiplyScalar(Math.exp(-18.0 * dt));

      if (throttle < 0.08 && this.velocity.lengthSq() < 0.02) {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.multiplyScalar(0.5);
      }
    }

    // 2. Warehouse Ceiling & Outer Walls
    const maxX = 21.6, maxY = 11.6, maxZ = 27.6;
    if (this.position.y + droneHalfHeight > maxY) {
      this.position.y = maxY - droneHalfHeight;
      if (this.velocity.y > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, this.velocity.y);
        this.velocity.y *= -0.30;
      }
    }
    if (Math.abs(this.position.x) + droneRadius > maxX) {
      const sign = Math.sign(this.position.x);
      this.position.x = sign * (maxX - droneRadius);
      if (this.velocity.x * sign > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, Math.abs(this.velocity.x));
        this.velocity.x *= -0.38;
        this.velocity.z *= 0.85;
      }
    }
    if (Math.abs(this.position.z) + droneRadius > maxZ) {
      const sign = Math.sign(this.position.z);
      this.position.z = sign * (maxZ - droneRadius);
      if (this.velocity.z * sign > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, Math.abs(this.velocity.z));
        this.velocity.z *= -0.38;
        this.velocity.x *= 0.85;
      }
    }

    // 3. Warehouse Obstacle AABB Collisions
    const closestPt = new THREE.Vector3();
    for (let i = 0; i < this.colliders.length; i++) {
      const col = this.colliders[i];
      const box = col.box;
      if (!box) continue;

      closestPt.copy(this.position).clamp(box.min, box.max);
      const diff = this.position.clone().sub(closestPt);
      const distSq = diff.lengthSq();

      if (distSq < droneRadius * droneRadius) {
        const dist = Math.sqrt(distSq);
        let normal = new THREE.Vector3(0, 1, 0);
        let penetration = droneRadius - dist;

        if (dist > 1e-5) {
          normal.copy(diff).divideScalar(dist);
        } else {
          const dMinX = Math.abs(this.position.x - box.min.x);
          const dMaxX = Math.abs(box.max.x - this.position.x);
          const dMinY = Math.abs(this.position.y - box.min.y);
          const dMaxY = Math.abs(box.max.y - this.position.y);
          const dMinZ = Math.abs(this.position.z - box.min.z);
          const dMaxZ = Math.abs(box.max.z - this.position.z);
          const m = Math.min(dMinX, dMaxX, dMinY, dMaxY, dMinZ, dMaxZ);
          penetration = m + droneRadius;
          if (m === dMaxY) normal.set(0, 1, 0);
          else if (m === dMinY) normal.set(0, -1, 0);
          else if (m === dMinX) normal.set(-1, 0, 0);
          else if (m === dMaxX) normal.set(1, 0, 0);
          else if (m === dMinZ) normal.set(0, 0, -1);
          else normal.set(0, 0, 1);
        }

        this.position.addScaledVector(normal, penetration);

        const vn = this.velocity.dot(normal);
        if (vn < 0) {
          const impact = -vn;
          if (impact > 1.0) {
            this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, impact);
          }

          const restitution = normal.y > 0.7 && impact < 1.5 ? 0.05 : (col.restitution ?? 0.35);
          const impulse = -(1.0 + restitution) * vn;
          this.velocity.addScaledVector(normal, impulse);

          const tangentVel = this.velocity.clone().addScaledVector(normal, -this.velocity.dot(normal));
          this.velocity.addScaledVector(tangentVel, normal.y > 0.7 ? -0.25 : -0.10);

          if (normal.y < 0.75 && impact > 0.8) {
            const contactArm = closestPt.clone().sub(this.position);
            const impulseVec = normal.clone().multiplyScalar(Math.min(impulse, 3.0));
            const torqueWorld = contactArm.cross(impulseVec);
            const torqueLocal = torqueWorld.applyQuaternion(this.quaternion.clone().invert());
            this.angularVelocity.addScaledVector(torqueLocal, 2.2);
          } else if (normal.y >= 0.75 && throttle < 0.15) {
            this.angularVelocity.multiplyScalar(Math.exp(-15.0 * dt));
          }
        }
      }
    }
  }

  updateTelemetry() {
    const { pitchRad, rollRad, yawRad } = this.getAttitudeAngles();
    this.telemetry.altitude = Math.max(0, this.position.y - 0.13);
    this.telemetry.speed = this.velocity.length();
    this.telemetry.verticalSpeed = this.velocity.y;
    this.telemetry.pitchDeg = THREE.MathUtils.radToDeg(pitchRad);
    this.telemetry.rollDeg = THREE.MathUtils.radToDeg(rollRad);
    let heading = THREE.MathUtils.radToDeg(-yawRad) % 360;
    if (heading < 0) heading += 360;
    this.telemetry.yawDeg = heading;

    const gVec = new THREE.Vector3(
      this.acceleration.x,
      this.acceleration.y + this.params.gravity,
      this.acceleration.z
    );
    this.telemetry.gForce = gVec.length() / this.params.gravity;
  }
}
