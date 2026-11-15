/**
 * Main Application Entry: 台北大巨蛋：無人機足球 5v5 聯賽 (main.js)
 *
 * Implements:
 * 1. Responsive Landscape & Viewport Fix (100dvw x 100dvh, dynamic resize/orientationchange sync,
 *    automatic Fullscreen + Landscape lock on Start Match, and Portrait rotation prompt overlay)
 * 2. Anti-Occlusion Camera System:
 *    - 3rd-Person Chase (default): Smooth Lerp 3.8m behind & 1.1m above player, strictly clamped inside netted court
 *    - 1st-Person FPV: Automatically hides player's black carbon-fiber cage (playerDroneCage.visible = false)
 *    - Menu Orbit: Live 360° Taipei Dome showcase camera behind the Start Menu
 * 3. Complete Battle System:
 *    - Start Menu Overlay (Mode: 5v5 / 1v1 / Free, FIDA Role: Striker / Defender, AI Difficulty: Rookie / Pro / World)
 *    - Pre-Match Formation & 3-2-1-START! Countdown with Web Audio synthesized beeps
 *    - Goal Celebration Slow-Motion (0.25x) + GOAL! Banner + 3-second Auto Kickoff Reset
 *    - 03:00 Match Timer (or First to 5 Goals) + Post-Match Summary Modal (Score, Goals, Blocks, MVP)
 * 4. Dual Virtual Joysticks + Nitro BOOST Button & Streamlined Top Tactical HUD
 */

import * as THREE from 'three';
import { BetaflightRates, RatesCurveChart } from './rates.js?v=20261115_6';
import { DronePhysics } from './physics.js?v=20261115_6';
import { DroneModel } from './drone.js?v=20261115_6';
import { TaipeiDomeSoccerScene } from './taipei_dome.js?v=20261115_6';
import { DroneAudio } from './audio.js?v=20261115_6';

const SIM_PARAMS_STORAGE_KEY = 'indoor_drone_sim_params_v1';

class TaipeiDomeDroneSoccerApp {
  constructor() {
    this.container = document.getElementById('webgl-container');
    this.osdCanvas = document.getElementById('osd-canvas');
    this.osdCtx = this.osdCanvas.getContext('2d');

    // 1. Initialize Three.js Renderer with ACESFilmicToneMapping & PCFSoftShadowMap
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 2. Initialize Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060911);
    this.scene.fog = new THREE.FogExp2(0x080d18, 0.0075);

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);

    // Camera Mode: 'CHASE' (Default 3.8m behind, 1.1m above) or 'FPV' (100° FOV, cage hidden)
    this.cameraMode = 'CHASE';
    this.chaseCamPos = new THREE.Vector3(0, 4.3, 7.6);
    this.chaseLookTarget = new THREE.Vector3(0, 3.2, 0);
    this.lastValidYaw = 0;
    this.orbitAngle = 0;

    // 3. Initialize Betaflight Rates, Taipei Dome 5v5 Scene, 6-DoF Physics, Player Drone & Web Audio
    this.rates = new BetaflightRates();
    this.taipeiDome = new TaipeiDomeSoccerScene(this.scene, this.renderer);
    this.physics = new DronePhysics(this.rates, this.taipeiDome.colliders);
    this.physics.droneRadius = 0.35;
    this.physics.droneHalfHeight = 0.34;
    this.droneModel = new DroneModel(this.scene);
    this.audio = new DroneAudio();

    this.loadAirframeParams();

    // 4. Battle System State Machine
    // States: 'MENU' | 'WAIT_LANDSCAPE' | 'COUNTDOWN' | 'PLAYING' | 'GOAL_CELEBRATION' | 'SUMMARY'
    this.gameState = 'MENU';
    this.matchConfig = {
      mode: '5v5',         // '5v5' | '1v1' | 'free'
      role: 'striker',     // 'striker' | 'defender'
      difficulty: 'pro'    // 'rookie' | 'pro' | 'world'
    };

    this.countdownTimer = 0;
    this.lastCountdownInt = 0;
    this.goalCelebrationTimer = 0;
    this.interceptBannerTimer = 0;
    this.dismissedOrientationWarning = false;

    // 5. Controls & Nitro BOOST State
    this.keys = {};
    this.controls = {
      throttle: 0.50,
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0,
      boost: false
    };
    this.smoothedKeyAxes = { yaw: 0.0, pitch: 0.0, roll: 0.0 };
    this.boostEnergy = 100.0; // 0 to 100
    this.boostTouchActive = false;

    this.touchSticks = {
      left:  { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 },
      right: { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 }
    };

    // 6. Initialize Betaflight Rates Chart & Bind UI
    const chartCanvas = document.getElementById('rates-chart-canvas');
    this.ratesChart = new RatesCurveChart(chartCanvas, this.rates);
    this.setTuningDrawerCollapsed(true);

    // Prepare background showcase match formation
    this.taipeiDome.setupMatch('5v5', 'striker', 'pro');
    this.taipeiDome.resetToFormation(this.physics);
    this.droneModel.setPlayerRole('striker');

    this.bindViewportEvents();
    this.bindInputEvents();
    this.bindVirtualGimbals();
    this.bindMenuAndUIControls();
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

  /**
   * Dynamic Canvas & Orientation Synchronization (eliminates aspect stretching)
   */
  bindViewportEvents() {
    const syncViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();

      // Check if waiting for phone to be rotated to Landscape
      if (this.gameState === 'WAIT_LANDSCAPE' && w > h) {
        document.getElementById('orientation-overlay').classList.add('hidden');
        this.beginMatchCountdown();
      } else if (
        (this.gameState === 'PLAYING' || this.gameState === 'COUNTDOWN') &&
        w < h &&
        !this.dismissedOrientationWarning
      ) {
        document.getElementById('orientation-overlay').classList.remove('hidden');
      } else if (w > h) {
        document.getElementById('orientation-overlay').classList.add('hidden');
      }
    };

    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', () => {
      setTimeout(syncViewport, 80);
      setTimeout(syncViewport, 250);
    });
    document.addEventListener('fullscreenchange', syncViewport);
  }

  bindInputEvents() {
    window.addEventListener('keydown', (e) => {
      this.audio.init();

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) {
        if (!document.activeElement || document.activeElement.tagName !== 'INPUT') {
          e.preventDefault();
        }
      }

      this.keys[e.code] = true;
      if (e.repeat) return;

      if (document.activeElement && document.activeElement.tagName === 'INPUT' && e.code !== 'Tab') {
        return;
      }

      if (e.code === 'KeyM') {
        this.toggleFlightMode();
      } else if (e.code === 'KeyC') {
        this.toggleCameraMode();
      } else if (e.code === 'KeyR' && this.gameState === 'PLAYING') {
        this.taipeiDome.resetToFormation(this.physics);
        this.resetStickControls();
      } else if (e.code === 'Tab' || e.code === 'KeyP') {
        e.preventDefault();
        this.toggleTuningDrawer();
      } else if (e.code === 'Escape') {
        this.openMainMenu();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('pointerdown', () => this.audio.init(), { passive: true });
    window.addEventListener('touchstart', () => this.audio.init(), { passive: true });
  }

  /**
   * Bind Dual Virtual Joysticks & Nitro BOOST Touch Button
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
        const maxRadius = Math.max(28, (Math.min(rect.width, rect.height) * 0.5) - 18);

        const dx = clientX - centerX;
        const dy = clientY - centerY;

        stickState.x = THREE.MathUtils.clamp(dx / maxRadius, -1.0, 1.0);
        stickState.y = THREE.MathUtils.clamp(-dy / maxRadius, -1.0, 1.0);
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
          // Left stick returns smoothly to 50% Hover Center so altitude stays steady
          stickState.x = 0.0;
          stickState.y = 0.0;
          this.controls.throttle = 0.50;
        }
      };

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

    // Bind Nitro BOOST Button (Multi-Touch + Mouse)
    const boostBtn = document.getElementById('btn-boost');
    if (boostBtn) {
      const setBoostActive = (active) => {
        this.boostTouchActive = active;
        boostBtn.classList.toggle('active', active);
      };
      boostBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.audio.init();
        setBoostActive(true);
      }, { passive: false });
      boostBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        setBoostActive(false);
      }, { passive: false });
      boostBtn.addEventListener('touchcancel', () => setBoostActive(false));
      boostBtn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        this.audio.init();
        setBoostActive(true);
      });
      boostBtn.addEventListener('pointerup', () => setBoostActive(false));
      boostBtn.addEventListener('pointerleave', () => setBoostActive(false));
    }
  }

  updateVirtualGimbalVisuals() {
    const leftRing = document.querySelector('#gimbal-left .gimbal-ring');
    const rightRing = document.querySelector('#gimbal-right .gimbal-ring');
    const knobLeft = document.getElementById('knob-left');
    const knobRight = document.getElementById('knob-right');
    const readoutLeft = document.getElementById('readout-left');
    const readoutRight = document.getElementById('readout-right');

    if (leftRing && knobLeft) {
      const maxR = Math.max(26, (leftRing.clientWidth * 0.5) - 22);
      const lx = this.controls.yaw * maxR;
      const ly = -(this.controls.throttle * 2.0 - 1.0) * maxR;
      knobLeft.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`;
    }
    if (rightRing && knobRight) {
      const maxR = Math.max(26, (rightRing.clientWidth * 0.5) - 22);
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

  bindMenuAndUIControls() {
    // 1. Start Menu Option Selectors (Mode, Role, Difficulty)
    const bindOptionGroup = (groupId, attrName, configKey) => {
      const container = document.getElementById(groupId);
      if (!container) return;
      const buttons = container.querySelectorAll('.menu-opt-btn');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.audio.init();
          const val = btn.getAttribute(attrName);
          this.matchConfig[configKey] = val;
          buttons.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
    };

    bindOptionGroup('group-match-mode', 'data-mode', 'mode');
    bindOptionGroup('group-player-role', 'data-role', 'role');
    bindOptionGroup('group-ai-difficulty', 'data-difficulty', 'difficulty');

    // 2. Start Match CTA Button (Fullscreen + Landscape Lock + Portrait Check)
    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      startBtn.addEventListener('click', () => this.onStartMatchClicked());
    }

    // 3. Rematch & Back to Main Menu Buttons
    const rematchBtn = document.getElementById('btn-rematch');
    if (rematchBtn) {
      rematchBtn.addEventListener('click', () => {
        document.getElementById('match-summary-overlay').classList.add('hidden');
        this.onStartMatchClicked();
      });
    }

    const backMenuBtn = document.getElementById('btn-back-menu');
    if (backMenuBtn) {
      backMenuBtn.addEventListener('click', () => this.openMainMenu());
    }

    // 4. Portrait Orientation Dismiss Fallback Button
    const dismissOrientBtn = document.getElementById('btn-dismiss-orientation');
    if (dismissOrientBtn) {
      dismissOrientBtn.addEventListener('click', () => {
        this.dismissedOrientationWarning = true;
        document.getElementById('orientation-overlay').classList.add('hidden');
        if (this.gameState === 'WAIT_LANDSCAPE') {
          this.beginMatchCountdown();
        }
      });
    }

    // 5. Top Tactical HUD Buttons
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
    bindBtn('btn-drawer-toggle', () => this.toggleTuningDrawer());
    bindBtn('btn-drawer-close', () => this.setTuningDrawerCollapsed(true));
    bindBtn('btn-pause-menu', () => this.openMainMenu());

    // 6. Betaflight Rates Presets & Sliders
    const presetButtons = document.querySelectorAll('[data-preset]');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        this.rates.applyPreset(key);
        presetButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.syncUIFromModel();
      });
    });

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

  /**
   * Handle "START MATCH":
   * 1. Request Fullscreen & Landscape Orientation Lock
   * 2. If device is Portrait and lock wasn't supported, show Portrait Rotate Prompt
   * 3. Otherwise start 3-2-1-START! Match Countdown
   */
  async onStartMatchClicked() {
    this.audio.init();
    document.getElementById('start-menu-overlay').classList.add('hidden');
    document.getElementById('match-summary-overlay').classList.add('hidden');

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen().catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}

    // Give browser a moment to update dimensions after fullscreen/orientation request
    setTimeout(() => {
      if (window.innerWidth < window.innerHeight && !this.dismissedOrientationWarning) {
        this.gameState = 'WAIT_LANDSCAPE';
        document.getElementById('orientation-overlay').classList.remove('hidden');
      } else {
        document.getElementById('orientation-overlay').classList.add('hidden');
        this.beginMatchCountdown();
      }
    }, 100);
  }

  /**
   * Set up match formations and initiate 3-2-1-START! Countdown
   */
  beginMatchCountdown() {
    const { mode, role, difficulty } = this.matchConfig;
    this.taipeiDome.setupMatch(mode, role, difficulty);
    this.taipeiDome.resetToFormation(this.physics);
    this.droneModel.setPlayerRole(role);
    this.droneModel.setFpvMode(this.cameraMode === 'FPV');

    this.resetStickControls();
    this.boostEnergy = 100.0;

    // Position chase camera directly behind player's kickoff spot (3.8m behind, 1.1m up)
    this.chaseCamPos.set(
      this.physics.position.x,
      this.physics.position.y + 1.1,
      this.physics.position.z + 3.8
    );
    this.chaseLookTarget.set(0, 3.2, -4.0);

    document.getElementById('top-hud-bar').classList.remove('hidden');
    document.getElementById('virtual-gimbals-layer').classList.remove('hidden');

    const centerOverlay = document.getElementById('center-event-overlay');
    const countdownEl = document.getElementById('countdown-text');
    const goalBox = document.getElementById('goal-banner-box');
    centerOverlay.classList.remove('hidden');
    countdownEl.classList.remove('hidden');
    goalBox.classList.add('hidden');

    this.gameState = 'COUNTDOWN';
    this.countdownTimer = 3.6;
    this.lastCountdownInt = 4;
    this.updateScoreboardDOM();
  }

  openMainMenu() {
    this.gameState = 'MENU';
    this.setTuningDrawerCollapsed(true);
    document.getElementById('top-hud-bar').classList.add('hidden');
    document.getElementById('virtual-gimbals-layer').classList.add('hidden');
    document.getElementById('center-event-overlay').classList.add('hidden');
    document.getElementById('match-summary-overlay').classList.add('hidden');
    document.getElementById('orientation-overlay').classList.add('hidden');
    document.getElementById('start-menu-overlay').classList.remove('hidden');

    this.droneModel.setFpvMode(false);
    this.taipeiDome.resetToFormation(this.physics);
  }

  showMatchSummary() {
    this.gameState = 'SUMMARY';
    document.getElementById('virtual-gimbals-layer').classList.add('hidden');
    document.getElementById('center-event-overlay').classList.add('hidden');
    document.getElementById('match-summary-overlay').classList.remove('hidden');

    const red = this.taipeiDome.scoreRed;
    const blue = this.taipeiDome.scoreBlue;
    const titleEl = document.getElementById('summary-Outcome-title');

    if (red > blue) {
      titleEl.textContent = '🏆 紅隊獲勝 VICTORY!';
      titleEl.style.color = '#fbbf24';
    } else if (blue > red) {
      titleEl.textContent = '⚡ 藍隊獲勝 DEFEAT';
      titleEl.style.color = '#38bdf8';
    } else {
      titleEl.textContent = '🤝 平手 DRAW MATCH';
      titleEl.style.color = '#e2e8f0';
    }

    document.getElementById('sum-score-red').textContent = String(red);
    document.getElementById('sum-score-blue').textContent = String(blue);
    document.getElementById('sum-player-goals').textContent = String(this.taipeiDome.playerGoals);
    document.getElementById('sum-player-blocks').textContent = String(this.taipeiDome.playerBlocks);

    let mvp = 'PLAYER (RED #1)';
    if (blue > red && this.taipeiDome.playerGoals === 0) {
      mvp = 'BLUE STRIKER #1';
    } else if (this.matchConfig.role === 'defender' && red > blue && this.taipeiDome.playerBlocks < 2) {
      mvp = 'RED AI STRIKER';
    }
    document.getElementById('sum-mvp-name').textContent = mvp;
  }

  resetStickControls() {
    this.controls.throttle = 0.50;
    this.controls.yaw = 0.0;
    this.controls.pitch = 0.0;
    this.controls.roll = 0.0;
    this.controls.boost = false;
    this.smoothedKeyAxes.yaw = 0;
    this.smoothedKeyAxes.pitch = 0;
    this.smoothedKeyAxes.roll = 0;
    this.touchSticks.left.x = 0;
    this.touchSticks.left.y = 0;
    this.touchSticks.right.x = 0;
    this.touchSticks.right.y = 0;
    this.updateVirtualGimbalVisuals();
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
      text.textContent = 'ACRO 手動';
    }
  }

  /**
   * Toggle between 3rd-Person Chase (3.8m behind, 1.1m up) and 1st-Person FPV (playerDroneCage hidden)
   */
  toggleCameraMode() {
    this.cameraMode = this.cameraMode === 'CHASE' ? 'FPV' : 'CHASE';
    this.droneModel.setFpvMode(this.cameraMode === 'FPV');
    this.updateCameraFOV();
    const text = document.getElementById('cam-status-text');
    if (text) {
      text.textContent = this.cameraMode === 'FPV' ? '視角: FPV' : '視角: 追尾';
    }
  }

  updateCameraFOV() {
    this.camera.fov = this.cameraMode === 'FPV' ? 100 : 72;
    this.camera.updateProjectionMatrix();
  }

  setTuningDrawerCollapsed(collapsed) {
    const drawer = document.getElementById('tuning-drawer');
    const label = document.getElementById('drawer-toggle-label');
    if (!drawer) return;
    drawer.classList.toggle('collapsed', collapsed);
    if (label) {
      label.textContent = collapsed ? '⚙ Rates' : '✕ Rates';
    }
    if (!collapsed) {
      requestAnimationFrame(() => this.ratesChart.render(this.controls));
    }
  }

  toggleTuningDrawer() {
    const drawer = document.getElementById('tuning-drawer');
    if (!drawer) return;
    this.setTuningDrawerCollapsed(!drawer.classList.contains('collapsed'));
  }

  /**
   * Process Dual Virtual Joysticks, Nitro BOOST, Keyboard (with RC Smoothing) & Gamepad API
   */
  updateInputs(dt) {
    // Lock controls unless in active PLAYING state
    if (this.gameState !== 'PLAYING') {
      this.controls.throttle = 0.50;
      this.controls.yaw = 0;
      this.controls.pitch = 0;
      this.controls.roll = 0;
      this.controls.boost = false;
      this.updateVirtualGimbalVisuals();
      return;
    }

    // 1. Update Nitro BOOST Energy & State
    const wantBoost = this.boostTouchActive || this.keys['Space'] || this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    if (wantBoost && this.boostEnergy > 4.0) {
      this.controls.boost = true;
      this.boostEnergy = Math.max(0, this.boostEnergy - 38.0 * dt);
    } else {
      this.controls.boost = false;
      this.boostEnergy = Math.min(100.0, this.boostEnergy + 22.0 * dt);
    }
    const boostFill = document.getElementById('boost-bar-fill');
    if (boostFill) {
      boostFill.style.width = `${Math.round(this.boostEnergy)}%`;
    }

    const leftTouch = this.touchSticks.left;
    const rightTouch = this.touchSticks.right;

    const applyDeadzone = (v, dz = 0.05) => {
      if (Math.abs(v) < dz) return 0;
      return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
    };

    if (leftTouch.active || rightTouch.active) {
      if (leftTouch.active) {
        this.controls.throttle = THREE.MathUtils.clamp((leftTouch.y + 1.0) * 0.5, 0.1, 0.95);
        this.controls.yaw = applyDeadzone(leftTouch.x, 0.04);
      } else {
        this.controls.throttle = 0.50;
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

    // 2. Native Gamepad API
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }

    const hasKeyboardInput =
      this.keys['KeyW'] || this.keys['KeyS'] ||
      this.keys['KeyA'] || this.keys['KeyD'] ||
      this.keys['ArrowUp'] || this.keys['ArrowDown'] ||
      this.keys['ArrowLeft'] || this.keys['ArrowRight'];

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

    // 3. Mode 2 Keyboard Controls with RC Smoothing
    if (this.keys['KeyW']) {
      this.controls.throttle = Math.min(0.92, this.controls.throttle + 0.65 * dt);
    } else if (this.keys['KeyS']) {
      this.controls.throttle = Math.max(0.12, this.controls.throttle - 0.65 * dt);
    } else {
      this.controls.throttle += (0.50 - this.controls.throttle) * Math.min(1, dt * 6.0);
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
   * Anti-Occlusion Camera System:
   * - MENU state: Smooth 3D Orbit Camera inside Taipei Dome
   * - CHASE mode: Lerp 3.8m behind & 1.1m above player drone, strictly clamped inside netted court
   * - FPV mode: Inside player drone with playerDroneCage.visible = false (100% unobstructed view)
   */
  updateCamera(dt) {
    if (this.gameState === 'MENU' || this.gameState === 'WAIT_LANDSCAPE') {
      this.orbitAngle += dt * 0.24;
      const r = 13.5;
      this.camera.position.set(
        Math.sin(this.orbitAngle) * r,
        4.6 + Math.sin(this.orbitAngle * 1.5) * 0.8,
        Math.cos(this.orbitAngle) * r
      );
      this.camera.lookAt(0, 3.2, 0);
      return;
    }

    if (this.cameraMode === 'FPV') {
      const camOffsetLocal = new THREE.Vector3(0, 0.025, -0.06);
      const worldPos = camOffsetLocal.applyQuaternion(this.physics.quaternion).add(this.physics.position);
      this.camera.position.copy(worldPos);

      const uptiltRad = THREE.MathUtils.degToRad(this.physics.params.cameraUptiltDeg);
      const uptiltQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), uptiltRad);
      this.camera.quaternion.copy(this.physics.quaternion).multiply(uptiltQuat);
    } else {
      // 3rd-Person Chase Camera: 3.8m behind & 1.1m above player drone
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
      const desiredOffset = new THREE.Vector3(0, 1.1, 3.8).applyQuaternion(yawOnlyQuat);
      const desiredPos = this.physics.position.clone().add(desiredOffset);

      // Strict Netted Court Collision Clamping so camera NEVER exits net or hits outer pillars
      const maxCamX = this.taipeiDome.courtHalfW - 0.55; // 8.45m
      const maxCamZ = this.taipeiDome.courtHalfL - 0.55; // 13.45m
      const maxCamY = this.taipeiDome.courtH - 0.65;     // 6.95m
      desiredPos.x = THREE.MathUtils.clamp(desiredPos.x, -maxCamX, maxCamX);
      desiredPos.y = THREE.MathUtils.clamp(desiredPos.y, 0.60, maxCamY);
      desiredPos.z = THREE.MathUtils.clamp(desiredPos.z, -maxCamZ, maxCamZ);

      const posAlpha = 1.0 - Math.exp(-11.0 * dt);
      this.chaseCamPos.lerp(desiredPos, posAlpha);
      this.camera.position.copy(this.chaseCamPos);

      const forwardLookOffset = new THREE.Vector3(0, 0.12, -3.2).applyQuaternion(yawOnlyQuat);
      const desiredTarget = this.physics.position.clone().add(forwardLookOffset);
      const lookAlpha = 1.0 - Math.exp(-15.0 * dt);
      this.chaseLookTarget.lerp(desiredTarget, lookAlpha);
      this.camera.lookAt(this.chaseLookTarget);
    }
  }

  /**
   * Render Streamlined Tactical OSD Reticle & Goal Direction Indicator
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

    if (this.gameState !== 'PLAYING' && this.gameState !== 'COUNTDOWN' && this.gameState !== 'GOAL_CELEBRATION') {
      ctx.restore();
      return;
    }

    const cx = w * 0.5;
    const cy = h * 0.48;
    const tel = this.physics.telemetry;

    // 1. Center Tactical Reticle & Pitch Horizon
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = this.controls.boost ? 'rgba(251, 191, 36, 0.92)' : 'rgba(56, 189, 248, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-20, 0); ctx.lineTo(-7, 0); ctx.lineTo(-3, 4); ctx.lineTo(0, 0);
    ctx.lineTo(3, 4); ctx.lineTo(7, 0); ctx.lineTo(20, 0);
    ctx.stroke();

    const rollRad = THREE.MathUtils.degToRad(tel.rollDeg);
    const pitchOffsetPx = THREE.MathUtils.clamp(tel.pitchDeg * 2.8, -70, 70);
    ctx.rotate(rollRad);
    ctx.translate(0, pitchOffsetPx);

    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-68, 0); ctx.lineTo(-24, 0);
    ctx.moveTo(24, 0);  ctx.lineTo(68, 0);
    ctx.stroke();
    ctx.restore();

    // 2. Compact Bottom-Center Tactical Readout (Role, Speed, Altitude, Interceptions)
    const roleLabel = this.matchConfig.role === 'striker' ? '⚡ STRIKER 攻擊手' : '🛡️ DEFENDER 防守員';
    ctx.textAlign = 'center';
    ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
    ctx.fillText(
      `${roleLabel}  •  SPD ${tel.speed.toFixed(1)} m/s  •  ALT ${tel.altitude.toFixed(1)}m  •  GOALS ${this.taipeiDome.playerGoals}  •  BLOCKS ${this.taipeiDome.playerBlocks}`,
      cx,
      h - 14
    );

    if (this.interceptBannerTimer > 0) {
      ctx.font = 'bold 16px "JetBrains Mono", sans-serif';
      ctx.fillStyle = '#34d399';
      ctx.fillText('💥 成功衝撞攔截對手！ (INTERCEPTION +1)', cx, cy - 80);
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

    const rawDt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;

    if (this.interceptBannerTimer > 0) {
      this.interceptBannerTimer -= rawDt;
    }

    // Handle State Machine Transitions
    if (this.gameState === 'MENU' || this.gameState === 'WAIT_LANDSCAPE' || this.gameState === 'SUMMARY') {
      // Background live stadium showcase
      this.taipeiDome.update(rawDt, this.physics, false);
      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
    } else if (this.gameState === 'COUNTDOWN') {
      // Pre-Match 3 - 2 - 1 - START! Countdown
      this.countdownTimer -= rawDt;
      const countdownEl = document.getElementById('countdown-text');

      if (this.countdownTimer > 0.6) {
        const currentInt = Math.ceil(this.countdownTimer - 0.6);
        if (currentInt !== this.lastCountdownInt && currentInt >= 1 && currentInt <= 3) {
          this.lastCountdownInt = currentInt;
          countdownEl.textContent = String(currentInt);
          this.audio.playCountdownBeep(false);
        }
      } else if (this.countdownTimer > 0) {
        if (this.lastCountdownInt !== 0) {
          this.lastCountdownInt = 0;
          countdownEl.textContent = 'START!';
          this.audio.playCountdownBeep(true);
        }
      } else {
        document.getElementById('center-event-overlay').classList.add('hidden');
        this.gameState = 'PLAYING';
      }

      this.updateInputs(rawDt);
      this.physics.update(rawDt, this.controls);
      this.taipeiDome.update(rawDt, this.physics, false);
      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
    } else if (this.gameState === 'GOAL_CELEBRATION') {
      // 0.25x Slow-Motion Goal Replay & 3-Second Reset
      const slowDt = rawDt * 0.25;
      this.goalCelebrationTimer -= rawDt;

      this.physics.update(slowDt, this.controls);
      this.taipeiDome.update(slowDt, this.physics, false);
      this.droneModel.update(slowDt, this.physics);
      this.updateCamera(rawDt);

      if (this.goalCelebrationTimer <= 0) {
        document.getElementById('center-event-overlay').classList.add('hidden');
        // Check if either team reached 5 goals to win the match
        if (this.matchConfig.mode !== 'free' && (this.taipeiDome.scoreRed >= 5 || this.taipeiDome.scoreBlue >= 5)) {
          this.showMatchSummary();
        } else {
          this.taipeiDome.resetToFormation(this.physics);
          this.resetStickControls();
          this.gameState = 'PLAYING';
        }
      }
    } else if (this.gameState === 'PLAYING') {
      this.updateInputs(rawDt);
      this.physics.update(rawDt, this.controls);

      const res = this.taipeiDome.update(rawDt, this.physics, true);
      if (res) {
        if (res.playerHitEnemy) {
          this.interceptBannerTimer = 1.4;
        }
        if (res.scoredTeam) {
          this.audio.playGoalHorn();
          this.updateScoreboardDOM();
          this.gameState = 'GOAL_CELEBRATION';
          this.goalCelebrationTimer = 3.0;

          const centerOverlay = document.getElementById('center-event-overlay');
          const countdownEl = document.getElementById('countdown-text');
          const goalBox = document.getElementById('goal-banner-box');
          const goalSub = document.getElementById('goal-subtitle');
          centerOverlay.classList.remove('hidden');
          countdownEl.classList.add('hidden');
          goalBox.classList.remove('hidden');
          goalSub.textContent = `${res.scorerName}  •  RED ${this.taipeiDome.scoreRed} - ${this.taipeiDome.scoreBlue} BLUE`;
        }
      }

      this.updateScoreboardDOM();

      // Check Match Clock Expiration (03:00)
      if (this.matchConfig.mode !== 'free' && this.taipeiDome.matchTimeSec <= 0) {
        this.showMatchSummary();
      }

      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
      this.audio.update(this.physics, this.controls.boost);
    }

    this.renderer.render(this.scene, this.camera);
    this.renderOSD();

    const drawer = document.getElementById('tuning-drawer');
    if (drawer && !drawer.classList.contains('collapsed')) {
      this.ratesChart.render(this.controls);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new TaipeiDomeDroneSoccerApp();
});
