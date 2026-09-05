/**
 * Vault engine: reads .enex files, materialises markdown notes + extracted
 * attachments, and writes .canvas boards. Depends on the Obsidian runtime.
 */

import { normalizePath, TFile, Vault } from "obsidian";
import type { EnexCardSettings } from "./settings";
import type {
  BoardSpec,
  CardSpec,
  EnexNote,
  EnexResource,
  MediaOccurrence,
  ParsedEnex,
} from "./core/types";
import { CANVAS_COLORS, paletteColorForSeed } from "./core/types";
import { parseEnexText } from "./core/enex";
import { enmlHtmlToMarkdown } from "./core/html";
import { buildCanvas, type CardLayoutOptions } from "./core/layout";
import {
  extForMime,
  isImageMime,
  isoToDate,
  slugify,
  toSafeSegment,
} from "./core/util";

export interface FileError {
  file: string;
  message: string;
}

export interface BoardBuildResult {
  canvasPath: string;
  /** Vault-relative path of every generated note. */
  notePaths: string[];
  notesCreated: number;
  notesUpdated: number;
  resourcesWritten: number;
  errors: FileError[];
}

export interface AddToBoardResult {
  canvasPath: string;
  /** Notebook groups that were appended to the board. */
  addedBoards: string[];
  /** Notebook groups already present (notes refreshed, nothing appended). */
  skippedBoards: string[];
  notePaths: string[];
  notesCreated: number;
  notesUpdated: number;
  resourcesWritten: number;
  errors: FileError[];
}

function cardIdFor(note: EnexNote, sourcePath: string): string {
  return `${sourcePath}::${note.guid ?? `n${note.index + 1}`}`;
}

function yamlStr(v: string): string {
  return JSON.stringify(v);
}

export class EnexCardEngine {
  notesCreated = 0;
  notesUpdated = 0;
  resourcesWritten = 0;

  constructor(
    private vault: Vault,
    private settings: EnexCardSettings,
  ) {}

  /** All .enex files in the vault (optionally inside one folder). */
  enexFilesIn(folderPath = ""): TFile[] {
    const prefix = folderPath ? normalizePath(folderPath) + "/" : "";
    return this.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === "enex" && f.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Folders (vault-relative, "" = root) that contain at least one .enex. */
  foldersWithEnex(): string[] {
    const set = new Set<string>();
    for (const f of this.enexFilesIn("")) {
      set.add(f.parent?.path ?? "");
    }
    return Array.from(set).sort((a, b) => {
      if (a === "") return -1;
      if (b === "") return 1;
      return a.localeCompare(b);
    });
  }

  private get s(): EnexCardSettings {
    return this.settings;
  }

  private async ensureFolder(path: string): Promise<void> {
    const clean = normalizePath(path).replace(/^\/+|\/+$/g, "");
    if (!clean || this.vault.getAbstractFileByPath(clean)) return;
    const segs = clean.split("/").filter(Boolean);
    let cur = "";
    for (const seg of segs) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!this.vault.getAbstractFileByPath(cur)) {
        await this.vault.createFolder(cur);
      }
    }
  }

  private async writeTextFile(path: string, content: string): Promise<void> {
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.vault.modify(existing, content);
    } else {
      await this.vault.create(path, content);
    }
  }

  private async writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
    const existing = this.vault.getAbstractFileByPath(path);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (existing instanceof TFile) {
      await this.vault.modifyBinary(existing, buffer);
    } else {
      await this.vault.createBinary(path, buffer);
    }
  }

  /**
   * Find a free path `folder/<wanted>.md`. If the file at the exact name is
   * ours (same card-id) we return it for overwriting; otherwise suffixes are
   * tried. Returns the path and whether it already exists (ours).
   */
  private async allocateNotePath(
    folder: string,
    wanted: string,
    cardId: string,
  ): Promise<{ path: string; exists: boolean }> {
    const tryName = async (name: string): Promise<{ path: string; exists: boolean } | null> => {
      const p = normalizePath(`${folder}/${name}.md`);
      const existing = this.vault.getAbstractFileByPath(p);
      if (!existing) return { path: p, exists: false };
      if (existing instanceof TFile) {
        const head = (await this.vault.cachedRead(existing)).slice(0, 900);
        if (head.includes(`card-id: ${yamlStr(cardId)}`)) return { path: p, exists: true };
      }
      return null;
    };
    const direct = await tryName(wanted);
    if (direct) return direct;
    for (let i = 2; i < 60; i++) {
      const alt = await tryName(`${wanted}-${i}`);
      if (alt) return alt;
    }
    throw new Error(`Could not allocate a markdown path for "${wanted}" in ${folder}`);
  }

  /** Write one note (md + used attachments). Returns a card descriptor. */
  private async materializeNote(
    parsed: ParsedEnex,
    note: EnexNote,
    noteFolder: string,
    color: string | undefined,
  ): Promise<CardSpec> {
    const attachmentsFolder = normalizePath(`${noteFolder}/${this.s.attachmentsFolderName}`);
    await this.ensureFolder(attachmentsFolder);

    const resourcesByHash = new Map<string, EnexResource>();
    for (const r of note.resources) resourcesByHash.set(r.hash, r);

    // Attach deterministic file names to referenced resources. The name embeds
    // 8 hex chars of the content MD5, so two different attachments that share a
    // generic Evernote file name ("photo.jpg") never collide, while identical
    // content re-uses one file across notes of the same notebook.
    const relByHash = new Map<string, string>();
    const nameFor = (res: EnexResource): string => {
      const existing = relByHash.get(res.hash);
      if (existing) return existing;
      const baseRaw = res.fileName
        ? toSafeSegment(res.fileName.replace(/\\/g, "/").split("/").pop() ?? "", "media", 100)
        : "";
      // Strip any extension the export gave us — the MIME type decides it, and
      // an 8-hex content hash keeps names unique and collision-proof.
      const root = (baseRaw || "media").replace(/\.[a-z0-9]{1,6}$/i, "");
      const ext = extForMime(res.mime);
      const candidate = `${root}-${res.hash.slice(0, 8)}.${ext}`;
      const rel = normalizePath(`${this.s.attachmentsFolderName}/${candidate}`);
      relByHash.set(res.hash, rel);
      return rel;
    };

    const usedHashes = new Set<string>();
    const conv = enmlHtmlToMarkdown(note.enmlHtml);
    let md = conv.markdown;
    let imageCount = 0;
    const pdfRels: string[] = [];

    const replaceMedia = (occ: MediaOccurrence): string => {
      const res = occ.hash ? resourcesByHash.get(occ.hash) : undefined;
      if (!res) {
        // Unresolved: keep whatever alt text the export carried.
        const alt = occ.alt?.trim();
        return alt ? alt : "";
      }
      usedHashes.add(res.hash);
      const rel = nameFor(res);
      if (isImageMime(res.mime)) {
        imageCount++;
        const rawAlt = (occ.alt ?? "").replace(/[[\]\n"\\]/g, " ").trim();
        const alt = rawAlt.length > 0 && rawAlt.length <= 80 && !/[()]/.test(rawAlt) ? rawAlt : "";
        return `![](${rel})` + (alt ? ` "${alt}"` : "");
      }
      if (this.s.includeNonImageAttachments) {
        const label = (occ.fileName ?? res.fileName ?? "attachment").trim();
        if (res.mime.toLowerCase() === "application/pdf") pdfRels.push(rel);
        return `[${label}](${rel})`;
      }
      return "";
    };

    for (const occ of conv.media) {
      const snippet = replaceMedia(occ);
      if (md.includes(occ.token)) md = md.split(occ.token).join(snippet);
    }

    // Optional: also save every resource even if unused.
    if (this.s.extractAllResources) {
      for (const res of note.resources) {
        if (!usedHashes.has(res.hash)) {
          nameFor(res);
          usedHashes.add(res.hash);
        }
      }
    }

    // Persist the used attachments (only when missing — the hash-suffixed name
    // guarantees identical content → identical name, so skipping is safe).
    let written = 0;
    for (const [hash, rel] of relByHash) {
      const res = resourcesByHash.get(hash);
      if (!res) continue;
      const fullPath = normalizePath(`${noteFolder}/${rel}`);
      if (!(this.vault.getAbstractFileByPath(fullPath) instanceof TFile)) {
        await this.writeBinaryFile(fullPath, base64ToBytes(res.dataB64));
        written++;
      }
    }

    // ---- assemble the markdown file ---------------------------------------
    const title = note.title.trim() || "Untitled";
    let body = md.trim();
    if (this.s.prependTitleHeading && title) {
      body = `# ${title}\n\n${body}`.replace(/\n{3,}/g, "\n\n").trim();
    }

    const metaBits: string[] = [];
    if (note.createdIso) {
      const d = isoToDate(note.createdIso);
      if (d) metaBits.push(`📅 ${d}`);
    }
    if (note.updatedIso && note.updatedIso !== note.createdIso) {
      const d = isoToDate(note.updatedIso);
      if (d) metaBits.push(`↻ ${d}`);
    }
    if (note.tags.length > 0) {
      metaBits.push(note.tags.map((t) => `#${toSafeSegment(t, "tag")}`).join(" "));
    }
    if (this.s.metaFooter && metaBits.length > 0) {
      body = `${body}\n\n*${metaBits.join("  ·  ")}*`;
    }

    const frontmatterLines: string[] = [];
    const push = (k: string, v: string) => frontmatterLines.push(`${k}: ${yamlStr(v)}`);
    push("title", title);
    if (note.createdIso) push("created", note.createdIso);
    if (note.updatedIso) push("updated", note.updatedIso);
    if (note.tags.length > 0) {
      frontmatterLines.push(`tags: ${JSON.stringify(note.tags)}`);
    }
    push("card-id", cardIdFor(note, parsed.sourcePath));
    push("enex-file", parsed.sourcePath);
    if (note.guid) push("enex-guid", note.guid);
    if (note.sourceUrl) push("source-url", note.sourceUrl);

    const content = `---\n${frontmatterLines.join("\n")}\n---\n\n${body}\n`;

    const cardId = cardIdFor(note, parsed.sourcePath);
    const fileName = slugify(title, `Note ${note.index + 1}`);
    const { path, exists } = await this.allocateNotePath(noteFolder, fileName, cardId);
    await this.writeTextFile(path, content);

    // Keep the size estimate mostly based on real text content.
    const textLen = Math.round(content.length * 0.88);

    if (exists) this.notesUpdated++;
    else this.notesCreated++;
    this.resourcesWritten += written;

    const pdfFiles = [...new Set(pdfRels.map((rel) => normalizePath(`${noteFolder}/${rel}`)))];
    return { file: path, title, textLen, imageCount, color, pdfFiles };
  }

  /** Convert a single .enex file into markdown notes (idempotent). */
  async materializeFile(file: TFile): Promise<{ board: BoardSpec; notePaths: string[] }> {
    const text = await this.vault.read(file);
    const parsed: ParsedEnex = parseEnexText(text, toSafeSegment(file.basename, "enex"), file.path);
    return this.materializeParsed(parsed);
  }

  private async materializeParsed(parsed: ParsedEnex): Promise<{ board: BoardSpec; notePaths: string[] }> {
    const noteFolder = normalizePath(
      [this.s.outputFolder, toSafeSegment(parsed.stem || parsed.sourcePath, "enex")].filter(Boolean).join("/"),
    );
    await this.ensureFolder(noteFolder);

    const cards: CardSpec[] = [];
    const notePaths: string[] = [];
    for (const note of parsed.notes) {
      let color: string | undefined;
      if (this.s.colorMode === "tag") {
        const seed = note.tags[0] ?? parsed.stem;
        color = paletteColorForSeed(seed);
      } else if (this.s.colorMode === "cycle") {
        color = CANVAS_COLORS[note.index % CANVAS_COLORS.length];
      }
      const card = await this.materializeNote(parsed, note, noteFolder, color);
      cards.push(card);
      notePaths.push(card.file);
    }
    return { board: { notebook: parsed.stem, cards }, notePaths };
  }

  private layoutOptions(): CardLayoutOptions {
    return {
      cardWidth: this.s.cardWidth,
      heightMode: this.s.heightMode,
      fixedHeight: this.s.fixedHeight,
      minHeight: this.s.minHeight,
      maxHeight: this.s.maxHeight,
      arrows: this.s.arrows,
      pdfScale: this.s.previewPdfsOnCanvas ? this.s.pdfScale : 0,
      pdfHeight: this.s.pdfHeight,
    };
  }

  /**
   * Build one board from one or more ENEX files (one group per file).
   * Returns the vault-relative path of the generated .canvas file.
   */
  async buildBoards(files: TFile[], canvasName: string): Promise<BoardBuildResult> {
    this.notesCreated = 0;
    this.notesUpdated = 0;
    this.resourcesWritten = 0;
    const errors: FileError[] = [];
    const boards: BoardSpec[] = [];
    const notePaths: string[] = [];

    for (const [idx, file] of files.entries()) {
      try {
        const { board, notePaths: paths } = await this.materializeFile(file);
        if (this.s.colorMode === "none") delete (board as { color?: string }).color;
        else board.color = CANVAS_COLORS[idx % CANVAS_COLORS.length];
        boards.push(board);
        notePaths.push(...paths);
      } catch (e) {
        errors.push({ file: file.path, message: (e as Error).message || String(e) });
      }
    }

    if (boards.length === 0) {
      throw new Error(
        errors.length > 0
          ? `No ENEX file could be converted.\n\n${errors.map((e) => `${e.file}: ${e.message}`).join("\n\n")}`
          : "Nothing to convert.",
      );
    }

    const { nodes, edges } = buildCanvas(boards, this.layoutOptions());

    const canvasDir = this.s.canvasFolder.trim() || this.s.outputFolder;
    await this.ensureFolder(canvasDir);
    const canvasPath = normalizePath(`${canvasDir}/${toSafeSegment(canvasName, "Visual Notes")}.canvas`);
    await this.writeTextFile(canvasPath, JSON.stringify({ nodes, edges }, null, 2));

    return { canvasPath, notePaths, notesCreated: this.notesCreated, notesUpdated: this.notesUpdated, resourcesWritten: this.resourcesWritten, errors };
  }

  /**
   * Append ENEX notebook groups to an existing .canvas board.
   *
   * Notes of the given files are always materialised (idempotent update), but a
   * group is only appended when the board does not already contain a group with
   * the same notebook label (the ENEX file stem). New groups are placed below
   * the existing canvas content. Returns which groups were added/skipped.
   */
  async addFilesToBoard(canvasFile: TFile, files: TFile[]): Promise<AddToBoardResult> {
    this.notesCreated = 0;
    this.notesUpdated = 0;
    this.resourcesWritten = 0;
    const errors: FileError[] = [];

    const text = await this.vault.read(canvasFile);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`"${canvasFile.path}" is not readable canvas JSON — cannot append to it.`);
    }
    const existingNodes = Array.isArray(data.nodes) ? (data.nodes as Array<Record<string, unknown>>) : [];
    if (!Array.isArray(data.nodes)) {
      throw new Error(`"${canvasFile.path}" has no "nodes" array — cannot append to it.`);
    }
    const existingEdges = Array.isArray(data.edges) ? (data.edges as Array<Record<string, unknown>>) : [];

    const existingLabels = new Set<string>();
    let maxBottom = 0;
    for (const nd of existingNodes) {
      if (nd && nd.type === "group" && typeof nd.label === "string") existingLabels.add(nd.label);
      const y = typeof nd.y === "number" ? nd.y : 0;
      const h = typeof nd.height === "number" ? nd.height : 0;
      if (Number.isFinite(y) && Number.isFinite(h) && y + h > maxBottom) maxBottom = y + h;
    }

    const addedBoards: BoardSpec[] = [];
    const addedNames: string[] = [];
    const skippedNames: string[] = [];
    const notePaths: string[] = [];

    for (const file of files) {
      try {
        const { board, notePaths: paths } = await this.materializeFile(file);
        notePaths.push(...paths);
        if (existingLabels.has(board.notebook)) {
          skippedNames.push(board.notebook);
          continue;
        }
        if (this.s.colorMode !== "none") {
          board.color = CANVAS_COLORS[(existingLabels.size + addedBoards.length) % CANVAS_COLORS.length];
        }
        addedBoards.push(board);
        addedNames.push(board.notebook);
      } catch (e) {
        errors.push({ file: file.path, message: (e as Error).message || String(e) });
      }
    }

    if (addedBoards.length > 0) {
      const local = buildCanvas(addedBoards, this.layoutOptions());
      const prefix = `a${Math.floor(Math.random() * 1e9).toString(36)}`;
      const baseY = Math.round(maxBottom) + 90;

      const idMap = new Map<string, string>();
      const remappedNodes: Array<Record<string, unknown>> = [];
      local.nodes.forEach((nd, i) => {
        const newId = `${prefix}${i}`;
        idMap.set(nd.id, newId);
        remappedNodes.push({ ...nd, id: newId, y: Math.round((nd.y ?? 0) + baseY), x: Math.round(nd.x ?? 0) });
      });
      const remappedEdges = local.edges.map((e, i) => ({
        ...e,
        id: `${prefix}e${i}`,
        fromNode: idMap.get(e.fromNode) ?? e.fromNode,
        toNode: idMap.get(e.toNode) ?? e.toNode,
      }));

      data.nodes = existingNodes.concat(remappedNodes);
      data.edges = existingEdges.concat(remappedEdges);
      await this.writeTextFile(canvasFile.path, JSON.stringify(data, null, 2));
    }

    return {
      canvasPath: canvasFile.path,
      addedBoards: addedNames,
      skippedBoards: skippedNames,
      notePaths,
      notesCreated: this.notesCreated,
      notesUpdated: this.notesUpdated,
      resourcesWritten: this.resourcesWritten,
      errors,
    };
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
