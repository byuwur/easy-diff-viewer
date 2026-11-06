"use strict";
/*
 * File: diff.js
 * Desc: Standalone DIFF viewer. No runtime dependencies.
 * Copyright (c) 2026 Andres Trujillo [Mateus] byUwUr
 * https://github.com/byuwur/easy-diff-viewer
 * MIT License (see LICENSE).
 */
(function (global) {
  // --- INITIALIZATION ---
  if (global.byDIFFviewer?.initialized) return;

  // --- METADATA ---
  byDIFFviewer.VERSION = "1.4"; // 2026-11-05

  // --- STATE ---
  const instances = new WeakMap();
  let nextViewId = 0;
  // --- HELPERS ---
  const node = (tag, className = "", text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };
  const button = (parent, text, label, action) => {
    const control = node("button", "", text);
    control.type = "button";
    control.title = label;
    control.setAttribute("aria-label", label);
    control.addEventListener("click", action);
    parent.appendChild(control);
    return control;
  };
  const copyButton = (parent, getText, label = "Copy source", text = "Copy") => {
    const control = button(parent, text, label, async () => {
      control.disabled = true;
      try {
        await navigator.clipboard.writeText(getText());
        control.textContent = "Copied!";
        control.dataset.state = "success";
      } catch {
        control.textContent = "Failed";
        control.dataset.state = "error";
        control.title = "Copy failed. Check clipboard access.";
      } finally {
        control.disabled = false;
      }
    });
    control.setAttribute("aria-live", "polite");
    const reset = () => {
      if (control.dataset.state === "error") return;
      delete control.dataset.state;
      control.textContent = text;
      control.title = label;
    };
    control.addEventListener("mouseleave", reset);
    control.addEventListener("focusout", reset);
    return control;
  };
  // Yield at a chunk boundary so input events and replacement renders can run.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const positive = (value, fallback, maximum) => (Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback);
  // --- APPEARANCE ---
  const extraPalettes = new Set([
    "dracula",
    "darcula",
    "nord",
    "catppuccin",
    "catppuccin-frappe",
    "catppuccin-macchiato",
    "rose-pine",
    "rose-pine-moon",
    "gruvbox",
    "gruvbox-material",
    "tokyo-night",
    "tokyo-storm",
    "tokyo-moon",
    "one",
    "material",
    "material-ocean",
    "night-owl",
    "synthwave",
    "ayu",
    "everforest",
    "kanagawa",
    "selenized",
    "vscode",
    "monokai-dimmed",
    "discord",
    "slack",
    "bonyur",
    "sakura",
    "bubblegum",
    "candy",
    "rose-gold",
    "lavender",
    "cyberpunk",
    "sunset",
    "volcano",
    "amber",
    "terminal",
    "paper",
    "ink",
    "ocean",
    "forest",
    "mint",
    "ice",
    "sepia"
  ]);
  const warnedPalettes = new Set();
  const warnMissingThemes = (element, palette = element.dataset.theme) => {
    if (!extraPalettes.has(palette) || warnedPalettes.has(palette)) return;
    const document = element.ownerDocument;
    if (document.defaultView.getComputedStyle(document.documentElement).getPropertyValue("--by-diff-themes-loaded").trim() === "1") return;
    warnedPalettes.add(palette);
    console.warn(`easy-diff-viewer: Palette "${palette}" requires diff.themes.css. Import it after diff.css. https://byuwur.github.io/easy-diff-viewer/`);
  };

  // Explicit appearance options override markup; omitted values preserve the container's state.
  const applyAppearance = (element, options) => {
    const { theme, palette, fontSize } = options;
    if (theme != null && !["light", "dark"].includes(theme)) throw new RangeError("Theme must be light or dark.");
    if (palette != null && (typeof palette !== "string" || !/^[a-z][\w-]*$/i.test(palette) || ["light", "dark"].includes(palette))) throw new RangeError("Palette must be a CSS theme name; use theme for light or dark.");
    warnMissingThemes(element, palette ?? element.dataset.theme);
    const size = typeof fontSize === "number" ? `${Math.max(0.5, Math.min(3, fontSize))}rem` : typeof fontSize === "string" ? `clamp(0.5rem, ${fontSize}, 3rem)` : "";
    if (fontSize != null && (typeof fontSize === "number" ? !Number.isFinite(fontSize) : typeof fontSize !== "string" || !CSS.supports("font-size", size))) throw new RangeError("Font size must be a finite multiplier or a CSS size.");
    if (theme != null || palette != null) {
      const mode = theme ?? (["light", "dark"].includes(element.dataset.theme) ? element.dataset.theme : element.classList.contains("dark") ? "dark" : "light");
      element.classList.toggle("light", mode === "light");
      element.classList.toggle("dark", mode === "dark");
      if (palette != null) element.dataset.theme = palette;
      else if (["light", "dark"].includes(element.dataset.theme)) element.dataset.theme = mode;
    }
    if (fontSize != null) {
      element.style.fontSize = size;
      element.dataset.byViewDefaultFontSize = element.style.fontSize;
    }
  };

  // --- CONTROLS ---
  // Mirrored across the family so each viewer can run without a shared runtime.
  /**
   * Adds container light/dark controls, retaining legacy stylesheet links as a fallback.
   * @param {HTMLElement} element Viewer container and theme owner.
   * @param {HTMLElement} controls Toolbar control group.
   * @param {string} filename Legacy theme stylesheet basename.
   * @returns {HTMLButtonElement} Theme toggle button.
   */
  const appendThemeToggle = (element, controls, filename) => {
    const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const themePattern = new RegExp(`^([^?#]*/)?${escapedFilename}\\.(light|dark)\\.css([?#].*)?$`, "i");
    const stylesheet = [document.getElementById("byVIEWtheme"), ...document.querySelectorAll('link[rel~="stylesheet"]')].find((link) => link && themePattern.test(link.getAttribute("href") || ""));
    // Explicit container state takes precedence over a shared legacy stylesheet.
    const localTheme = (target) => {
      if (["light", "dark"].includes(target.dataset.theme)) return target.dataset.theme;
      if (target.classList.contains("dark")) return "dark";
      if (target.classList.contains("light")) return "light";
      return target.dataset.theme ? "light" : null;
    };
    const legacyTheme = () => (stylesheet?.isConnected ? (stylesheet.getAttribute("href") || "").match(themePattern) : null);
    const getTheme = () => localTheme(element) || legacyTheme()?.[2].toLowerCase() || "light";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "byVIEWthemeToggle";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
    const sync = () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      const toggles = !localTheme(element) && legacyTheme() ? [button, ...document.querySelectorAll(".byDIFFdocument > .byVIEWtoolbar > .byVIEWcontrols > .byVIEWthemeToggle")] : [button];
      for (const toggle of toggles) {
        // A legacy link must not change the controls of independently themed viewers.
        if (toggle !== button && localTheme(toggle.closest(".byDIFFdocument"))) continue;
        toggle.title = `Switch to ${next} theme`;
        toggle.setAttribute("aria-label", toggle.title);
      }
    };
    button.addEventListener("click", () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      if (!localTheme(element) && legacyTheme()) {
        const href = stylesheet.getAttribute("href");
        stylesheet.setAttribute(
          "href",
          href.replace(themePattern, (_, path = "", theme, suffix = "") => `${path}${filename}.${next}.css${suffix}`)
        );
      } else if (element.dataset.theme && !["light", "dark"].includes(element.dataset.theme)) {
        // Named palettes stay selected while only the mode changes.
        element.classList.toggle("light", next === "light");
        element.classList.toggle("dark", next === "dark");
      } else if (element.hasAttribute("data-theme") || (!element.classList.contains("light") && !element.classList.contains("dark"))) {
        element.dataset.theme = next;
      } else {
        element.classList.toggle("light", next === "light");
        element.classList.toggle("dark", next === "dark");
      }
      sync();
    });
    button.addEventListener("focus", sync);
    button.addEventListener("pointerenter", sync);
    sync();
    return controls.appendChild(button);
  };

  /**
   * Adds text size controls for a renderer.
   * @param {HTMLElement} element - Renderer whose font size is changed.
   * @param {HTMLElement} controls - Toolbar that receives the controls.
   * @return {HTMLElement} The text size button group.
   */
  const appendFontSizeControls = (element, controls) => {
    element.dataset.byViewDefaultFontSize ??= element.style.fontSize;
    const sizes = document.createElement("div");
    sizes.className = "byVIEWfontSizes";
    controls.appendChild(sizes);
    const getSize = () => (parseFloat(getComputedStyle(element).fontSize) || 16) / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const decrease = document.createElement("button");
    const increase = document.createElement("button");
    const reset = document.createElement("button");
    reset.textContent = "A";
    decrease.textContent = "A-";
    increase.textContent = "A+";
    for (const [button, title] of [
      [decrease, "Decrease text size"],
      [reset, "Reset text size"],
      [increase, "Increase text size"]
    ]) {
      button.type = "button";
      button.className = "byVIEWfontSize";
      button.title = title;
      button.setAttribute("aria-label", title);
      sizes.appendChild(button);
    }
    const sync = () => {
      const size = getSize();
      decrease.disabled = size <= 0.5;
      increase.disabled = size >= 3;
    };
    for (const [button, step] of [
      [decrease, -0.125],
      [increase, 0.125]
    ]) {
      button.addEventListener("click", () => {
        const size = Math.max(0.5, Math.min(3, getSize() + step));
        element.style.fontSize = `${size}rem`;
        sync();
      });
    }
    reset.addEventListener("click", () => {
      element.style.fontSize = element.dataset.byViewDefaultFontSize;
      sync();
    });
    sync();
    return sizes;
  };

  /**
   * Add a copy action for the complete source, including content outside the visible rendered chunk.
   * @param {HTMLElement} controls Toolbar control group.
   * @param {Function} getText Callback that returns the text to copy.
   * @param {string} label Human-readable label.
   * @returns {void}
   */
  const appendCopyButton = (controls, getText, label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "byVIEWcopy";
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" aria-hidden="true" focusable="false"><!--!Font Awesome Free 7.3.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.--><path d="M288 64C252.7 64 224 92.7 224 128L224 384C224 419.3 252.7 448 288 448L480 448C515.3 448 544 419.3 544 384L544 183.4C544 166 536.9 149.3 524.3 137.2L466.6 81.8C454.7 70.4 438.8 64 422.3 64L288 64zM160 192C124.7 192 96 220.7 96 256L96 512C96 547.3 124.7 576 160 576L352 576C387.3 576 416 547.3 416 512L416 496L352 496L352 512L160 512L160 256L176 256L176 192L160 192z"/></svg>`;
    const caption = document.createElement("span");
    caption.setAttribute("aria-live", "polite");
    button.appendChild(caption);
    const reset = () => {
      if (button.dataset.state === "error") return;
      delete button.dataset.state;
      caption.textContent = "Copy";
      button.title = label;
      button.setAttribute("aria-label", label);
    };
    reset();
    button.addEventListener("mouseleave", reset);
    button.addEventListener("focusout", reset);
    controls.appendChild(button);
    button.addEventListener("click", async (event) => {
      button.disabled = true;
      let message = "Copied!";
      try {
        await navigator.clipboard.writeText(getText(event));
        caption.textContent = message;
        button.dataset.state = "success";
      } catch {
        caption.textContent = "Failed";
        button.dataset.state = "error";
        message = "Copy failed. Check clipboard access.";
      } finally {
        button.disabled = false;
        button.title = `${message} ${label}`;
        button.setAttribute("aria-label", button.title);
      }
    });
  };

  // --- PARSING ---
  const splitLines = (source) => {
    if (typeof source !== "string") throw new TypeError("Diff inputs must be strings.");
    if (source.length > 2000000) throw new RangeError("Each diff input is limited to 2 million characters.");
    const normalized = source.replace(/\r\n?/g, "\n");
    const lines = normalized.match(/[^\n]*\n|[^\n]+$/g) || [];
    // Keep the final blank line separate from the preceding line's text.
    if (normalized.endsWith("\n")) lines.push("");
    if (lines.length > 20000) throw new RangeError("Each diff input is limited to 20,000 lines.");
    return lines;
  };
  // Yield comparison checkpoints and return a bounded Myers edit script with original line payloads.
  function* compare(oldSource, newSource, options = {}) {
    const before = splitLines(oldSource),
      after = splitLines(newSource);
    // Comparison keys may ignore whitespace; operation payloads keep both original line texts.
    const key = (line) => {
      const text = line.endsWith("\n") ? line.slice(0, -1) : line;
      return options.ignoreWhitespace === "all" ? text.replace(/\s/g, "") : options.ignoreWhitespace === "trim" ? text.trim() : text;
    };
    const a = before.map(key),
      b = after.map(key);
    const operation = (type, x, y) => ({ type, oldLine: x === null ? null : x + 1, newLine: y === null ? null : y + 1, oldText: x === null ? null : before[x], newText: y === null ? null : after[y] });
    let prefix = 0,
      suffix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    const n = a.length - prefix - suffix,
      m = b.length - prefix - suffix;
    const output = [];
    for (let i = 0; i < prefix; i++) output.push(operation("equal", i, i));
    if (!n || !m) {
      for (let i = 0; i < n; i++) output.push(operation("delete", prefix + i, null));
      for (let i = 0; i < m; i++) output.push(operation("insert", null, prefix + i));
    } else {
      // Myers tracks the furthest match on each diagonal; saved frontiers reconstruct the edit path.
      const trace = [],
        frontier = new Map([[1, 0]]);
      let work = 0,
        distance = -1;
      search: for (let d = 0; d <= Math.min(n + m, 1000); d++) {
        trace.push(new Map(frontier));
        for (let k = -d; k <= d; k += 2) {
          let x = k === -d || (k !== d && (frontier.get(k - 1) ?? -1) < (frontier.get(k + 1) ?? -1)) ? (frontier.get(k + 1) ?? 0) : (frontier.get(k - 1) ?? 0) + 1;
          let y = x - k;
          while (x < n && y < m && a[prefix + x] === b[prefix + y]) {
            x++;
            y++;
            work++;
          }
          frontier.set(k, x);
          work++;
          if (work > 4000000) throw new RangeError("Diff exceeded its comparison budget; compare smaller sections.");
          if (x >= n && y >= m) {
            distance = d;
            break search;
          }
        }
        if (d % 20 === 0) yield;
      }
      if (distance < 0) throw new RangeError("Diff exceeds 1,000 edits in the changed region; compare smaller sections.");
      let x = n,
        y = m;
      const edits = [];
      for (let d = distance; d >= 0; d--) {
        const previous = trace[d],
          k = x - y;
        const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0,
          previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          edits.push(operation("equal", prefix + x - 1, prefix + y - 1));
          x--;
          y--;
        }
        if (d === 0) break;
        if (x === previousX) {
          edits.push(operation("insert", null, prefix + y - 1));
          y--;
        } else {
          edits.push(operation("delete", prefix + x - 1, null));
          x--;
        }
      }
      output.push(...edits.reverse());
    }
    for (let i = suffix; i > 0; i--) output.push(operation("equal", a.length - i, b.length - i));
    return output;
  }

  // --- RENDERING ---
  // Align replacements within each change block without changing the public edit list.
  const pairChanges = (edits) => {
    const rows = [];
    for (let index = 0; index < edits.length; ) {
      if (edits[index].type === "equal") {
        rows.push(edits[index++]);
        continue;
      }
      const removed = [],
        added = [];
      while (index < edits.length && edits[index].type !== "equal") {
        const edit = edits[index++];
        (edit.type === "delete" ? removed : added).push(edit);
      }
      for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
        const old = removed[offset],
          next = added[offset];
        rows.push({
          type: old && next ? "change" : old ? "delete" : "insert",
          oldText: old?.oldText ?? null,
          oldLine: old?.oldLine ?? null,
          newText: next?.newText ?? null,
          newLine: next?.newLine ?? null
        });
      }
    }
    return rows;
  };

  // --- LIFECYCLE ---
  // One instance owns the container; replacement disposes its pending work first.
  // Replace the previous owner and return its cancellable state. Only the current owner may clear the host.
  const mount = (element, options, getText) => {
    if (!(element instanceof HTMLElement)) throw new TypeError("byDIFFviewer: element must be an HTMLElement.");
    applyAppearance(element, options);
    const painted = element.classList.contains("byVIEWready");
    instances.get(element)?.destroy();
    const state = { active: true };
    state.destroy = () => {
      if (!state.active) return;
      state.active = false;
      cancelAnimationFrame(state.motionFrame);
      if (instances.get(element) === state) {
        instances.delete(element);
        element.replaceChildren();
        element.classList.remove("byDIFFdocument", "byVIEWcompact", "byVIEWbottom", "byVIEWmotion", "byVIEWappear", "byVIEWready");
        element.removeAttribute("aria-busy");
      }
    };
    instances.set(element, state);
    element.replaceChildren();
    element.classList.add("byDIFFdocument");
    element.classList.toggle("byVIEWmotion", options.animations !== false);
    element.classList.toggle("byVIEWappear", options.animations !== false && options.appearAnimation === true);
    if (painted) element.classList.add("byVIEWready");
    else {
      // Enable background transitions after the first paint without forcing layout.
      state.motionFrame = requestAnimationFrame(() => {
        state.motionFrame = requestAnimationFrame(() => {
          if (state.active) element.classList.add("byVIEWready");
        });
      });
    }
    element.classList.toggle("byVIEWplain", options.displayContainer === false);
    element.classList.toggle("byVIEWcompact", options.controlsCompact !== false);
    element.classList.toggle("byVIEWbottom", options.controlsPosition === "bottom");
    const content = node("div", "byVIEWcontent");
    const toolbar = node("div", "byVIEWtoolbar");
    toolbar.dataset.size = ["xs", "small", "regular", "large", "xl"].includes(options.controlsSize) ? options.controlsSize : "regular";
    const info = node("small", "byVIEWinfo");
    for (const [text, href] of [
      ["easy-diff-viewer", "https://github.com/byuwur/easy-diff-viewer"],
      ["@byUwUr", "https://byuwur.co"]
    ]) {
      const link = node("a", "", text);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (info.childNodes.length) info.append(` · v${byDIFFviewer.VERSION} · `);
      info.appendChild(link);
    }
    if (options.credits !== false) toolbar.appendChild(info);
    const controls = node("div", "byVIEWcontrols");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Viewer controls");
    if (options.themeToggle !== false) appendThemeToggle(element, controls, "diff");
    if (options.fontSizeControls !== false) appendFontSizeControls(element, controls);
    if (options.copyButton !== false) appendCopyButton(controls, getText, "Copy source");
    if (controls.childNodes.length) toolbar.appendChild(controls);
    if (options.toolbar === false || !toolbar.childNodes.length) {
      element.classList.remove("byVIEWbottom");
      element.appendChild(content);
    } else element.append(...(options.controlsPosition === "bottom" ? [content, toolbar] : [toolbar, content]));
    state.content = content;
    state.error = (error) => {
      if (!state.active) return;
      element.setAttribute("aria-busy", "false");
      const message = node("p", "byVIEWerror", error.message);
      message.setAttribute("role", "alert");
      content.replaceChildren(message);
    };
    return state;
  };

  // --- PUBLIC API ---
  // Compare two strings without executing either. ready resolves after the first display batch.
  function byDIFFviewer(element, oldSource, newSource, options = {}) {
    if (typeof oldSource !== "string" || typeof newSource !== "string") throw new TypeError("Diff inputs must be strings.");
    options = { view: "unified", lineNumbers: true, batchSize: 500, ...options };
    options.batchSize = positive(options.batchSize, 500, 2000);
    const state = mount(element, options, () => newSource);
    element.setAttribute("aria-busy", "true");
    const actions = node("div", "byVIEWactions");
    let view = options.view === "split" ? "split" : "unified";
    const viewControl = node("div", "byVIEWsegments");
    viewControl.setAttribute("role", "group");
    viewControl.setAttribute("aria-label", "Diff view");
    const viewName = `byDIFFview-${++nextViewId}`;
    for (const [value, label] of [
      ["unified", "Unified"],
      ["split", "Side by side"]
    ]) {
      const choice = node("label");
      const input = node("input");
      input.type = "radio";
      input.name = viewName;
      input.value = value;
      input.checked = value === view;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        view = value;
        render();
      });
      choice.append(input, node("span", "", label));
      viewControl.appendChild(choice);
    }
    if (options.viewSelect === true) actions.appendChild(viewControl);
    if (options.copyOldButton === true) copyButton(actions, () => oldSource, "Copy old source", "Copy old");
    const status = node("p", "byVIEWstatus", "Comparing…");
    status.setAttribute("role", "status");
    const scroll = node("div", "byDIFFscroll");
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Text comparison");
    const table = node("table", "byDIFFtable");
    table.setAttribute("aria-label", "Line differences");
    scroll.appendChild(table);
    let edits = [],
      splitEdits = [],
      shown = options.batchSize;
    const more = button(state.content, "Load more", "Load more differences", () => {
      shown += options.batchSize;
      render();
    });
    const panel = node("div", "byVIEWpanel");
    panel.append(status, scroll);
    state.content.replaceChildren(actions, panel, more);
    const appendLineText = (cell, text, kind) => {
      const source = text ?? "";
      cell.appendChild(node("span", "byDIFFtext", source.endsWith("\n") ? source.slice(0, -1) : source));
      if (text === "" && kind !== "equal") cell.appendChild(node("small", "byDIFFnewline", "Newline at end of file"));
      else if (text && !source.endsWith("\n")) cell.appendChild(node("small", "byDIFFnoNewline", "No newline at end of file"));
    };
    const addCell = (row, text, number, kind) => {
      if (options.lineNumbers !== false) {
        const gutter = node("td", "byDIFFnumber", number ?? "");
        gutter.setAttribute("aria-label", number === null ? "No line" : `Line ${number}`);
        row.appendChild(gutter);
      }
      const cell = node("td", `byDIFFcode byDIFF${kind}`);
      appendLineText(cell, text, kind);
      row.appendChild(cell);
    };
    // --- RENDERING ---
    const render = () => {
      if (!state.active) return;
      const head = node("thead"),
        heading = node("tr");
      head.appendChild(heading);
      for (const label of view === "split" ? ["Old", "New"] : ["Old line", "New line", "Change", "Text"]) {
        if (view === "unified" && options.lineNumbers === false && /line$/.test(label)) continue;
        const th = node("th", "", label);
        th.scope = "col";
        if (view === "split" && options.lineNumbers !== false) th.colSpan = 2;
        heading.appendChild(th);
      }
      const body = node("tbody");
      const rows = view === "split" ? splitEdits : edits;
      for (const edit of options.loadMore === false ? rows : rows.slice(0, shown)) {
        const row = node("tr", `byDIFF${edit.type}`);
        if (view === "split") {
          addCell(row, edit.oldText, edit.oldLine, edit.type !== "equal" && edit.oldText !== null ? "delete" : "equal");
          addCell(row, edit.newText, edit.newLine, edit.type !== "equal" && edit.newText !== null ? "insert" : "equal");
        } else {
          if (options.lineNumbers !== false) {
            row.append(node("td", "byDIFFnumber", edit.oldLine ?? ""), node("td", "byDIFFnumber", edit.newLine ?? ""));
          }
          const marker = node("td", "byDIFFmarker", edit.type === "insert" ? "+" : edit.type === "delete" ? "−" : " ");
          marker.setAttribute("aria-label", edit.type);
          row.appendChild(marker);
          const code = node("td", "byDIFFcode");
          const text = edit.type === "delete" ? edit.oldText : edit.newText;
          appendLineText(code, text, edit.type);
          row.appendChild(code);
        }
        body.appendChild(row);
      }
      table.dataset.view = view;
      table.replaceChildren(head, body);
      more.hidden = options.loadMore === false || shown >= rows.length;
      status.hidden = options.statusBar === false && edits.length > 0;
      const inserted = edits.filter((edit) => edit.type === "insert").length,
        deleted = edits.filter((edit) => edit.type === "delete").length;
      status.textContent = edits.length ? `${inserted} additions · ${deleted} deletions · ${options.loadMore === false ? rows.length : Math.min(shown, rows.length)} of ${rows.length} rows displayed` : "Both inputs are empty.";
      element.setAttribute("aria-busy", "false");
    };
    state.ready = (async () => {
      try {
        await pause();
        const iterator = compare(oldSource, newSource, options);
        let step;
        do {
          if (!state.active) return false;
          step = iterator.next();
          if (!step.done) await pause();
        } while (!step.done);
        edits = step.value;
        splitEdits = pairChanges(edits);
        render();
        return state.active;
      } catch (error) {
        state.error(error);
        return false;
      }
    })();
    return { ready: state.ready, destroy: state.destroy };
  }

  byDIFFviewer.diff = (oldSource, newSource, options = {}) => {
    const iterator = compare(oldSource, newSource, options);
    let step;
    do {
      step = iterator.next();
    } while (!step.done);
    return step.value;
  };
  // --- EXPORT ---
  global.byDIFFviewer = byDIFFviewer;
  byDIFFviewer.initialized = true;
})(typeof window !== "undefined" ? window : this);
