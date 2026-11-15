/**
 * Main Application Entry: Taipei Dome 5v5 Drone Soccer & Indoor FPV Simulator (main.js)
 *
 * Features:
 * - True Landscape Game (橫向遊戲): Auto-rotates stage 90° on portrait mobile screens so it always plays in wide Landscape
 * - Taipei Dome 5v5 Drone Soccer Match (10 Spherical Carbon-Fiber Exoskeleton Drones: 5 Red LED vs 5 Blue LED,
 *   Netted Court, Suspended Glowing Circular Ring Goals, Curved White Space-Frame Roof Trusses, Live Jumbotron)
 * - Indoor Warehouse FPV Racing Scene (switchable anytime via top HUD button or V key)
 * - 6-DoF Rigid-Body Physics + Betaflight Classic Rates Live Curve Drawer
 */

import * as THREE from 'three';
import { BetaflightRates, RatesCurveChart } from './rates.js?v=20261115_5';
import { DronePhysics } from './physics.js?v=20261115_5';
import { DroneModel } from './drone.js?v=20261115_5';
import { WarehouseScene } from './warehouse.js?v=20261115_5';
import { TaipeiDomeSoccerScene } from './taipei_dome.js?v=20261115_5';
import { DroneAudio } from './audio.js?v=20261115_5';

const SIM_PARAMS_STORAGE_KEY = 'indoor_drone_sim_params_v1';

class IndoorDroneSimulator {
  constructor() {
    this.container = document.getElementById('webgl-container');
    this.osdCanvas = document.getElementById('osd-canvas');
    this.osdCtx = this.osdCanvas.getContext('2d');

    const stageDim = this.getStageDimensions();

    // 1. Initialize Three.js Renderer with ACESFilmicToneMapping & PCFSoftShadowMap
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(stageDim.width, stageDim.height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 2. Initialize Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, stageDim.width / stageDim.height, 0.05, 150);

    // Camera Mode: 'STADIUM' (16mm Wide Broadcast Chase, FOV 80°), 'CHASE' (Close 3rd, FOV 68°), 'FPV' (FOV 100°)
    this.cameraMode = 'STADIUM';
    this.chaseCamPos = new THREE.Vector3(0, 3.6, 9.2);
    this.chaseLookTarget = new THREE.Vector3(0, 2.8, 0);
    this.lastValidYaw = 0;

    // 3. Initialize Betaflight Rates, Warehouse Scene, Taipei Dome 5v5 Drone Soccer Scene, Physics, Drone 3D Mesh & Audio
    this.rates = new BetaflightRates();
    this.warehouse = new WarehouseScene(this.scene, this.renderer);
    this.taipeiDome = new TaipeiDomeSoccerScene(this.scene, this.renderer);
    this.physics = new DronePhysics(this.rates, this.taipeiDome.colliders);
    this.droneModel = new DroneModel(this.scene);
    this.audio = new DroneAudio();

    // Default Scene: 'TAIPEI_DOME' (Taipei Dome 5v5 Drone Soccer Match)
    this.arenaMode = 'TAIPEI_DOME';

    this.loadAirframeParams();

    // 4. Input State (Mode 2 Virtual Touch Gimbals + Keyboard RC Smoothing + Gamepad API)
    this.keys = {};
    this.controls = {
      throttle: 0.50,
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
      left:  { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 },
      right: { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 }
    };

    // 5. Initialize Betaflight Rates Chart & UI Drawer Bindings
    const chartCanvas = document.getElementById('rates-chart-canvas');
    this.ratesChart = new RatesCurveChart(chartCanvas, this.rates);

    // Start with tuning drawer collapsed so the full Landscape Arena & Dual Joysticks are visible
    this.setTuningDrawerCollapsed(true);

    // Configure initial Taipei Dome 5v5 Drone Soccer state
    this.applyArenaMode('TAIPEI_DOME');

    this.bindInputEvents();
    this.bindVirtualGimbals();
    this.bindUIControls();
    this.syncUIFromModel();
    this.updateCameraFOV();

    this.lastFrameTime = performance.now();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Returns Landscape stage dimensions even when the device is in Portrait orientation
   * (where CSS rotates #game-stage by 90 degrees so the game is always Horizontal/Landscape)
   */
  getStageDimensions() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < h) {
      return { width: h, height: w, rotated90: true };
    }
    return { width: w, height: h, rotated90: false };
  }

  applyArenaMode(mode) {
    this.arenaMode = mode;
    const isDome = mode === 'TAIPEI_DOME';

    this.warehouse.setVisible(!isDome);
    this.taipeiDome.setVisible(isDome);
    this.droneModel.setExoskeletonEnabled(isDome);

    const scoreBanner = document.getElementById('soccer-hud-scoreboard');
    if (scoreBanner) {
      scoreBanner.style.display = isDome ? 'inline-flex' : 'none';
    }

    const sceneBtn = document.getElementById('btn-scene-toggle');
    const sceneText = document.getElementById('scene-status-text');
    if (sceneBtn && sceneText) {
      sceneBtn.className = isDome ? 'hud-badge scene-dome' : 'hud-badge scene-warehouse';
      sceneText.textContent = isDome ? '🏟️ 大巨蛋足球 5v5' : '🏭 室內倉庫穿越';
    }

    if (isDome) {
      this.scene.background = new THREE.Color(0x060911);
      this.scene.fog = new THREE.FogExp2(0x080d18, 0.0085);
      this.physics.setColliders(this.taipeiDome.colliders);
      this.physics.droneRadius = 0.34;
      this.physics.droneHalfHeight = 0.32;
      this.physics.spawnPoint.set(0, 2.8, 5.4);
    } else {
      this.scene.background = new THREE.Color(0x0c111a);
      this.scene.fog = new THREE.FogExp2(0x0c111a, 0.015);
      this.physics.setColliders(this.warehouse.colliders);
      this.physics.droneRadius = 0.22;
      this.physics.droneHalfHeight = 0.09;
      this.physics.spawnPoint.set(0, 0.13, 18.0);
    }

    this.resetDrone();
  }

  toggleArenaMode() {
    const next = this.arenaMode === 'TAIPEI_DOME' ? 'WAREHOUSE' : 'TAIPEI_DOME';
    this.applyArenaMode(next);
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
    const onResize = () => {
      const dim = this.getStageDimensions();
      this.camera.aspect = dim.width / dim.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(dim.width, dim.height);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));

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
      } else if (e.code === 'KeyV') {
        this.toggleArenaMode();
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
    window.addEventListener('touchstart', () => {
      this.audio.init();
    }, { passive: true });
  }

  /**
   * Bind Multi-Touch (TouchEvent + PointerEvent) & Mouse Drag Virtual Gimbals
   * Automatically transforms touch vectors when #game-stage is rotated 90° in Portrait orientation!
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
        const maxRadius = Math.max(30, (Math.min(rect.width, rect.height) * 0.5) - 18);

        const physDx = clientX - centerX;
        const physDy = clientY - centerY;
        const dim = this.getStageDimensions();

        if (dim.rotated90) {
          // Stage is rotated +90deg clockwise into Landscape:
          // Landscape +X (Right) = physical +Y (Down)
          // Landscape +Y (Up)    = physical +X (Right)
          stickState.x = THREE.MathUtils.clamp(physDy / maxRadius, -1.0, 1.0);
          stickState.y = THREE.MathUtils.clamp(physDx / maxRadius, -1.0, 1.0);
        } else {
          stickState.x = THREE.MathUtils.clamp(physDx / maxRadius, -1.0, 1.0);
          stickState.y = THREE.MathUtils.clamp(-physDy / maxRadius, -1.0, 1.0);
        }
      };

      const releaseStick = () => {
        stickState.active = false;
        stickState.pointerId = null;
        stickState.touchId = null;
        ringEl.classList.remove('active');

        if (side === 'right') {
          stickState.x = 0.0;
          stickState.y = 0.0;
        } else {
          stickState.x = 0.0;
          // If pulled down near bottom while close to floor, cut throttle to land/idle
          if (stickState.y < -0.60 && this.physics.position.y < 0.45) {
            stickState.y = -1.0;
            this.controls.throttle = 0.0;
          } else if (this.physics.position.y > 0.22 || stickState.y > -0.25) {
            // Center stick (y = 0.0, throttle = 0.50) is exact 1.0G Hover in physics.js
            stickState.y = 0.0;
            this.controls.throttle = 0.50;
          } else {
            stickState.y = -1.0;
            this.controls.throttle = 0.0;
          }
        }
      };

      // Touch Events (guaranteed multi-touch support across all mobile browsers & WebViews)
      ringEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.audio.init();
        const touch = e.changedTouches[0];
        if (!touch) return;
        stickState.active = true;
        stickState.touchId = touch.identifier;
        ringEl.classList.add('active');
        updateStickFromPoint(touch.clientX, touch.clientY);
      }, { passive: false });

      ringEl.addEventListener('touchmove', (e) => {
        if (!stickState.active) return;
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === stickState.touchId) {
            updateStickFromPoint(t.clientX, t.clientY);
            break;
          }
        }
      }, { passive: false });

      const onTouchEnd = (e) => {
        if (!stickState.active) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === stickState.touchId) {
            e.preventDefault();
            releaseStick();
            break;
          }
        }
      };
      ringEl.addEventListener('touchend', onTouchEnd, { passive: false });
      ringEl.addEventListener('touchcancel', onTouchEnd, { passive: false });

      // Pointer Events for Desktop Mouse Drag
      ringEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        e.stopPropagation();
        this.audio.init();
        stickState.active = true;
        stickState.pointerId = e.pointerId;
        ringEl.classList.add('active');
        try { ringEl.setPointerCapture(e.pointerId); } catch (_) {}
        updateStickFromPoint(e.clientX, e.clientY);
      });

      ringEl.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        if (!stickState.active || e.pointerId !== stickState.pointerId) return;
        e.preventDefault();
        updateStickFromPoint(e.clientX, e.clientY);
      });

      const endPointer = (e) => {
        if (e.pointerType === 'touch') return;
        if (!stickState.active || e.pointerId !== stickState.pointerId) return;
        e.preventDefault();
        try {
          if (ringEl.hasPointerCapture(e.pointerId)) ringEl.releasePointerCapture(e.pointerId);
        } catch (_) {}
        releaseStick();
      };
      ringEl.addEventListener('pointerup', endPointer);
      ringEl.addEventListener('pointercancel', endPointer);
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
      const maxR = Math.max(28, (leftRing.clientWidth * 0.5) - 22);
      const lx = this.controls.yaw * maxR;
      const ly = -(this.controls.throttle * 2.0 - 1.0) * maxR;
      knobLeft.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
    }
    if (rightRing && knobRight) {
      const maxR = Math.max(28, (rightRing.clientWidth * 0.5) - 22);
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

    bindBtn('btn-scene-toggle', () => this.toggleArenaMode());
    bindBtn('btn-mode-toggle', () => this.toggleFlightMode());
    bindBtn('btn-cam-toggle', () => this.toggleCameraMode());
    bindBtn('btn-reset-drone', () => this.resetDrone());
    bindBtn('btn-audio-toggle', () => {
      this.audio.init();
      const muted = this.audio.toggleMute();
      document.getElementById('audio-status-text').textContent = muted ? '🔇 靜音' : '🔊 音效';
    });
    bindBtn('btn-fullscreen', async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => {});
          }
        } else {
          await document.exitFullscreen();
        }
      } catch (_) {}
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
      text.textContent = 'ANGLE 自穩';
    } else {
      badge.className = 'hud-badge mode-acro';
      text.textContent = 'ACRO 特技';
    }
  }

  toggleCameraMode() {
    if (this.cameraMode === 'STADIUM') {
      this.cameraMode = 'CHASE';
    } else if (this.cameraMode === 'CHASE') {
      this.cameraMode = 'FPV';
    } else {
      this.cameraMode = 'STADIUM';
    }
    this.updateCameraFOV();
    const text = document.getElementById('cam-status-text');
    if (this.cameraMode === 'STADIUM') {
      text.textContent = '視角: 16mm廣角';
    } else if (this.cameraMode === 'CHASE') {
      text.textContent = '視角: 近距追尾';
    } else {
      text.textContent = '視角: FPV 100°';
    }
  }

  updateCameraFOV() {
    if (this.cameraMode === 'FPV') {
      this.camera.fov = 100;
    } else if (this.cameraMode === 'STADIUM') {
      this.camera.fov = 80;
    } else {
      this.camera.fov = 68;
    }
    this.camera.updateProjectionMatrix();
  }

  resetDrone() {
    this.physics.reset();
    this.controls.yaw = 0.0;
    this.controls.pitch = 0.0;
    this.controls.roll = 0.0;
    this.smoothedKeyAxes.yaw = 0;
    this.smoothedKeyAxes.pitch = 0;
    this.smoothedKeyAxes.roll = 0;
    this.touchSticks.left.x = 0.0;
    this.touchSticks.right.x = 0.0;
    this.touchSticks.right.y = 0.0;

    if (this.arenaMode === 'TAIPEI_DOME') {
      // Start hovering mid-air inside the netted Drone Soccer court ready for 5v5 action
      this.controls.throttle = 0.50;
      this.touchSticks.left.y = 0.0;
      this.chaseCamPos.set(0, 3.5, 9.6);
      this.chaseLookTarget.set(0, 2.8, -2.0);
    } else {
      this.controls.throttle = 0.0;
      this.touchSticks.left.y = -1.0;
      this.chaseCamPos.set(0, 1.35, 20.6);
      this.chaseLookTarget.set(0, 0.4, 16);
    }
    this.updateVirtualGimbalVisuals();
  }

  setTuningDrawerCollapsed(collapsed) {
    const drawer = document.getElementById('tuning-drawer');
    const label = document.getElementById('drawer-toggle-label');
    if (!drawer) return;
    drawer.classList.toggle('collapsed', collapsed);
    if (label) {
      label.textContent = collapsed ? '⚙ 調校' : '✕ 收合';
    }
    if (!collapsed) {
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
    const leftTouch = this.touchSticks.left;
    const rightTouch = this.touchSticks.right;

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
      if (leftTouch.active) {
        this.controls.throttle = THREE.MathUtils.clamp((leftTouch.y + 1.0) * 0.5, 0, 1);
        this.controls.yaw = applyDeadzone(leftTouch.x, 0.04);
      } else {
        this.controls.yaw = 0;
        if (rightTouch.active && Math.hypot(rightTouch.x, rightTouch.y) > 0.14 && this.controls.throttle < 0.50) {
          this.controls.throttle = Math.min(0.54, this.controls.throttle + 0.85 * dt);
          leftTouch.y = this.controls.throttle * 2.0 - 1.0;
        } else if (this.physics.position.y > 0.55 && Math.abs(this.controls.throttle - 0.50) < 0.06) {
          this.controls.throttle = 0.50;
          leftTouch.y = 0.0;
        }
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

    // Mode 2 Keyboard Controls with RC Smoothing (1st-order Low-Pass Filter)
    const hoverThrottle = 0.50;
    if (this.keys['KeyW']) {
      this.controls.throttle = Math.min(1.0, this.controls.throttle + 0.65 * dt);
    } else if (this.keys['KeyS']) {
      this.controls.throttle = Math.max(0.0, this.controls.throttle - 0.70 * dt);
    } else {
      if (this.physics.position.y > 0.25 && this.controls.throttle > 0.15) {
        this.controls.throttle += (hoverThrottle - this.controls.throttle) * Math.min(1, dt * 4.5);
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
   * Update Camera Transform:
   * - 'STADIUM': Wide-angle 16mm Taipei Dome broadcast follow perspective
   * - 'CHASE': Close 3rd-person follow
   * - 'FPV': 100° FOV inside the drone with camera uptilt
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
      const forwardWorld = new THREE.Vector3(0, 0, -1).applyQuaternion(this.physics.quaternion);
      const horizLen = Math.hypot(forwardWorld.x, forwardWorld.z);
      let yawAngle = 0;
      if (horizLen > 0.05) {
        yawAngle = Math.atan2(-forwardWorld.x, -forwardWorld.z);
        this.lastValidYaw = yawAngle;
      } else {
        yawAngle = this.lastValidYaw || 0;
      }

      const yawOnlyQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawAngle);

      const isStadiumWide = this.cameraMode === 'STADIUM';
      const offsetVec = isStadiumWide
        ? new THREE.Vector3(0, 0.95, 3.15)
        : new THREE.Vector3(0, 0.65, 1.95);

      const desiredOffset = offsetVec.applyQuaternion(yawOnlyQuat);
      const desiredPos = this.physics.position.clone().add(desiredOffset);

      if (this.arenaMode === 'TAIPEI_DOME') {
        desiredPos.y = Math.max(0.45, Math.min(6.1, desiredPos.y));
        desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, -6.6, 6.6);
        desiredPos.z = THREE.MathUtils.clamp(desiredPos.z, -11.6, 11.6);
      } else {
        desiredPos.y = Math.max(0.28, Math.min(11.3, desiredPos.y));
        desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, -21.2, 21.2);
        desiredPos.z = THREE.MathUtils.clamp(desiredPos.z, -27.2, 27.2);
      }

      // Frame-rate-independent exponential smoothing (never oscillates or jitters)
      const posAlpha = 1.0 - Math.exp(-12.0 * dt);
      this.chaseCamPos.lerp(desiredPos, posAlpha);
      this.camera.position.copy(this.chaseCamPos);

      const forwardLookOffset = new THREE.Vector3(0, 0.15, -2.4).applyQuaternion(yawOnlyQuat);
      const desiredTarget = this.physics.position.clone().add(forwardLookOffset);
      const lookAlpha = 1.0 - Math.exp(-16.0 * dt);
      this.chaseLookTarget.lerp(desiredTarget, lookAlpha);
      this.camera.lookAt(this.chaseLookTarget);
    }
  }

  /**
   * Render FPV On-Screen Display (OSD / HUD) in Landscape Coordinates
   */
  renderOSD() {
    const canvas = this.osdCanvas;
    const ctx = this.osdCtx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dim = this.getStageDimensions();
    const w = dim.width;
    const h = dim.height;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.48;
    const tel = this.physics.telemetry;
    const bat = this.physics.battery;

    // 1. Artificial Horizon & Pitch Ladder in Center of Screen
    ctx.save();
    ctx.translate(cx, cy);

    const retSpan = 22;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.82)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-retSpan, 0); ctx.lineTo(-8, 0); ctx.lineTo(-4, 5); ctx.lineTo(0, 0);
    ctx.lineTo(4, 5); ctx.lineTo(8, 0); ctx.lineTo(retSpan, 0);
    ctx.stroke();

    const rollRad = THREE.MathUtils.degToRad(tel.rollDeg);
    const pixelsPerDeg = 3.2;
    const pitchOffsetPx = THREE.MathUtils.clamp(tel.pitchDeg * pixelsPerDeg, -85, 85);

    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffsetPx);

    const hSpan = 85;
    const hGap = 28;
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-hSpan, 0); ctx.lineTo(-hGap, 0);
    ctx.moveTo(hGap, 0);   ctx.lineTo(hSpan, 0);
    ctx.stroke();

    for (const deg of [-30, -15, 15, 30]) {
      const y = -deg * pixelsPerDeg;
      ctx.beginPath();
      if (deg < 0) ctx.setLineDash([4, 3]);
      else ctx.setLineDash([]);
      ctx.moveTo(-34, y); ctx.lineTo(-16, y);
      ctx.moveTo(16, y);  ctx.lineTo(34, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // 2. Compact Telemetry Readout Boxes Left & Right of Center Reticle
    const offsetSide = Math.min(cx - 155, 185);
    if (offsetSide > 95) {
      const boxW = 78;
      const leftX = cx - offsetSide;

      ctx.fillStyle = 'rgba(11, 16, 26, 0.58)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
      ctx.lineWidth = 1;
      ctx.fillRect(leftX, cy - 42, boxW, 84);
      ctx.strokeRect(leftX, cy - 42, boxW, 84);

      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      ctx.fillText('SPD (m/s)', leftX + 6, cy - 27);
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`${tel.speed.toFixed(1)}`, leftX + 6, cy - 10);

      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('THR', leftX + 6, cy + 10);
      ctx.font = 'bold 14px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(`${tel.throttlePct}%`, leftX + 6, cy + 28);

      const rightX = cx + offsetSide - boxW;
      ctx.fillStyle = 'rgba(11, 16, 26, 0.58)';
      ctx.fillRect(rightX, cy - 42, boxW, 84);
      ctx.strokeRect(rightX, cy - 42, boxW, 84);

      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('ALT (m)', rightX + 6, cy - 27);
      ctx.font = 'bold 15px "JetBrains Mono", monospace';
      ctx.fillStyle = '#34d399';
      ctx.fillText(`${tel.altitude.toFixed(2)}`, rightX + 6, cy - 10);

      ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('BAT 6S', rightX + 6, cy + 10);
      ctx.font = 'bold 13.5px "JetBrains Mono", monospace';
      ctx.fillStyle = bat.cellVoltage < 3.65 ? '#f43f5e' : '#34d399';
      ctx.fillText(`${bat.voltage.toFixed(1)}V`, rightX + 6, cy + 28);
    }

    // 3. Bottom-Center Objective / Goal Status Banner
    ctx.textAlign = 'center';
    if (this.arenaMode === 'TAIPEI_DOME') {
      if (this.taipeiDome.goalFlashTimer > 0) {
        ctx.font = 'bold 16px "JetBrains Mono", sans-serif';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('⚽ GOAL SCORED! 紅隊衝破藍隊圓環球門得分！ (+1)', cx, h - 16);
      } else {
        ctx.font = 'bold 11.5px "JetBrains Mono", sans-serif';
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText('🎯 目標：操控紅隊碳纖維球形無人機，衝過前方藍色發光圓環球門得分！', cx, h - 14);
      }
    } else {
      const gateNum = this.warehouse.activeGateIndex + 1;
      const totalGates = this.warehouse.gates.length;
      const lapStr = this.warehouse.bestLapTime
        ? `BEST ${this.warehouse.bestLapTime.toFixed(2)}s`
        : '穿越綠色發光門';
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillText(`GATE ${gateNum}/${totalGates} • LAP ${this.warehouse.lapCount} • ${lapStr}`, cx, h - 14);
    }

    ctx.restore();
  }

  updateScoreboardDOM() {
    const redEl = document.getElementById('hud-score-red');
    const blueEl = document.getElementById('hud-score-blue');
    const clockEl = document.getElementById('hud-match-clock');
    if (redEl) redEl.textContent = String(this.taipeiDome.scoreRed);
    if (blueEl) blueEl.textContent = String(this.taipeiDome.scoreBlue);
    if (clockEl) {
      const mins = Math.floor(this.taipeiDome.matchTimeSec / 60);
      const secs = Math.floor(this.taipeiDome.matchTimeSec % 60);
      clockEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  }

  animate(now) {
    requestAnimationFrame(this.animate);

    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    this.updateInputs(dt);
    this.physics.update(dt, this.controls);

    if (this.arenaMode === 'TAIPEI_DOME') {
      const res = this.taipeiDome.update(dt, this.physics);
      if (res && res.scoredGoal) {
        this.audio.playGateChime();
      }
      this.updateScoreboardDOM();
    } else {
      if (this.warehouse.checkGatePass(this.physics.position)) {
        this.audio.playGateChime();
      }
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
