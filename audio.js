/**
 * Real-Time Web Audio API Quadcopter & Stadium Match Sound Synthesizer (audio.js)
 *
 * Dynamically synthesizes:
 * - 4 independent brushless motor + tri-blade propeller harmonic oscillators
 * - Aerodynamic wind rush & turbo BOOST noise
 * - 3-2-1-START electronic match countdown beeps
 * - Carbon-fiber cage collision impact + electric spark snap
 * - Stadium Goal Horn fanfare
 */

export class DroneAudio {
  constructor() {
    this.ctx = null;
    this.initialized = false;
    this.muted = false;
    this.motorNodes = [];
    this.masterGain = null;
    this.windGain = null;
    this.windFilter = null;
    this.lastImpactTime = 0;
  }

  init() {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.28;
    this.masterGain.connect(this.ctx.destination);

    // Create 4 independent motor sound channels (fundamental + tri-blade harmonic)
    const detuneOffsets = [-4.5, 3.2, -2.1, 5.0];
    for (let i = 0; i < 4; i++) {
      const oscFund = this.ctx.createOscillator();
      const oscHarm = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      oscFund.type = 'sawtooth';
      oscHarm.type = 'triangle';
      oscFund.detune.value = detuneOffsets[i];
      oscHarm.detune.value = detuneOffsets[i] * 1.5;

      filter.type = 'bandpass';
      filter.frequency.value = 320;
      filter.Q.value = 1.4;

      gain.gain.value = 0.0;

      oscFund.connect(filter);
      oscHarm.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      oscFund.start();
      oscHarm.start();

      this.motorNodes.push({ oscFund, oscHarm, filter, gain });
    }

    // Create white-noise buffer for aerodynamic wind & propwash rush
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.9;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0;

    noiseSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    noiseSource.start();

    this.initialized = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0.0 : 0.28, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  /**
   * Update motor frequencies and volumes from real-time physics state
   */
  update(physics) {
    if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;

    for (let i = 0; i < 4; i++) {
      const rpm = physics.motorRPM[i] || 2000;
      const node = this.motorNodes[i];

      const baseFreq = Math.max(65, (rpm / 60) * 3.0);
      const harmFreq = baseFreq * 2.0;

      node.oscFund.frequency.setTargetAtTime(baseFreq, now, 0.025);
      node.oscHarm.frequency.setTargetAtTime(harmFreq, now, 0.025);
      node.filter.frequency.setTargetAtTime(Math.min(3800, baseFreq * 2.4), now, 0.03);

      const norm = Math.max(0, Math.min(1, (rpm - 1800) / 26000));
      const targetGain = 0.032 + 0.15 * Math.pow(norm, 1.35);
      node.gain.gain.setTargetAtTime(targetGain, now, 0.03);
    }

    const speed = physics.telemetry.speed || 0;
    const windNorm = Math.min(1, speed / 18.0);
    this.windFilter.frequency.setTargetAtTime(280 + windNorm * 1250, now, 0.05);
    this.windGain.gain.setTargetAtTime(windNorm * 0.20, now, 0.05);

    if (physics.telemetry.collisionIntensity > 1.0 && now - this.lastImpactTime > 0.14) {
      this.lastImpactTime = now;
      this.playCollisionImpact(Math.min(1, physics.telemetry.collisionIntensity / 6.0));
    }
  }

  /**
   * 3-2-1-START Match Countdown Electronic Tone
   */
  playCountdownBeep(isStart = false) {
    this.init();
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (!isStart) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.19);
    } else {
      // START! Dual harmonic chord
      [783.99, 1046.5].forEach((freq) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + 0.56);
      });
    }
  }

  /**
   * Carbon-Fiber Cage Impact + Spark Snap Sound
   */
  playCollisionImpact(intensity = 0.6) {
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Low carbon-cage thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.13);
    gain.gain.setValueAtTime(0.38 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);

    // High-frequency metallic cage spark click
    const sparkOsc = this.ctx.createOscillator();
    const sparkGain = this.ctx.createGain();
    sparkOsc.type = 'sawtooth';
    sparkOsc.frequency.setValueAtTime(2200, now);
    sparkOsc.frequency.exponentialRampToValueAtTime(420, now + 0.055);
    sparkGain.gain.setValueAtTime(0.18 * intensity, now);
    sparkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    sparkOsc.connect(sparkGain);
    sparkGain.connect(this.masterGain);
    sparkOsc.start(now);
    sparkOsc.stop(now + 0.065);
  }

  /**
   * Stadium Goal Horn & Fanfare Chime
   */
  playGoalHorn() {
    this.init();
    if (!this.initialized || this.muted || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Brass stadium horn triad
    const freqs = [220, 277.18, 329.63, 440];
    freqs.forEach((f) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.setValueAtTime(0.14, now + 0.45);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.18);
    });
  }

  playGateChime() {
    this.playGoalHorn();
  }
}
