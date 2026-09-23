/* ==========================================================================
   utils.js — time formatting, relative dates, debounce, misc helpers
   ========================================================================== */

/** Format seconds as mm:ss (or h:mm:ss for long tracks). */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "--:--";
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Render a timestamp as relative time ("2 days ago") or a short date. */
export function relativeTime(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;

  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)} min ago`;
  if (diff < day) {
    const h = Math.floor(diff / hour);
    return `${h} hour${h > 1 ? "s" : ""} ago`;
  }
  if (diff < 30 * day) {
    const d = Math.floor(diff / day);
    return `${d} day${d > 1 ? "s" : ""} ago`;
  }
  // Older than a month → short date
  return new Date(ts).toLocaleDateString(undefined, {
    year: "2-digit",
    month: "short",
    day: "numeric",
  });
}

/** Classic trailing debounce. */
export function debounce(fn, wait = 200) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** Clamp a number to [min, max]. */
export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/** Strip the extension from a filename. */
export function stripExt(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Cheap unique id generator. */
let _uid = 0;
export function uid() {
  return `t${++_uid}_${Date.now().toString(36)}`;
}

/** Escape a string for safe innerHTML injection. */
export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
