/* ==========================================================================
   player.js — audio playback engine built on the Web Audio API
   Graph: <audio> → MediaElementSource → AnalyserNode → GainNode → destination
   ========================================================================== */

import { clamp } from "./utils.js";

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";

    // Web Audio graph is created lazily — AudioContext requires a user gesture.
    this.ctx = null;
    this.analyser = null;
    this.gain = null;

    this.volume = 0.8;
    this.muted = false;
    this.currentTrack = null;

    // Event callbacks assigned by the app layer
    this.onTime = null; // (currentTime, duration)
    this.onEnded = null;
    this.onPlayState = null; // (isPlaying)
    this.onError = null; // (track)

    this.audio.addEventListener("timeupdate", () => {
      this.onTime?.(this.audio.currentTime, this.audio.duration);
    });
    this.audio.addEventListener("ended", () => this.onEnded?.());
    this.audio.addEventListener("play", () => this.onPlayState?.(true));
    this.audio.addEventListener("pause", () => this.onPlayState?.(false));
    this.audio.addEventListener("error", () => {
      if (this.currentTrack) this.onError?.(this.currentTrack);
    });
  }

  /** Build the AudioContext graph (must run inside a user gesture). */
  initAudioGraph() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    const source = this.ctx.createMediaElementSource(this.audio);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512; // 256 frequency bins for the visualizer
    this.analyser.smoothingTimeConstant = 0.55;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.volume;

    source.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  /** Load a track (does not autostart). */
  load(track) {
    this.currentTrack = track;
    this.audio.src = track.url;
    this.audio.load();
  }

  /** Load and start playing a track. */
  async playTrack(track) {
    this.initAudioGraph();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.load(track);
    try {
      await this.audio.play();
    } catch (err) {
      // Autoplay rejection or decode failure
      if (err?.name !== "AbortError") this.onError?.(track);
    }
  }

  async toggle() {
    if (!this.currentTrack) return false;
    this.initAudioGraph();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.audio.paused) {
      try {
        await this.audio.play();
      } catch {
        /* ignored */
      }
    } else {
      this.audio.pause();
    }
    return !this.audio.paused;
  }

  get isPlaying() {
    return !this.audio.paused && !this.audio.ended && this.audio.readyState > 2;
  }

  seek(time) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = clamp(time, 0, this.audio.duration);
    }
  }

  seekRatio(ratio) {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = clamp(ratio, 0, 1) * this.audio.duration;
    }
  }

  /** Set volume 0..1. Uses GainNode when available, element volume otherwise. */
  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (!this.muted) this.applyGain(this.volume);
  }

  setMuted(m) {
    this.muted = m;
    this.applyGain(m ? 0 : this.volume);
  }

  applyGain(v) {
    if (this.gain) {
      // Small ramp avoids clicks
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
    this.audio.volume = this.gain ? 1 : v;
  }
}
