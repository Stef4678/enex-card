/**
 * UI helpers: pick an .enex file, pick a folder containing .enex files, and a
 * confirm-and-run modal used by both commands.
 */

import { App, FuzzySuggestModal, Modal, Notice, TFile } from "obsidian";
import type { BoardBuildResult } from "./engine";

export interface PickItem {
  label: string;
  detail?: string;
  data: TFile | string;
}

export class EnexPickModal extends FuzzySuggestModal<PickItem> {
  constructor(
    app: App,
    private items: PickItem[],
    private onPick: (data: TFile | string) => void,
    private emptyText = "No matching items.",
  ) {
    super(app);
    this.setPlaceholder("Search…");
    this.limit = 30;
  }

  getItems(): PickItem[] {
    return this.items;
  }

  getItemText(item: PickItem): string {
    return item.label;
  }

  onChooseItem(item: PickItem): void {
    this.onPick(item.data);
  }

  override onNoSuggestion(): void {
    const el = this.resultContainerEl;
    el.createDiv({ cls: "suggestion-empty", text: this.emptyText });
  }
}

export interface RunOptions<T = BoardBuildResult> {
  title: string;
  lines: string[];
  actionLabel?: string;
  execute: () => Promise<T>;
  onSuccess: (result: T) => void;
}

export class RunConfirmModal<T = BoardBuildResult> extends Modal {
  private busy = false;

  constructor(app: App, private opts: RunOptions<T>) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.opts.title });

    const list = contentEl.createDiv();
    for (const line of this.opts.lines) {
      list.createDiv({ text: line, cls: "enex-card-row" });
    }

    const foot = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = foot.createEl("button", { text: "Cancel", cls: "mod-warning" });
    cancel.addEventListener("click", () => this.close());

    const run = foot.createEl("button", {
      text: this.opts.actionLabel ?? "Run",
      cls: "mod-cta",
    });
    run.addEventListener("click", () => {
      void this.runClicked(run, cancel);
    });
  }

  private async runClicked(run: HTMLButtonElement, cancel: HTMLButtonElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    run.disabled = true;
    run.setText("Building…");
    cancel.disabled = true;
    try {
      const result = await this.opts.execute();
      this.close();
      this.opts.onSuccess(result);
    } catch (e) {
      this.close();
      new Notice(`Enex Card failed:\n${(e as Error).message || String(e)}`, 15000);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
