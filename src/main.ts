/**
 * Enex Card — main plugin entry.
 */

import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, EnexCardSettings, normalizeSettings } from "./settings";
import { type AddToBoardResult, BoardBuildResult, EnexCardEngine } from "./engine";
import { EnexPickModal, PickItem, RunConfirmModal } from "./modals";
import { EnexCardSettingTab } from "./settingsTab";

export default class EnexCardPlugin extends Plugin {
  settings: EnexCardSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "build-from-file",
      name: "Build visual board from an ENEX file…",
      callback: () => void this.pickFileAndBuild(),
    });

    this.addCommand({
      id: "build-from-folder",
      name: "Build one visual board from every ENEX in a folder…",
      callback: () => void this.pickFolderAndBuild(),
    });

    this.addCommand({
      id: "add-file-to-board",
      name: "Add ENEX file to an existing board…",
      callback: () => void this.pickCanvasThenSource("file"),
    });

    this.addCommand({
      id: "add-folder-to-board",
      name: "Add all ENEX in a folder to an existing board…",
      callback: () => void this.pickCanvasThenSource("folder"),
    });

    this.addRibbonIcon("kanban", "Enex Card: ENEX → Canvas board", () =>
      void this.pickFileAndBuild(),
    );

    this.addSettingTab(new EnexCardSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<EnexCardSettings> | null | undefined;
    this.settings = normalizeSettings(data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private newEngine(): EnexCardEngine {
    return new EnexCardEngine(this.app.vault, this.settings);
  }

  // ---- commands ------------------------------------------------------------

  private async pickFileAndBuild(): Promise<void> {
    const files = this.newEngine().enexFilesIn("");
    if (files.length === 0) {
      new Notice(
        "No .enex files found in this vault. Drop Evernote export (.enex) files into the vault " +
          "(Embeds+ can preview them inline), then run this command again.",
        12000,
      );
      return;
    }
    const items: PickItem[] = files.map((f) => ({
      label: f.path,
      detail: "One notebook group on the board",
      data: f,
    }));
    new EnexPickModal(this.app, items, (data) => {
      if (!(data instanceof TFile)) return;
      const file = data;
      this.confirmAndBuild([file], file.basename, [`Source: ${file.path}`]);
    }, "No .enex files match that search.").open();
  }

  private async pickFolderAndBuild(): Promise<void> {
    const engine = this.newEngine();
    const folders = engine.foldersWithEnex();
    if (folders.length === 0) {
      new Notice(
        "No .enex files found in this vault. Drop Evernote export (.enex) files into the vault first.",
        10000,
      );
      return;
    }
    const items: PickItem[] = folders.map((folder) => {
      const count = engine.enexFilesIn(folder).length;
      return {
        label: folder === "" ? "Vault root (entire vault)" : folder,
        detail: `${count} ENEX file${count === 1 ? "" : "s"} → one board with a group per file`,
        data: folder,
      };
    });
    new EnexPickModal(this.app, items, (data) => {
      const folder = data as string;
      const files = engine.enexFilesIn(folder);
      const canvasName = folder ? folder.split("/").filter(Boolean).pop()! : "Visual Notes";
      this.confirmAndBuild(
        files,
        canvasName,
        [
          `Folder: ${folder === "" ? "vault root" : folder}`,
          `${files.length} ENEX file${files.length === 1 ? "" : "s"} will each become a notebook group.`,
        ],
      );
    }, "No folder with .enex files matches that search.").open();
  }

  private confirmAndBuild(files: TFile[], canvasName: string, lines: string[]): void {
    if (files.length === 0) return;

    const engine = this.newEngine();
    const modal = new RunConfirmModal(this.app, {
      title: "Build canvas board",
      lines: [
        ...lines,
        `Cards: one per Evernote note (markdown) → “${this.settings.outputFolder || "vault root"}”`,
        `Attachments are extracted into an “${this.settings.attachmentsFolderName || "attachments"}” folder.`,
        this.settings.colorMode === "tag"
          ? "Card colors follow the first Evernote tag."
          : this.settings.colorMode === "cycle"
            ? "Card colors cycle through the canvas palette."
            : "Cards use the default canvas color.",
      ],
      actionLabel: "Build board",
      execute: () => engine.buildBoards(files, canvasName),
      onSuccess: (result) => void this.afterBuild(result),
    });
    if (!this.settings.confirmBeforeRun) {
      // Run immediately without the dialog.
      engine
        .buildBoards(files, canvasName)
        .then((r) => void this.afterBuild(r))
        .catch((e) => new Notice(`Enex Card failed:\n${(e as Error).message || String(e)}`, 15000));
      return;
    }
    modal.open();
  }

  // ---- add to an existing board ---------------------------------------------

  private canvasFiles(): TFile[] {
    return this.app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === "canvas")
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private pickCanvasThenSource(kind: "file" | "folder"): void {
    const canvases = this.canvasFiles();
    if (canvases.length === 0) {
      new Notice(
        "No .canvas files in this vault. Build a board first (Enex Card commands), then add to it.",
        10000,
      );
      return;
    }
    const canvasItems: PickItem[] = canvases.map((f) => ({
      label: f.path,
      detail: "Add ENEX notebook groups below this board",
      data: f,
    }));
    new EnexPickModal(this.app, canvasItems, (canvas) => {
      if (!(canvas instanceof TFile)) return;
      const target = canvas;
      if (kind === "file") {
        const files = this.newEngine().enexFilesIn("");
        if (files.length === 0) {
          new Notice("No .enex files found in this vault.", 8000);
          return;
        }
        const items: PickItem[] = files.map((f) => ({
          label: f.path,
          detail: "Adds one notebook group",
          data: f,
        }));
        new EnexPickModal(this.app, items, (chosen) => {
          if (!(chosen instanceof TFile)) return;
          const file = chosen;
          this.confirmAdd(target, [file], [
            `Board: ${target.path}`,
            `Source: ${file.path}`,
          ]);
        }).open();
      } else {
        const engine = this.newEngine();
        const folders = engine.foldersWithEnex();
        const items: PickItem[] = folders.map((folder) => {
          const count = engine.enexFilesIn(folder).length;
          return {
            label: folder === "" ? "Vault root (entire vault)" : folder,
            detail: `${count} ENEX file${count === 1 ? "" : "s"}`,
            data: folder,
          };
        });
        if (items.length === 0) {
          new Notice("No .enex files found in this vault.", 8000);
          return;
        }
        new EnexPickModal(this.app, items, (chosen) => {
          const folder = chosen as string;
          const files = engine.enexFilesIn(folder);
          this.confirmAdd(target, files, [
            `Board: ${target.path}`,
            `Folder: ${folder === "" ? "vault root" : folder} (${files.length} ENEX files)`,
          ]);
        }).open();
      }
    }).open();
  }

  private confirmAdd(canvas: TFile, files: TFile[], lines: string[]): void {
    if (files.length === 0) return;
    const engine = this.newEngine();
    const modal = new RunConfirmModal(this.app, {
      title: "Add ENEX content to board",
      lines: [
        ...lines,
        "Notes are (re)generated idempotently.",
        "Notebook groups already on the board are refreshed, not duplicated.",
        "New groups are appended below the current board content.",
      ],
      actionLabel: "Add to board",
      execute: () => engine.addFilesToBoard(canvas, files),
      onSuccess: (result) => void this.afterAdd(result),
    });
    if (!this.settings.confirmBeforeRun) {
      engine
        .addFilesToBoard(canvas, files)
        .then((r) => void this.afterAdd(r))
        .catch((e) => new Notice(`Enex Card failed:\n${(e as Error).message || String(e)}`, 15000));
      return;
    }
    modal.open();
  }

  private async afterBuild(result: BoardBuildResult): Promise<void> {
    if (result.errors.length > 0) {
      const head = result.errors
        .slice(0, 3)
        .map((e) => `${e.file}: ${e.message}`)
        .join("\n");
      new Notice(
        `Enex Card finished with ${result.errors.length} error(s):\n${head}`,
        20000,
      );
    } else {
      new Notice(
        `Board ready: ${result.notePaths.length} note${result.notePaths.length === 1 ? "" : "s"} ` +
          `(${result.notesCreated} created, ${result.notesUpdated} updated, ` +
          `${result.resourcesWritten} attachments) → ${result.canvasPath}`,
        12000,
      );
    }
    if (this.settings.openAfterCreate) {
      const canvasFile = this.app.vault.getAbstractFileByPath(result.canvasPath);
      if (canvasFile instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(canvasFile);
      }
    }
  }

  private async afterAdd(result: AddToBoardResult): Promise<void> {
    const parts: string[] = [];
    if (result.addedBoards.length > 0) {
      parts.push(`added ${result.addedBoards.length} group(s)`);
    }
    if (result.skippedBoards.length > 0) {
      parts.push(`refreshed ${result.skippedBoards.length} group(s) already on the board`);
    }
    if (parts.length === 0) {
      new Notice(`Nothing to add to ${result.canvasPath}.`, 8000);
    } else {
      const extra =
        result.errors.length > 0
          ? `\n${result.errors.length} file(s) failed:\n${result.errors
              .slice(0, 3)
              .map((e) => `${e.file}: ${e.message}`)
              .join("\n")}`
          : "";
      new Notice(
        `Board updated (${result.notesCreated} created, ${result.notesUpdated} updated, ` +
          `${result.resourcesWritten} attachments): ${parts.join(", ")} → ${result.canvasPath}${extra}`,
        14000,
      );
    }
    if (this.settings.openAfterCreate) {
      const canvasFile = this.app.vault.getAbstractFileByPath(result.canvasPath);
      if (canvasFile instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(canvasFile);
      }
    }
  }
}
