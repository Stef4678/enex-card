/**
 * Settings tab for Enex Card.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type EnexCardPlugin from "./main";

export class EnexCardSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: EnexCardPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Where files go").setHeading();

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc(
        "Vault folder that receives one sub-folder per ENEX file with its markdown notes " +
          "(“Evernote Visuals/‹file›/…”). Empty means the vault root.",
      )
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_OUTPUT)
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (v) => {
            this.plugin.settings.outputFolder = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Canvas folder")
      .setDesc("Where generated .canvas boards are saved. Empty = same as the output folder.")
      .addText((t) =>
        t
          .setPlaceholder("same as output folder")
          .setValue(this.plugin.settings.canvasFolder)
          .onChange(async (v) => {
            this.plugin.settings.canvasFolder = v.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Attachments folder")
      .setDesc("Name of the sub-folder (inside each notebook folder) for extracted images/attachments.")
      .addText((t) =>
        t
          .setPlaceholder("attachments")
          .setValue(this.plugin.settings.attachmentsFolderName)
          .onChange(async (v) => {
            this.plugin.settings.attachmentsFolderName = v.trim() || "attachments";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Cards").setHeading();

    new Setting(containerEl)
      .setName("Card width")
      .setDesc("Node width in canvas units (height is estimated from the note content).")
      .addText((t) =>
        t
          .setPlaceholder("330")
          .setValue(String(this.plugin.settings.cardWidth))
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            if (!Number.isNaN(n) && n >= 120 && n <= 1200) {
              this.plugin.settings.cardWidth = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Card height")
      .setDesc("auto = estimate from content so the whole note is visible; fixed = one size for every card.")
      .addDropdown((d) =>
        d
          .addOption("auto", "Auto (fit content)")
          .addOption("fixed", "Fixed height")
          .setValue(this.plugin.settings.heightMode)
          .onChange(async (v) => {
            this.plugin.settings.heightMode = v === "fixed" ? "fixed" : "auto";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.heightMode === "fixed") {
      new Setting(containerEl)
        .setName("Fixed card height")
        .setDesc("Height in canvas units used for every card.")
        .addText((t) =>
          t
            .setPlaceholder("420")
            .setValue(String(this.plugin.settings.fixedHeight))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n) && n >= 100 && n <= 4000) {
                this.plugin.settings.fixedHeight = n;
                await this.plugin.saveSettings();
              }
            }),
        );
    } else {
      new Setting(containerEl)
        .setName("Min / max card height")
        .setDesc("Clamps for the auto height estimate (canvas units).")
        .addText((t) =>
          t
            .setPlaceholder(String(MIN_H))
            .setValue(String(this.plugin.settings.minHeight))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n) && n > 0) {
                this.plugin.settings.minHeight = n;
                await this.plugin.saveSettings();
              }
            }),
        )
        .addText((t) =>
          t
            .setPlaceholder(String(MAX_H))
            .setValue(String(this.plugin.settings.maxHeight))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n) && n > 0) {
                this.plugin.settings.maxHeight = n;
                await this.plugin.saveSettings();
              }
            }),
        );
    }

    new Setting(containerEl)
      .setName("Card color")
      .setDesc("Cycle = palette order; Tag = first Evernote tag picks a stable color; None = default.")
      .addDropdown((d) =>
        d
          .addOption("cycle", "Cycle through palette")
          .addOption("tag", "By first Evernote tag")
          .addOption("none", "None")
          .setValue(this.plugin.settings.colorMode)
          .onChange(async (v) => {
            this.plugin.settings.colorMode = v as "none" | "cycle" | "tag";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Reading-order arrows")
      .setDesc("Connect horizontally adjacent cards with arrows (order inside the ENEX file).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.arrows).onChange(async (v) => {
          this.plugin.settings.arrows = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Markdown notes").setHeading();

    new Setting(containerEl)
      .setName("Prepend “# Title”")
      .setDesc("Start each generated note with a heading so cards look like titled notes.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.prependTitleHeading).onChange(async (v) => {
          this.plugin.settings.prependTitleHeading = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Meta footer")
      .setDesc("Add a small italic footer with the creation date and tags to each note.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.metaFooter).onChange(async (v) => {
          this.plugin.settings.metaFooter = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Keep non-image attachments")
      .setDesc("PDFs, audio, archives… are saved and linked inside the card instead of being dropped.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.includeNonImageAttachments).onChange(async (v) => {
          this.plugin.settings.includeNonImageAttachments = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Preview PDFs on the board")
      .setDesc(
        "When a note contains a PDF, add a PDF file node underneath its card so Obsidian " +
          "shows the document right on the canvas (the PDF also stays linked in the note).",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.previewPdfsOnCanvas).onChange(async (v) => {
          this.plugin.settings.previewPdfsOnCanvas = v;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (this.plugin.settings.previewPdfsOnCanvas) {
      new Setting(containerEl)
        .setName("PDF preview size")
        .setDesc(
          "PDF node width as a multiple of the note card width. Obsidian renders the PDF page " +
            "inside the node, so a wider node shows bigger text (default 1.6×).",
        )
        .addText((t) =>
          t
            .setPlaceholder("1.6")
            .setValue(String(this.plugin.settings.pdfScale))
            .onChange(async (v) => {
              const n = parseFloat(v);
              if (!Number.isNaN(n) && n >= 0.6 && n <= 5) {
                this.plugin.settings.pdfScale = n;
                await this.plugin.saveSettings();
              }
            }),
        );

      new Setting(containerEl)
        .setName("Minimum PDF height")
        .setDesc("Absolute minimum height of one PDF node in canvas units; height grows with the width (default 480).")
        .addText((t) =>
          t
            .setPlaceholder("480")
            .setValue(String(this.plugin.settings.pdfHeight))
            .onChange(async (v) => {
              const n = parseInt(v, 10);
              if (!Number.isNaN(n) && n >= 120 && n <= 4000) {
                this.plugin.settings.pdfHeight = n;
                await this.plugin.saveSettings();
              }
            }),
        );
    }

    new Setting(containerEl)
      .setName("Extract all resources")
      .setDesc("Off = only resources the note actually embeds are saved. Turn on to keep every attachment.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.extractAllResources).onChange(async (v) => {
          this.plugin.settings.extractAllResources = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Behaviour").setHeading();

    new Setting(containerEl)
      .setName("Open the board afterwards")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openAfterCreate).onChange(async (v) => {
          this.plugin.settings.openAfterCreate = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Confirm before building")
      .setDesc("Show a summary dialog with a Run button before files are written.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.confirmBeforeRun).onChange(async (v) => {
          this.plugin.settings.confirmBeforeRun = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Tip")
      .setDesc(
        "Keep the original .enex files in your vault. Embeds+ previews them inline with " +
          "full Evernote styling; Enex Card turns every note into a card on a spatial canvas.",
      );
  }
}

const DEFAULT_OUTPUT = "Evernote Visuals";
const MIN_H = 170;
const MAX_H = 1600;
