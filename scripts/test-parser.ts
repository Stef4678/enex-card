/**
 * Node smoke test for the pure core (no Obsidian): md5 vectors, ENEX parsing,
 * ENML→Markdown conversion and canvas layout. Run: `npm test`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { DOMParser: unknown }).DOMParser = dom.window.DOMParser;
(globalThis as unknown as { Node: unknown }).Node = dom.window.Node;

import { md5Hex } from "../src/core/md5";
import { parseEnexText, b64ToBytes } from "../src/core/enex";
import { enmlHtmlToMarkdown } from "../src/core/html";
import { buildCanvas, estimateCardHeight, pdfHeightFor, pdfWidthFor } from "../src/core/layout";
import type { BoardSpec } from "../src/core/types";
import { enexTimeToIso, toSafeSegment } from "../src/core/util";

let failures = 0;
function check(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}`);
  }
}

const enc = new TextEncoder();

// ---- md5 vectors ------------------------------------------------------------
console.log("md5:");
check(md5Hex(new Uint8Array()) === "d41d8cd98f00b204e9800998ecf8427e", "empty string");
check(md5Hex(enc.encode("abc")) === "900150983cd24fb0d6963f7d28e17f72", "'abc'");
check(
  md5Hex(enc.encode("The quick brown fox jumps over the lazy dog")) ===
    "9e107d9d372bb6826bd81d3542a419d6",
  "fox sentence",
);
for (const [n, s] of [
  ["hello", "hello"],
  ["sample A", "sample text for md5 123"],
  ["sample B", "another sample 4567890"],
] as Array<[string, string]>) {
  const bytes = enc.encode(s);
  check(
    md5Hex(bytes) === createHash("md5").update(bytes).digest("hex"),
    `${n} matches node crypto`,
  );
}

// ---- parse the sample ENEX ---------------------------------------------------
console.log("ENEX parsing:");
const samplePath = path.join(process.cwd(), "samples", "sample-notes.enex");
const xml = readFileSync(samplePath, "utf8");
const parsed = parseEnexText(xml, "sample-notes", "samples/sample-notes.enex");
check(parsed.notes.length === 3, `parsed ${parsed.notes.length} notes (expected 3)`);
check(parsed.application === "Evernote", "application=Evernote");
check(parsed.exportDateIso === "2024-01-15T10:30:00Z", "export date converted");

const n1 = parsed.notes[0];
check(n1.title === "Project kickoff notes", "note 1 title");
check(JSON.stringify(n1.tags) === JSON.stringify(["Work", "Inbox"]), "note 1 tags");
check(n1.createdIso === "2024-01-02T11:55:38Z", "note 1 created");
check(n1.resources.length === 1, "note 1 has 1 resource");
check(n1.resources[0].hash === "2cd8bde463f5d82aae0f0cec061d6b8f", "resource md5 matches image A");
check(n1.resources[0].fileName === "diagram.png", "resource file name kept");
check(parsed.notes[1].resources[0].hash === "ddd7757a419bf84c54dc3ff1f2b86f3b", "note2 resource md5 B");
check(parsed.notes[2].resources.length === 0, "note 3 has no resources");

// ---- conversion --------------------------------------------------------------
console.log("ENML → Markdown:");
const c1 = enmlHtmlToMarkdown(n1.enmlHtml);
console.log("----- note 1 markdown -----");
console.log(c1.markdown);
check(c1.media.length === 1, "note 1 collected 1 media");
check(c1.markdown.includes(c1.media[0].token), "media token present in note 1");
check(c1.markdown.includes("**bold**") && c1.markdown.includes("*italic*"), "bold/italic");
check(c1.markdown.includes("[docs](https://example.com/docs)"), "link");
check(c1.markdown.includes("- First item"), "bullet list");
check(c1.markdown.includes("1. Step one"), "ordered list");
check(c1.markdown.includes("Quote me"), "blockquote text");
check(c1.markdown.includes("| Name | Value |") && c1.markdown.includes("| --- | --- |"), "table + separator");
check(c1.markdown.includes("- [ ] Write the plan"), "unchecked task");
check(c1.markdown.includes("- [x] Send invite"), "checked task");
check(c1.markdown.includes("A&B"), "entity decoded (&amp;)");
check(!c1.markdown.includes("<b>"), "raw tags removed");

const c2 = enmlHtmlToMarkdown(parsed.notes[1].enmlHtml);
check(c2.markdown.includes("[encrypted]"), "en-crypt placeholder");
console.log("----- note 2 markdown -----");
console.log(c2.markdown);

const c3 = enmlHtmlToMarkdown(parsed.notes[2].enmlHtml);
console.log("----- note 3 markdown -----");
console.log(c3.markdown);
check(c3.markdown.includes("<angle>"), "entity decoded (&lt;angle&gt;)");

// ---- canvas layout ------------------------------------------------------------
console.log("Canvas layout:");
const boards: BoardSpec[] = [
  {
    notebook: "sample-notes",
    color: "4",
    cards: [
      { file: "Evernote Visuals/sample-notes/Project kickoff notes.md", title: "Project kickoff notes", textLen: c1.markdown.length, imageCount: 1, color: "1" },
      { file: "Evernote Visuals/sample-notes/Research — colour picker.md", title: "Research — colour picker", textLen: c2.markdown.length, imageCount: 1, color: "2" },
      { file: "Evernote Visuals/sample-notes/Quick note.md", title: "Quick note", textLen: c3.markdown.length, imageCount: 0, color: "3" },
    ],
  },
  {
    notebook: "second-book",
    cards: [
      {
        file: "Evernote Visuals/second-book/Solo.md",
        title: "Solo",
        textLen: 40,
        imageCount: 0,
        color: "4",
        pdfFiles: ["Evernote Visuals/second-book/attachments/report-a1b2c3d4.pdf"],
      },
    ],
  },
];
const layoutOpts = {
  cardWidth: 330,
  heightMode: "auto",
  fixedHeight: 400,
  minHeight: 150,
  maxHeight: 1600,
  arrows: true,
  pdfScale: 1.6,
  pdfHeight: 480,
} as const;
const { nodes, edges } = buildCanvas(boards, layoutOpts);
const ids = nodes.map((n) => n.id);
check(new Set(ids).size === ids.length, "all node ids unique");
check(nodes.filter((n) => n.type === "group").length === 2, "two group nodes");
check(
  nodes.filter((n) => n.type === "file").length === 5,
  "five file nodes (4 notes + 1 PDF preview)",
);
check(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.width > 0 && n.height > 0), "positions/sizes finite");
check(nodes.every((n) => n.x >= 0 && n.y >= 0), "no negative coordinates");
check(edges.length >= 1, "arrows added for horizontal neighbours");

// The PDF node hangs below its note card by ~cardHeight + GAP_PDF.
const soloCard = nodes.find((n) => n.file?.endsWith("Solo.md"));
const pdfNode = nodes.find((n) => n.file?.endsWith("report-a1b2c3d4.pdf"));
check(!!soloCard && !!pdfNode, "card + pdf node located");
if (soloCard && pdfNode) {
  const est = estimateCardHeight(
    boards[1].cards[0],
    layoutOpts,
  );
  const diff = (pdfNode.y ?? 0) - (soloCard.y ?? 0) - est;
  check(Math.abs(diff - 36) <= 6, `pdf sits below card (diff ${Math.round(diff)})`);
}

// PDF nodes are wider than the card (scale factor) with an A4-ish height.
const bigBoard: BoardSpec = {
  notebook: "big",
  cards: [
    {
      file: "Evernote Visuals/big/Long note.md",
      title: "Long note with an attached PDF",
      textLen: 9000,
      imageCount: 0,
      pdfFiles: ["Evernote Visuals/big/attachments/big-doc-aabbccdd.pdf"],
    },
  ],
};
const big = buildCanvas([bigBoard], layoutOpts);
const bigCard = big.nodes.find((n) => n.file?.endsWith("Long note.md"));
const bigPdf = big.nodes.find((n) => n.file?.endsWith("big-doc-aabbccdd.pdf"));
if (bigCard && bigPdf) {
  const expW = pdfWidthFor(layoutOpts.cardWidth, layoutOpts);
  const expH = pdfHeightFor(expW, layoutOpts);
  check(bigPdf.width === expW, `pdf width == scale×card (${expW})`);
  check(bigPdf.height === expH, `pdf height == width×√2 floor (${expH})`);
  check(bigPdf.width > bigCard.width, "pdf wider than its note card");
  check(bigPdf.height >= layoutOpts.pdfHeight, "pdf height ≥ configured minimum");
  check(bigPdf.x === bigCard.x, "pdf shares the card column");
} else {
  check(false, "big card + pdf nodes located");
}
JSON.parse(JSON.stringify({ nodes, edges }));
check(true, "canvas JSON round-trips");
console.log(`  nodes=${nodes.length} edges=${edges.length} spans=[0,0 → ${Math.max(...nodes.map((n) => n.x + n.width))},${Math.max(...nodes.map((n) => n.y + n.height))}]`);

// ---- misc helpers ---------------------------------------------------------------
console.log("helpers:");
check(enexTimeToIso("20240102T115538Z") === "2024-01-02T11:55:38Z", "enex time UTC");
check(enexTimeToIso("20240102T115538+0200") === "2024-01-02T11:55:38+02:00", "enex time offset");
check(enexTimeToIso("nope") === null, "bad time → null");
check(b64ToBytes("SGVsbG8=").length === 5, "base64 decode");
check(toSafeSegment('a/b\\c:d*?"<>|', "x") === "a-b-c-d------", "path chars sanitized");
check(toSafeSegment("  ", "fallback") === "fallback", "empty fallback");

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll checks passed.");
