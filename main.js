/**
 * Main Application Entry: 3D Indoor Drone Simulator & Betaflight Rates Configurator (main.js)
 * Supports Mobile Multi-Touch Dual Virtual Gimbals (Mode 2), Keyboard (with RC Smoothing), and Gamepad API.
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
    this.cameraMode = 'CHASE';
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

    // 4. Input State (Mode 2 Virtual Touch Gimbals + Keyboard RC Smoothing + Gamepad API)
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

    // Dual Virtual Touch Gimbal State
    this.touchSticks = {
      left:  { active: false, pointerId: null, x: 0.0, y: -1.0 }, // x: yaw [-1,1], y: throttle [-1,1]
      right: { active: false, pointerId: null, x: 0.0, y: 0.0 }   // x: roll [-1,1], y: pitch [-1,1]
    };

    // 5. Initialize Betaflight Rates Chart & UI Drawer Bindings
    const chartCanvas = document.getElementById('rates-chart-canvas');
    this.ratesChart = new RatesCurveChart(chartCanvas, this.rates);

    // On mobile screens, collapse the tuning drawer initially so the 3D view & virtual sticks are unobstructed
    if (window.innerWidth <= 860) {
      this.setTuningDrawerCollapsed(true);
    } else {
      this.setTuningDrawerCollapsed(false);
    }

    this.bindInputEvents();
    this.bindVirtualGimbals();
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
    } catch (_) {}
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
      this.audio.init();

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
        if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }

      if (e.repeat) return;
      this.keys[e.code] = true;

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
    }, { passive: true });
  }

  /**
   * Bind Multi-Touch & Mouse Drag Virtual Gimbals (Mode 2: Left = Throttle/Yaw, Right = Pitch/Roll)
   */
  bindVirtualGimbals() {
    const setupGimbal = (side, containerId) => {
      const gimbalEl = document.getElementById(containerId);
      if (!gimbalEl) return;
      const ringEl = gimbalEl.querySelector('.gimbal-ring');
      const stickState = this.touchSticks[side];

      const updateStickFromPoint = (clientX, clientY) => {
        const rect = ringEl.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.5;
        const maxRadius = Math.max(36, (rect.width * 0.5) - 22);

        const dx = clientX - centerX;
        const dy = clientY - centerY;

        // Normalize to [-1, 1]; invert Y so pushing up is +1
        stickState.x = THREE.MathUtils.clamp(dx / maxRadius, -1.0, 1.0);
        stickState.y = THREE.MathUtils.clamp(-dy / maxRadius, -1.0, 1.0);
      };

      ringEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.audio.init();

        stickState.active = true;
        stickState.pointerId = e.pointerId;
        ringEl.classList.add('active');
        try {
          ringEl.setPointerCapture(e.pointerId);
        } catch (_) {}

        updateStickFromPoint(e.clientX, e.clientY);
      });

      ringEl.addEventListener('pointermove', (e) => {
        if (!stickState.active || e.pointerId !== stickState.pointerId) return;
        e.preventDefault();
        updateStickFromPoint(e.clientX, e.clientY);
      });

      const endStick = (e) => {
        if (!stickState.active || e.pointerId !== stickState.pointerId) return;
        e.preventDefault();
        stickState.active = false;
        stickState.pointerId = null;
        ringEl.classList.remove('active');
        try {
          if (ringEl.hasPointerCapture(e.pointerId)) {
            ringEl.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}

        if (side === 'right') {
          // Right gimbal (Pitch & Roll) springs back to center (0, 0)
          stickState.x = 0.0;
          stickState.y = 0.0;
        } else {
          // Left gimbal: Yaw (x) springs back to center 0; Throttle (y) holds hover unless pulled down to idle
          stickState.x = 0.0;
          if (stickState.y < -0.65 && this.physics.position.y < 0.45) {
            stickState.y = -1.0;
            this.controls.throttle = 0.0;
          } else {
            const hoverThr = Math.sqrt(1.0 / this.physics.params.thrustToWeight);
            stickState.y = hoverThr * 2.0 - 1.0;
            this.controls.throttle = hoverThr;
          }
        }
      };

      ringEl.addEventListener('pointerup', endStick);
      ringEl.addEventListener('pointercancel', endStick);
    };

    setupGimbal('left', 'gimbal-left');
    setupGimbal('right', 'gimbal-right');
  }

  /**
   * Update visual knob positions & percentage readouts on the dual virtual gimbals
   */
  updateVirtualGimbalVisuals() {
    const leftRing = document.querySelector('#gimbal-left .gimbal-ring');
    const rightRing = document.querySelector('#gimbal-right .gimbal-ring');
    const knobLeft = document.getElementById('knob-left');
    const knobRight = document.getElementById('knob-right');
    const readoutLeft = document.getElementById('readout-left');
    const readoutRight = document.getElementById('readout-right');

    if (leftRing && knobLeft) {
      const maxR = Math.max(32, (leftRing.clientWidth * 0.5) - 24);
      const lx = this.controls.yaw * maxR;
      const ly = -(this.controls.throttle * 2.0 - 1.0) * maxR;
      knobLeft.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
    }
    if (rightRing && knobRight) {
      const maxR = Math.max(32, (rightRing.clientWidth * 0.5) - 24);
      const rx = this.controls.roll * maxR;
      const ry = -this.controls.pitch * maxR;
      knobRight.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
    }
    if (readoutLeft) {
      const thrPct = Math.round(this.controls.throttle * 100);
      const yawPct = Math.round(this.controls.yaw * 100);
      readoutLeft.textContent = `THR ${thrPct}% · YAW ${yawPct > 0 ? '+' : ''}${yawPct}%`;
    }
    if (readoutRight) {
      const pitPct = Math.round(this.controls.pitch * 100);
      const rolPct = Math.round(this.controls.roll * 100);
      readoutRight.textContent = `PIT ${pitPct > 0 ? '+' : ''}${pitPct}% · ROL ${rolPct > 0 ? '+' : ''}${rolPct}%`;
    }
  }

  bindUIControls() {
    // Top bar action pills & drawer close button
    const bindBtn = (id, fn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
        el.blur();
      });
    };

    bindBtn('btn-mode-toggle', () => this.toggleFlightMode());
    bindBtn('btn-cam-toggle', () => this.toggleCameraMode());
    bindBtn('btn-reset-drone', () => this.resetDrone());
    bindBtn('btn-audio-toggle', () => {
      this.audio.init();
      const muted = this.audio.toggleMute();
      document.getElementById('audio-status-text').textContent = muted ? '🔇 靜音' : '🔊 音效';
    });
    bindBtn('btn-drawer-toggle', () => this.toggleTuningDrawer());
    bindBtn('btn-drawer-close', () => this.setTuningDrawerCollapsed(true));

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

        if (slider) slider.addEventListener('input', (e) => onUpdate(e.target.value));
        if (numInput) numInput.addEventListener('change', (e) => onUpdate(e.target.value));
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
    bindBtn('btn-reset-rates', () => {
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
    this.touchSticks.left.x = 0.0;
    this.touchSticks.left.y = -1.0;
    this.touchSticks.right.x = 0.0;
    this.touchSticks.right.y = 0.0;

    this.chaseCamPos.set(0, 1.35, 20.6);
    this.chaseCamVel.set(0, 0, 0);
  }

  setTuningDrawerCollapsed(collapsed) {
    const drawer = document.getElementById('tuning-drawer');
    const label = document.getElementById('drawer-toggle-label');
    if (!drawer) return;
    drawer.classList.toggle('collapsed', collapsed);
    if (label) {
      label.textContent = collapsed ? '⚙ 展開調校面板' : '✕ 收合調校面板';
    }
    if (!collapsed) {
      // Re-render chart once layout is visible
      requestAnimationFrame(() => this.ratesChart.render(this.controls));
    }
  }

  toggleTuningDrawer() {
    const drawer = document.getElementById('tuning-drawer');
    if (!drawer) return;
    const isCollapsed = drawer.classList.contains('collapsed');
    this.setTuningDrawerCollapsed(!isCollapsed);
  }

  /**
   * Process On-Screen Virtual Gimbals, Mode 2 Keyboard (with RC Smoothing), and Native Gamepad API
   */
  updateInputs(dt) {
    // 1. Check if user is actively touching/dragging either On-Screen Virtual Gimbal
    const leftTouch = this.touchSticks.left;
    const rightTouch = this.touchSticks.right;

    // 2. Check Native Gamepad API
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

    if (leftTouch.active || rightTouch.active) {
      // On-Screen Virtual Gimbal Control (direct analog stick mapping)
      if (leftTouch.active) {
        this.controls.throttle = THREE.MathUtils.clamp((leftTouch.y + 1.0) * 0.5, 0, 1);
        this.controls.yaw = applyDeadzone(leftTouch.x, 0.04);
      } else {
        this.controls.yaw = 0;
      }

      if (rightTouch.active) {
        this.controls.roll = applyDeadzone(rightTouch.x, 0.04);
        this.controls.pitch = applyDeadzone(rightTouch.y, 0.04);
      } else {
        this.controls.roll = 0;
        this.controls.pitch = 0;
      }
      this.updateVirtualGimbalVisuals();
      return;
    }

    if (gp && !hasKeyboardInput) {
      const rawYaw = applyDeadzone(gp.axes[0] || 0);
      const rawThr = -(gp.axes[1] || 0);
      const rawRoll = applyDeadzone(gp.axes[2] || 0);
      const rawPitch = applyDeadzone(-(gp.axes[3] || 0));

      this.controls.throttle = THREE.MathUtils.clamp((rawThr + 1.0) * 0.5, 0, 1);
      this.controls.yaw = THREE.MathUtils.clamp(rawYaw, -1, 1);
      this.controls.roll = THREE.MathUtils.clamp(rawRoll, -1, 1);
      this.controls.pitch = THREE.MathUtils.clamp(rawPitch, -1, 1);
      this.updateVirtualGimbalVisuals();
      return;
    }

    // 3. Mode 2 Keyboard Controls with RC Smoothing (1st-order Low-Pass Filter)
    const hoverThrottle = Math.sqrt(1.0 / this.physics.params.thrustToWeight);
    if (this.keys['KeyW']) {
      this.controls.throttle = Math.min(1.0, this.controls.throttle + 0.72 * dt);
    } else if (this.keys['KeyS']) {
      this.controls.throttle = Math.max(0.0, this.controls.throttle - 0.78 * dt);
    } else {
      if (this.physics.position.y > 0.35 && this.controls.throttle > 0.12) {
        this.controls.throttle += (hoverThrottle - this.controls.throttle) * Math.min(1, dt * 3.2);
      }
    }

    const rawKeyYaw = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const rawKeyPitch = (this.keys['ArrowUp'] ? 1 : 0) - (this.keys['ArrowDown'] ? 1 : 0);
    const rawKeyRoll = (this.keys['ArrowRight'] ? 1 : 0) - (this.keys['ArrowLeft'] ? 1 : 0);

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

    this.updateVirtualGimbalVisuals();
  }

  /**
   * Update Camera Transform (FPV 100° with Camera Uptilt vs Spring-Damper 3rd-Person Chase)
   */
  updateCamera(dt) {
    if (this.cameraMode === 'FPV') {
      const camOffsetLocal = new THREE.Vector3(0, 0.032, -0.078);
      const worldPos = camOffsetLocal.applyQuaternion(this.physics.quaternion).add(this.physics.position);
      this.camera.position.copy(worldPos);

      const uptiltRad = THREE.MathUtils.degToRad(this.physics.params.cameraUptiltDeg);
      const uptiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), uptiltRad);
      this.camera.quaternion.copy(this.physics.quaternion).multiply(uptiltQuat);
    } else {
      const euler = new THREE.Euler().setFromQuaternion(this.physics.quaternion, 'YXZ');
      const yawOnlyQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);

      const desiredOffset = new THREE.Vector3(0, 0.72, 2.15).applyQuaternion(yawOnlyQuat);
      const desiredPos = this.physics.position.clone().add(desiredOffset);
      desiredPos.y = Math.max(0.28, Math.min(11.3, desiredPos.y));
      desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, -21.2, 21.2);
      desiredPos.z = THREE.MathUtils.clamp(desiredPos.z, -27.2, 27.2);

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
   * Render FPV On-Screen Display (OSD / HUD)
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
    const cy = h * 0.44;
    const tel = this.physics.telemetry;
    const bat = this.physics.battery;
    const isCompact = w < 640;

    // 1. Artificial Horizon & Pitch Ladder in Center of Screen
    ctx.save();
    ctx.translate(cx, cy);

    const retSpan = isCompact ? 18 : 26;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-retSpan, 0); ctx.lineTo(-8, 0); ctx.lineTo(-4, 5); ctx.lineTo(0, 0);
    ctx.lineTo(4, 5); ctx.lineTo(8, 0); ctx.lineTo(retSpan, 0);
    ctx.stroke();

    const rollRad = THREE.MathUtils.degToRad(tel.rollDeg);
    const pixelsPerDeg = isCompact ? 3.0 : 4.2;
    const pitchOffsetPx = THREE.MathUtils.clamp(tel.pitchDeg * pixelsPerDeg, -110, 110);

    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffsetPx);

    const hSpan = isCompact ? 68 : 110;
    const hGap = isCompact ? 24 : 36;
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.78)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-hSpan, 0); ctx.lineTo(-hGap, 0);
    ctx.moveTo(hGap, 0);   ctx.lineTo(hSpan, 0);
    ctx.stroke();

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(52, 211, 153, 0.8)';
    for (const deg of [-30, -15, 15, 30]) {
      const y = -deg * pixelsPerDeg;
      ctx.beginPath();
      if (deg < 0) ctx.setLineDash([4, 3]);
      else ctx.setLineDash([]);
      ctx.moveTo(-40, y); ctx.lineTo(-18, y);
      ctx.moveTo(18, y);  ctx.lineTo(40, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!isCompact) {
        ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, 44, y + 3);
      }
    }
    ctx.restore();

    // 2. Telemetry Readout Boxes (Speed, Throttle, Altitude, Battery)
    const offsetSide = isCompact ? Math.min(cx - 8, 155) : 225;
    const boxW = isCompact ? 76 : 88;
    const leftX = cx - offsetSide;

    ctx.fillStyle = 'rgba(11, 16, 26, 0.62)';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 1;
    ctx.fillRect(leftX, cy - 46, boxW, 92);
    ctx.strokeRect(leftX, cy - 46, boxW, 92);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('SPD (m/s)', leftX + 7, cy - 30);
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`${tel.speed.toFixed(1)}`, leftX + 7, cy - 11);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('THR', leftX + 7, cy + 12);
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(`${tel.throttlePct}%`, leftX + 7, cy + 31);

    const rightX = cx + offsetSide - boxW;
    ctx.fillStyle = 'rgba(11, 16, 26, 0.62)';
    ctx.fillRect(rightX, cy - 46, boxW, 92);
    ctx.strokeRect(rightX, cy - 46, boxW, 92);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ALT (m)', rightX + 7, cy - 30);
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillStyle = '#34d399';
    ctx.fillText(`${tel.altitude.toFixed(2)}`, rightX + 7, cy - 11);

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('BAT 6S', rightX + 7, cy + 12);
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.fillStyle = bat.cellVoltage < 3.65 ? '#f43f5e' : '#34d399';
    ctx.fillText(`${bat.voltage.toFixed(1)}V`, rightX + 7, cy + 31);

    // 3. Top Center Gate & Lap Status
    const gateNum = this.warehouse.activeGateIndex + 1;
    const totalGates = this.warehouse.gates.length;
    const lapStr = this.warehouse.bestLapTime
      ? `BEST ${this.warehouse.bestLapTime.toFixed(2)}s`
      : '穿越綠色發光門';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillText(`GATE ${gateNum}/${totalGates} • LAP ${this.warehouse.lapCount} • ${lapStr}`, cx, isCompact ? 58 : 34);

    ctx.restore();
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    this.updateInputs(dt);
    this.physics.update(dt, this.controls);

    if (this.warehouse.checkGatePass(this.physics.position)) {
      this.audio.playGateChime();
    }

    this.droneModel.update(dt, this.physics);
    this.updateCamera(dt);
    this.audio.update(this.physics);

    this.renderer.render(this.scene, this.camera);
    this.renderOSD();

    const drawer = document.getElementById('tuning-drawer');
    if (drawer && !drawer.classList.contains('collapsed')) {
      this.ratesChart.render(this.controls);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new IndoorDroneSimulator();
});
