/**
 * Main Application Entry: 3D Indoor Drone Simulator & Betaflight Rates Configurator (main.js)
 */

import * as THREE from 'three';
import { BetaflightRates, RatesCurveChart } from './rates.js';
import { DronePhysics } from './physics.js';
import { DroneModel } from './drone.js';
import { WarehouseScene } from './warehouse.js';
import { DroneAudio } from './audio.js';

const SIM_PARAMS_STORAGE_KEY = 'indoor_drone_sim_params_v1';

class IndoorDroneSimulator {
  constructor() {
    this.container = document.getElementById('webgl-container');
    this.osdCanvas = document.getElementById('osd-canvas');
    this.osdCtx = this.osdCanvas.getContext('2d');

    // 1. Initialize Three.js Renderer with ACESFilmicToneMapping & PCFSoftShadowMap
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 2. Initialize Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(100, window.innerWidth / window.innerHeight, 0.05, 120);

    // Camera Mode: 'FPV' (FOV 100°, 15° Uptilt) or 'CHASE' (Spring-Damper Follow, FOV 68°)
    this.cameraMode = 'CHASE'; // Start in Chase or FPV; C key switches immediately
    this.chaseCamPos = new THREE.Vector3(0, 1.4, 20.6);
    this.chaseCamVel = new THREE.Vector3(0, 0, 0);
    this.chaseLookTarget = new THREE.Vector3(0, 0.5, 16);

    // 3. Initialize Betaflight Rates, Warehouse Scene, Physics, Drone 3D Mesh & Web Audio
    this.rates = new BetaflightRates();
    this.warehouse = new WarehouseScene(this.scene, this.renderer);
    this.physics = new DronePhysics(this.rates, this.warehouse.colliders);
    this.droneModel = new DroneModel(this.scene);
    this.audio = new DroneAudio();

    this.loadAirframeParams();

    // 4. Input State (Mode 2 Standard + Keyboard RC Smoothing + Gamepad API)
    this.keys = {};
    this.controls = {
      throttle: 0.0,
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0
    };
    this.smoothedKeyAxes = {
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0
    };
    this.gamepadActive = false;
    this.gamepadName = '';

    // 5. Initialize Betaflight Rates Chart & UI Drawer Bindings
    const chartCanvas = document.getElementById('rates-chart-canvas');
    this.ratesChart = new RatesCurveChart(chartCanvas, this.rates);

    this.bindInputEvents();
    this.bindUIControls();
    this.syncUIFromModel();
    this.updateCameraFOV();

    this.lastFrameTime = performance.now();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  loadAirframeParams() {
    try {
      const raw = localStorage.getItem(SIM_PARAMS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.thrustToWeight === 'number') {
        this.physics.params.thrustToWeight = THREE.MathUtils.clamp(data.thrustToWeight, 2.5, 9.0);
      }
      if (typeof data.cameraUptiltDeg === 'number') {
        this.physics.params.cameraUptiltDeg = THREE.MathUtils.clamp(data.cameraUptiltDeg, 0, 45);
        this.droneModel.setCameraUptilt(this.physics.params.cameraUptiltDeg);
      }
    } catch (_) {
      // Ignore storage errors
    }
  }

  saveAirframeParams() {
    try {
      localStorage.setItem(SIM_PARAMS_STORAGE_KEY, JSON.stringify({
        thrustToWeight: this.physics.params.thrustToWeight,
        cameraUptiltDeg: this.physics.params.cameraUptiltDeg
      }));
    } catch (_) {}
  }

  bindInputEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    window.addEventListener('keydown', (e) => {
      // Unlock Web Audio on first user interaction
      this.audio.init();

      // Prevent default scrolling for arrow keys and Tab
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
        if (document.activeElement.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }

      if (e.repeat) return;
      this.keys[e.code] = true;

      // Hotkeys (ignore if typing inside a number input)
      if (document.activeElement && document.activeElement.tagName === 'INPUT' && e.code !== 'Tab') {
        return;
      }

      if (e.code === 'KeyM') {
        this.toggleFlightMode();
      } else if (e.code === 'KeyC') {
        this.toggleCameraMode();
      } else if (e.code === 'KeyR') {
        this.resetDrone();
      } else if (e.code === 'Tab' || e.code === 'KeyP') {
        e.preventDefault();
        this.toggleTuningDrawer();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('pointerdown', () => {
      this.audio.init();
    });

    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadActive = true;
      this.gamepadName = e.gamepad.id;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadActive = false;
    });
  }

  bindUIControls() {
    // Top bar action pills
    document.getElementById('btn-mode-toggle').addEventListener('click', () => this.toggleFlightMode());
    document.getElementById('btn-cam-toggle').addEventListener('click', () => this.toggleCameraMode());
    document.getElementById('btn-reset-drone').addEventListener('click', () => this.resetDrone());
    document.getElementById('btn-audio-toggle').addEventListener('click', () => {
      this.audio.init();
      const muted = this.audio.toggleMute();
      document.getElementById('audio-status-text').textContent = muted ? 'MUTED' : 'AUDIO ON';
    });
    document.getElementById('btn-drawer-toggle').addEventListener('click', () => this.toggleTuningDrawer());

    // Preset Buttons (Cinematic / Freestyle / Racing)
    const presetButtons = document.querySelectorAll('[data-preset]');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        this.rates.applyPreset(key);
        presetButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.syncUIFromModel();
      });
    });

    // Roll, Pitch, Yaw Sliders & Number Inputs
    const axes = ['roll', 'pitch', 'yaw'];
    const params = ['rcRate', 'superRate', 'expo'];

    for (const axis of axes) {
      for (const param of params) {
        const slider = document.getElementById(`slider-${axis}-${param}`);
        const numInput = document.getElementById(`num-${axis}-${param}`);

        const onUpdate = (val) => {
          this.rates.setAxisParam(axis, param, val);
          presetButtons.forEach((b) => b.classList.remove('active'));
          this.syncUIFromModel();
        };

        if (slider) {
          slider.addEventListener('input', (e) => onUpdate(e.target.value));
        }
        if (numInput) {
          numInput.addEventListener('change', (e) => onUpdate(e.target.value));
        }
      }
    }

    // Airframe & Camera Sliders (TWR, Camera Uptilt, Keyboard RC Smoothing)
    const twrSlider = document.getElementById('slider-twr');
    const twrNum = document.getElementById('num-twr');
    const uptiltSlider = document.getElementById('slider-uptilt');
    const uptiltNum = document.getElementById('num-uptilt');
    const smoothSlider = document.getElementById('slider-smoothing');
    const smoothNum = document.getElementById('num-smoothing');

    const updateTWR = (val) => {
      const v = THREE.MathUtils.clamp(Number(val) || 5.5, 2.5, 9.0);
      this.physics.params.thrustToWeight = v;
      twrSlider.value = v;
      twrNum.value = v.toFixed(1);
      this.saveAirframeParams();
    };
    twrSlider.addEventListener('input', (e) => updateTWR(e.target.value));
    twrNum.addEventListener('change', (e) => updateTWR(e.target.value));

    const updateUptilt = (val) => {
      const v = THREE.MathUtils.clamp(Number(val) || 15, 0, 45);
      this.physics.params.cameraUptiltDeg = v;
      this.droneModel.setCameraUptilt(v);
      uptiltSlider.value = v;
      uptiltNum.value = Math.round(v);
      this.saveAirframeParams();
    };
    uptiltSlider.addEventListener('input', (e) => updateUptilt(e.target.value));
    uptiltNum.addEventListener('change', (e) => updateUptilt(e.target.value));

    const updateSmooth = (val) => {
      const v = THREE.MathUtils.clamp(Number(val) || 12, 3, 35);
      this.rates.rcSmoothingCutoff = v;
      smoothSlider.value = v;
      smoothNum.value = Math.round(v);
      this.rates.saveToStorage();
    };
    smoothSlider.addEventListener('input', (e) => updateSmooth(e.target.value));
    smoothNum.addEventListener('change', (e) => updateSmooth(e.target.value));

    // Reset to Default Button
    document.getElementById('btn-reset-rates').addEventListener('click', () => {
      this.rates.resetToDefault();
      this.physics.params.thrustToWeight = 5.5;
      this.physics.params.cameraUptiltDeg = 15;
      this.rates.rcSmoothingCutoff = 12;
      this.droneModel.setCameraUptilt(15);
      this.saveAirframeParams();
      presetButtons.forEach((b) => b.classList.remove('active'));
      this.syncUIFromModel();
    });
  }

  syncUIFromModel() {
    const axes = ['roll', 'pitch', 'yaw'];
    const params = ['rcRate', 'superRate', 'expo'];

    for (const axis of axes) {
      const cfg = this.rates.axes[axis];
      const metrics = this.rates.getAxisMetrics(axis);

      const metricsEl = document.getElementById(`metrics-${axis}`);
      if (metricsEl) {
        metricsEl.textContent = `Max: ${metrics.maxVel}°/s | Center: ${metrics.centerSens}°/s`;
      }

      for (const param of params) {
        const slider = document.getElementById(`slider-${axis}-${param}`);
        const numInput = document.getElementById(`num-${axis}-${param}`);
        if (slider) slider.value = cfg[param];
        if (numInput) numInput.value = cfg[param].toFixed(2);
      }
    }

    document.getElementById('slider-twr').value = this.physics.params.thrustToWeight;
    document.getElementById('num-twr').value = this.physics.params.thrustToWeight.toFixed(1);
    document.getElementById('slider-uptilt').value = this.physics.params.cameraUptiltDeg;
    document.getElementById('num-uptilt').value = Math.round(this.physics.params.cameraUptiltDeg);
    document.getElementById('slider-smoothing').value = this.rates.rcSmoothingCutoff;
    document.getElementById('num-smoothing').value = Math.round(this.rates.rcSmoothingCutoff);

    this.ratesChart.render(this.controls);
  }

  toggleFlightMode() {
    const mode = this.physics.toggleFlightMode();
    const badge = document.getElementById('btn-mode-toggle');
    const text = document.getElementById('mode-status-text');
    if (mode === 'ANGLE') {
      badge.className = 'hud-badge mode-angle';
      text.textContent = 'MODE: ANGLE (自穩)';
    } else {
      badge.className = 'hud-badge mode-acro';
      text.textContent = 'MODE: ACRO (特技)';
    }
  }

  toggleCameraMode() {
    this.cameraMode = this.cameraMode === 'FPV' ? 'CHASE' : 'FPV';
    this.updateCameraFOV();
    const text = document.getElementById('cam-status-text');
    text.textContent = this.cameraMode === 'FPV' ? 'CAM: FPV 100°' : 'CAM: CHASE 3RD';
  }

  updateCameraFOV() {
    this.camera.fov = this.cameraMode === 'FPV' ? 100 : 68;
    this.camera.updateProjectionMatrix();
  }

  resetDrone() {
    this.physics.reset();
    this.controls.throttle = 0.0;
    this.controls.yaw = 0.0;
    this.controls.pitch = 0.0;
    this.controls.roll = 0.0;
    this.smoothedKeyAxes.yaw = 0;
    this.smoothedKeyAxes.pitch = 0;
    this.smoothedKeyAxes.roll = 0;

    this.chaseCamPos.set(0, 1.35, 20.6);
    this.chaseCamVel.set(0, 0, 0);
  }

  toggleTuningDrawer() {
    const drawer = document.getElementById('tuning-drawer');
    drawer.classList.toggle('collapsed');
  }

  /**
   * Process Mode 2 Keyboard Input (with 1st-Order Low-Pass RC Smoothing) & Native Gamepad API
   */
  updateInputs(dt) {
    // 1. Check Native Gamepad API first
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }

    const applyDeadzone = (v, dz = 0.05) => {
      if (Math.abs(v) < dz) return 0;
      return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
    };

    const hasKeyboardInput =
      this.keys['KeyW'] || this.keys['KeyS'] ||
      this.keys['KeyA'] || this.keys['KeyD'] ||
      this.keys['ArrowUp'] || this.keys['ArrowDown'] ||
      this.keys['ArrowLeft'] || this.keys['ArrowRight'];

    if (gp && !hasKeyboardInput) {
      // Standard Mode 2 Gamepad mapping:
      // Left Stick: Axis 0 = Yaw, Axis 1 = Throttle (inverted: -1 is up)
      // Right Stick: Axis 2 = Roll, Axis 3 = Pitch (inverted: -1 is up/forward)
      const rawYaw = applyDeadzone(gp.axes[0] || 0);
      const rawThr = -(gp.axes[1] || 0); // [-1, 1]
      const rawRoll = applyDeadzone(gp.axes[2] || 0);
      const rawPitch = applyDeadzone(-(gp.axes[3] || 0));

      // Analog sticks bypass keyboard smoothing and pass raw axis values directly
      this.controls.throttle = THREE.MathUtils.clamp((rawThr + 1.0) * 0.5, 0, 1);
      this.controls.yaw = THREE.MathUtils.clamp(rawYaw, -1, 1);
      this.controls.roll = THREE.MathUtils.clamp(rawRoll, -1, 1);
      this.controls.pitch = THREE.MathUtils.clamp(rawPitch, -1, 1);
      return;
    }

    // 2. Mode 2 Keyboard Controls with RC Smoothing (1st-order Low-Pass Filter)
    // W / S: Throttle (油門)
    // Hover throttle helper: hover occurs at T = sqrt(1 / TWR)
    const hoverThrottle = Math.sqrt(1.0 / this.physics.params.thrustToWeight);
    if (this.keys['KeyW']) {
      // Smoothly ramp throttle up
      this.controls.throttle = Math.min(1.0, this.controls.throttle + 0.72 * dt);
    } else if (this.keys['KeyS']) {
      // Smoothly ramp throttle down
      this.controls.throttle = Math.max(0.0, this.controls.throttle - 0.78 * dt);
    } else {
      // Gentle spring-assist toward hover throttle when airborne so keyboard flight is effortless
      if (this.physics.position.y > 0.35 && this.controls.throttle > 0.12) {
        this.controls.throttle += (hoverThrottle - this.controls.throttle) * Math.min(1, dt * 3.2);
      }
    }

    // Digital target inputs in [-1, 1]
    const rawKeyYaw = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const rawKeyPitch = (this.keys['ArrowUp'] ? 1 : 0) - (this.keys['ArrowDown'] ? 1 : 0);
    const rawKeyRoll = (this.keys['ArrowRight'] ? 1 : 0) - (this.keys['ArrowLeft'] ? 1 : 0);

    // First-Order Low-Pass Filter (RC Smoothing) prevents instantaneous 0->1 snaps at high Rates
    const cutoff = this.rates.rcSmoothingCutoff;
    const alphaRise = 1.0 - Math.exp(-cutoff * dt);
    const alphaFall = 1.0 - Math.exp(-cutoff * 1.45 * dt);

    this.smoothedKeyAxes.yaw += (rawKeyYaw - this.smoothedKeyAxes.yaw) * (rawKeyYaw !== 0 ? alphaRise : alphaFall);
    this.smoothedKeyAxes.pitch += (rawKeyPitch - this.smoothedKeyAxes.pitch) * (rawKeyPitch !== 0 ? alphaRise : alphaFall);
    this.smoothedKeyAxes.roll += (rawKeyRoll - this.smoothedKeyAxes.roll) * (rawKeyRoll !== 0 ? alphaRise : alphaFall);

    if (Math.abs(this.smoothedKeyAxes.yaw) < 0.004) this.smoothedKeyAxes.yaw = 0;
    if (Math.abs(this.smoothedKeyAxes.pitch) < 0.004) this.smoothedKeyAxes.pitch = 0;
    if (Math.abs(this.smoothedKeyAxes.roll) < 0.004) this.smoothedKeyAxes.roll = 0;

    this.controls.yaw = this.smoothedKeyAxes.yaw;
    this.controls.pitch = this.smoothedKeyAxes.pitch;
    this.controls.roll = this.smoothedKeyAxes.roll;
  }

  /**
   * Update Camera Transform (FPV 100° with Camera Uptilt vs Spring-Damper 3rd-Person Chase)
   */
  updateCamera(dt) {
    if (this.cameraMode === 'FPV') {
      // FPV Camera mounted at front of drone with configurable Camera Uptilt (default 15 deg)
      const camOffsetLocal = new THREE.Vector3(0, 0.032, -0.078);
      const worldPos = camOffsetLocal.applyQuaternion(this.physics.quaternion).add(this.physics.position);
      this.camera.position.copy(worldPos);

      const uptiltRad = THREE.MathUtils.degToRad(this.physics.params.cameraUptiltDeg);
      const uptiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), uptiltRad);
      this.camera.quaternion.copy(this.physics.quaternion).multiply(uptiltQuat);
    } else {
      // Third-Person Chase Camera with Smooth Spring-Damper Follow
      const euler = new THREE.Euler().setFromQuaternion(this.physics.quaternion, 'YXZ');
      const yawOnlyQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);

      // Desired camera offset behind and slightly above the drone
      const desiredOffset = new THREE.Vector3(0, 0.72, 2.15).applyQuaternion(yawOnlyQuat);
      const desiredPos = this.physics.position.clone().add(desiredOffset);
      desiredPos.y = Math.max(0.28, Math.min(11.3, desiredPos.y));
      desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, -21.2, 21.2);
      desiredPos.z = THREE.MathUtils.clamp(desiredPos.z, -27.2, 27.2);

      // Critically-damped spring integration
      const stiffness = 140.0;
      const damping = 22.0;
      const displacement = desiredPos.clone().sub(this.chaseCamPos);
      const springForce = displacement.multiplyScalar(stiffness).sub(this.chaseCamVel.clone().multiplyScalar(damping));
      this.chaseCamVel.addScaledVector(springForce, Math.min(dt, 0.04));
      this.chaseCamPos.addScaledVector(this.chaseCamVel, Math.min(dt, 0.04));

      this.camera.position.copy(this.chaseCamPos);

      const forwardLookOffset = new THREE.Vector3(0, 0.12, -1.6).applyQuaternion(yawOnlyQuat);
      const desiredTarget = this.physics.position.clone().add(forwardLookOffset);
      this.chaseLookTarget.lerp(desiredTarget, Math.min(1, dt * 16));
      this.camera.lookAt(this.chaseLookTarget);
    }
  }

  /**
   * Render FPV On-Screen Display (OSD / HUD):
   * Artificial Horizon, Throttle %, Altitude (m), Speed (m/s), Flight Mode, Battery Voltage & Stick Gimbals
   */
  renderOSD() {
    const canvas = this.osdCanvas;
    const ctx = this.osdCtx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const tel = this.physics.telemetry;
    const bat = this.physics.battery;

    // 1. Artificial Horizon & Pitch Ladder in Center of Screen
    ctx.save();
    ctx.translate(cx, cy);

    // Center Fixed Aircraft Reticle (W-shape)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(-10, 0); ctx.lineTo(-5, 6); ctx.lineTo(0, 0);
    ctx.lineTo(5, 6); ctx.lineTo(10, 0); ctx.lineTo(26, 0);
    ctx.stroke();

    // Rotate by Roll & translate by Pitch for dynamic Artificial Horizon
    const rollRad = THREE.MathUtils.degToRad(tel.rollDeg);
    const pixelsPerDeg = 4.2;
    const pitchOffsetPx = THREE.MathUtils.clamp(tel.pitchDeg * pixelsPerDeg, -140, 140);

    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffsetPx);

    // Main Horizon Line (0 deg)
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.78)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-110, 0); ctx.lineTo(-36, 0);
    ctx.moveTo(36, 0);   ctx.lineTo(110, 0);
    ctx.stroke();

    // Pitch Ladder Bars (-30, -15, +15, +30 deg)
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(52, 211, 153, 0.8)';
    for (const deg of [-30, -15, 15, 30]) {
      const y = -deg * pixelsPerDeg;
      ctx.beginPath();
      if (deg < 0) ctx.setLineDash([4, 3]);
      else ctx.setLineDash([]);
      ctx.moveTo(-52, y); ctx.lineTo(-24, y);
      ctx.moveTo(-24, y); ctx.lineTo(-24, y + (deg > 0 ? 5 : -5));
      ctx.moveTo(24, y);  ctx.lineTo(52, y);
      ctx.moveTo(24, y);  ctx.lineTo(24, y + (deg > 0 ? 5 : -5));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, 56, y + 3);
    }
    ctx.restore();

    // 2. Left Telemetry Column: Speed (m/s) & Throttle Bar (%)
    const leftX = cx - 225;
    ctx.fillStyle = 'rgba(11, 16, 26, 0.65)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.fillRect(leftX - 88, cy - 52, 86, 104);
    ctx.strokeRect(leftX - 88, cy - 52, 86, 104);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('SPEED', leftX - 80, cy - 34);
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`${tel.speed.toFixed(1)}`, leftX - 80, cy - 13);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('m/s', leftX - 30, cy - 13);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText('THROTTLE', leftX - 80, cy + 14);
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${tel.throttlePct}%`, leftX - 80, cy + 34);

    // Throttle Vertical Bar
    const barX = leftX - 16;
    const barY = cy - 42;
    const barH = 84;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(barX, barY, 6, barH);
    const fillH = (tel.throttlePct / 100) * barH;
    ctx.fillStyle = tel.throttlePct > 85 ? '#f43f5e' : '#10b981';
    ctx.fillRect(barX, barY + barH - fillH, 6, fillH);

    // 3. Right Telemetry Column: Altitude (m) & Vertical Speed (m/s)
    const rightX = cx + 140;
    ctx.fillStyle = 'rgba(11, 16, 26, 0.65)';
    ctx.fillRect(rightX, cy - 52, 92, 104);
    ctx.strokeRect(rightX, cy - 52, 92, 104);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ALTITUDE', rightX + 10, cy - 34);
    ctx.font = 'bold 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#34d399';
    ctx.fillText(`${tel.altitude.toFixed(2)}`, rightX + 10, cy - 13);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('m', rightX + 68, cy - 13);

    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText('VARIO', rightX + 10, cy + 14);
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e2e8f0';
    const vsSign = tel.verticalSpeed >= 0 ? '+' : '';
    ctx.fillText(`${vsSign}${tel.verticalSpeed.toFixed(1)} m/s`, rightX + 10, cy + 34);

    // 4. Bottom OSD Status Strip: Flight Mode, Virtual Battery Voltage, Gate Lap Timer & Dual Stick Gimbals
    const botY = h - 32;
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';

    // Virtual 6S LiPo Battery Readout
    const batColor = bat.cellVoltage < 3.65 ? '#f43f5e' : '#34d399';
    ctx.fillStyle = batColor;
    ctx.fillText(
      `BAT 6S ${bat.voltage.toFixed(1)}V (${bat.cellVoltage.toFixed(2)}V/cell) | ${bat.currentAmps.toFixed(1)}A`,
      cx,
      botY - 82
    );

    // Race Gate Checkpoint Progress
    const gateNum = this.warehouse.activeGateIndex + 1;
    const totalGates = this.warehouse.gates.length;
    const lapStr = this.warehouse.bestLapTime
      ? `BEST ${this.warehouse.bestLapTime.toFixed(2)}s`
      : 'FLY THROUGH GREEN GATES';
    ctx.fillStyle = '#38bdf8';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText(`GATE ${gateNum}/${totalGates}  •  LAP ${this.warehouse.lapCount}  •  ${lapStr}`, cx, 36);

    // Dual Mode-2 Transmitter Stick Gimbal Overlay (Bottom Center)
    this.drawGimbalStick(ctx, cx - 54, h - 46, 30, this.controls.yaw, this.controls.throttle * 2 - 1, 'THR/YAW');
    this.drawGimbalStick(ctx, cx + 54, h - 46, 30, this.controls.roll, this.controls.pitch, 'ROLL/PIT');

    ctx.restore();
  }

  drawGimbalStick(ctx, x, y, r, stickX, stickY, label) {
    ctx.save();
    ctx.fillStyle = 'rgba(11, 16, 26, 0.72)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();

    // Crosshairs
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.beginPath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.stroke();

    // Stick Dot
    const dx = x + THREE.MathUtils.clamp(stickX, -1, 1) * (r - 5);
    const dy = y - THREE.MathUtils.clamp(stickY, -1, 1) * (r - 5);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(dx, dy, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 11);
    ctx.restore();
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    // 1. Update Inputs (Keyboard with RC Smoothing / Gamepad API)
    this.updateInputs(dt);

    // 2. Step 6-DoF Physics & Flight Controller
    this.physics.update(dt, this.controls);

    // 3. Check LED Racing Gate Checkpoint Pass
    if (this.warehouse.checkGatePass(this.physics.position)) {
      this.audio.playGateChime();
    }

    // 4. Update 3D Drone Model, Camera, Web Audio Synthesizer & OSD
    this.droneModel.update(dt, this.physics);
    this.updateCamera(dt);
    this.audio.update(this.physics);

    // 5. Render Three.js Scene & 2D OSD + Live Betaflight Rates Curve
    this.renderer.render(this.scene, this.camera);
    this.renderOSD();
    this.ratesChart.render(this.controls);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new IndoorDroneSimulator();
});
