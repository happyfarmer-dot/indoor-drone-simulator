/**
 * Betaflight Classic Rates Mathematical Model & Real-Time 2D Curve Graph Renderer
 *
 * Implements the exact Betaflight Classic Rates formula for Roll, Pitch, and Yaw:
 *   x in [-1, 1], r = |x|
 *   x_expo = x * (r^3 * expo + (1 - expo))
 *   rcRate_eff = rcRate > 2.0 ? rcRate + 14.54 * (rcRate - 2.0) : rcRate
 *   omega_deg(x) = 200 * rcRate_eff * x_expo * (1 / (1 - r * superRate))
 *   omega_rad(x) = omega_deg(x) * (Math.PI / 180)
 */

const STORAGE_KEY = 'indoor_drone_sim_bf_rates_v1';

export const RATE_PRESETS = {
  cinematic: {
    name: 'Cinematic (電影平滑)',
    roll:  { rcRate: 0.70, superRate: 0.50, expo: 0.30 },
    pitch: { rcRate: 0.70, superRate: 0.50, expo: 0.30 },
    yaw:   { rcRate: 0.65, superRate: 0.45, expo: 0.25 }
  },
  freestyle: {
    name: 'Freestyle (花式穿越)',
    roll:  { rcRate: 1.00, superRate: 0.70, expo: 0.15 },
    pitch: { rcRate: 1.00, superRate: 0.70, expo: 0.15 },
    yaw:   { rcRate: 1.00, superRate: 0.65, expo: 0.10 }
  },
  racing: {
    name: 'Racing (競速高反應)',
    roll:  { rcRate: 1.20, superRate: 0.75, expo: 0.00 },
    pitch: { rcRate: 1.20, superRate: 0.75, expo: 0.00 },
    yaw:   { rcRate: 1.15, superRate: 0.70, expo: 0.00 }
  },
  default: {
    name: 'Betaflight Default (標準預設)',
    roll:  { rcRate: 1.00, superRate: 0.70, expo: 0.00 },
    pitch: { rcRate: 1.00, superRate: 0.70, expo: 0.00 },
    yaw:   { rcRate: 1.00, superRate: 0.70, expo: 0.00 }
  }
};

export class BetaflightRates {
  constructor() {
    this.axes = {
      roll:  { rcRate: 1.00, superRate: 0.70, expo: 0.00 },
      pitch: { rcRate: 1.00, superRate: 0.70, expo: 0.00 },
      yaw:   { rcRate: 1.00, superRate: 0.70, expo: 0.00 }
    };
    this.rcSmoothingCutoff = 12.0; // Keyboard RC smoothing responsiveness (Hz-like rate)
    this.loadFromStorage();
  }

  /**
   * Clamp and sanitize an axis configuration object
   */
  sanitizeAxis(cfg) {
    const rcRate = Math.max(0.10, Math.min(2.50, Number(cfg.rcRate) || 1.00));
    const superRate = Math.max(0.00, Math.min(0.95, Number(cfg.superRate) || 0.00));
    const expo = Math.max(0.00, Math.min(1.00, Number(cfg.expo) || 0.00));
    return {
      rcRate: Math.round(rcRate * 100) / 100,
      superRate: Math.round(superRate * 100) / 100,
      expo: Math.round(expo * 100) / 100
    };
  }

  /**
   * Compute effective RC Rate with high-rate linear compensation:
   * If rcRate > 2.0, rcRate_eff = rcRate + 14.54 * (rcRate - 2.0)
   */
  static computeEffectiveRcRate(rcRate) {
    const r = Math.max(0.01, rcRate);
    return r > 2.0 ? r + 14.54 * (r - 2.0) : r;
  }

  /**
   * Compute angular velocity in deg/s using Betaflight Classic Rates formula
   * @param {number} x Normalized stick input in [-1, 1]
   * @param {object} axisConfig { rcRate, superRate, expo }
   * @returns {number} Target angular velocity in deg/s
   */
  static calculateRateDeg(x, axisConfig) {
    const clampedX = Math.max(-1.0, Math.min(1.0, x));
    const r = Math.abs(clampedX);

    const rcRate = Math.max(0.01, axisConfig.rcRate);
    // Clamp superRate to [0.00, 0.95] to prevent division by zero
    const superRate = Math.max(0.00, Math.min(0.95, axisConfig.superRate));
    const expo = Math.max(0.00, Math.min(1.00, axisConfig.expo));

    // 1. Expo curve calculation: x_expo = x * (r^3 * expo + (1 - expo))
    const xExpo = clampedX * (Math.pow(r, 3) * expo + (1.0 - expo));

    // 2. RC Rate high-order linear compensation
    const rcRateEff = BetaflightRates.computeEffectiveRcRate(rcRate);

    // 3. Super Rate amplification & final deg/s
    const superFactor = 1.0 / (1.0 - r * superRate);
    const omegaDeg = 200.0 * rcRateEff * xExpo * superFactor;

    return omegaDeg;
  }

  /**
   * Compute angular velocity in rad/s for the physics engine
   */
  getRateRad(axisName, stickInput) {
    const cfg = this.axes[axisName] || this.axes.roll;
    const degPerSec = BetaflightRates.calculateRateDeg(stickInput, cfg);
    return degPerSec * (Math.PI / 180.0);
  }

  /**
   * Compute angular velocity in deg/s for a given axis and stick input
   */
  getRateDeg(axisName, stickInput) {
    const cfg = this.axes[axisName] || this.axes.roll;
    return BetaflightRates.calculateRateDeg(stickInput, cfg);
  }

  /**
   * Get key telemetry metrics for an axis:
   * - maxVel: Full stick deflection angular velocity (deg/s) at |x| = 1.0
   * - centerSens: Slope d(omega_deg)/dx at x = 0 (deg/s)
   */
  getAxisMetrics(axisName) {
    const cfg = this.axes[axisName] || this.axes.roll;
    const rcRateEff = BetaflightRates.computeEffectiveRcRate(cfg.rcRate);
    const centerSens = 200.0 * rcRateEff * (1.0 - cfg.expo);
    const maxVel = BetaflightRates.calculateRateDeg(1.0, cfg);
    return {
      centerSens: Math.round(centerSens),
      maxVel: Math.round(maxVel)
    };
  }

  setAxisParam(axisName, param, value) {
    if (!this.axes[axisName]) return;
    this.axes[axisName][param] = Number(value);
    this.axes[axisName] = this.sanitizeAxis(this.axes[axisName]);
    this.saveToStorage();
  }

  applyPreset(presetKey) {
    const preset = RATE_PRESETS[presetKey] || RATE_PRESETS.default;
    this.axes.roll = this.sanitizeAxis(preset.roll);
    this.axes.pitch = this.sanitizeAxis(preset.pitch);
    this.axes.yaw = this.sanitizeAxis(preset.yaw);
    this.saveToStorage();
  }

  resetToDefault() {
    this.applyPreset('default');
  }

  saveToStorage() {
    try {
      const payload = {
        axes: this.axes,
        rcSmoothingCutoff: this.rcSmoothingCutoff
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (_) {
      // Ignore storage quota / privacy mode errors
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.axes) {
        if (parsed.axes.roll) this.axes.roll = this.sanitizeAxis(parsed.axes.roll);
        if (parsed.axes.pitch) this.axes.pitch = this.sanitizeAxis(parsed.axes.pitch);
        if (parsed.axes.yaw) this.axes.yaw = this.sanitizeAxis(parsed.axes.yaw);
      }
      if (typeof parsed.rcSmoothingCutoff === 'number') {
        this.rcSmoothingCutoff = Math.max(3, Math.min(35, parsed.rcSmoothingCutoff));
      }
    } catch (_) {
      // Fallback to defaults
    }
  }
}

/**
 * High-DPI HTML5 Canvas 2D Real-Time Betaflight Rates Curve Renderer
 */
export class RatesCurveChart {
  constructor(canvas, ratesModel) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rates = ratesModel;
    this.colors = {
      roll:  { stroke: '#ff4d5e', glow: 'rgba(255, 77, 94, 0.45)', label: 'Roll' },
      pitch: { stroke: '#34d399', glow: 'rgba(52, 211, 153, 0.45)', label: 'Pitch' },
      yaw:   { stroke: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)', label: 'Yaw' }
    };
  }

  /**
   * Render the 3-axis rate curves + live stick tracking dots + corner telemetry
   * @param {object} liveInput { roll: [-1,1], pitch: [-1,1], yaw: [-1,1] }
   */
  render(liveInput = { roll: 0, pitch: 0, yaw: 0 }) {
    if (!this.canvas || !this.ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(260, rect.width || 320);
    const cssH = Math.max(180, rect.height || 200);

    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = 'rgba(10, 14, 22, 0.92)';
    ctx.fillRect(0, 0, cssW, cssH);

    const padLeft = 40;
    const padRight = 14;
    const padTop = 14;
    const padBottom = 24;
    const plotW = cssW - padLeft - padRight;
    const plotH = cssH - padTop - padBottom;
    const cx = padLeft + plotW * 0.5;
    const cy = padTop + plotH * 0.5;

    // Determine dynamic Y-axis scale from max angular velocity across all 3 axes
    const mRoll = this.rates.getAxisMetrics('roll');
    const mPitch = this.rates.getAxisMetrics('pitch');
    const mYaw = this.rates.getAxisMetrics('yaw');
    const peakRate = Math.max(200, mRoll.maxVel, mPitch.maxVel, mYaw.maxVel);
    // Round up to a clean step (e.g., nearest 200 deg/s)
    const yMax = Math.ceil(peakRate / 200) * 200;

    // Draw background grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
    ctx.font = '10px "JetBrains Mono", "SFMono-Regular", Consolas, monospace';

    // Vertical grid lines (-100%, -50%, 0%, +50%, +100%)
    const xTicks = [-1, -0.5, 0, 0.5, 1];
    ctx.textAlign = 'center';
    for (const t of xTicks) {
      const x = cx + t * (plotW * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      ctx.fillText(`${Math.round(t * 100)}%`, x, padTop + plotH + 15);
    }

    // Horizontal grid lines (-yMax, -yMax/2, 0, +yMax/2, +yMax)
    const yTicks = [-1, -0.5, 0, 0.5, 1];
    ctx.textAlign = 'right';
    for (const t of yTicks) {
      const y = cy - t * (plotH * 0.5);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      const labelVal = Math.round(t * yMax);
      ctx.fillText(`${labelVal}`, padLeft - 5, y + 3);
    }

    // Center crosshair axes
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.32)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, padTop);
    ctx.lineTo(cx, padTop + plotH);
    ctx.moveTo(padLeft, cy);
    ctx.lineTo(padLeft + plotW, cy);
    ctx.stroke();

    // Clip to plot region for curves
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, plotW, plotH);
    ctx.clip();

    // Draw the 3 curves: Yaw, Pitch, Roll (slight dash or glow so overlapping curves remain visible)
    const axesOrder = ['yaw', 'pitch', 'roll'];
    const numSamples = 120;

    for (let idx = 0; idx < axesOrder.length; idx++) {
      const axis = axesOrder[idx];
      const style = this.colors[axis];

      ctx.beginPath();
      for (let i = 0; i <= numSamples; i++) {
        const normX = (i / numSamples) * 2.0 - 1.0;
        const deg = this.rates.getRateDeg(axis, normX);
        const px = cx + normX * (plotW * 0.5);
        const py = cy - (deg / yMax) * (plotH * 0.5);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = axis === 'roll' ? 2.2 : (axis === 'pitch' ? 2.0 : 1.8);
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();

    // Draw real-time glowing tracking dots for current stick positions
    for (const axis of axesOrder) {
      const stickVal = Math.max(-1, Math.min(1, liveInput[axis] || 0));
      const deg = this.rates.getRateDeg(axis, stickVal);
      const px = cx + stickVal * (plotW * 0.5);
      const py = Math.max(padTop, Math.min(padTop + plotH, cy - (deg / yMax) * (plotH * 0.5)));
      const style = this.colors[axis];

      // Outer glow halo
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = style.glow;
      ctx.fill();

      // Inner bright core
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = style.stroke;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Show live deg/s label next to dot when stick is deflected
      if (Math.abs(stickVal) > 0.03) {
        const label = `${Math.round(deg)}°/s (${Math.round(stickVal * 100)}%)`;
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillStyle = style.stroke;
        ctx.textAlign = stickVal > 0.35 ? 'right' : 'left';
        const offsetX = stickVal > 0.35 ? -9 : 9;
        const offsetY = axis === 'roll' ? -8 : (axis === 'pitch' ? 4 : 14);
        ctx.fillText(label, px + offsetX, Math.max(padTop + 10, Math.min(padTop + plotH - 6, py + offsetY)));
      }
    }

    // Corner Legend & Live Metrics Overlay (Top-Left inside plot)
    const legendX = padLeft + 7;
    let legendY = padTop + 12;
    ctx.textAlign = 'left';
    ctx.font = '10px "JetBrains Mono", monospace';

    const metricsMap = { roll: mRoll, pitch: mPitch, yaw: mYaw };
    for (const axis of ['roll', 'pitch', 'yaw']) {
      const st = this.colors[axis];
      const m = metricsMap[axis];
      ctx.fillStyle = st.stroke;
      ctx.fillText(
        `● ${st.label.padEnd(5)} Max:${String(m.maxVel).padStart(4)}°/s  Cntr:${String(m.centerSens).padStart(3)}°/s`,
        legendX,
        legendY
      );
      legendY += 13;
    }

    ctx.restore();
  }
}
