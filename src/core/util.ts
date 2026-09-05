/**
 * Small shared helpers. Pure — no Obsidian / DOM dependency.
 */

/** Deterministic 32-bit hash of a string (FNV-1a). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random in [0, 1) derived from a string seed. */
export function hashUnit(seed: string): number {
  return fnv1a(seed) / 4294967296;
}

/**
 * Convert a string to a safe vault path segment.
 * Keeps unicode letters/digits/spaces, collapses runs of unsafe chars to "-",
 * trims dots/spaces, caps length and falls back to `fallback`.
 */
export function toSafeSegment(input: string, fallback: string, maxLen = 80): string {
  let s = (input ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[<>:"/\\|?*\u202a-\u202e]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[.\s]+$/g, "")
    .trim();
  s = s.replace(/\s+/g, "-");
  if (s.length === 0 || s === "." || s === "..") return fallback;
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[.\s-]+$/g, "");
  return s.length > 0 ? s : fallback;
}

/** Slug used for generated markdown file names. */
export function slugify(title: string, fallback: string): string {
  return toSafeSegment(title, fallback, 90);
}

/**
 * ENEX timestamps look like `20240102T115538Z` (or with a numeric offset,
 * e.g. `20240102T115538+0800`). Convert to an ISO string, or return null.
 */
export function enexTimeToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, tz] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (!tz || tz === "Z") return iso + "Z";
  return iso + tz.slice(0, 3) + ":" + tz.slice(3);
}

/** Human-friendly date for display in card footers (ISO → `YYYY-MM-DD`). */
export function isoToDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Normalise whitespace runs (but keep single spaces) for inline contexts. */
export function collapseWs(s: string): string {
  return s.replace(/[ \t\r\n]+/g, " ");
}

/** Map a MIME type to a file extension (no leading dot), with fallback. */
export function extForMime(mime: string, fallback = "bin"): string {
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/tiff": "tif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
    "text/html": "html",
    "text/csv": "csv",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };
  return known[(mime || "").toLowerCase()] ?? fallback;
}

export const IMAGE_MIME_PREFIX = "image/";

export function isImageMime(mime: string | null | undefined): boolean {
  return !!mime && mime.toLowerCase().startsWith(IMAGE_MIME_PREFIX);
}
