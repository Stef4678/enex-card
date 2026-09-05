/**
 * Shared data types for the pure core. No Obsidian or DOM imports so the core
 * can be unit-tested in plain Node (jsdom supplies DOMParser there).
 */

/** One binary attachment (image, pdf, …) stored inside an ENEX export. */
export interface EnexResource {
  /** MD5 hex of the decoded bytes — ENML references it via en-media[hash]. */
  hash: string;
  mime: string;
  /** Suggested file name, when the export provides one. */
  fileName: string | null;
  width: number | null;
  height: number | null;
  /** True when <resource-attributes><attachment/> is present. */
  attachment: boolean;
  dataB64: string;
}

export interface EnexNote {
  /** 0-based order inside the export (preserved for reading-order arrows). */
  index: number;
  guid: string | null;
  title: string;
  /** Raw text of the <content> CDATA block (the ENML XML). */
  contentRaw: string;
  /** Inner HTML of the <en-note> element, when present. */
  enmlHtml: string;
  createdIso: string | null;
  updatedIso: string | null;
  tags: string[];
  author: string | null;
  source: string | null;
  sourceUrl: string | null;
  resources: EnexResource[];
}

export interface ParsedEnex {
  application: string | null;
  exportDateIso: string | null;
  /** File stem used for folder / notebook naming. */
  stem: string;
  /** Full vault path of the source file (may be empty in tests). */
  sourcePath: string;
  notes: EnexNote[];
}

/** A media element (<en-media> or <img>) found while converting HTML. */
export interface MediaOccurrence {
  token: string;
  hash: string | null;
  mime: string | null;
  alt: string | null;
  /** Original file name hint (may be null). */
  fileName: string | null;
}

export interface HtmlToMarkdownResult {
  markdown: string;
  media: MediaOccurrence[];
}

/** One visual card to place on the canvas. */
export interface CardSpec {
  /** Vault-relative path of the generated markdown note. */
  file: string;
  title: string;
  /** Estimated plain-text length (used for auto sizing). */
  textLen: number;
  /** Number of inline images in the note. */
  imageCount: number;
  /** Canvas palette color name ("1".."6") or undefined. */
  color?: string;
  /** Metadata line shown under the title. */
  meta?: string;
  /** Vault-relative paths of PDF attachments to show as preview nodes. */
  pdfFiles?: string[];
}

export interface BoardSpec {
  /** Notebook / source file label for the group. */
  notebook: string;
  color?: string;
  cards: CardSpec[];
}

export type PaletteColor = string;

export const CANVAS_COLORS: PaletteColor[] = ["1", "2", "3", "4", "5", "6"];

export function paletteColorForSeed(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  }
  return CANVAS_COLORS[h % CANVAS_COLORS.length];
}
