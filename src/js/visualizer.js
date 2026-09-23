/* ==========================================================================
   visualizer.js — CAVA-style frequency bar visualizer on <canvas>
   • 64 bars, log-spaced frequency mapping, eased rise/fall
   • rounded tops, neon cyan→magenta gradient, glow, falling peaks,
     mirrored reflection, gentle idle pulse when silent
   ========================================================================== */

const NUM_BARS = 64;
const GAP_RATIO = 0.35; // portion of a slot used as gap
const RISE = 0.34; // easing when bars go up
const FALL = 0.10; // easing when bars come down
const PEAK_FALL = 0.004; // peak marker gravity (per frame, normalized)
const BASELINE = 0.74; // baseline as fraction of canvas height

export class Visualizer {
  constructor(canvas, getAnalyser) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.getAnalyser = getAnalyser; // () => AnalyserNode | null
    this.levels = new Float32Array(NUM_BARS); // eased 0..1
    this.peaks = new Float32Array(NUM_BARS);
    this.freq = null; // Uint8Array sized to analyser bins
    this.raf = 0;
    this.t = 0;
    this.playing = false;
    this.gradient = null;

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, w * dpr);
    this.canvas.height = Math.max(1, h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    // Vertical neon gradient: cyan (bottom) → magenta (top)
    const grad = this.g.createLinearGradient(0, h * BASELINE, 0, 0);
    grad.addColorStop(0, "#00fff9");
    grad.addColorStop(0.55, "#00c8ff");
    grad.addColorStop(0.8, "#b026ff");
    grad.addColorStop(1, "#ff00c8");
    this.gradient = grad;
  }

  setPlaying(playing) {
    this.playing = playing;
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Pull frequency data and map bins → bars with log-ish spacing. */
  sample(targets) {
    const analyser = this.getAnalyser();
    if (this.playing && analyser) {
      const bins = analyser.frequencyBinCount;
      if (!this.freq || this.freq.length !== bins) this.freq = new Uint8Array(bins);
      analyser.getByteFrequencyData(this.freq);

      const usable = Math.floor(bins * 0.82); // drop near-nyquist silence
      for (let i = 0; i < NUM_BARS; i++) {
        // Exponential index spacing gives low frequencies more resolution
        const lo = Math.floor(Math.pow(i / NUM_BARS, 1.6) * usable);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / NUM_BARS, 1.6) * usable));
        let sum = 0;
        for (let j = lo; j < hi; j++) sum += this.freq[j];
        let v = sum / (hi - lo) / 255;
        v = Math.pow(v, 1.35) * (0.75 + (i / NUM_BARS) * 0.55); // treble lift
        targets[i] = Math.min(1, v);
      }
    } else {
      // Idle: gentle traveling sine pulse so bars never fully vanish
      for (let i = 0; i < NUM_BARS; i++) {
        targets[i] =
          0.028 +
          0.022 * (0.5 + 0.5 * Math.sin(this.t * 0.045 + i * 0.42)) +
          0.012 * (0.5 + 0.5 * Math.sin(this.t * 0.02 - i * 0.18));
      }
    }
  }

  frame() {
    this.raf = requestAnimationFrame(this.frame);
    this.t++;

    const g = this.g;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;

    const targets = this._targets || (this._targets = new Float32Array(NUM_BARS));
    this.sample(targets);

    g.clearRect(0, 0, w, h);

    const baseY = h * BASELINE;
    const slot = w / NUM_BARS;
    const barW = Math.max(2, slot * (1 - GAP_RATIO));
    const maxH = baseY - 12;
    const radius = Math.min(barW / 2, 4);

    // Baseline scan-line
    g.save();
    g.strokeStyle = "rgba(0,255,249,0.22)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, baseY + 0.5);
    g.lineTo(w, baseY + 0.5);
    g.stroke();
    g.restore();

    for (let i = 0; i < NUM_BARS; i++) {
      // Ease toward target: quick attack, slow decay (classic cava feel)
      const tgt = targets[i];
      const cur = this.levels[i];
      this.levels[i] = cur + (tgt - cur) * (tgt > cur ? RISE : FALL);

      // Peak markers linger then fall
      if (this.levels[i] > this.peaks[i]) {
        this.peaks[i] = this.levels[i];
      } else {
        this.peaks[i] = Math.max(this.levels[i], this.peaks[i] - PEAK_FALL * (1 + this.peaks[i] * 4));
      }

      const x = i * slot + (slot - barW) / 2;
      const bh = Math.max(2, this.levels[i] * maxH);
      const y = baseY - bh;

      // --- main bar with neon glow ---
      g.save();
      g.shadowColor = i % 2 ? "rgba(255,0,200,0.55)" : "rgba(0,255,249,0.55)";
      g.shadowBlur = 10;
      g.fillStyle = this.gradient;
      roundTopRect(g, x, y, barW, bh, radius);
      g.fill();
      g.restore();

      // --- falling peak dot ---
      if (this.playing || this.peaks[i] > 0.06) {
        const py = baseY - this.peaks[i] * maxH - 4;
        g.fillStyle = "rgba(240,230,0,0.85)";
        g.fillRect(x, py, barW, 2);
      }

      // --- mirrored reflection below baseline ---
      const rh = bh * 0.28;
      const rGrad = g.createLinearGradient(0, baseY, 0, baseY + rh);
      rGrad.addColorStop(0, "rgba(0,255,249,0.22)");
      rGrad.addColorStop(1, "rgba(0,255,249,0)");
      g.fillStyle = rGrad;
      g.fillRect(x, baseY + 2, barW, rh);
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener("resize", this.resize);
  }
}

/** Rect with rounded top corners only. */
function roundTopRect(g, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  g.beginPath();
  g.moveTo(x, y + h);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h);
  g.closePath();
}
