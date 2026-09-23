/* ==========================================================================
   playlist.js — track collection, sorting, searching & list rendering
   ========================================================================== */

import { formatTime, relativeTime, escapeHtml } from "./utils.js";
import { DEFAULT_COVER } from "./fileLoader.js";

const SORTERS = {
  "added-desc": (a, b) => b.added - a.added,
  "added-asc": (a, b) => a.added - b.added,
  "title-asc": (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  "title-desc": (a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: "base" }),
  "artist-asc": (a, b) =>
    (a.artist || "\uffff").localeCompare(b.artist || "\uffff", undefined, { sensitivity: "base" }),
  "artist-desc": (a, b) =>
    (b.artist || "").localeCompare(a.artist || "", undefined, { sensitivity: "base" }),
  "duration-asc": (a, b) => (a.duration || 1e9) - (b.duration || 1e9),
  "duration-desc": (a, b) => (b.duration || 0) - (a.duration || 0),
};

export class Playlist {
  constructor(listEl) {
    this.listEl = listEl;
    this.tracks = []; // master collection
    this.view = []; // filtered + sorted
    this.sortMode = "added-desc";
    this.query = "";
    this.currentId = null;
    this.playing = false;
    this.onSelect = null; // (track) callback

    // Event delegation for row clicks
    this.listEl.addEventListener("click", (e) => {
      const row = e.target.closest(".track-item");
      if (!row) return;
      const track = this.tracks.find((t) => t.id === row.dataset.id);
      if (track) this.onSelect?.(track);
    });
  }

  /** Add new files, skipping duplicates (same name + size). */
  addTracks(newTracks) {
    const seen = new Set(this.tracks.map((t) => `${t.fileName}::${t.file.size}`));
    const fresh = newTracks.filter((t) => {
      const key = `${t.fileName}::${t.file.size}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.tracks.push(...fresh);
    this.refresh();
    return fresh.length;
  }

  get size() {
    return this.tracks.length;
  }

  setSort(mode) {
    if (SORTERS[mode]) this.sortMode = mode;
    this.refresh();
  }

  setQuery(q) {
    this.query = q.trim().toLowerCase();
    this.refresh();
  }

  setCurrent(id, playing) {
    this.currentId = id;
    this.playing = playing;
    this.updateHighlights();
  }

  /** The playable ordered list (what next/prev navigate through). */
  getOrder() {
    return this.view;
  }

  indexOf(track) {
    return this.view.findIndex((t) => t.id === track?.id);
  }

  findByFileName(name) {
    return this.tracks.find((t) => t.fileName === name) || null;
  }

  /* ------------------------------ rendering ----------------------------- */

  refresh() {
    const q = this.query;
    this.view = this.tracks
      .filter(
        (t) =>
          !q ||
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          t.fileName.toLowerCase().includes(q)
      )
      .sort(SORTERS[this.sortMode]);
    this.render();
  }

  render() {
    if (this.tracks.length === 0) return; // keep the empty-state markup

    if (this.view.length === 0) {
      this.listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-glyph">⌀</div>
          <p class="empty-title">NO MATCHES</p>
          <p class="empty-hint">No tracks match your search query.</p>
        </div>`;
      return;
    }

    const rows = this.view
      .map((t, i) => {
        const isCurrent = t.id === this.currentId;
        return `
        <div class="track-item${isCurrent ? " playing" : ""}" data-id="${t.id}" title="${escapeHtml(t.fileName)}">
          <span class="t-num">${isCurrent ? eqHtml(this.playing) : String(i + 1).padStart(2, "0")}</span>
          <img class="t-art" loading="lazy" src="${t.artUrl || DEFAULT_COVER}" alt="" draggable="false" />
          <div class="t-info">
            <div class="t-title">${escapeHtml(t.title)}</div>
            <div class="t-artist">${escapeHtml(t.artist || "Unknown artist")}</div>
          </div>
          <span class="t-added">${relativeTime(t.added)}</span>
          <span class="t-dur">${formatTime(t.duration)}</span>
        </div>`;
      })
      .join("");
    this.listEl.innerHTML = rows;
  }

  /** Update a single row after async metadata arrives (avoids full rerender). */
  updateTrackRow(track) {
    const row = this.listEl.querySelector(`.track-item[data-id="${track.id}"]`);
    if (!row) return;
    row.querySelector(".t-title").textContent = track.title;
    row.querySelector(".t-artist").textContent = track.artist || "Unknown artist";
    row.querySelector(".t-dur").textContent = formatTime(track.duration);
    if (track.artUrl) row.querySelector(".t-art").src = track.artUrl;
  }

  updateHighlights() {
    this.listEl.querySelectorAll(".track-item").forEach((row) => {
      const isCurrent = row.dataset.id === this.currentId;
      row.classList.toggle("playing", isCurrent);
      const numEl = row.querySelector(".t-num");
      if (isCurrent) {
        numEl.innerHTML = eqHtml(this.playing);
      } else if (numEl.querySelector(".t-eq")) {
        const idx = this.view.findIndex((t) => t.id === row.dataset.id);
        numEl.textContent = String(idx + 1).padStart(2, "0");
      }
    });
  }

  /** Scroll the current track into view. */
  revealCurrent() {
    const row = this.listEl.querySelector(".track-item.playing");
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function eqHtml(playing) {
  return `<span class="t-eq${playing ? "" : " paused"}"><i></i><i></i><i></i></span>`;
}
