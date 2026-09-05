/**
 * ENEX (Evernote XML export) parser. Uses the browser DOMParser (also provided
 * by jsdom in tests). No Obsidian imports.
 */

import { md5Hex } from "./md5";
import { enexTimeToIso } from "./util";
import type { EnexNote, EnexResource, ParsedEnex } from "./types";

export class EnexParseError extends Error {}

/** Decode a base64 string to bytes (atob is available in renderer + node ≥16). */
export function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function firstText(el: Element | null | undefined): string | null {
  if (!el) return null;
  const t = el.textContent ?? "";
  return t.length > 0 ? t : null;
}

/** Parse the <content> CDATA and return the <en-note> inner HTML, or "". */
function extractEnmlHtml(contentRaw: string): string {
  const html = contentRaw.replace(/^<\?xml[^>]*\?>/, "").replace(/^<!DOCTYPE[^>]*>/i, "");
  if (!/<en-note[\s>]/i.test(html)) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const enNote = doc.querySelector("en-note");
  return enNote ? enNote.innerHTML.trim() : "";
}

/**
 * Parse the full text of an .enex file. Throws EnexParseError when the file
 * does not look like an ENEX export.
 */
export function parseEnexText(text: string, stem: string, sourcePath = ""): ParsedEnex {
  const stripped = text.replace(/^\uFEFF/, "").trim();
  if (!stripped) throw new EnexParseError("The file is empty.");

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(stripped, "text/xml");
  } catch (e) {
    throw new EnexParseError(`Could not parse XML: ${(e as Error).message}`);
  }

  const root = doc.documentElement;
  if (!root || !/en-export/i.test(root.tagName)) {
    const snippet = stripped.slice(0, 200).replace(/\s+/g, " ");
    throw new EnexParseError(`Not an ENEX export (expected <en-export> root). Got: ${snippet}`);
  }
  // Chrome/Firefox surface XML errors as a <parsererror> element.
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new EnexParseError(`XML error: ${parserError.textContent ?? "malformed file"}`);

  const notes: EnexNote[] = [];
  const noteEls = Array.from(doc.getElementsByTagName("note"));
  noteEls.forEach((noteEl, index) => {
    const resources: EnexResource[] = [];
    const resourceEls = Array.from(noteEl.getElementsByTagName("resource"));
    for (const resEl of resourceEls) {
      const dataEl = resEl.querySelector("data");
      if (!dataEl || !dataEl.textContent) continue;
      const b64 = dataEl.textContent;
      const bytes = b64ToBytes(b64);
      const mime = (resEl.querySelector("mime")?.textContent ?? "application/octet-stream").trim();
      const attrs = resEl.querySelector("resource-attributes");
      const fileName = firstText(attrs?.querySelector("file-name")) ?? firstText(attrs?.querySelector("source-url"));
      const widthRaw = resEl.querySelector("width")?.textContent;
      const heightRaw = resEl.querySelector("height")?.textContent;
      resources.push({
        hash: md5Hex(bytes),
        mime,
        fileName,
        width: widthRaw ? parseInt(widthRaw, 10) || null : null,
        height: heightRaw ? parseInt(heightRaw, 10) || null : null,
        attachment: !!attrs?.querySelector("attachment"),
        dataB64: b64,
      });
    }

    const tags: string[] = [];
    for (const t of Array.from(noteEl.getElementsByTagName("tag"))) {
      const v = (t.textContent ?? "").trim();
      if (v) tags.push(v);
    }

    const noteAttrs = noteEl.querySelector("note-attributes");
    const contentRaw = firstText(noteEl.querySelector("content")) ?? "";

    notes.push({
      index,
      guid: firstText(noteEl.querySelector("guid")),
      title: (noteEl.querySelector("title")?.textContent ?? "").trim() || "Untitled",
      contentRaw,
      enmlHtml: extractEnmlHtml(contentRaw),
      createdIso: enexTimeToIso(firstText(noteEl.querySelector("created"))),
      updatedIso: enexTimeToIso(firstText(noteEl.querySelector("updated"))),
      tags,
      author: firstText(noteAttrs?.querySelector("author")),
      source: firstText(noteAttrs?.querySelector("source")),
      sourceUrl: firstText(noteAttrs?.querySelector("source-url")),
      resources,
    });
  });

  if (notes.length === 0) {
    throw new EnexParseError("No <note> elements found inside this ENEX export.");
  }

  return {
    application: root.getAttribute("application"),
    exportDateIso: enexTimeToIso(root.getAttribute("export-date")),
    stem,
    sourcePath,
    notes,
  };
}
