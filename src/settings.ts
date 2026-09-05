/** Plugin settings (persisted to data.json by Obsidian). */

export type HeightMode = "auto" | "fixed";
export type ColorMode = "none" | "cycle" | "tag";

export interface EnexCardSettings {
  /** Vault folder that receives one sub-folder per ENEX notebook. */
  outputFolder: string;
  /** Where to save generated .canvas files; empty = same as outputFolder. */
  canvasFolder: string;
  /** Attachment sub-folder name inside each notebook folder. */
  attachmentsFolderName: string;

  /** Canvas card geometry. */
  cardWidth: number;
  heightMode: HeightMode;
  fixedHeight: number;
  minHeight: number;
  maxHeight: number;

  /** Card coloring: none | cycle through the palette | by first Evernote tag. */
  colorMode: ColorMode;
  /** Draw reading-order arrows between horizontally adjacent cards. */
  arrows: boolean;

  /** Prepend "# Title" as first line of each generated markdown note. */
  prependTitleHeading: boolean;
  /** Add a small italic footer with date + tags. */
  metaFooter: boolean;
  /** Link non-image attachments (pdf, audio, …) inside the card. */
  includeNonImageAttachments: boolean;
  /** False = only save resources the note actually references. */
  extractAllResources: boolean;

  /** Place PDF preview nodes under their note card on the canvas. */
  previewPdfsOnCanvas: boolean;
  /** PDF node width as a multiple of the note card width. */
  pdfScale: number;
  /** Minimum height of a PDF node (canvas units). */
  pdfHeight: number;

  openAfterCreate: boolean;
  confirmBeforeRun: boolean;
}

export const DEFAULT_SETTINGS: EnexCardSettings = {
  outputFolder: "Evernote Visuals",
  canvasFolder: "",
  attachmentsFolderName: "attachments",
  cardWidth: 330,
  heightMode: "auto",
  fixedHeight: 420,
  minHeight: 170,
  maxHeight: 1600,
  colorMode: "cycle",
  arrows: false,
  prependTitleHeading: true,
  metaFooter: true,
  includeNonImageAttachments: true,
  extractAllResources: false,
  previewPdfsOnCanvas: true,
  pdfScale: 1.6,
  pdfHeight: 480,
  openAfterCreate: true,
  confirmBeforeRun: true,
};

export function normalizeSettings(s: Partial<EnexCardSettings> | null | undefined): EnexCardSettings {
  const d = DEFAULT_SETTINGS;
  const v = s ?? {};
  const num = (x: unknown, fallback: number): number =>
    typeof x === "number" && isFinite(x) ? x : fallback;
  const str = (x: unknown, fallback: string): string =>
    typeof x === "string" ? x : fallback;
  const bool = (x: unknown, fallback: boolean): boolean =>
    typeof x === "boolean" ? x : fallback;
  return {
    outputFolder: str(v.outputFolder, d.outputFolder).trim(),
    canvasFolder: str(v.canvasFolder, d.canvasFolder).trim(),
    attachmentsFolderName: str(v.attachmentsFolderName, d.attachmentsFolderName).trim() || "attachments",
    cardWidth: num(v.cardWidth, d.cardWidth),
    heightMode: v.heightMode === "fixed" ? "fixed" : "auto",
    fixedHeight: num(v.fixedHeight, d.fixedHeight),
    minHeight: num(v.minHeight, d.minHeight),
    maxHeight: num(v.maxHeight, d.maxHeight),
    colorMode: v.colorMode === "none" || v.colorMode === "tag" ? v.colorMode : "cycle",
    arrows: bool(v.arrows, d.arrows),
    prependTitleHeading: bool(v.prependTitleHeading, d.prependTitleHeading),
    metaFooter: bool(v.metaFooter, d.metaFooter),
    includeNonImageAttachments: bool(v.includeNonImageAttachments, d.includeNonImageAttachments),
    extractAllResources: bool(v.extractAllResources, d.extractAllResources),
    previewPdfsOnCanvas: bool(v.previewPdfsOnCanvas, d.previewPdfsOnCanvas),
    pdfScale: num(v.pdfScale, d.pdfScale),
    pdfHeight: num(v.pdfHeight, d.pdfHeight),
    openAfterCreate: bool(v.openAfterCreate, d.openAfterCreate),
    confirmBeforeRun: bool(v.confirmBeforeRun, d.confirmBeforeRun),
  };
}
