/**
 * ENML (the HTML-ish body of an Evernote note) → Obsidian Markdown.
 * Pure module: uses DOMParser only at call time, so it is testable in Node
 * (jsdom) and runs in the Obsidian renderer.
 *
 * Design notes
 *  - Media elements (<en-media> / <img>) are replaced by private-use tokens
 *    (\uE000n\uE001) and reported in `media`, so the caller can substitute the
 *    real path of the attachment it extracts (the token cannot collide with
 *    note text in practice).
 *  - Evernote lays content out as stacked <div> lines; paragraph lines are
 *    emitted with Markdown hard breaks ("  ") so stacked divs stay on
 *    separate visual lines inside a narrow canvas card.
 */

import type { HtmlToMarkdownResult, MediaOccurrence } from "./types";

const TOKEN_START = "\uE000";
const TOKEN_END = "\uE001";

const HEADING_LEVELS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "aside", "center", "address",
  "figure", "figcaption", "form", "fieldset", "header", "footer", "details",
]);

const LIST_CONTAINERS = new Set(["ul", "ol"]);

const PLAIN_INLINE_TAGS = new Set([
  "u", "ins", "sup", "sub", "small", "span", "font", "abbr", "mark", "label",
  "time", "tt", "kbd", "cite", "q", "pre", "nobr", "wbr", "var", "samp",
]);

function tagOf(el: Element): string {
  return el.tagName.toLowerCase();
}

function isBlockTag(t: string): boolean {
  return BLOCK_TAGS.has(t) || t in HEADING_LEVELS;
}

function normalizeInlineText(s: string): string {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/[ \t\r\n]+/g, " ");
}

/** Escape a Markdown block-starting character at the beginning of a line. */
function escapeLineStart(line: string): string {
  return line.replace(/^([#>*+\-=`~])/, "\\$1");
}

/** Turn a line that starts like an Evernote task ("[ ] x") into a task item. */
function taskify(line: string): string {
  return line.replace(/^\[([ xX])\]\s+/, (_m, m: string) => `- [${m.toLowerCase()}] `);
}

function isStructuralLine(line: string): boolean {
  return /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|\[[ xX]\]|\||```|````|---|~~~)/.test(line);
}

export function enmlHtmlToMarkdown(enmlHtml: string): HtmlToMarkdownResult {
  const media: MediaOccurrence[] = [];
  let mediaIndex = 0;

  function mediaToken(el: Element): string {
    const token = `${TOKEN_START}${mediaIndex}${TOKEN_END}`;
    media.push({
      token,
      hash: el.getAttribute("hash"),
      mime: el.getAttribute("type") || el.getAttribute("mime"),
      alt: el.getAttribute("alt") || el.getAttribute("title"),
      fileName: el.getAttribute("filename"),
    });
    mediaIndex++;
    return token;
  }

  const styleIs = (el: Element, prop: string, values: string[]): boolean => {
    const style = el.getAttribute("style") || "";
    const m = new RegExp(`${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
    return !!m && values.some((v) => m[1].trim().toLowerCase().includes(v));
  };

  /** "[x] " / "[ ] " for <en-todo>/<input type=checkbox> elements. */
  function checkboxToken(el: Element): string {
    const raw = el.getAttribute("checked");
    const checked = raw === "" || (raw !== null && /^(true|checked|1)$/i.test(raw));
    return checked ? "[x] " : "[ ] ";
  }

  /** Inline Markdown for one element (wrappers applied here). */
  function elementInline(el: Element): string {
    const t = tagOf(el);
    const content = (): string => childrenInline(el);
    switch (t) {
      case "br":
        return " ";
      case "b": case "strong":
        return `**${content()}**`;
      case "i": case "em":
        return `*${content()}*`;
      case "s": case "strike": case "del":
        return `~~${content()}~~`;
      case "code":
        return "`" + (el.textContent ?? "") + "`";
      case "a": {
        const href = el.getAttribute("href");
        const label = childrenInline(el).trim();
        if (!label) return "";
        if (href && /^(https?:|mailto:)/i.test(href)) return `[${label}](${href})`;
        return label;
      }
      case "en-media": case "img":
        return " " + mediaToken(el) + " ";
      case "en-todo": {
        // Some pipelines re-serialise the note and turn the void self-closing
        // <en-todo/> into a paired element that carries the task text.
        const inner = childrenInline(el).trimStart();
        return inner ? checkboxToken(el) + inner : checkboxToken(el);
      }
      case "input":
        return checkboxToken(el);
      case "en-crypt":
        return "[encrypted] ";
      default:
        if (PLAIN_INLINE_TAGS.has(t)) return content();
        // Legacy formatting via inline styles.
        if (styleIs(el, "font-weight", ["bold", "bolder", "700", "800"])) {
          return `**${content()}**`;
        }
        if (styleIs(el, "font-style", ["italic"])) {
          return `*${content()}*`;
        }
        if (styleIs(el, "text-decoration", ["underline"])) {
          return content();
        }
        return content();
    }
  }

  /** Concatenate the inline Markdown of every child of `parent`. */
  function childrenInline(parent: Node): string {
    let out = "";
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += normalizeInlineText(child.textContent ?? "");
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        out += elementInline(child as Element);
      }
    }
    return out;
  }

  function linesOfChildren(parent: Element, quoteDepth: number): string[] {
    const lines: string[] = [];
    let buf = "";
    const flush = () => {
      let t = buf.trim();
      buf = "";
      if (!t) return;
      t = escapeLineStart(t);
      t = taskify(t);
      if (quoteDepth > 0) t = "> ".repeat(quoteDepth) + t;
      lines.push(t);
    };
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        buf += normalizeInlineText(child.textContent ?? "");
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const t = tagOf(el);
      if (t === "br") {
        buf += " ";
        continue;
      }
      if (t in HEADING_LEVELS) {
        flush();
        lines.push(`${"#".repeat(HEADING_LEVELS[t])} ${childrenInline(el).trim()}`);
        continue;
      }
      if (isBlockTag(t) || LIST_CONTAINERS.has(t) || t === "blockquote" ||
          t === "table" || t === "pre" || t === "hr" || t === "en-note" ||
          t === "en-media" || t === "img") {
        flush();
        lines.push(...blockLines(el, quoteDepth));
        continue;
      }
      // Generic inline element.
      buf += elementInline(el);
    }
    flush();
    return lines;
  }

  function listLines(el: Element, depth: number, quoteDepth: number): string[] {
    const ordered = tagOf(el) === "ol";
    const out: string[] = [];
    const indent = "  ".repeat(depth);
    let counter = 0;
    for (const li of Array.from(el.children)) {
      if (tagOf(li) !== "li") continue;
      counter++;
      const marker = ordered ? `${counter}.` : "-";
      const bodyLines: string[] = [];
      let buf = "";
      const flush = () => {
        const t = buf.trim();
        buf = "";
        if (t) bodyLines.push(taskify(escapeLineStart(t)));
      };
      for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          buf += normalizeInlineText(child.textContent ?? "");
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const el2 = child as Element;
          const t2 = tagOf(el2);
          if (LIST_CONTAINERS.has(t2)) {
            flush();
            bodyLines.push(...listLines(el2, depth + 1, quoteDepth));
          } else if (t2 === "br") {
            buf += " ";
          } else if (isBlockTag(t2) || t2 === "en-media" || t2 === "img") {
            flush();
            bodyLines.push(...blockLines(el2, quoteDepth));
          } else {
            buf += elementInline(el2);
          }
        }
      }
      flush();
      const all = bodyLines.length > 0 ? bodyLines : [""];
      const q = quoteDepth > 0 ? "> ".repeat(quoteDepth) : "";
      all.forEach((ln, i) => {
        out.push(i === 0 ? `${q}${indent}${marker} ${ln}` : `${q}${indent}  ${ln}`);
      });
    }
    return out;
  }

  function codeLines(el: Element): string[] {
    const text = (el.textContent ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    const fence = text.includes("```") ? "````" : "```";
    return [fence, text, fence];
  }

  function tableLines(el: Element): string[] {
    const out: string[] = [];
    const rows = Array.from(el.querySelectorAll("tr"));
    rows.forEach((tr, ri) => {
      const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
      if (cells.length === 0) return;
      const cellTexts = cells.map((c) => childrenInline(c).trim().replace(/\|/g, "\\|"));
      out.push(`| ${cellTexts.join(" | ")} |`);
      if (ri === 0) out.push(`| ${cells.map(() => "---").join(" | ")} |`);
    });
    return out;
  }

  function blockLines(el: Element, quoteDepth = 0): string[] {
    const t = tagOf(el);
    if (t === "hr") return ["---"];
    if (t === "br") return [""];
    if (t === "en-media" || t === "img") {
      const md = mediaToken(el);
      return [quoteDepth > 0 ? `> ${md}` : md];
    }
    if (t === "blockquote") {
      const inner = linesOfChildren(el, quoteDepth + 1);
      return inner.map((ln) => (ln && !ln.startsWith(">") ? `> ${ln}` : ln));
    }
    if (t === "ul" || t === "ol") return listLines(el, 0, quoteDepth);
    if (t === "pre") return codeLines(el);
    if (t === "table") return tableLines(el);
    // Generic container (p, div, heading handled by caller, …).
    const raw = linesOfChildren(el, quoteDepth);
    return raw.length === 0 ? [""] : raw;
  }

  const htmlTextRaw = (enmlHtml || "").trim();
  if (!htmlTextRaw) return { markdown: "", media };

  // Evernote emits tasks as self-closing <en-todo …/>. The HTML parser does not
  // honour self-closing syntax for unknown elements, which would swallow the
  // following text into the <en-todo>. Rewrite those tags as void <input>s so
  // the text after the checkbox stays a sibling.
  const htmlText = htmlTextRaw.replace(/<en-todo\b([^>]*?)\/>/gi, (_all, attrs: string) => {
    const checked = /checked\s*=\s*(["']?)(true|checked|1)\1/i.test(attrs);
    return `<input type="checkbox" checked="${checked ? "true" : "false"}">`;
  });

  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const enNote = doc.querySelector("en-note");
  const body = (enNote ?? doc.body) as Element;

  const rawLines = linesOfChildren(body, 0);

  // ---- assemble final markdown --------------------------------------------
  const cleaned: string[] = [];
  for (const line of rawLines) {
    const l = line.replace(/\s+$/g, "");
    if (!l) {
      if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== "") cleaned.push("");
      continue;
    }
    cleaned.push(l);
  }
  while (cleaned.length > 0 && cleaned[0] === "") cleaned.shift();
  while (cleaned.length > 0 && cleaned[cleaned.length - 1] === "") cleaned.pop();

  // Markdown folds single newlines, so keep stacked Evernote <div> lines on
  // separate visual lines with hard breaks, and blank-separate paragraph text
  // from structural blocks (lists, tables, quotes, fences…).
  const out: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const line = cleaned[i];
    const next = i + 1 < cleaned.length ? cleaned[i + 1] : null;
    const lineStructural = isStructuralLine(line);
    const nextStructural = next !== null && isStructuralLine(next);
    let outLine = line;
    if (next !== null && next !== "" && line !== "" && !lineStructural && !nextStructural) {
      outLine += "  "; // hard break between two paragraph-ish lines
    }
    out.push(outLine);
    if (next !== null && next !== "" && line !== "" && lineStructural !== nextStructural) {
      out.push("");
    }
  }

  const markdown = out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return { markdown, media };
}
