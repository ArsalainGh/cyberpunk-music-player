/* ==========================================================================
   fileLoader.js — filesystem access, folder scanning & metadata extraction
   Method A: File System Access API (window.showDirectoryPicker)
   Method B: <input webkitdirectory> + drag & drop (webkitGetAsEntry)
   Metadata: jsmediatags (CDN global) + <audio> duration probing
   ========================================================================== */

import { stripExt, uid } from "./utils.js";
import defaultCover from "../assets/default-cover.png";

export const DEFAULT_COVER = defaultCover;

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a"]);

/** Does this browser support the File System Access API? */
export function supportsFSAccess() {
  return typeof window.showDirectoryPicker === "function";
}

/** Is this filename a supported audio file? */
export function isAudioFile(name) {
  const ext = name.split(".").pop().toLowerCase();
  return AUDIO_EXTS.has(ext);
}

/* --------------------------------------------------------------------------
 * Track factory
 * ------------------------------------------------------------------------ */

/** Build the internal track object from a File. */
export function createTrack(file) {
  return {
    id: uid(),
    file,
    url: URL.createObjectURL(file), // stable object URL for playback
    fileName: file.name,
    title: stripExt(file.name),
    artist: "",
    album: "",
    duration: NaN, // filled in by the metadata queue
    added: file.lastModified || Date.now(),
    artUrl: null, // blob URL for embedded album art
    tagsLoaded: false,
  };
}

/* --------------------------------------------------------------------------
 * Method A — File System Access API
 * ------------------------------------------------------------------------ */

/** Prompt for a directory and recursively collect every audio File. */
export async function pickDirectory() {
  const dirHandle = await window.showDirectoryPicker({ mode: "read" });
  const files = [];
  await scanDirHandle(dirHandle, files);
  return files;
}

async function scanDirHandle(dirHandle, out) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file") {
      if (isAudioFile(entry.name)) {
        try {
          out.push(await entry.getFile());
        } catch {
          /* unreadable file — skip silently */
        }
      }
    } else if (entry.kind === "directory") {
      await scanDirHandle(entry, out); // recurse into subfolders
    }
  }
}

/* --------------------------------------------------------------------------
 * Method B — fallback input + drag & drop
 * ------------------------------------------------------------------------ */

/** Filter the FileList of an <input webkitdirectory multiple>. */
export function filesFromInput(fileList) {
  return Array.from(fileList).filter((f) => isAudioFile(f.name));
}

/** Recursively resolve dropped items (files AND folders). */
export async function filesFromDrop(dataTransfer) {
  const out = [];
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length > 0) {
    await Promise.all(entries.map((e) => walkEntry(e, out)));
  } else {
    // Plain file drop without entry support
    for (const f of Array.from(dataTransfer.files || [])) {
      if (isAudioFile(f.name)) out.push(f);
    }
  }
  return out;
}

function walkEntry(entry, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file(
        (file) => {
          if (isAudioFile(file.name)) out.push(file);
          resolve();
        },
        () => resolve()
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => {
        reader.readEntries(
          async (batch) => {
            if (!batch.length) return resolve();
            await Promise.all(batch.map((e) => walkEntry(e, out)));
            readBatch(); // readEntries returns max 100 per call
          },
          () => resolve()
        );
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

/* --------------------------------------------------------------------------
 * Metadata extraction (jsmediatags + duration probing)
 * ------------------------------------------------------------------------ */

/** Read ID3/MP4/FLAC tags via the jsmediatags CDN global. */
function readTags(track) {
  return new Promise((resolve) => {
    const jsmediatags = window.jsmediatags;
    if (!jsmediatags) return resolve(); // CDN unavailable — filename fallback

    jsmediatags.read(track.file, {
      onSuccess({ tags }) {
        if (tags.title) track.title = String(tags.title).trim() || track.title;
        if (tags.artist) track.artist = String(tags.artist).trim();
        if (tags.album) track.album = String(tags.album).trim();
        if (tags.picture && tags.picture.data && tags.picture.data.length) {
          try {
            const bytes = new Uint8Array(tags.picture.data);
            const blob = new Blob([bytes], { type: tags.picture.format || "image/jpeg" });
            track.artUrl = URL.createObjectURL(blob);
          } catch {
            /* corrupt art — keep default */
          }
        }
        resolve();
      },
      onError() {
        resolve(); // no/unreadable tags — filename fallback already in place
      },
    });
  });
}

/** Probe track duration by loading metadata into a throwaway <audio>. */
function readDuration(track) {
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    const done = () => {
      probe.removeAttribute("src");
      probe.load();
      resolve();
    };
    const timer = setTimeout(done, 8000); // corrupt file guard
    probe.addEventListener(
      "loadedmetadata",
      () => {
        clearTimeout(timer);
        track.duration = probe.duration;
        done();
      },
      { once: true }
    );
    probe.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true }
    );
    probe.src = track.url;
  });
}

/**
 * Process tracks through the metadata pipeline with limited concurrency.
 * `onProgress(track)` fires as each track completes so the UI can refresh.
 */
export async function extractMetadata(tracks, onProgress, concurrency = 4) {
  const queue = [...tracks];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const track = queue.shift();
      await Promise.all([readTags(track), readDuration(track)]);
      track.tagsLoaded = true;
      onProgress?.(track);
    }
  });
  await Promise.all(workers);
}
