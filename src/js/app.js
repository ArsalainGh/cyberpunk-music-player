/* ==========================================================================
   app.js — NEØNWAVE main initialization & UI orchestration
   ========================================================================== */

import "../css/style.css";
import { formatTime, debounce, clamp } from "./utils.js";
import {
  supportsFSAccess,
  pickDirectory,
  filesFromInput,
  filesFromDrop,
  createTrack,
  extractMetadata,
  DEFAULT_COVER,
} from "./fileLoader.js";
import { Player } from "./player.js";
import { Visualizer } from "./visualizer.js";
import { Playlist } from "./playlist.js";

/* ------------------------------- DOM refs ------------------------------- */
const $ = (id) => document.getElementById(id);
const el = {
  loadFolder: $("btn-load-folder"),
  pickDir: $("btn-pick-dir"),
  fileInput: $("file-input"),
  trackList: $("track-list"),
  emptyState: $("empty-state"),
  search: $("search-input"),
  sort: $("sort-select"),
  stats: $("library-stats"),
  npArt: $("np-art"),
  npTitle: $("np-title"),
  npArtist: $("np-artist"),
  npAlbum: $("np-album"),
  artFrame: $("art-frame"),
  hudStatus: $("hud-status"),
  btnPlay: $("btn-play"),
  iconPlay: $("icon-play"),
  iconPause: $("icon-pause"),
  btnPrev: $("btn-prev"),
  btnNext: $("btn-next"),
  btnShuffle: $("btn-shuffle"),
  btnRepeat: $("btn-repeat"),
  repeatBadge: $("repeat-one-badge"),
  seekBar: $("seek-bar"),
  seekFill: $("seek-fill"),
  seekHandle: $("seek-handle"),
  timeCur: $("time-current"),
  timeTot: $("time-total"),
  btnMute: $("btn-mute"),
  volSlider: $("volume-slider"),
  volW1: $("vol-w1"),
  volW2: $("vol-w2"),
  volX: $("vol-x"),
  dropOverlay: $("drop-overlay"),
  toasts: $("toast-container"),
};

/* ------------------------------ Core objects ---------------------------- */
const player = new Player();
const playlist = new Playlist(el.trackList);
const viz = new Visualizer($("visualizer"), () => player.analyser);
viz.start(); // idle animation runs even before audio exists

/* -------------------------------- State --------------------------------- */
const LS = {
  volume: "nw_volume",
  muted: "nw_muted",
  shuffle: "nw_shuffle",
  repeat: "nw_repeat",
  lastTrack: "nw_last_track",
};

const state = {
  shuffle: localStorage.getItem(LS.shuffle) === "1",
  repeat: localStorage.getItem(LS.repeat) || "off", // off | all | one
  seeking: false,
};

el.npArt.src = DEFAULT_COVER;

/* =========================================================================
   Toast notifications
   ========================================================================= */
function toast(msg, type = "info", ms = 3800) {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = msg;
  el.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    t.addEventListener("animationend", () => t.remove(), { once: true });
  }, ms);
}

/* click flash effect on all buttons */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".icon-btn, .cyber-btn");
  if (!btn) return;
  btn.classList.remove("flash");
  void btn.offsetWidth; // restart animation
  btn.classList.add("flash");
});

/* =========================================================================
   Library loading
   ========================================================================= */
async function loadViaPicker() {
  if (!supportsFSAccess()) {
    // Firefox/Safari fallback → directory input
    el.fileInput.click();
    return;
  }
  try {
    showLoading();
    const files = await pickDirectory();
    await ingestFiles(files);
  } catch (err) {
    hideLoading();
    if (err?.name !== "AbortError") {
      toast(`<b>ERR //</b> Folder access failed: ${err.message}`, "error");
    }
  }
}

async function ingestFiles(files) {
  hideLoading();
  if (!files.length) {
    toast("<b>WARN //</b> No supported audio files found in that location.", "warn");
    return;
  }
  const tracks = files.map(createTrack);
  const added = playlist.addTracks(tracks);
  if (added === 0) {
    toast("<b>INFO //</b> All of those tracks are already loaded.", "warn");
    return;
  }

  el.emptyState?.remove();
  updateStats();
  toast(`<b>OK //</b> ${added} track${added > 1 ? "s" : ""} loaded into the grid.`);

  // Async metadata pipeline — rows update live as tags/durations resolve
  const fresh = tracks.filter((t) => playlist.tracks.includes(t));
  const rerenderDebounced = debounce(() => {
    // resort if the active sort depends on async fields
    if (/duration|title|artist/.test(playlist.sortMode)) playlist.refresh();
    updateStats();
  }, 600);
  extractMetadata(fresh, (t) => {
    playlist.updateTrackRow(t);
    if (player.currentTrack?.id === t.id) applyNowPlaying(t);
    rerenderDebounced();
  });

  // Restore last-played track by filename (first load only)
  if (!player.currentTrack) {
    const lastName = localStorage.getItem(LS.lastTrack);
    const match = lastName && playlist.findByFileName(lastName);
    if (match) {
      selectTrack(match, false);
      toast(`<b>RESTORED //</b> Last session track cued: ${match.title}`, "info");
    }
  }
}

function showLoading() {
  if (!playlist.size) {
    el.trackList.innerHTML = `<div class="loader-row"><span class="spinner"></span>SCANNING DIRECTORY...</div>`;
  }
}
function hideLoading() {
  el.trackList.querySelector(".loader-row")?.remove();
  // Restore the empty-state panel if the library is still empty
  if (!playlist.size && !el.trackList.children.length) {
    el.trackList.appendChild(el.emptyState);
  }
}

function updateStats() {
  const total = playlist.tracks.reduce(
    (s, t) => s + (Number.isFinite(t.duration) ? t.duration : 0),
    0
  );
  el.stats.textContent = playlist.size
    ? `${playlist.size} TRACKS // ${formatTime(total)}`
    : "";
}

el.loadFolder.addEventListener("click", loadViaPicker);
el.pickDir?.addEventListener("click", loadViaPicker);

el.fileInput.addEventListener("change", () => {
  ingestFiles(filesFromInput(el.fileInput.files));
  el.fileInput.value = "";
});

/* Drag & drop (whole window) */
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  if (++dragDepth === 1) el.dropOverlay.classList.remove("hidden");
});
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) {
    dragDepth = 0;
    el.dropOverlay.classList.add("hidden");
  }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.dropOverlay.classList.add("hidden");
  try {
    const files = await filesFromDrop(e.dataTransfer);
    await ingestFiles(files);
  } catch (err) {
    toast(`<b>ERR //</b> Drop failed: ${err.message}`, "error");
  }
});

/* =========================================================================
   Search & sort
   ========================================================================= */
el.search.addEventListener(
  "input",
  debounce(() => playlist.setQuery(el.search.value), 180)
);
el.sort.addEventListener("change", () => playlist.setSort(el.sort.value));

/* =========================================================================
   Playback flow
   ========================================================================= */
playlist.onSelect = (track) => selectTrack(track, true);

function selectTrack(track, autoplay) {
  if (autoplay) {
    player.playTrack(track);
  } else {
    player.load(track);
  }
  playlist.setCurrent(track.id, autoplay);
  applyNowPlaying(track);
  localStorage.setItem(LS.lastTrack, track.fileName);
  updateMediaSession(track);
}

function applyNowPlaying(track) {
  el.npTitle.textContent = track.title;
  el.npArtist.textContent = track.artist || "Unknown artist";
  el.npAlbum.textContent = track.album || "";
  el.npArt.src = track.artUrl || DEFAULT_COVER;
  el.timeTot.textContent = formatTime(track.duration);
  requestAnimationFrame(updateMarquee);
}

/** Marquee scroll if the title overflows its container. */
function updateMarquee() {
  const clip = el.npTitle.parentElement;
  el.npTitle.classList.remove("marquee");
  if (el.npTitle.scrollWidth > clip.clientWidth + 4) {
    const dist = el.npTitle.scrollWidth - clip.clientWidth + 60;
    el.npTitle.style.setProperty("--clip-w", `${clip.clientWidth}px`);
    el.npTitle.style.setProperty("--marquee-dur", `${Math.max(6, dist / 25)}s`);
    el.npTitle.classList.add("marquee");
  }
}

/* ----- next / prev with shuffle & repeat semantics ----- */
function pickNextIndex(dir) {
  const order = playlist.getOrder();
  if (!order.length) return -1;
  const cur = playlist.indexOf(player.currentTrack);

  if (state.shuffle && order.length > 1) {
    let i;
    do {
      i = Math.floor(Math.random() * order.length);
    } while (i === cur);
    return i;
  }
  return cur + dir;
}

function playNext(auto = false) {
  const order = playlist.getOrder();
  if (!order.length) return;
  let i = pickNextIndex(1);
  if (i >= order.length || i < 0) {
    if (state.repeat === "all" || !auto) i = 0;
    else {
      // repeat off + end of list → stop
      player.audio.pause();
      player.seek(0);
      return;
    }
  }
  selectTrack(order[i], true);
  playlist.revealCurrent();
}

function playPrev() {
  // Restart current track if >3s in (standard player behavior)
  if (player.audio.currentTime > 3) {
    player.seek(0);
    return;
  }
  const order = playlist.getOrder();
  if (!order.length) return;
  let i = pickNextIndex(-1);
  if (i < 0) i = order.length - 1;
  selectTrack(order[i], true);
  playlist.revealCurrent();
}

async function togglePlay() {
  if (!player.currentTrack) {
    const order = playlist.getOrder();
    if (!order.length) {
      toast("<b>WARN //</b> Load some audio files first.", "warn");
      return;
    }
    selectTrack(order[0], true);
    return;
  }
  await player.toggle();
}

el.btnPlay.addEventListener("click", togglePlay);
el.btnNext.addEventListener("click", () => playNext(false));
el.btnPrev.addEventListener("click", playPrev);

/* ----- player events ----- */
player.onPlayState = (playing) => {
  el.iconPlay.classList.toggle("hidden", playing);
  el.iconPause.classList.toggle("hidden", !playing);
  el.artFrame.classList.toggle("playing", playing);
  el.hudStatus.textContent = playing ? "▶ SIGNAL ACTIVE" : "■ STANDBY";
  el.hudStatus.classList.toggle("playing", playing);
  viz.setPlaying(playing);
  playlist.setCurrent(player.currentTrack?.id ?? null, playing);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
};

player.onTime = (cur, dur) => {
  if (state.seeking) return;
  el.timeCur.textContent = formatTime(cur);
  if (Number.isFinite(dur)) el.timeTot.textContent = formatTime(dur);
  const pct = Number.isFinite(dur) && dur > 0 ? (cur / dur) * 100 : 0;
  el.seekFill.style.width = `${pct}%`;
  el.seekHandle.style.left = `${pct}%`;
};

player.onEnded = () => {
  if (state.repeat === "one") {
    player.seek(0);
    player.audio.play().catch(() => {});
    return;
  }
  playNext(true);
};

player.onError = (track) => {
  toast(`<b>ERR //</b> Cannot decode <b>${track.fileName}</b> — skipping.`, "error");
  setTimeout(() => playNext(true), 400);
};

/* =========================================================================
   Seek bar (click + drag)
   ========================================================================= */
function seekFromEvent(e) {
  const rect = el.seekBar.getBoundingClientRect();
  const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  el.seekFill.style.width = `${ratio * 100}%`;
  el.seekHandle.style.left = `${ratio * 100}%`;
  el.timeCur.textContent = formatTime(ratio * (player.audio.duration || 0));
  return ratio;
}

el.seekBar.addEventListener("pointerdown", (e) => {
  if (!player.currentTrack) return;
  state.seeking = true;
  el.seekBar.classList.add("dragging");
  el.seekBar.setPointerCapture(e.pointerId);
  seekFromEvent(e);
});
el.seekBar.addEventListener("pointermove", (e) => {
  if (state.seeking) seekFromEvent(e);
});
el.seekBar.addEventListener("pointerup", (e) => {
  if (!state.seeking) return;
  state.seeking = false;
  el.seekBar.classList.remove("dragging");
  player.seekRatio(seekFromEvent(e));
});

/* =========================================================================
   Volume & mute
   ========================================================================= */
function refreshVolumeUI() {
  const v = player.muted ? 0 : player.volume;
  el.volSlider.value = Math.round(player.volume * 100);
  el.volSlider.style.setProperty("--vol", `${player.muted ? 0 : player.volume * 100}%`);
  // speaker icon states: muted / low / medium / high
  el.volX.classList.toggle("hidden", !player.muted && v > 0);
  el.volW1.classList.toggle("hidden", player.muted || v === 0);
  el.volW2.classList.toggle("hidden", player.muted || v < 0.55);
}

function setVolume(v, announce = false) {
  player.setVolume(v);
  if (v > 0 && player.muted) player.setMuted(false);
  localStorage.setItem(LS.volume, String(player.volume));
  localStorage.setItem(LS.muted, player.muted ? "1" : "0");
  refreshVolumeUI();
  if (announce) toast(`<b>VOL //</b> ${Math.round(player.volume * 100)}%`, "info", 1200);
}

function toggleMute() {
  player.setMuted(!player.muted);
  localStorage.setItem(LS.muted, player.muted ? "1" : "0");
  refreshVolumeUI();
}

el.volSlider.addEventListener("input", () => setVolume(el.volSlider.value / 100));
el.btnMute.addEventListener("click", toggleMute);

/* =========================================================================
   Shuffle & repeat
   ========================================================================= */
function refreshModeUI() {
  el.btnShuffle.classList.toggle("active", state.shuffle);
  el.btnRepeat.classList.toggle("active", state.repeat !== "off");
  el.repeatBadge.classList.toggle("hidden", state.repeat !== "one");
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  localStorage.setItem(LS.shuffle, state.shuffle ? "1" : "0");
  refreshModeUI();
  toast(`<b>SHUFFLE //</b> ${state.shuffle ? "ENGAGED" : "OFFLINE"}`, "info", 1500);
}

function cycleRepeat() {
  state.repeat = state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off";
  localStorage.setItem(LS.repeat, state.repeat);
  refreshModeUI();
  const label = { off: "OFFLINE", all: "REPEAT ALL", one: "REPEAT ONE" }[state.repeat];
  toast(`<b>LOOP //</b> ${label}`, "info", 1500);
}

el.btnShuffle.addEventListener("click", toggleShuffle);
el.btnRepeat.addEventListener("click", cycleRepeat);

/* =========================================================================
   Keyboard shortcuts
   ========================================================================= */
document.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  switch (e.key) {
    case " ":
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      e.preventDefault();
      playNext(false);
      break;
    case "ArrowLeft":
      e.preventDefault();
      playPrev();
      break;
    case "ArrowUp":
      e.preventDefault();
      setVolume(clamp(player.volume + 0.05, 0, 1), true);
      break;
    case "ArrowDown":
      e.preventDefault();
      setVolume(clamp(player.volume - 0.05, 0, 1), true);
      break;
    case "m":
    case "M":
      toggleMute();
      break;
    case "s":
    case "S":
      toggleShuffle();
      break;
    case "r":
    case "R":
      cycleRepeat();
      break;
  }
});

/* =========================================================================
   MediaSession API — OS-level media controls & notifications
   ========================================================================= */
function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "Unknown artist",
    album: track.album || "NEØNWAVE",
    artwork: [{ src: track.artUrl || DEFAULT_COVER, sizes: "512x512", type: "image/png" }],
  });
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => togglePlay());
  ms.setActionHandler("pause", () => togglePlay());
  ms.setActionHandler("previoustrack", () => playPrev());
  ms.setActionHandler("nexttrack", () => playNext(false));
  try {
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) player.seek(d.seekTime);
    });
  } catch {
    /* seekto unsupported */
  }
}

/* =========================================================================
   Boot — restore persisted preferences
   ========================================================================= */
(function boot() {
  const vol = parseFloat(localStorage.getItem(LS.volume));
  player.setVolume(Number.isFinite(vol) ? vol : 0.8);
  player.setMuted(localStorage.getItem(LS.muted) === "1");
  refreshVolumeUI();
  refreshModeUI();
  el.sort.value = playlist.sortMode;

  if (!supportsFSAccess()) {
    toast(
      "<b>COMPAT //</b> File System Access API unavailable — using the fallback file browser. Drag &amp; drop also works.",
      "warn",
      6000
    );
  }
})();
