# byuwur/easy-diff-viewer

![easy-diff-viewer preview](prev.jpg)

**Diff, spot what changed.**

Compare two strings in a unified or side-by-side view, with line numbers and exact source copying.

Use it for configuration changes, before/after snapshots, and text revisions.

One JavaScript file. One scoped stylesheet. No build step. Plain JavaScript, with no runtime dependencies.

[Open the playground](https://byuwur.github.io/easy-diff-viewer/)

Open `index.html` for the local playground; its page assets require internet access.

## Installation and usage

**Recommended: CDN.** No downloads or package manager.

```html
<link href="https://cdn.jsdelivr.net/gh/byuwur/easy-diff-viewer@latest/diff.css" rel="stylesheet" />
<script src="https://cdn.jsdelivr.net/gh/byuwur/easy-diff-viewer@latest/diff.js" defer></script>
<div id="viewer" data-theme="light"></div>
<script>
  document.addEventListener("DOMContentLoaded", () => {
    byDIFFviewer(document.getElementById("viewer"), "before\n", "after\n", { view: "split" });
  });
</script>
```

The CDN example uses `@latest` and requires internet access. Use a published tag or commit to pin a version.

**Local files:** For offline use, save `diff.js` and `diff.css` beside your HTML:

```html
<link href="diff.css" rel="stylesheet" />
<script src="diff.js" defer></script>
```

Exported HTML starters use default settings, independently of playground changes.

## API and comparison contract

`byDIFFviewer(element, oldText, newText, options?)` requires two strings. Invalid types/target throw `TypeError`. Comparison errors are displayed, and `ready` resolves false.

The main Copy button copies the exact new input; Copy old copies the exact old input. Display line endings normalize CR/LF/CRLF to LF; copying keeps the originals.

`byDIFFviewer.diff(oldText, newText, options?)` synchronously returns an array of `{ type, oldLine, newLine, oldText, newText }`. Types are `equal`, `delete`, and `insert`. Line numbers start at 1; an absent side is null. Text includes its normalized line terminator where present. Concatenating non-null `oldText` or `newText` reconstructs the corresponding normalized input. Equal lines may contain different text when whitespace is ignored or only their newline terminators differ. A trailing newline adds an empty final line. Invalid input throws `TypeError`/`RangeError`.

The engine uses Myers' shortest edit script. Shifted and repeated lines are compared as sequences. Line text is compared separately from its terminator, so adding or removing a final newline changes the empty final line instead of replacing unchanged text. Whitespace options apply to line text. Empty input has zero lines.

Intraline/word diff, file parsing, and patch application are unsupported.

## Diff options and limits

| Option             | Default     | Behavior                                                                                                                                                          |
| ------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view`             | `"unified"` | `"unified"` or `"split"`; invalid values use `"unified"`.                                                                                                         |
| `lineNumbers`      | `true`      | Show old/new line numbers.                                                                                                                                        |
| `ignoreWhitespace` | none        | `"trim"` ignores leading/trailing whitespace per line; `"all"` ignores whitespace within lines too. Other values compare exactly. Original line text is retained. |
| `batchSize`        | `500`       | Initial/per Load more displayed row count, integer 1–2000; invalid values use 500.                                                                                |

Each input is limited to 2 million characters and 20,000 lines, including the empty final line when present. After matching prefixes/suffixes are trimmed, the changed region allows at most 1,000 edits and 4 million comparison operations. Empty-sided regions are handled directly. Exceeding a limit displays an error; compare smaller sections for large rewrites.

Trace memory grows quadratically with edit distance within these limits. The viewer yields during comparison and mounts one batch initially; `.diff()`, line splitting, prefix trimming, and individual search steps are synchronous.

Use `--by-diff-add` and `--by-diff-remove` on `.byDIFFdocument` to customize change colors alongside the shared variables below.

## Shared controls and lifecycle

| Option             | Default     | Behavior                                                                                                             |
| ------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `animations`       | `true`      | Brief control/disclosure motion. `true` enables it and `false` disables it, overriding the system motion preference. |
| `toolbar`          | `true`      | Show the viewer header; secondary tools are configured separately.                                                   |
| `credits`          | `true`      | Show attribution in the header.                                                                                      |
| `statusBar`        | `true`      | Show counts and metadata. Loading, errors, and empty results remain visible.                                         |
| `viewSelect`       | `false`     | Show segmented Unified / Side by side buttons.                                                                       |
| `copyOldButton`    | `false`     | Show a separate button to copy the old source.                                                                       |
| `loadMore`         | `true`      | Load differences in batches; false displays every line.                                                              |
| `theme`            | Container   | Initial `"light"` or `"dark"` mode class.                                                                            |
| `palette`          | Container   | Initial `data-theme` palette, including custom CSS names.                                                            |
| `fontSize`         | Container   | Number in rem or a CSS size such as `"1.25em"` or `"20px"`; bounded to `0.5rem`–`3rem`.                              |
| `themeToggle`      | `true`      | Show the theme toggle.                                                                                               |
| `fontSizeControls` | `true`      | Show text-size controls.                                                                                             |
| `copyButton`       | `true`      | Show full source copy button.                                                                                        |
| `controlsSize`     | `"regular"` | `"small"`, `"regular"`, or `"large"`; invalid values use `"regular"`.                                                |
| `controlsCompact`  | `true`      | Keep credits beside controls; `false` stacks them. Wraps as needed.                                                  |
| `controlsPosition` | `"top"`     | Sticky `"top"` or `"bottom"` toolbar; invalid values use `"top"`.                                                    |

The controller exposes `ready` and `destroy()`. `ready` resolves `true` after initial rendering, or `false` on a displayed data error or cancellation. Invalid targets/options can throw synchronously.

`ready` describes the initial render only; it does not track later view changes or Load more actions.

```javascript
const viewer = byDIFFviewer(target, before, after, { view: "split" });
const rendered = await viewer.ready; // false on data errors or cancellation.
viewer.destroy(); // Call when the host panel is removed.
```

Re-rendering disposes the previous instance. `destroy()` cancels pending work and clears the target only if the instance still owns it. Duplicate script loads preserve the API. Read its version with `byDIFFviewer.VERSION`.

Input is displayed as text, never executed. Style `.byDIFFdocument` with `--by-view-bg`, `--by-view-text`, `--by-view-muted`, `--by-view-border`, `--by-view-accent`, `--by-view-alt`, `--by-view-string`, and `--by-view-literal`. The container uses system-ui; source/tree content uses monospace. Override the class or target's inline font/size as needed.

In split view, adjacent removed and added lines share rows. Unmatched lines have an empty cell opposite them. Batches count displayed rows so replacements stay together.

Copy requires clipboard permission in a secure context.

Requires a modern browser with async functions, WeakMap, ES2022 array methods, and CSS variables. Tests run in Chromium; other engines are unverified.

`--by-view-content-font` and `--by-view-line-height` set source/tree typography.

Use `toolbar: false` to hide the header, or disable `credits`, `themeToggle`, `fontSizeControls`, and `copyButton` individually. Content actions such as search and format-specific buttons use their own options.

Controls use monospace by default; override `--by-view-controls-font` to change it.

## Themes

Configure appearance in the options object or on the container:

```javascript
byDIFFviewer(target, oldSource, newSource, {
  theme: "dark",
  palette: "github",
  fontSize: 1.125
});
```

`theme` sets the mode class; `palette` sets `data-theme`. `fontSize` numbers use rem (`1` = the root text size); CSS sizes such as `"1.25em"`, `"1.25rem"`, and `"20px"` are also accepted. All sizes stay between `0.5rem` and `3rem`. Explicit options override markup; omitted or `null` values retain the container's settings. A named palette preserves its existing mode, including the `data-theme="light"` / `"dark"` aliases. Invalid appearance values throw `RangeError` before replacing the current document. Text-size Reset returns to the configured size, including after re-rendering.

Initial content appears immediately. Animations affect controls and deliberate show/hide actions; rows, tokens, and typing are not animated. Disclosure size/exit transitions progressively enhance browsers that support them.

The outer document and inner surfaces have independent CSS backgrounds. Both follow the selected theme unless overridden. Set `--by-view-document-bg: #0000` to reveal the host page while keeping content panels and individual controls readable. `--by-view-container-bg` sets the shared background of those panels and controls; it also accepts alpha colors or `transparent`. The toolbar and credits have no background. These overrides survive theme changes.

```css
.byDIFFdocument {
  --by-view-document-bg: #0000;
}
```

The playground uses SPA.js's Pickr assets for color and opacity, with text inputs when Pickr is unavailable. **Copy CSS** exports the appearance overrides; clear a field to restore its theme default. The renderer needs no color-picker dependency.

`diff.css` includes all palettes in Light and Dark. Monokai is the default.

| Palette           | `data-theme`    | What it looks like                                                |
| ----------------- | --------------- | ----------------------------------------------------------------- |
| Monokai (default) | `monokai`       | Warm light and dark colors.                                       |
| GitHub            | `github`        | Familiar neutral surfaces and syntax colors.                      |
| Solarized         | `solarized`     | Warm light or deep blue-green dark surfaces.                      |
| High Contrast     | `high-contrast` | Black/white surfaces, strong text, borders, and focus indicators. |

Use a mode class and a palette name together:

```html
<div id="viewer" class="dark" data-theme="github"></div>
<!-- High Contrast Light: class="light" data-theme="high-contrast" -->
<!-- High Contrast Dark: class="dark" data-theme="high-contrast" -->
```

Rendering adds `.byDIFFdocument`; its variables affect only that container and its children. The theme switch changes mode while keeping the palette; re-rendering preserves both. A named palette without a mode class starts in Light; if both mode classes are present, Dark wins.

`data-theme="light"` and `data-theme="dark"` select Monokai and override mode classes. A mode class alone, or no explicit theme, also uses Monokai.

### High Contrast

High Contrast text colors target at least [7:1 contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html), with [3:1 contrast for control boundaries and focus cues](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Check contrast again when you override colors.

### Make it yours

The playground's **Custom theme CSS** field edits both modes of the selected palette. Export those rules to your own stylesheet and use `data-theme="custom"` with `class="light"` or `class="dark"`. Custom drafts stay in the playground; the renderer does not store them.

Define a named palette after the viewer stylesheet. Unspecified colors inherit Monokai:

```css
.byDIFFdocument.light[data-theme="ocean"] {
  --by-view-bg: #f3f8fc;
  --by-view-text: #102a43;
  --by-view-border: #486581;
  --by-view-accent: #005a9c;
}

.byDIFFdocument.dark[data-theme="ocean"] {
  --by-view-bg: #102a43;
  --by-view-text: #f0f6fc;
  --by-view-border: #9fb3c8;
  --by-view-accent: #8cd3ff;
}
```

```html
<div id="viewer" class="dark" data-theme="ocean"></div>
```

Named palettes need no JavaScript registration or extra theme files.

In the playground configuration, `theme` is the mode, `palette` is its name, and `customThemeCSS` holds custom rules. Null appearance values inherit defaults. Pass only documented API options to the renderer.

**Copy CSS** exports typography and individual color overrides. Inline colors override palette variables; clear them or Reset to restore palette defaults.

Text-size controls change only this viewer, in `0.125rem` steps from `0.5rem` to `3rem`, independently of button size. **A** restores its initial size; re-rendering preserves the selected size.

### Legacy theme links

Legacy integrations can use `#byVIEWtheme` or a detected `diff.light.css` / `diff.dark.css` link. The toggle keeps its path, query, and hash and updates viewers sharing the link. Explicit container themes stay independent. Separate theme files are no longer shipped; retain your hosted legacy files to use this alternative.

## Checks

Theme tests cover both modes, container isolation, legacy links, custom CSS, and High Contrast. Clipboard tests use stubs; they do not verify real permissions.

Playground tests fetch the pinned Bootstrap stylesheet unless `BOOTSTRAP_CSS_PATH` points to a cached copy.

Install Playwright outside the repository and set `NODE_PATH` to its `node_modules` directory:

```sh
node --check diff.js
node --test tests/rendering.cjs   # Library
node --test tests/playground.cjs  # Playground
```

`BROWSER_CHANNEL=chrome` uses installed Chrome; `CHROMIUM_EXECUTABLE_PATH` selects a Chromium executable. Otherwise, install Playwright Chromium. [GitHub Actions](.github/workflows/rendering.yml) reports Library and Playground as independent jobs; a failed suite does not cancel the other.

## The easy viewers

Need another format, or a Markdown editor? Explore the family:

[Markdown](https://github.com/byuwur/easy-md-viewer) · [JSON](https://github.com/byuwur/easy-json-viewer) · [CSV & TSV](https://github.com/byuwur/easy-csv-viewer) · [Logs](https://github.com/byuwur/easy-log-viewer) · [Diff](https://github.com/byuwur/easy-diff-viewer) · [XML](https://github.com/byuwur/easy-xml-viewer) · [YAML](https://github.com/byuwur/easy-yaml-viewer) · [Source code](https://github.com/byuwur/easy-code-viewer)

[Write Markdown with easy-md-editor](https://github.com/byuwur/easy-md-editor).

## License

MIT (c) 2026 Andres Trujillo [Mateus] byUwUr. See [LICENSE](LICENSE).
