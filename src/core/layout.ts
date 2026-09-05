/**
 * Canvas JSON layout builder (pure — no Obsidian / DOM).
 * Produces the object Obsidian persists for `.canvas` files:
 * one `file` node per note card, wrapped in a `group` node per notebook,
 * optional reading-order arrows between horizontally adjacent cards.
 */

import type { BoardSpec, CardSpec } from "./types";
import { clamp, hashUnit } from "./util";

export interface CanvasNodeJson {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  file?: string;
  text?: string;
  label?: string;
}

export interface CanvasEdgeJson {
  id: string;
  fromNode: string;
  fromSide: string;
  toNode: string;
  toSide: string;
  toEnd: string;
}

export interface CanvasJson {
  nodes: CanvasNodeJson[];
  edges: CanvasEdgeJson[];
}

export interface CardLayoutOptions {
  cardWidth: number;
  heightMode: "auto" | "fixed";
  fixedHeight: number;
  minHeight: number;
  maxHeight: number;
  arrows: boolean;
  /** Scale factor of PDF preview nodes relative to the note card width (≥1). */
  pdfScale: number;
  /** Absolute minimum height of a PDF node (canvas units). */
  pdfHeight: number;
}

/** Distance between neighbouring cards. */
const GAP_X = 90;
const GAP_Y = 60;
/** Distance between a note card and the PDF nodes hanging below it. */
const GAP_PDF = 36;
/** Padding inside a group around its cards (top = label headroom). */
const PAD_LEFT = 140;
const PAD_RIGHT = 60;
const PAD_TOP = 130;
const PAD_BOTTOM = 70;
const BOARD_GAP = 240;

/** Estimate how tall a file node should be so its markdown mostly fits. */
export function estimateCardHeight(card: CardSpec, opts: CardLayoutOptions): number {
  if (opts.heightMode === "fixed") return opts.fixedHeight;
  const usableWidth = Math.max(120, opts.cardWidth - 56);
  const charsPerLine = usableWidth / 7.1;
  let lines = Math.max(1, Math.ceil(Math.max(0, card.textLen) / charsPerLine));
  // The title H1 is a big line of its own.
  lines += Math.max(0, Math.ceil(card.title.length / charsPerLine) - 1);
  const height = 46 + lines * 21 + card.imageCount * 190;
  return clamp(Math.round(height), opts.minHeight, opts.maxHeight);
}

/**
 * Width of each PDF preview node relative to the note card width.
 * Returns 0 when PDF previews are disabled.
 */
export function pdfWidthFor(cardWidth: number, opts: CardLayoutOptions): number {
  if (opts.pdfScale <= 0) return 0;
  return Math.max(0, Math.round(cardWidth * opts.pdfScale));
}

/**
 * Effective height of one PDF node: wide enough to show a full A4-ish page at
 * the chosen width (width × √2), never below the configured minimum.
 */
export function pdfHeightFor(pdfWidth: number, opts: CardLayoutOptions): number {
  if (pdfWidth <= 0) return 0;
  return Math.max(opts.pdfHeight, Math.round(pdfWidth * Math.SQRT2));
}

/**
 * Total vertical space a card occupies in the grid: its own node plus the
 * stack of PDF previews hanging underneath (when enabled).
 */
export function cardBlockHeight(card: CardSpec, opts: CardLayoutOptions): number {
  const cardH = estimateCardHeight(card, opts);
  const pdfs = opts.pdfScale > 0 ? card.pdfFiles?.length ?? 0 : 0;
  if (pdfs === 0) return cardH;
  const pdfH = pdfHeightFor(pdfWidthFor(opts.cardWidth, opts), opts);
  return cardH + GAP_PDF + pdfs * (pdfH + GAP_PDF);
}

function fileNode(
  id: string,
  card: CardSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  color?: string,
): CanvasNodeJson {
  const node: CanvasNodeJson = { id, type: "file", x, y, width: w, height: h, file: card.file };
  if (card.color ?? color) node.color = card.color ?? color;
  return node;
}

function pdfNode(id: string, pdfPath: string, x: number, y: number, w: number, h: number, color?: string): CanvasNodeJson {
  const node: CanvasNodeJson = { id, type: "file", x, y, width: w, height: h, file: pdfPath };
  if (color) node.color = color;
  return node;
}

function groupNode(
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  color?: string,
): CanvasNodeJson {
  const node: CanvasNodeJson = {
    id,
    type: "group",
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
    label,
  };
  if (color) node.color = color;
  return node;
}

export interface BuildResult {
  nodes: CanvasNodeJson[];
  edges: CanvasEdgeJson[];
}

/**
 * Lay boards out one under the other. Cards inside a board are placed in a
 * row-major grid with a tiny deterministic "sticky note" jitter per card;
 * PDF previews hang below their note card in the same column.
 */
export function buildCanvas(boards: BoardSpec[], opts: CardLayoutOptions): BuildResult {
  const nodes: CanvasNodeJson[] = [];
  const edges: CanvasEdgeJson[] = [];

  let cursorY = 0;

  boards.forEach((board, boardIdx) => {
    const cards = board.cards;
    if (cards.length === 0) return;
    const n = cards.length;
    const W = opts.cardWidth;
    const cols = clamp(Math.ceil(Math.sqrt(n)), 1, 10);
    const rowCount = Math.ceil(n / cols);
    const cardHs = cards.map((c) => estimateCardHeight(c, opts));
    const blockHs = cards.map((c) => cardBlockHeight(c, opts));

    // PDF preview geometry for this board.
    const pdfEnabled = opts.pdfScale > 0;
    const pdfW = pdfEnabled ? pdfWidthFor(W, opts) : 0;
    const pdfH = pdfEnabled ? pdfHeightFor(pdfW, opts) : 0;
    // Columns must leave room for the (wider) PDF nodes hanging below cards.
    const colStep = pdfW > 0 && pdfW + GAP_X > W + GAP_X ? pdfW + GAP_X : W + GAP_X;

    // Row-major grid positions.
    const xs: number[] = [];
    const ys: number[] = [];
    const rowMax: number[] = new Array<number>(rowCount).fill(0);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      xs.push(c * colStep);
      rowMax[r] = Math.max(rowMax[r], blockHs[i]);
    }
    let acc = 0;
    for (let r = 0; r < rowCount; r++) {
      for (let i = r * cols; i < Math.min(n, (r + 1) * cols); i++) ys.push(acc);
      acc += rowMax[r] + GAP_Y;
    }
    const gridH = rowCount > 0 ? acc - GAP_Y : 0;
    const gridW = cols * colStep - GAP_X;

    const gx = 0;
    const gy = cursorY;
    const cardBaseX = gx + PAD_LEFT;
    const cardBaseY = gy + PAD_TOP;

    cards.forEach((card, i) => {
      const r = Math.floor(i / cols);
      void r;
      const jx = (hashUnit(`${card.file}#x`) - 0.5) * GAP_X * 0.45;
      const jy = (hashUnit(`${card.file}#y`) - 0.5) * GAP_Y * 0.35;
      const x = Math.round(cardBaseX + xs[i] + jx);
      const y = Math.round(cardBaseY + ys[i] + jy);
      nodes.push(fileNode(`b${boardIdx}c${i}`, card, x, y, W, cardHs[i]));

      const pdfs = pdfEnabled ? card.pdfFiles ?? [] : [];
      pdfs.forEach((pdfPath, k) => {
        // PDF preview nodes are larger than the note card (scale factor), so
        // the page content inside is readable; they hang below the card.
        const py = y + cardHs[i] + GAP_PDF + k * (pdfH + GAP_PDF);
        nodes.push(
          pdfNode(`b${boardIdx}c${i}p${k}`, pdfPath, x, py, pdfW, pdfH, card.color),
        );
      });

      if (opts.arrows && i % cols !== cols - 1 && i + 1 < n) {
        edges.push({
          id: `b${boardIdx}e${i}`,
          fromNode: `b${boardIdx}c${i}`,
          fromSide: "right",
          toNode: `b${boardIdx}c${i + 1}`,
          toSide: "left",
          toEnd: "arrow",
        });
      }
    });

    const groupW = PAD_LEFT + gridW + PAD_RIGHT;
    const groupH = PAD_TOP + gridH + PAD_BOTTOM;
    nodes.push(groupNode(`b${boardIdx}g`, board.notebook, gx, gy, groupW, groupH, board.color));

    cursorY += groupH + BOARD_GAP;
  });

  return { nodes, edges };
}
