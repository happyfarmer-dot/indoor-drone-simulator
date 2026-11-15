/**
 * Main Application Entry: 台北大巨蛋：無人機足球 5v5 聯賽 (main.js)
 *
 * Implements:
 * 1. Responsive Landscape & Viewport Fix (100dvw x 100dvh, dynamic resize/orientationchange sync,
 *    automatic Fullscreen + Landscape lock, non-blocking portrait prompt banner with skip option)
 * 2. Anti-Occlusion Camera System:
 *    - 3rd-Person Chase: Smooth Lerp 3.8m behind & 1.1m above player, strictly clamped inside netted court
 *    - 1st-Person FPV: Automatically hides player's black carbon-fiber cage for 100% unobstructed view
 *    - Menu Orbit: Live 360° Taipei Dome showcase camera behind the Start Menu
 * 3. Complete Battle System & Continuous Non-Stop Scoring:
 *    - Start Menu (Single Player AI: 5v5 / 1v1 / Free, FIDA Role: Striker / Defender, AI Difficulty: Rookie / Pro / World)
 *    - Pure Frontend WebRTC P2P Online Multiplayer via PeerJS (Host generates 4-digit room code, Guest joins,
 *      Host controls Red Striker, Guest controls Blue Striker, remaining 8 drones run on Host AI with 30Hz state sync)
 *    - Pre-Match Formation & 3-2-1-START! Independent Countdown Timer
 *    - Continuous Non-Stop Scoring: No game pause, no teleporting back to spawn points; instant scoreboard update,
 *      goal ring high-intensity flash, spark explosion, non-blocking upper banner, and 3.0s anti-double-score guard.
 *    - Dual Virtual Joysticks with Expo 1.6 curve & auto-hover deadzone (Nitro Boost completely removed).
 */

import * as THREE from 'three';
import { BetaflightRates, RatesCurveChart } from './rates.js?v=20261115_7';
import { DronePhysics } from './physics.js?v=20261115_7';
import { DroneModel } from './drone.js?v=20261115_7';
import { TaipeiDomeSoccerScene } from './taipei_dome.js?v=20261115_7';
import { DroneAudio } from './audio.js?v=20261115_7';

const SIM_PARAMS_STORAGE_KEY = 'indoor_drone_sim_params_v1';
const PEER_ID_PREFIX = 'taipeidome-5v5-';

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

    // 4. Battle System State Machine: 'MENU' | 'COUNTDOWN' | 'PLAYING' | 'GAMEOVER'
    this.gameState = 'MENU';
    this.matchConfig = {
      mode: '5v5',         // '5v5' | '1v1' | 'free'
      role: 'striker',     // 'striker' | 'defender'
      difficulty: 'pro'    // 'rookie' | 'pro' | 'world'
    };

    // 5. WebRTC P2P Multiplayer State (PeerJS)
    this.isMultiplayer = false;
    this.isHost = false;
    this.roomCode = null;
    this.peer = null;
    this.netConn = null;
    this.lastNetSendTime = 0;

    // 6. Timers & Toasts
    this.countdownInterval = null;
    this.countdownStart = 0;
    this.goalToastTimer = null;
    this.toastTimer = null;
    this.interceptBannerTimer = 0;
    this.dismissedOrientationWarning = false;

    // 7. Controls (Boost completely removed; pure realistic throttle & tilt)
    this.keys = {};
    this.controls = {
      throttle: 0.50,
      yaw: 0.0,
      pitch: 0.0,
      roll: 0.0
    };
    this.smoothedKeyAxes = { yaw: 0.0, pitch: 0.0, roll: 0.0 };

    this.touchSticks = {
      left:  { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 },
      right: { active: false, pointerId: null, touchId: null, x: 0.0, y: 0.0 }
    };

    // 8. Initialize Betaflight Rates Chart & Bind UI
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

      // If in landscape, automatically hide orientation banner
      if (w > h) {
        document.getElementById('orientation-overlay').classList.add('hidden');
      } else if ((this.gameState === 'PLAYING' || this.gameState === 'COUNTDOWN') && !this.dismissedOrientationWarning) {
        document.getElementById('orientation-overlay').classList.remove('hidden');
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
      } else if (e.code === 'KeyR' && this.gameState === 'PLAYING' && !this.isMultiplayer) {
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
   * Bind Dual Virtual Joysticks (Boost Button completely removed)
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
          // Left stick returns smoothly to 50% Hover Center
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
    // 1. Lobby Tab Switcher (Single Player vs Online PvP)
    const lobbyTabGroup = document.getElementById('group-lobby-type');
    if (lobbyTabGroup) {
      const tabs = lobbyTabGroup.querySelectorAll('.lobby-tab-btn');
      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          this.audio.init();
          tabs.forEach((t) => t.classList.toggle('active', t === tab));
          const type = tab.getAttribute('data-lobby');
          document.getElementById('panel-single-player').classList.toggle('hidden', type !== 'single');
          document.getElementById('panel-online-multiplayer').classList.toggle('hidden', type !== 'online');
        });
      });
    }

    // 2. Single Player Option Selectors (Mode, Role, Difficulty)
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

    // 3. Start Single Player Match CTA Button
    const startBtn = document.getElementById('btn-start-match');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.isMultiplayer = false;
        this.onStartMatchClicked();
      });
    }

    // 4. Online Multiplayer: Host Room (建立房間)
    const hostCreateBtn = document.getElementById('btn-host-create');
    if (hostCreateBtn) {
      hostCreateBtn.addEventListener('click', () => this.createHostRoom());
    }

    const copyCodeBtn = document.getElementById('btn-copy-code');
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', () => {
        if (!this.roomCode) return;
        navigator.clipboard.writeText(this.roomCode).then(() => {
          copyCodeBtn.textContent = '已複製!';
          setTimeout(() => { copyCodeBtn.textContent = '複製'; }, 2000);
        }).catch(() => {});
      });
    }

    const hostStartBtn = document.getElementById('btn-host-start');
    if (hostStartBtn) {
      hostStartBtn.addEventListener('click', () => this.startHostMatch());
    }

    // 5. Online Multiplayer: Join Room (加入房間)
    const joinBtn = document.getElementById('btn-join-room');
    if (joinBtn) {
      joinBtn.addEventListener('click', () => this.joinGuestRoom());
    }
    const joinInput = document.getElementById('input-join-code');
    if (joinInput) {
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.joinGuestRoom();
      });
    }

    // 6. Rematch & Back to Main Menu Buttons
    const rematchBtn = document.getElementById('btn-rematch');
    if (rematchBtn) {
      rematchBtn.addEventListener('click', () => {
        document.getElementById('match-summary-overlay').classList.add('hidden');
        if (this.isMultiplayer && this.isHost) {
          this.startHostMatch();
        } else {
          this.onStartMatchClicked();
        }
      });
    }

    const backMenuBtn = document.getElementById('btn-back-menu');
    if (backMenuBtn) {
      backMenuBtn.addEventListener('click', () => this.openMainMenu());
    }

    // 7. Portrait Orientation Dismiss Fallback Button
    const dismissOrientBtn = document.getElementById('btn-dismiss-orientation');
    if (dismissOrientBtn) {
      dismissOrientBtn.addEventListener('click', () => {
        this.dismissedOrientationWarning = true;
        document.getElementById('orientation-overlay').classList.add('hidden');
      });
    }

    // 8. Top Tactical HUD Buttons
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

    // 9. Betaflight Rates Presets & Sliders
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
   * Non-blocking request for Fullscreen and Landscape screen lock
   */
  tryLandscapeFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } catch (_) {}

    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}
  }

  /**
   * Start Single Player Match
   */
  onStartMatchClicked() {
    this.audio.init();
    this.tryLandscapeFullscreen();

    if (window.innerWidth < window.innerHeight && !this.dismissedOrientationWarning) {
      document.getElementById('orientation-overlay').classList.remove('hidden');
    } else {
      document.getElementById('orientation-overlay').classList.add('hidden');
    }

    this.beginMatchCountdown();
  }

  /**
   * WebRTC P2P: Host Creates Room (PeerJS)
   */
  createHostRoom() {
    this.audio.init();
    const code = String(Math.floor(1000 + Math.random() * 9000));
    this.roomCode = code;
    this.isHost = true;
    this.isMultiplayer = true;

    const codeEl = document.getElementById('txt-room-code');
    const statusEl = document.getElementById('host-lobby-status');
    const unreadyWrap = document.getElementById('host-unready-wrap');
    const readyWrap = document.getElementById('host-ready-wrap');
    const hostStartBtn = document.getElementById('btn-host-start');

    if (codeEl) codeEl.textContent = code;
    if (statusEl) statusEl.textContent = '正在向 WebRTC 伺服器註冊房間...';
    unreadyWrap.classList.add('hidden');
    readyWrap.classList.remove('hidden');
    hostStartBtn.style.display = 'none';

    try {
      if (this.peer) this.peer.destroy();
    } catch (_) {}

    const PeerClass = window.Peer;
    if (!PeerClass) {
      if (statusEl) statusEl.textContent = '❌ PeerJS 函式庫未載入，請確認網路連線';
      return;
    }

    const peerId = `${PEER_ID_PREFIX}${code}`;
    this.peer = new PeerClass(peerId, { debug: 1 });

    this.peer.on('open', () => {
      if (statusEl) statusEl.textContent = `房號 ${code} 建立成功！等待對手加入... ⏳`;
      hostStartBtn.style.display = 'block';
    });

    this.peer.on('connection', (conn) => {
      this.netConn = conn;
      conn.on('open', () => {
        if (statusEl) statusEl.textContent = '🟢 對手已加入房間！點擊下方開始對戰';
        hostStartBtn.style.display = 'block';
        this.showToastNotice('🟢 對手已連線加入！', 2500);
      });
      conn.on('data', (data) => this.handleNetData(data));
      conn.on('close', () => this.handlePeerDisconnect());
      conn.on('error', () => this.handlePeerDisconnect());
    });

    this.peer.on('error', (err) => {
      console.warn('Peer host error:', err);
      if (err.type === 'unavailable-id') {
        setTimeout(() => this.createHostRoom(), 300);
      } else {
        if (statusEl) statusEl.textContent = `連線錯誤: ${err.type || err}`;
      }
    });
  }

  /**
   * WebRTC P2P: Host starts match for both players
   */
  startHostMatch() {
    this.isHost = true;
    this.isMultiplayer = true;
    this.matchConfig.mode = '5v5';
    this.matchConfig.role = 'striker'; // Host is Red Striker

    if (this.netConn && this.netConn.open) {
      try {
        this.netConn.send({ type: 'START_MATCH' });
      } catch (_) {}
    }

    this.onStartMatchClicked();
  }

  /**
   * WebRTC P2P: Guest Joins Room (PeerJS)
   */
  joinGuestRoom() {
    this.audio.init();
    const input = document.getElementById('input-join-code');
    const statusEl = document.getElementById('join-lobby-status');
    const code = input ? input.value.trim() : '';

    if (!code || code.length !== 4) {
      if (statusEl) statusEl.textContent = '❌ 請輸入 4 位數數字房號';
      return;
    }

    this.roomCode = code;
    this.isHost = false;
    this.isMultiplayer = true;
    if (statusEl) statusEl.textContent = `正在連線至房號 ${code}... ⏳`;

    try {
      if (this.peer) this.peer.destroy();
    } catch (_) {}

    const PeerClass = window.Peer;
    if (!PeerClass) {
      if (statusEl) statusEl.textContent = '❌ PeerJS 函式庫未載入，請確認網路連線';
      return;
    }

    this.peer = new PeerClass({ debug: 1 });
    this.peer.on('open', () => {
      const targetId = `${PEER_ID_PREFIX}${code}`;
      const conn = this.peer.connect(targetId, { reliable: false });
      this.netConn = conn;

      conn.on('open', () => {
        if (statusEl) statusEl.textContent = `🟢 已成功連線至房號 ${code}！等待房主開戰...`;
        this.showToastNotice(`🟢 已連線至房號 ${code}，等待房主開戰`, 3000);
      });

      conn.on('data', (data) => this.handleNetData(data));
      conn.on('close', () => this.handlePeerDisconnect());
      conn.on('error', () => this.handlePeerDisconnect());
    });

    this.peer.on('error', (err) => {
      console.warn('Guest peer error:', err);
      if (statusEl) statusEl.textContent = `❌ 連線失敗: ${err.type || '查無此房號'}`;
    });
  }

  /**
   * Process incoming WebRTC DataChannel packets
   */
  handleNetData(data) {
    if (!data) return;

    if (data.type === 'START_MATCH') {
      // Received by Guest from Host
      this.isMultiplayer = true;
      this.isHost = false;
      this.matchConfig.mode = '5v5';
      this.matchConfig.role = 'striker'; // Guest is Blue Striker
      this.onStartMatchClicked();
      return;
    }

    if (this.isHost) {
      // Host receives Blue Striker coordinates from Guest
      if (data.type === 'GUEST_DRONE' && data.drone) {
        const blueStriker = this.taipeiDome.aiPool[4];
        if (blueStriker && blueStriker.active) {
          blueStriker.position.x = data.drone.x;
          blueStriker.position.y = data.drone.y;
          blueStriker.position.z = data.drone.z;
          blueStriker.mesh.position.copy(blueStriker.position);
          blueStriker.mesh.quaternion.set(data.drone.qx, data.drone.qy, data.drone.qz, data.drone.qw);
        }
      }
    } else {
      // Guest receives authoritative world state from Host
      if (data.type === 'HOST_STATE') {
        this.taipeiDome.matchTimeSec = data.time;
        this.taipeiDome.scoreRed = data.red;
        this.taipeiDome.scoreBlue = data.blue;
        this.updateScoreboardDOM();

        // Update Host Drone (Red Striker) in Guest's scene (represented by aiPool[0])
        if (data.hostDrone && this.taipeiDome.aiPool[0]) {
          const redStriker = this.taipeiDome.aiPool[0];
          redStriker.position.set(data.hostDrone.x, data.hostDrone.y, data.hostDrone.z);
          redStriker.mesh.position.copy(redStriker.position);
          redStriker.mesh.quaternion.set(data.hostDrone.qx, data.hostDrone.qy, data.hostDrone.qz, data.hostDrone.qw);
        }

        // Interpolate the remaining 8 AI drones from Host
        if (Array.isArray(data.aiDrones)) {
          for (let i = 0; i < data.aiDrones.length; i++) {
            if (i === 4) continue; // Skip Guest's own local drone
            const target = data.aiDrones[i];
            const ai = this.taipeiDome.aiPool[i];
            if (ai && target) {
              ai.position.set(target.x, target.y, target.z);
              ai.mesh.position.copy(ai.position);
              ai.mesh.quaternion.set(target.qx, target.qy, target.qz, target.qw);
            }
          }
        }
      }
    }
  }

  handlePeerDisconnect() {
    if (this.isHost) {
      this.showToastNotice('⚠️ 對手已離線，由 AI 接管！', 3500);
      this.taipeiDome.setBlueStrikerRemote(false);
      this.isMultiplayer = false;
      this.netConn = null;
      const statusEl = document.getElementById('host-lobby-status');
      if (statusEl) statusEl.textContent = '對手已離線。等待新對手... ⏳';
    } else {
      this.showToastNotice('⚠️ 房主已斷線，5 秒後返回主選單', 5000);
      setTimeout(() => {
        if (this.gameState === 'PLAYING' || this.gameState === 'COUNTDOWN') {
          this.openMainMenu();
        }
      }, 5000);
    }
  }

  /**
   * Set up match formations and initiate independent 3-2-1-START! Countdown
   */
  beginMatchCountdown() {
    const isGuest = this.isMultiplayer && !this.isHost;

    if (isGuest) {
      // Guest is Blue Striker
      this.taipeiDome.setupMatch('5v5', 'striker', 'pro');
      this.physics.spawnPoint.set(0, 3.2, -3.8);
      this.physics.reset();
      this.physics.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Face +Z toward Red Goal
      this.droneModel.setTeamColor('blue');
      this.droneModel.setPlayerRole('striker');
      this.chaseCamPos.set(0, 4.3, -7.6);
      this.chaseLookTarget.set(0, 3.2, 4.0);
    } else {
      // Host or Singleplayer is Red
      const { mode, role, difficulty } = this.matchConfig;
      this.taipeiDome.setupMatch(mode, role, difficulty);
      if (this.isMultiplayer && this.isHost) {
        this.taipeiDome.setBlueStrikerRemote(true);
      }
      this.taipeiDome.resetToFormation(this.physics);
      this.droneModel.setTeamColor('red');
      this.droneModel.setPlayerRole(role);
      this.chaseCamPos.set(0, 4.3, 7.6);
      this.chaseLookTarget.set(0, 3.2, -4.0);
    }

    this.droneModel.setFpvMode(this.cameraMode === 'FPV');
    this.resetStickControls();

    // Snap Camera Position immediately (Zero Orbit delay)
    this.camera.position.copy(this.chaseCamPos);
    this.camera.lookAt(this.chaseLookTarget);

    document.getElementById('start-menu-overlay').classList.add('hidden');
    document.getElementById('match-summary-overlay').classList.add('hidden');
    document.getElementById('top-hud-bar').classList.remove('hidden');
    document.getElementById('virtual-gimbals-layer').classList.remove('hidden');

    const centerOverlay = document.getElementById('center-event-overlay');
    const countdownEl = document.getElementById('countdown-text');
    const goalBox = document.getElementById('goal-banner-box');
    centerOverlay.classList.remove('hidden');
    countdownEl.classList.remove('hidden');
    goalBox.classList.add('hidden');

    this.gameState = 'COUNTDOWN';
    this.updateScoreboardDOM();

    // Independent 3-2-1-START! Countdown Timer (driven by performance.now)
    this.countdownStart = performance.now();
    countdownEl.textContent = '3';
    try { this.audio.playCountdownBeep(false); } catch (_) {}

    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      const elapsed = (performance.now() - this.countdownStart) / 1000;
      if (elapsed < 1.0) {
        countdownEl.textContent = '3';
      } else if (elapsed < 2.0) {
        if (countdownEl.textContent !== '2') {
          countdownEl.textContent = '2';
          try { this.audio.playCountdownBeep(false); } catch (_) {}
        }
      } else if (elapsed < 3.0) {
        if (countdownEl.textContent !== '1') {
          countdownEl.textContent = '1';
          try { this.audio.playCountdownBeep(false); } catch (_) {}
        }
      } else if (elapsed < 3.7) {
        if (countdownEl.textContent !== 'START!') {
          countdownEl.textContent = 'START!';
          this.gameState = 'PLAYING';
          try { this.audio.playCountdownBeep(true); } catch (_) {}
        }
      } else {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        countdownEl.classList.add('hidden');
        if (goalBox.classList.contains('hidden')) {
          centerOverlay.classList.add('hidden');
        }
        this.gameState = 'PLAYING';
      }
    }, 45);
  }

  openMainMenu() {
    this.gameState = 'MENU';
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.setTuningDrawerCollapsed(true);
    document.getElementById('top-hud-bar').classList.add('hidden');
    document.getElementById('virtual-gimbals-layer').classList.add('hidden');
    document.getElementById('center-event-overlay').classList.add('hidden');
    document.getElementById('match-summary-overlay').classList.add('hidden');
    document.getElementById('orientation-overlay').classList.add('hidden');
    document.getElementById('start-menu-overlay').classList.remove('hidden');

    this.droneModel.setFpvMode(false);
    this.droneModel.setTeamColor('red');
    this.taipeiDome.resetToFormation(this.physics);
  }

  showMatchSummary() {
    this.gameState = 'GAMEOVER';
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

  /**
   * Non-Blocking Floating Goal Toast Banner
   */
  showGoalToast(team, scorerName) {
    const banner = document.getElementById('goal-banner-box');
    const centerOverlay = document.getElementById('center-event-overlay');
    const goalSub = document.getElementById('goal-subtitle');

    if (banner && centerOverlay && goalSub) {
      centerOverlay.classList.remove('hidden');
      banner.classList.remove('hidden');
      goalSub.textContent = `${scorerName} 得分！ RED ${this.taipeiDome.scoreRed} - ${this.taipeiDome.scoreBlue} BLUE`;

      if (this.goalToastTimer) clearTimeout(this.goalToastTimer);
      this.goalToastTimer = setTimeout(() => {
        banner.classList.add('hidden');
        if (this.gameState === 'PLAYING') {
          centerOverlay.classList.add('hidden');
        }
      }, 2200);
    }

    this.showToastNotice(`⚽ GOAL! ${team} 得分！ (${this.taipeiDome.scoreRed} - ${this.taipeiDome.scoreBlue})`, 2500);
  }

  showToastNotice(msg, duration = 3000) {
    const toast = document.getElementById('game-toast-banner');
    const msgEl = document.getElementById('toast-msg');
    if (toast && msgEl) {
      msgEl.textContent = msg;
      toast.classList.remove('hidden');
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
      }, duration);
    }
  }

  resetStickControls() {
    this.controls.throttle = 0.50;
    this.controls.yaw = 0.0;
    this.controls.pitch = 0.0;
    this.controls.roll = 0.0;
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
   * Toggle between 3rd-Person Chase and 1st-Person FPV (playerDroneCage hidden)
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
   * Process Dual Virtual Joysticks & Keyboard with Non-Linear Expo 1.6 Curve
   */
  updateInputs(dt) {
    // Lock controls during COUNTDOWN or non-PLAYING state
    if (this.gameState !== 'PLAYING') {
      this.controls.throttle = 0.50;
      this.controls.yaw = 0;
      this.controls.pitch = 0;
      this.controls.roll = 0;
      this.updateVirtualGimbalVisuals();
      return;
    }

    const leftTouch = this.touchSticks.left;
    const rightTouch = this.touchSticks.right;

    const applyDeadzone = (v, dz = 0.05) => {
      if (Math.abs(v) < dz) return 0;
      return Math.sign(v) * ((Math.abs(v) - dz) / (1 - dz));
    };

    const applyExpo = (v, exp = 1.6) => {
      return Math.sign(v) * Math.pow(Math.abs(v), exp);
    };

    if (leftTouch.active || rightTouch.active) {
      if (leftTouch.active) {
        // In center deadband (|y| < 0.12), lock to exactly 50% Hover Throttle for easy altitude hold
        if (Math.abs(leftTouch.y) < 0.12) {
          this.controls.throttle = 0.50;
        } else {
          const curved = applyExpo(leftTouch.y, 1.55);
          this.controls.throttle = THREE.MathUtils.clamp(0.50 + curved * 0.45, 0.10, 0.95);
        }
        this.controls.yaw = applyExpo(applyDeadzone(leftTouch.x, 0.04), 1.6);
      } else {
        this.controls.throttle = 0.50;
        this.controls.yaw = 0;
      }

      if (rightTouch.active) {
        this.controls.roll = applyExpo(applyDeadzone(rightTouch.x, 0.04), 1.6);
        this.controls.pitch = applyExpo(applyDeadzone(rightTouch.y, 0.04), 1.6);
      } else {
        this.controls.roll = 0;
        this.controls.pitch = 0;
      }
      this.updateVirtualGimbalVisuals();
      return;
    }

    // Native Gamepad API
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
      this.controls.yaw = applyExpo(THREE.MathUtils.clamp(rawYaw, -1, 1), 1.6);
      this.controls.roll = applyExpo(THREE.MathUtils.clamp(rawRoll, -1, 1), 1.6);
      this.controls.pitch = applyExpo(THREE.MathUtils.clamp(rawPitch, -1, 1), 1.6);
      this.updateVirtualGimbalVisuals();
      return;
    }

    // Mode 2 Keyboard Controls with RC Smoothing
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

    this.controls.yaw = applyExpo(this.smoothedKeyAxes.yaw, 1.6);
    this.controls.pitch = applyExpo(this.smoothedKeyAxes.pitch, 1.6);
    this.controls.roll = applyExpo(this.smoothedKeyAxes.roll, 1.6);

    this.updateVirtualGimbalVisuals();
  }

  /**
   * Anti-Occlusion Camera System:
   * - MENU state: Smooth 3D Orbit Camera inside Taipei Dome
   * - CHASE mode: Smooth Lerp 3.8m behind & 1.1m above player drone, strictly clamped inside netted court
   * - FPV mode: Inside player drone with playerDroneCage.visible = false (100% unobstructed view)
   */
  updateCamera(dt) {
    if (this.gameState === 'MENU') {
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
   * Render Streamlined Tactical OSD Reticle
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

    if (this.gameState !== 'PLAYING' && this.gameState !== 'COUNTDOWN') {
      ctx.restore();
      return;
    }

    const cx = w * 0.5;
    const cy = h * 0.48;
    const tel = this.physics.telemetry;

    // 1. Center Tactical Reticle & Pitch Horizon
    ctx.save();
    ctx.translate(cx, cy);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
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

    // 2. Compact Bottom-Center Tactical Readout
    let roleLabel = '⚡ RED STRIKER 紅隊攻擊手';
    if (this.isMultiplayer && !this.isHost) {
      roleLabel = '⚡ BLUE STRIKER 藍隊攻擊手 (Guest)';
    } else if (this.matchConfig.role === 'defender') {
      roleLabel = '🛡️ RED DEFENDER 紅隊防守員';
    }

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

    // State Machine Processing
    if (this.gameState === 'MENU' || this.gameState === 'GAMEOVER') {
      // Live stadium background showcase
      this.taipeiDome.update(rawDt, this.physics, false);
      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
    } else if (this.gameState === 'COUNTDOWN') {
      // Drones held in kickoff formation while 3-2-1 countdown timer runs
      this.updateInputs(rawDt);
      this.taipeiDome.update(rawDt, this.physics, false);
      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
    } else if (this.gameState === 'PLAYING') {
      this.updateInputs(rawDt);
      this.physics.update(rawDt, this.controls);

      // Continuous Non-Stop Scoring: taipeiDome updates positions in real-time
      const res = this.taipeiDome.update(rawDt, this.physics, true);
      if (res) {
        if (res.playerHitEnemy) {
          this.interceptBannerTimer = 1.4;
        }
        if (res.scoredTeam) {
          try { this.audio.playGoalHorn(); } catch (_) {}
          this.updateScoreboardDOM();
          this.showGoalToast(res.scoredTeam, res.scorerName);

          // Check if either team reached 5 goals to conclude the match
          if (this.matchConfig.mode !== 'free' && (this.taipeiDome.scoreRed >= 5 || this.taipeiDome.scoreBlue >= 5)) {
            this.showMatchSummary();
          }
        }
      }

      this.updateScoreboardDOM();

      // Check Match Clock Expiration (03:00)
      if (this.matchConfig.mode !== 'free' && this.taipeiDome.matchTimeSec <= 0) {
        this.showMatchSummary();
      }

      // WebRTC P2P Multiplayer 30Hz State Synchronization
      if (this.isMultiplayer && this.netConn && this.netConn.open) {
        if (now - this.lastNetSendTime >= 32) {
          this.lastNetSendTime = now;
          if (this.isHost) {
            // Host broadcasts world state to Guest
            try {
              this.netConn.send({
                type: 'HOST_STATE',
                time: this.taipeiDome.matchTimeSec,
                red: this.taipeiDome.scoreRed,
                blue: this.taipeiDome.scoreBlue,
                hostDrone: {
                  x: this.physics.position.x,
                  y: this.physics.position.y,
                  z: this.physics.position.z,
                  qx: this.physics.quaternion.x,
                  qy: this.physics.quaternion.y,
                  qz: this.physics.quaternion.z,
                  qw: this.physics.quaternion.w
                },
                aiDrones: this.taipeiDome.aiPool.map((a) => ({
                  x: a.position.x,
                  y: a.position.y,
                  z: a.position.z,
                  qx: a.mesh.quaternion.x,
                  qy: a.mesh.quaternion.y,
                  qz: a.mesh.quaternion.z,
                  qw: a.mesh.quaternion.w
                }))
              });
            } catch (_) {}
          } else {
            // Guest sends local Blue Striker state to Host
            try {
              this.netConn.send({
                type: 'GUEST_DRONE',
                drone: {
                  x: this.physics.position.x,
                  y: this.physics.position.y,
                  z: this.physics.position.z,
                  qx: this.physics.quaternion.x,
                  qy: this.physics.quaternion.y,
                  qz: this.physics.quaternion.z,
                  qw: this.physics.quaternion.w
                }
              });
            } catch (_) {}
          }
        }
      }

      this.droneModel.update(rawDt, this.physics);
      this.updateCamera(rawDt);
      this.audio.update(this.physics);
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
  window.__droneApp = new TaipeiDomeDroneSoccerApp();
});
