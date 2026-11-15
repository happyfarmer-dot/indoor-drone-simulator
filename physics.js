/**
 * 6-DoF Quadcopter Rigid-Body Physics & Flight Control System (physics.js)
 *
 * Features:
 * - True 6-DoF rigid-body dynamics in Three.js coordinate space (+X Right, +Y Up, -Z Forward)
 * - Gravity (9.81 m/s^2), local-to-world 4-motor thrust vector transformation via Quaternion
 * - Principal Moment of Inertia Tensor (Ixx, Iyy, Izz) & Euler gyroscopic precession
 * - Anisotropic air drag, angular damping & Cheeseman-Bennett Ground Effect (IGE)
 * - Dual Flight Modes (M key):
 *   1. Angle Mode (Self-Leveling): Cascaded Attitude + Rate PID, max tilt 45 deg, Yaw uses Betaflight Rates
 *   2. Acro / Rate Mode: Pure rate control on Roll, Pitch, Yaw using Betaflight Classic Rates (rad/s)
 * - Multi-point 3D AABB/OBB collision detection & response with restitution, friction & attitude perturbation
 */

import * as THREE from 'three';

export class DronePhysics {
  constructor(ratesModel, colliders = []) {
    this.ratesModel = ratesModel;
    this.colliders = colliders; // Array of { box: THREE.Box3, tag: string, restitution?: number }

    // Physical & Configurable Parameters
    this.params = {
      mass: 0.58,              // kg (5-inch 6S FPV Quadcopter)
      gravity: 9.81,           // m/s^2
      armLength: 0.125,        // m (250mm wheelbase)
      rotorRadius: 0.0635,     // m (5-inch propeller)
      thrustToWeight: 5.5,     // Configurable Thrust-to-Weight ratio (TWR)
      linearDragXY: 0.28,      // Horizontal linear air resistance
      linearDragY: 0.45,       // Vertical linear air resistance
      quadraticDrag: 0.045,    // High-speed aerodynamic drag
      angularDamping: 1.85,    // Aerodynamic rotational damping
      Ixx: 0.0026,             // Pitch moment of inertia (kg*m^2)
      Iyy: 0.0046,             // Yaw moment of inertia (kg*m^2)
      Izz: 0.0024,             // Roll moment of inertia (kg*m^2)
      motorTauUp: 0.020,       // Brushless motor spin-up time constant (s)
      motorTauDown: 0.030,     // Active braking spin-down time constant (s)
      maxMotorRPM: 29500,      // 6S 1950KV peak RPM
      idleMotorRPM: 2100,      // Armed idle RPM
      maxTiltAngleDeg: 45,     // Angle mode max tilt limit (45 deg)
      cameraUptiltDeg: 15      // FPV Camera Uptilt (default 15 deg)
    };

    // Flight Mode: 'ANGLE' (Self-Leveling, 45 deg limit) or 'ACRO' (Rate / Manual Freestyle)
    this.flightMode = 'ANGLE';

    // 6-DoF State Vectors
    this.position = new THREE.Vector3(0, 0.25, 18);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.acceleration = new THREE.Vector3(0, 0, 0);
    this.quaternion = new THREE.Quaternion();
    // Angular velocity in Drone Local Body Frame (rad/s):
    // x: Pitch (+ nose up, - nose down)
    // y: Yaw   (+ CCW left, - CW right)
    // z: Roll  (+ left wing up / roll right is -, roll left is +)
    this.angularVelocity = new THREE.Vector3(0, 0, 0);

    // 4 Motors: [M1: Front-Right CCW, M2: Rear-Right CW, M3: Rear-Left CCW, M4: Front-Left CW]
    this.motorNormalized = [0.06, 0.06, 0.06, 0.06];
    this.motorRPM = [2100, 2100, 2100, 2100];
    this.motorThrust = [0, 0, 0, 0];

    // PID Controller State (Body Frame Angular Rate PID)
    this.pid = {
      integral: new THREE.Vector3(0, 0, 0),
      prevError: new THREE.Vector3(0, 0, 0),
      // Rate loop gains (map rad/s error -> normalized torque command)
      kp: new THREE.Vector3(0.115, 0.180, 0.115),
      ki: new THREE.Vector3(0.220, 0.250, 0.220),
      kd: new THREE.Vector3(0.0022, 0.0005, 0.0022),
      angleKp: 7.5 // Outer attitude loop P gain for Angle Mode
    };

    // Virtual 6S LiPo Battery State
    this.battery = {
      cells: 6,
      capacityMah: 1300,
      usedMah: 0,
      voltage: 25.2,
      cellVoltage: 4.20,
      currentAmps: 1.5
    };

    // Telemetry Readouts for HUD
    this.telemetry = {
      throttlePct: 0,
      altitude: 0.25,
      speed: 0,
      verticalSpeed: 0,
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      gForce: 1.0,
      groundEffect: 1.0,
      collisionIntensity: 0
    };

    this.spawnPoint = new THREE.Vector3(0, 0.24, 18);
    this.reset();
  }

  setColliders(colliders) {
    this.colliders = colliders;
  }

  toggleFlightMode() {
    this.flightMode = this.flightMode === 'ANGLE' ? 'ACRO' : 'ANGLE';
    // Reset PID integrators on mode switch for smooth transition
    this.pid.integral.set(0, 0, 0);
    return this.flightMode;
  }

  reset() {
    this.position.copy(this.spawnPoint);
    this.velocity.set(0, 0, 0);
    this.acceleration.set(0, 0, 0);
    this.quaternion.identity();
    this.angularVelocity.set(0, 0, 0);

    this.pid.integral.set(0, 0, 0);
    this.pid.prevError.set(0, 0, 0);

    const idle = this.params.idleMotorRPM;
    this.motorRPM = [idle, idle, idle, idle];
    this.motorNormalized = [0.05, 0.05, 0.05, 0.05];
    this.motorThrust = [0, 0, 0, 0];

    this.battery.usedMah = 0;
    this.battery.voltage = 25.2;
    this.battery.cellVoltage = 4.20;
    this.battery.currentAmps = 1.2;
    this.telemetry.collisionIntensity = 0;
    this.updateTelemetry();
  }

  /**
   * Extract aircraft Pitch, Roll, Heading angles from Quaternion
   */
  getAttitudeAngles() {
    // Intrinsic YXZ Euler matches aircraft Yaw (Y) -> Pitch (X) -> Roll (Z)
    const euler = new THREE.Euler().setFromQuaternion(this.quaternion, 'YXZ');
    // Note: in Three.js right-handed coords (+X right, +Y up, -Z forward):
    // euler.x > 0 is nose up, euler.x < 0 is nose down
    // euler.z < 0 is roll right, euler.z > 0 is roll left
    return {
      pitchRad: euler.x,
      rollRad: -euler.z, // positive = right wing down
      yawRad: euler.y
    };
  }

  /**
   * Main Physics Update with 480Hz Fixed Sub-Stepping
   * @param {number} frameDt Frame delta time in seconds
   * @param {object} controls { throttle: [0,1], roll: [-1,1], pitch: [-1,1], yaw: [-1,1] }
   *   Stick convention:
   *   throttle: 0.0 (idle) -> 1.0 (full power)
   *   pitch: +1.0 (push forward / nose down), -1.0 (pull back / nose up)
   *   roll:  +1.0 (roll right), -1.0 (roll left)
   *   yaw:   +1.0 (yaw right / CW), -1.0 (yaw left / CCW)
   */
  update(frameDt, controls) {
    const dtClamped = Math.min(frameDt, 0.05);
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

    // 1. Compute Target Body Angular Velocity (rad/s) based on Flight Mode
    // Body frame axes:
    // +X: Right wing  -> positive rotation is Pitch Nose-Up (so forward stick pitch > 0 => negative omega.x)
    // +Y: Up          -> positive rotation is Yaw Left CCW  (so right stick yaw > 0 => negative omega.y)
    // +Z: Rear        -> positive rotation is Roll Left     (so right stick roll > 0 => negative omega.z)
    let targetOmegaX = 0;
    let targetOmegaY = 0;
    let targetOmegaZ = 0;

    if (this.flightMode === 'ACRO') {
      // Acro Mode: All 3 axes directly map stick input through Betaflight Classic Rates -> rad/s
      targetOmegaX = -this.ratesModel.getRateRad('pitch', controls.pitch);
      targetOmegaZ = -this.ratesModel.getRateRad('roll', controls.roll);
      targetOmegaY = -this.ratesModel.getRateRad('yaw', controls.yaw);
    } else {
      // Angle Mode (Self-Leveling):
      // Roll & Pitch stick map to target tilt angle (max 45 deg), outer PID drives attitude error to zero
      const maxTiltRad = THREE.MathUtils.degToRad(p.maxTiltAngleDeg);
      const targetPitchRad = -controls.pitch * maxTiltRad; // forward stick => negative pitch angle
      const targetRollRad = controls.roll * maxTiltRad;    // right stick => positive right-wing-down

      const { pitchRad, rollRad } = this.getAttitudeAngles();

      // Calculate shortest angular error
      const pitchError = targetPitchRad - pitchRad;
      const rollError = targetRollRad - rollRad;

      // Clamp outer-loop rate request to a smooth self-leveling speed (max 400 deg/s = 6.98 rad/s)
      const maxLevelRate = 6.98;
      targetOmegaX = THREE.MathUtils.clamp(pitchError * this.pid.angleKp, -maxLevelRate, maxLevelRate);
      targetOmegaZ = THREE.MathUtils.clamp(-rollError * this.pid.angleKp, -maxLevelRate, maxLevelRate);

      // Yaw axis still uses Betaflight Yaw Rates curve in Angle Mode!
      targetOmegaY = -this.ratesModel.getRateRad('yaw', controls.yaw);
    }

    // 2. Inner Angular Velocity PID Controller
    const errX = targetOmegaX - this.angularVelocity.x;
    const errY = targetOmegaY - this.angularVelocity.y;
    const errZ = targetOmegaZ - this.angularVelocity.z;

    const onGround = this.position.y < 0.28 && throttle < 0.12;
    if (onGround) {
      this.pid.integral.multiplyScalar(0.88);
    } else {
      this.pid.integral.x = THREE.MathUtils.clamp(this.pid.integral.x + errX * this.pid.ki.x * dt, -0.28, 0.28);
      this.pid.integral.y = THREE.MathUtils.clamp(this.pid.integral.y + errY * this.pid.ki.y * dt, -0.28, 0.28);
      this.pid.integral.z = THREE.MathUtils.clamp(this.pid.integral.z + errZ * this.pid.ki.z * dt, -0.28, 0.28);
    }

    const dErrX = (errX - this.pid.prevError.x) / dt;
    const dErrY = (errY - this.pid.prevError.y) / dt;
    const dErrZ = (errZ - this.pid.prevError.z) / dt;
    this.pid.prevError.set(errX, errY, errZ);

    const pidPitch = this.pid.kp.x * errX + this.pid.integral.x + this.pid.kd.x * dErrX;
    const pidYaw   = this.pid.kp.y * errY + this.pid.integral.y + this.pid.kd.y * dErrY;
    const pidRoll  = this.pid.kp.z * errZ + this.pid.integral.z + this.pid.kd.z * dErrZ;

    // 3. Quad-X Motor Mixer with Betaflight AirMode Authority Preservation
    // M1 (FR, CCW): +Pitch, +Roll, -Yaw
    // M2 (RR, CW):  -Pitch, +Roll, +Yaw
    // M3 (RL, CCW): -Pitch, -Roll, -Yaw
    // M4 (FL, CW):  +Pitch, -Roll, +Yaw
    let m1 = throttle + pidPitch + pidRoll - pidYaw;
    let m2 = throttle - pidPitch + pidRoll + pidYaw;
    let m3 = throttle - pidPitch - pidRoll - pidYaw;
    let m4 = throttle + pidPitch - pidRoll + pidYaw;

    if (!onGround) {
      const minM = Math.min(m1, m2, m3, m4);
      const maxM = Math.max(m1, m2, m3, m4);
      const span = maxM - minM;
      if (span > 1.0) {
        const inv = 1.0 / span;
        m1 *= inv; m2 *= inv; m3 *= inv; m4 *= inv;
      }
      const minAfter = Math.min(m1, m2, m3, m4);
      const maxAfter = Math.max(m1, m2, m3, m4);
      if (minAfter < 0.05) {
        const shift = 0.05 - minAfter;
        m1 += shift; m2 += shift; m3 += shift; m4 += shift;
      } else if (maxAfter > 1.0) {
        const shift = maxAfter - 1.0;
        m1 -= shift; m2 -= shift; m3 -= shift; m4 -= shift;
      }
    }

    this.motorNormalized[0] = THREE.MathUtils.clamp(m1, 0.04, 1.0);
    this.motorNormalized[1] = THREE.MathUtils.clamp(m2, 0.04, 1.0);
    this.motorNormalized[2] = THREE.MathUtils.clamp(m3, 0.04, 1.0);
    this.motorNormalized[3] = THREE.MathUtils.clamp(m4, 0.04, 1.0);

    // 4. Virtual 6S LiPo Battery Voltage Sag & Current Calculation
    const avgCmd = 0.25 * (this.motorNormalized[0] + this.motorNormalized[1] + this.motorNormalized[2] + this.motorNormalized[3]);
    const currentDraw = 1.4 + 105.0 * Math.pow(avgCmd, 2.15);
    this.battery.currentAmps += (currentDraw - this.battery.currentAmps) * Math.min(1, dt * 15);
    this.battery.usedMah += (this.battery.currentAmps * 1000 * dt) / 3600;
    const soc = Math.max(0.05, 1.0 - this.battery.usedMah / this.battery.capacityMah);
    const ocvCell = 3.52 + 0.68 * Math.pow(soc, 0.85);
    const loadedPackV = Math.max(19.5, ocvCell * 6 - this.battery.currentAmps * 0.038);
    this.battery.voltage += (loadedPackV - this.battery.voltage) * Math.min(1, dt * 16);
    this.battery.cellVoltage = this.battery.voltage / 6.0;

    // 5. Ground Effect (In-Ground-Effect Cushion)
    const agl = Math.max(0.08, this.position.y);
    const rEff = 2.0 * p.rotorRadius;
    const igeRatio = rEff / (4.0 * Math.max(agl, 0.3 * rEff));
    const groundEffect = 1.0 / (1.0 - Math.min(0.35, igeRatio * igeRatio));
    this.telemetry.groundEffect = groundEffect;

    // 6. Brushless Motor RPM Lag & Individual Thrust Calculation
    const maxTotalThrust = p.mass * p.gravity * p.thrustToWeight * (this.battery.voltage / 25.2);
    const maxThrustPerMotor = maxTotalThrust * 0.25;
    const kThrust = maxThrustPerMotor / (p.maxMotorRPM * p.maxMotorRPM);

    let totalLocalThrustY = 0;
    for (let i = 0; i < 4; i++) {
      const targetRPM = p.idleMotorRPM + this.motorNormalized[i] * (p.maxMotorRPM - p.idleMotorRPM);
      const tau = targetRPM >= this.motorRPM[i] ? p.motorTauUp : p.motorTauDown;
      this.motorRPM[i] += ((targetRPM - this.motorRPM[i]) / tau) * dt;
      this.motorThrust[i] = kThrust * this.motorRPM[i] * this.motorRPM[i] * groundEffect;
      totalLocalThrustY += this.motorThrust[i];
    }

    // 7. Transform Local Thrust Vector (0, totalLocalThrustY, 0) to World Space via Quaternion
    const thrustWorld = new THREE.Vector3(0, totalLocalThrustY, 0).applyQuaternion(this.quaternion);

    // 8. Compute Aerodynamic Drag in Local Body Frame & Transform to World Space
    const invQuat = this.quaternion.clone().invert();
    const velLocal = this.velocity.clone().applyQuaternion(invQuat);

    const dragLocal = new THREE.Vector3(
      -p.linearDragXY * velLocal.x - p.quadraticDrag * Math.abs(velLocal.x) * velLocal.x,
      -p.linearDragY  * velLocal.y - p.quadraticDrag * 2.2 * Math.abs(velLocal.y) * velLocal.y,
      -p.linearDragXY * velLocal.z - p.quadraticDrag * Math.abs(velLocal.z) * velLocal.z
    );
    const dragWorld = dragLocal.applyQuaternion(this.quaternion);

    // 9. Net World Force & Linear Integration (F = F_thrust + F_drag + m*g)
    const netForce = new THREE.Vector3(
      thrustWorld.x + dragWorld.x,
      thrustWorld.y + dragWorld.y - p.mass * p.gravity,
      thrustWorld.z + dragWorld.z
    );

    this.acceleration.copy(netForce).divideScalar(p.mass);
    this.velocity.addScaledVector(this.acceleration, dt);
    this.position.addScaledVector(this.velocity, dt);

    // 10. Rigid-Body Torques & Inertia Tensor Integration in Body Space
    const armDiag = p.armLength * Math.SQRT1_2;
    const F1 = this.motorThrust[0];
    const F2 = this.motorThrust[1];
    const F3 = this.motorThrust[2];
    const F4 = this.motorThrust[3];

    const yawCoeff = 0.015;
    // Physical torques from motor thrust differentials + aerodynamic angular damping
    const tauX = armDiag * (F1 + F4 - F2 - F3) - p.angularDamping * p.Ixx * this.angularVelocity.x;
    const tauZ = armDiag * (F1 + F2 - F3 - F4) - p.angularDamping * p.Izz * this.angularVelocity.z;
    const tauY = yawCoeff * (F2 + F4 - F1 - F3) - p.angularDamping * p.Iyy * this.angularVelocity.y;

    // Euler's Rigid Body Equation: I * d(omega)/dt = tau - omega x (I * omega)
    const wx = this.angularVelocity.x;
    const wy = this.angularVelocity.y;
    const wz = this.angularVelocity.z;

    const gyroX = wy * (p.Izz * wz) - wz * (p.Iyy * wy);
    const gyroY = wz * (p.Ixx * wx) - wx * (p.Izz * wz);
    const gyroZ = wx * (p.Iyy * wy) - wy * (p.Ixx * wx);

    this.angularVelocity.x += ((tauX - gyroX) / p.Ixx) * dt;
    this.angularVelocity.y += ((tauY - gyroY) / p.Iyy) * dt;
    this.angularVelocity.z += ((tauZ - gyroZ) / p.Izz) * dt;

    // Update Quaternion Orientation from Body Angular Velocity
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
    const droneRadius = 0.22;
    const droneHalfHeight = 0.09;

    // 1. Floor Collision (Y = 0)
    if (this.position.y - droneHalfHeight < 0) {
      this.position.y = droneHalfHeight;
      if (this.velocity.y < 0) {
        const impactSpeed = -this.velocity.y;
        if (impactSpeed > 1.2) {
          this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, impactSpeed);
        }
        // Bounce with momentum loss
        this.velocity.y = impactSpeed > 1.8 ? impactSpeed * 0.25 : 0;
        // Surface friction
        this.velocity.x *= Math.pow(0.04, dt);
        this.velocity.z *= Math.pow(0.04, dt);
      }
      // Landing skid attitude stabilization when touching the floor
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion.clone().invert());
      this.angularVelocity.x += -localUp.z * 16.0 * dt;
      this.angularVelocity.z +=  localUp.x * 16.0 * dt;
      this.angularVelocity.multiplyScalar(Math.pow(0.02, dt));
    }

    // 2. Warehouse Ceiling & Outer Walls (Width: 44m [-22, 22], Height: 12m [0, 12], Depth: 56m [-28, 28])
    const maxX = 21.6, maxY = 11.6, maxZ = 27.6;
    if (this.position.y + droneHalfHeight > maxY) {
      this.position.y = maxY - droneHalfHeight;
      if (this.velocity.y > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, this.velocity.y);
        this.velocity.y *= -0.35;
        this.perturbAttitude(0.8);
      }
    }
    if (Math.abs(this.position.x) + droneRadius > maxX) {
      const sign = Math.sign(this.position.x);
      this.position.x = sign * (maxX - droneRadius);
      if (this.velocity.x * sign > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, Math.abs(this.velocity.x));
        this.velocity.x *= -0.42;
        this.velocity.z *= 0.85;
        this.perturbAttitude(Math.abs(this.velocity.x) * 0.6 + 0.5);
      }
    }
    if (Math.abs(this.position.z) + droneRadius > maxZ) {
      const sign = Math.sign(this.position.z);
      this.position.z = sign * (maxZ - droneRadius);
      if (this.velocity.z * sign > 0) {
        this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, Math.abs(this.velocity.z));
        this.velocity.z *= -0.42;
        this.velocity.x *= 0.85;
        this.perturbAttitude(Math.abs(this.velocity.z) * 0.6 + 0.5);
      }
    }

    // 3. Warehouse Obstacle AABB Collisions (Racks, Pallets, Boxes, Steel Columns, Gate Posts)
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
          // Center inside AABB: find minimum penetration face
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

        // Push drone out of obstacle
        this.position.addScaledVector(normal, penetration);

        const vn = this.velocity.dot(normal);
        if (vn < 0) {
          const impact = -vn;
          if (impact > 0.8) {
            this.telemetry.collisionIntensity = Math.max(this.telemetry.collisionIntensity, impact);
          }

          const restitution = normal.y > 0.7 && impact < 1.4 ? 0.08 : (col.restitution ?? 0.42);
          const impulse = -(1.0 + restitution) * vn;
          this.velocity.addScaledVector(normal, impulse);

          // Tangential friction
          const tangentVel = this.velocity.clone().addScaledVector(normal, -this.velocity.dot(normal));
          this.velocity.addScaledVector(tangentVel, normal.y > 0.7 ? -0.18 : -0.08);

          // Off-center impact induces realistic attitude perturbation
          if (normal.y < 0.75 && impact > 0.6) {
            const contactArm = closestPt.clone().sub(this.position);
            const impulseVec = normal.clone().multiplyScalar(impulse);
            const torqueWorld = contactArm.cross(impulseVec);
            const torqueLocal = torqueWorld.applyQuaternion(this.quaternion.clone().invert());
            this.angularVelocity.addScaledVector(torqueLocal, 24.0);
            this.perturbAttitude(impact * 0.35);
          } else if (normal.y >= 0.75 && throttle < 0.15) {
            this.angularVelocity.multiplyScalar(Math.pow(0.03, dt));
          }
        }
      }
    }
  }

  perturbAttitude(magnitude) {
    this.angularVelocity.x += (Math.random() - 0.5) * magnitude * 3.2;
    this.angularVelocity.y += (Math.random() - 0.5) * magnitude * 2.5;
    this.angularVelocity.z += (Math.random() - 0.5) * magnitude * 3.2;
  }

  updateTelemetry() {
    const { pitchRad, rollRad, yawRad } = this.getAttitudeAngles();
    this.telemetry.altitude = Math.max(0, this.position.y - 0.09);
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
