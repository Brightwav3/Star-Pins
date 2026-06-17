"use strict";

const { Plugin, Menu, setIcon, Notice } = require("obsidian");

const DEFAULT_DATA = { pins: [] };

module.exports = class StarPinsPlugin extends Plugin {
  async onload() {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    if (!Array.isArray(this.data.pins)) this.data.pins = [];

    // Add / refresh the star button + keep the explorer grid mounted.
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshHeaders();
        this.mountGrid();
      })
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.refreshHeaders();
        this.mountGrid();
      })
    );

    // Keep pins consistent when files are renamed or deleted.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const i = this.data.pins.indexOf(oldPath);
        if (i !== -1) {
          this.data.pins[i] = file.path;
          this.persistAndRender();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        const i = this.data.pins.indexOf(file.path);
        if (i !== -1) {
          this.data.pins.splice(i, 1);
          this.persistAndRender();
        }
      })
    );

    // Command palette + hotkey support.
    this.addCommand({
      id: "toggle-pin-active-file",
      name: "Pin / unpin current file",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.togglePin(file.path);
        return true;
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.mountGrid();
      this.refreshHeaders();
    });
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
    this.observer = null;
    if (this.gridEl) this.gridEl.remove();
    this.gridEl = null;
    // Remove our header buttons.
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf && leaf.view;
      if (view && view.__starPinEl) {
        view.__starPinEl.remove();
        view.__starPinEl = null;
      }
    });
  }

  /* ---------- data ---------- */

  // A pin entry is either a file-path string or a view descriptor object
  // { key, viewType, state, label, icon }. The key uniquely identifies it.
  pinKeyOf(entry) { return typeof entry === "string" ? entry : (entry && entry.key); }

  isPinned(key) {
    return !!key && this.data.pins.some((e) => this.pinKeyOf(e) === key);
  }

  // `entry` may be a path string or a descriptor object.
  async togglePin(entry) {
    const key = this.pinKeyOf(entry);
    if (!key) return;
    const i = this.data.pins.findIndex((e) => this.pinKeyOf(e) === key);
    if (i === -1) this.data.pins.push(entry);
    else this.data.pins.splice(i, 1);
    await this.persistAndRender();
  }

  async unpin(key) {
    const i = this.data.pins.findIndex((e) => this.pinKeyOf(e) === key);
    if (i !== -1) {
      this.data.pins.splice(i, 1);
      await this.persistAndRender();
    }
  }

  // Reorder: drop `fromKey` next to `toKey` (toKey null = move to the end).
  async movePin(fromKey, toKey, placeAfter) {
    if (!fromKey || fromKey === toKey) return;
    const pins = this.data.pins;
    const from = pins.findIndex((e) => this.pinKeyOf(e) === fromKey);
    if (from === -1) return;
    const [moved] = pins.splice(from, 1);
    let to = toKey == null ? pins.length : pins.findIndex((e) => this.pinKeyOf(e) === toKey);
    if (to === -1) to = pins.length;
    if (placeAfter) to += 1;
    pins.splice(to, 0, moved);
    await this.persistAndRender();
  }

  async persistAndRender() {
    await this.saveData(this.data);
    this.renderGrid();
    this.refreshHeaders();
  }

  /* ---------- header star button ---------- */

  forEachMarkdownView(cb) {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (leaf.view) cb(leaf.view);
    });
  }

  refreshHeaders() {
    // Any open view that is backed by a file (markdown, bases, canvas, …) OR
    // exposes a `starPin` descriptor (custom views) gets a star button.
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf && leaf.view;
      if (view && typeof view.addAction === "function" && (view.file || view.starPin)) {
        this.ensureStarButton(view);
      }
    });
  }

  // Current pin target for a view: its file path, or its starPin descriptor.
  pinTargetOf(view) {
    if (view.file) return view.file.path;
    if (view.starPin) return view.starPin;
    return null;
  }

  ensureStarButton(view) {
    if (!view.__starPinEl) {
      const el = view.addAction("star", "Pin", () => {
        const target = this.pinTargetOf(view);
        if (target) this.togglePin(target);
      });
      el.addClass("star-pin-action");
      view.__starPinEl = el;
    }

    const key = this.pinKeyOf(this.pinTargetOf(view));
    const pinned = this.isPinned(key);
    view.__starPinEl.toggleClass("is-pinned", pinned);
    view.__starPinEl.setAttr("aria-label", pinned ? "Unpin" : "Pin");
  }

  /* ---------- Iconize integration ---------- */

  // Read the icon name that Iconize (obsidian-icon-folder) assigned to a path.
  getIconizeIcon(path) {
    const ip = this.app.plugins && this.app.plugins.plugins
      ? this.app.plugins.plugins["obsidian-icon-folder"]
      : null;
    if (!ip) return null;
    const data = ip.data || (typeof ip.getData === "function" ? ip.getData() : null);
    if (!data || typeof data !== "object") return null;
    let raw = data[path];
    if (raw && typeof raw === "object") raw = raw.iconName || raw.icon || null;
    return typeof raw === "string" && raw.length ? raw : null;
  }

  // Render an Iconize icon into `container`. Returns true on success.
  applyIcon(container, iconName) {
    if (!iconName) return false;

    // Prefixed icon-pack names: "Li" (native Lucide), "Fa", "Bi", ...
    if (/^[A-Z][a-z][A-Z0-9]/.test(iconName)) {
      // Native Lucide -> Obsidian's bundled setIcon understands the kebab id.
      if (iconName.startsWith("Li")) {
        const kebab = iconName
          .slice(2)
          .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
          .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
          .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
          .toLowerCase();
        const span = container.createSpan();
        setIcon(span, kebab);
        if (span.childElementCount > 0) return true;
        span.remove();
      }
      // Any icon pack: ask Iconize to give us the SVG.
      if (this.renderViaIconize(container, iconName)) return true;
      return false;
    }

    // Otherwise treat it as an emoji / text glyph.
    container.createSpan({ cls: "star-pin-emoji", text: iconName });
    return true;
  }

  renderViaIconize(container, iconName) {
    try {
      const ip = this.app.plugins.plugins["obsidian-icon-folder"];
      const api = ip && ip.api;
      const icon =
        api && typeof api.getIconByName === "function" ? api.getIconByName(iconName) : null;
      const svg = icon && (icon.svgElement || icon.svg || icon.iconName);
      if (typeof svg === "string" && svg.indexOf("<svg") !== -1) {
        container.innerHTML = svg;
        return true;
      }
    } catch (e) {
      /* Iconize API shape varies between versions; fall back silently. */
    }
    return false;
  }

  /* ---------- explorer grid ---------- */

  getExplorerContainer() {
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    if (!leaf || !leaf.view || !leaf.view.containerEl) return null;
    return leaf.view.containerEl;
  }

  mountGrid() {
    const container = this.getExplorerContainer();
    if (!container) return;

    // Already mounted and still in the DOM -> just refresh contents.
    if (this.gridEl && container.contains(this.gridEl)) {
      this.renderGrid();
      this.watchExplorer(container);
      return;
    }
    if (this.gridEl) this.gridEl.remove();

    const filesContainer = container.querySelector(".nav-files-container");
    this.gridEl = createDiv("star-pins-grid");
    if (filesContainer && filesContainer.parentElement) {
      filesContainer.parentElement.insertBefore(this.gridEl, filesContainer);
    } else {
      container.appendChild(this.gridEl);
    }
    this.attachGridDnd();
    this.renderGrid();
    this.watchExplorer(container);
  }

  // Grid-level drop target: dropping in the empty gap moves the tile to the end.
  attachGridDnd() {
    this.gridEl.addEventListener("dragover", (e) => {
      if (this._dragKey) e.preventDefault();
    });
    this.gridEl.addEventListener("drop", (e) => {
      if (!this._dragKey) return;
      e.preventDefault();
      const from = this._dragKey;
      this._dragKey = null;
      this.movePin(from, null, false);
    });
  }

  // Re-insert the grid whenever the explorer rebuilds its DOM and drops our node.
  watchExplorer(container) {
    if (this.observedContainer === container && this.observer) return;
    if (this.observer) this.observer.disconnect();
    this.observedContainer = container;
    this.observer = new MutationObserver(() => {
      if (this.gridEl && !container.contains(this.gridEl)) {
        this.mountGrid();
      }
    });
    this.observer.observe(container, { childList: true, subtree: true });
  }

  renderGrid() {
    // Re-mount if the explorer was closed/reopened and our node is gone.
    const container = this.getExplorerContainer();
    if (!this.gridEl || (container && !container.contains(this.gridEl))) {
      this.mountGrid();
      return;
    }
    if (this.data.pins.length === 0) {
      this.gridEl.addClass("is-empty");
      this.gridEl.empty();
      this._renderKey = "";
      return;
    }
    this.gridEl.removeClass("is-empty");

    // Only rebuild the tiles when the pins (or their icons) actually changed.
    // Otherwise an active-leaf-change on click would replace the tile mid-click.
    const key = this.data.pins
      .map((e) =>
        typeof e === "string"
          ? e + "|" + (this.getIconizeIcon(e) || "")
          : e.key + "|" + (e.icon || "")
      )
      .join("~");
    if (key === this._renderKey && this.gridEl.childElementCount === this.data.pins.length) {
      return;
    }
    this._renderKey = key;
    this.gridEl.empty();

    this.data.pins.forEach((entry) => {
      const r = this.resolvePin(entry);

      const tile = this.gridEl.createDiv("star-pin-tile");
      tile.setAttr("aria-label", r.label);
      if (r.missing) tile.addClass("is-missing");

      // Drag & drop reordering (by pin key).
      tile.setAttr("draggable", "true");
      tile.addEventListener("dragstart", (e) => {
        this._dragKey = r.key;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", r.key);
        tile.addClass("is-dragging");
      });
      tile.addEventListener("dragend", () => {
        this._dragKey = null;
        tile.removeClass("is-dragging");
        tile.removeClass("drop-before");
        tile.removeClass("drop-after");
      });
      tile.addEventListener("dragover", (e) => {
        if (!this._dragKey || this._dragKey === r.key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = tile.getBoundingClientRect();
        const after = e.clientX > rect.left + rect.width / 2;
        tile.toggleClass("drop-after", after);
        tile.toggleClass("drop-before", !after);
      });
      tile.addEventListener("dragleave", () => {
        tile.removeClass("drop-before");
        tile.removeClass("drop-after");
      });
      tile.addEventListener("drop", (e) => {
        if (!this._dragKey) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = tile.getBoundingClientRect();
        const after = e.clientX > rect.left + rect.width / 2;
        const from = this._dragKey;
        this._dragKey = null;
        tile.removeClass("drop-before");
        tile.removeClass("drop-after");
        this.movePin(from, r.key, after);
      });

      const iconWrap = tile.createDiv("star-pin-icon");
      if (r.lucide) {
        setIcon(iconWrap, r.lucide);
        if (iconWrap.childElementCount === 0) {
          iconWrap.addClass("is-mono");
          iconWrap.setText((r.label.trim()[0] || "?").toUpperCase());
        }
      } else if (!this.applyIcon(iconWrap, r.iconName)) {
        iconWrap.addClass("is-mono");
        iconWrap.setText((r.label.trim()[0] || "?").toUpperCase());
      }

      tile.addEventListener("click", (evt) => r.open(evt.ctrlKey || evt.metaKey));

      // Middle-click opens the pin in a new tab (Arc/browser convention).
      tile.addEventListener("auxclick", (evt) => {
        if (evt.button !== 1) return;
        evt.preventDefault();
        if (r.canOpenNew) r.open(true);
      });

      tile.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item.setTitle("Unpin").setIcon("star-off").onClick(() => this.unpin(r.key))
        );
        if (r.canOpenNew) {
          menu.addItem((item) =>
            item.setTitle("Open in new tab").setIcon("file-plus").onClick(() => r.open(true))
          );
        }
        menu.showAtMouseEvent(evt);
      });
    });
  }

  // Resolve a pin entry into render data: label, icon, open() handler.
  resolvePin(entry) {
    if (typeof entry === "string") {
      const file = this.app.vault.getAbstractFileByPath(entry);
      const name = file ? file.basename || file.name : entry.split("/").pop();
      const label = (name || "?").replace(/\.[^.]+$/, "");
      return {
        key: entry,
        label,
        missing: !file,
        lucide: null,
        iconName: file ? this.getIconizeIcon(file.path) : null,
        canOpenNew: !!file,
        open: (newLeaf) => {
          if (!file) { new Notice("Pinned file no longer exists."); return; }
          this.app.workspace.getLeaf(newLeaf).openFile(file);
        },
      };
    }
    // View descriptor: { key, viewType, state, label, icon }
    return {
      key: entry.key,
      label: entry.label || entry.key,
      missing: false,
      lucide: entry.icon || "panel-left",
      iconName: null,
      canOpenNew: true,
      open: (newLeaf) => this.openViewPin(entry, newLeaf),
    };
  }

  async openViewPin(entry, newLeaf) {
    const existing = this.app.workspace.getLeavesOfType(entry.viewType)[0];
    const leaf = existing && !newLeaf ? existing : this.app.workspace.getLeaf(newLeaf || false);
    await leaf.setViewState({ type: entry.viewType, state: entry.state || {}, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
};
