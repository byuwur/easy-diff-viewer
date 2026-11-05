/*
 * File: tests/rendering.cjs
 * Desc: DIFF library contracts using local renderer assets; playground checks live in playground.cjs.
 */

/* --- DEPENDENCIES --- */
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

/* --- THEME FIXTURES --- */
// Caller-provided legacy stylesheets reuse the canonical palettes without distribution files.
const legacyThemeCSS = (theme) => {
  const css = require("node:fs").readFileSync(path.join(__dirname, "../diff.css"), "utf8");
  const section = css.split(`/* --- ${theme.toUpperCase()} --- */`)[1];
  return `.byDIFFdocument {${section.match(/\{([\s\S]*?)\}/)[1]}}`;
};

/* --- STANDALONE RENDERER --- */
test("DIFF standalone browser contracts", async (t) => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    const errors = [],
      requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith("http://viewer.test/")) requests.push(request.url());
    });
    // This generated host exercises the library without reading the playground's index.html.
    await page.route("http://viewer.test/**", (route) => {
      const filename = new URL(route.request().url()).pathname.slice(1);
      if (/^diff\.(light|dark)\.css$/.test(filename)) return route.fulfill({ body: legacyThemeCSS(filename.includes(".dark.css") ? "dark" : "light"), contentType: "text/css" });
      if (!filename || filename === "fixture.html")
        return route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="diff.css"><script src="diff.js"></script><div id="viewer" data-theme="light"></div>'
        });
      return route.fulfill({ path: path.join(__dirname, "..", filename), contentType: filename.endsWith(".css") ? "text/css" : "text/javascript" });
    });
    await page.goto("http://viewer.test/fixture.html");
    await page.evaluate(
      async ({ source, second, options }) => {
        await byDIFFviewer(document.getElementById("viewer"), source, second, options).ready;
      },
      {
        source: "A small document\nKeep this line\nOld wording\nLast line\n",
        second: "A small document\nAn added line\nKeep this line\nNew wording\nLast line\n",
        options: { fontSizeControls: true, view: "unified", lineNumbers: true, ignoreWhitespace: false, batchSize: 500 }
      }
    );
    await page.waitForFunction(() => document.getElementById("viewer")?.getAttribute("aria-busy") !== "true" && typeof window.byDIFFviewer === "function");
    await page.evaluate(() => {
      window.root = document.getElementById("viewer");
      window.copies = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => copies.push(value) } });
    });
    await t.test("themes, copy, font size, and responsive controls", async () => {
      assert.equal(await page.locator("#viewer [role=alert]:visible").count(), 0);
      await page.locator(".byVIEWcopy").click();
      assert.equal(await page.evaluate(() => typeof copies.at(-1)), "string");
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
      await page.waitForFunction(() => getComputedStyle(root).backgroundColor === "rgb(39, 40, 34)");
      await page.getByRole("button", { name: "Increase text size" }).click();
      assert.equal(await page.evaluate(() => root.style.fontSize), "1.125rem");
      await page.setViewportSize({ width: 320, height: 640 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width: 1100, height: 800 });
      await page.getByRole("button", { name: "Reset text size" }).click();
    });
    await t.test("clipboard denial is reported", async () => {
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new Error("denied");
        };
      });
      await page.locator(".byVIEWcopy").click();
      assert.equal(await page.locator(".byVIEWcopy").textContent(), "Failed");
      await page.evaluate(() => {
        navigator.clipboard.writeText = async (value) => copies.push(value);
      });
    });

    await t.test("Myers edits reconstruct both inputs and match a small LCS oracle", async () => {
      const result = await page.evaluate(() => {
        let seed = 7;
        const random = (n) => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed % n;
        };
        const input = () => Array.from({ length: random(9) }, () => String(random(4))).join("\n") + (random(2) ? "\n" : "");
        for (let sample = 0; sample < 400; sample++) {
          const before = input(),
            after = input();
          const a = before ? before.split("\n") : [],
            b = after ? after.split("\n") : [];
          const edits = byDIFFviewer.diff(before, after);
          if (edits.map((e) => e.oldText ?? "").join("") !== before || edits.map((e) => e.newText ?? "").join("") !== after) return `Reconstruction ${sample}`;
          const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
          for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
          if (edits.filter((e) => e.type !== "equal").length !== a.length + b.length - 2 * dp[a.length][b.length]) return `Minimality ${sample}`;
          if (edits.some((e) => e.type === "equal" && e.oldText.replace(/\n$/, "") !== e.newText.replace(/\n$/, ""))) return `False equality ${sample}`;
          if (edits.filter((e) => e.oldLine !== null).some((e, index) => e.oldLine !== index + 1) || edits.filter((e) => e.newLine !== null).some((e, index) => e.newLine !== index + 1)) return `Line numbers ${sample}`;
        }
        return true;
      });
      assert.equal(result, true);
    });
    await t.test("insertions, deletion, CRLF, final newline, and whitespace modes", async () => {
      const result = await page.evaluate(() => ({
        shift: byDIFFviewer.diff("a\nb\nc\n", "x\na\nb\nc\n").map((e) => e.type),
        empty: byDIFFviewer.diff("", ""),
        newline: byDIFFviewer.diff("a\n", "a").map((e) => e.type),
        crlf: byDIFFviewer.diff("a\r\nb\r", "a\nb\n").every((e) => e.type === "equal"),
        trim: byDIFFviewer.diff(" a b \n", "a b\n", { ignoreWhitespace: "trim" }).length,
        all: byDIFFviewer.diff(" a b \n", "ab\n", { ignoreWhitespace: "all" }).every((e) => e.type === "equal")
      }));
      assert.deepEqual(result, { shift: ["insert", "equal", "equal", "equal", "equal"], empty: [], newline: ["equal", "delete"], crlf: true, trim: 2, all: true });
    });
    await t.test("unified/split view, line numbers, and exact copying", async () => {
      await page.evaluate(async () => {
        await byDIFFviewer(root, "old\r\n", "new", { viewSelect: true, copyOldButton: true }).ready;
      });
      assert.equal(
        await page
          .locator("th")
          .first()
          .evaluate((cell) => getComputedStyle(cell).whiteSpace),
        "nowrap"
      );
      assert.equal(await page.locator("tbody tr").count(), 3);
      assert.equal(await page.locator(".byDIFFnoNewline").count(), 1);
      await page.getByRole("radio", { name: "Side by side", exact: true }).check();
      assert.equal(await page.locator('table[data-view="split"] tbody tr:first-child td').count(), 4);
      await page.getByRole("button", { name: "Copy old source", exact: true }).click();
      assert.equal(await page.evaluate(() => copies.at(-1)), "old\r\n");
      await page.locator(".byVIEWcopy").click();
      assert.equal(await page.evaluate(() => copies.at(-1)), "new");
    });
    await t.test("multi-digit line numbers stay on one line in unified and split views", async () => {
      for (const view of ["unified", "split"]) {
        for (const fontSize of ["1rem", "1.5rem"]) {
          const result = await page.evaluate(
            async ({ view, fontSize }) => {
              const source = Array.from({ length: 123 }, (_, index) => `Line ${index + 1}`).join("\n");
              const previousWidth = root.style.width,
                previousFontSize = root.style.fontSize;
              root.style.width = "20rem";
              root.style.fontSize = fontSize;
              await byDIFFviewer(root, source, source, { view, loadMore: false }).ready;
              const cells = [...root.querySelectorAll(".byDIFFnumber")].filter((cell) => ["10", "100", "123"].includes(cell.textContent));
              const failures = cells
                .filter((cell) => {
                  const range = document.createRange();
                  range.selectNodeContents(cell);
                  const style = getComputedStyle(cell);
                  const available = cell.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
                  return range.getClientRects().length !== 1 || range.getBoundingClientRect().width > available + 0.1;
                })
                .map((cell) => cell.textContent);
              root.style.width = previousWidth;
              root.style.fontSize = previousFontSize;
              return { count: cells.length, failures };
            },
            { view, fontSize }
          );
          assert.deepEqual(result, { count: 6, failures: [] }, `${view}, ${fontSize}: digits must fit without wrapping or clipping`);
        }
      }
    });
    await t.test("safe text, malformed API, empty input, and comparison limits", async () => {
      const result = await page.evaluate(async () => {
        let invalid = false;
        try {
          byDIFFviewer(root, 42, "");
        } catch (error) {
          invalid = error instanceof TypeError;
        }
        await byDIFFviewer(root, "", '<img src=x onerror="window.injected=1">', { view: "split", lineNumbers: false }).ready;
        const safe = !root.querySelector("img") && !window.injected && !root.querySelector(".byDIFFnumber");
        const empty = await byDIFFviewer(root, "", "").ready;
        const emptyRows = root.querySelectorAll("tbody tr").length;
        const limited = await byDIFFviewer(root, Array.from({ length: 510 }, (_, i) => `a${i}\n`).join(""), Array.from({ length: 510 }, (_, i) => `b${i}\n`).join("")).ready;
        return { invalid, safe, empty, emptyRows, limited, alert: Boolean(root.querySelector("[role=alert]")) };
      });
      assert.deepEqual(result, { invalid: true, safe: true, empty: true, emptyRows: 0, limited: false, alert: true });
    });
    await t.test("large similar inputs, batching, replacement, and disposal", async () => {
      const result = await page.evaluate(async () => {
        const source = Array.from({ length: 12000 }, (_, i) => `Line ${i}\n`).join("");
        const view = byDIFFviewer(root, source, `inserted\n${source}`);
        const ready = await view.ready;
        const rows = root.querySelectorAll("tbody tr").length;
        const old = byDIFFviewer(root, source, source);
        const current = byDIFFviewer(root, "a", "b");
        const cancelled = await old.ready;
        await current.ready;
        old.destroy();
        const preserved = root.childNodes.length > 0;
        current.destroy();
        return { ready, rows, cancelled, preserved, disposed: root.childNodes.length === 0 };
      });
      assert.deepEqual(result, { ready: true, rows: 500, cancelled: false, preserved: true, disposed: true });
    });

    await t.test("split replacements align, keep context, and remain paired across batches", async () => {
      const oldSource = "A small document\nKeep this line\nOld wording\nLast line\n";
      const newSource = "A small document\nAn added line\nKeep this line\nNew wording\nLast line\n";
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          async ({ oldSource, newSource, theme }) => {
            root.dataset.theme = theme;
            await byDIFFviewer(root, oldSource, newSource, { view: "split", viewSelect: true }).ready;
          },
          { oldSource, newSource, theme }
        );
        assert.deepEqual(await page.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => cell.querySelector(".byDIFFtext")?.textContent ?? cell.textContent))), [
          ["1", "A small document", "1", "A small document"],
          ["", "", "2", "An added line"],
          ["2", "Keep this line", "3", "Keep this line"],
          ["3", "Old wording", "4", "New wording"],
          ["4", "Last line", "5", "Last line"],
          ["5", "", "6", ""]
        ]);
        assert.equal(await page.locator("tbody tr.byDIFFchange .byDIFFdelete").count(), 1);
        assert.equal(await page.locator("tbody tr.byDIFFchange .byDIFFinsert").count(), 1);
      }
      await page.evaluate(async () => {
        await byDIFFviewer(root, "old one\nold two\n", "new one\nnew two\nnew three\n", { view: "split", batchSize: 1, statusBar: true, viewSelect: true }).ready;
      });
      for (const count of [1, 2, 3, 4]) {
        assert.equal(await page.locator("tbody tr").count(), count);
        if (count < 4) {
          if (count < 3)
            assert.equal(
              await page
                .locator("tbody tr")
                .nth(count - 1)
                .locator(".byDIFFcode")
                .allTextContents()
                .then((cells) => cells.every(Boolean)),
              true
            );
          await page.getByRole("button", { name: "Load more differences" }).click();
        }
      }
      assert.deepEqual(await page.locator("tbody tr").nth(2).locator(".byDIFFcode").allTextContents(), ["", "new three"]);
      assert.deepEqual(await page.locator("tbody tr").last().locator(".byDIFFtext").allTextContents(), ["", ""]);
      assert.match(await page.locator(".byVIEWpanel > .byVIEWstatus").textContent(), /4 of 4 rows/);
      assert.equal(await page.getByRole("button", { name: "Load more differences" }).isVisible(), false);
      await page.getByRole("radio", { name: "Unified", exact: true }).check();
      assert.equal(await page.locator(".byDIFFtable").getAttribute("data-view"), "unified");
      await page.getByRole("radio", { name: "Unified", exact: true }).press("ArrowRight");
      assert.equal(await page.locator(".byDIFFtable").getAttribute("data-view"), "split");
      await page.evaluate(async () => {
        const other = document.createElement("div");
        other.id = "other-layout";
        document.body.appendChild(other);
        await byDIFFviewer(other, "a", "b", { viewSelect: true }).ready;
      });
      await page.locator("#viewer").getByRole("radio", { name: "Unified", exact: true }).check();
      assert.equal(await page.locator("#other-layout .byDIFFtable").getAttribute("data-view"), "unified");
      assert.equal(await page.locator("#other-layout").getByRole("radio", { name: "Unified", exact: true }).isChecked(), true);
      await page.locator("#other-layout").evaluate((element) => element.remove());
      await page.evaluate(async () => {
        await byDIFFviewer(root, "old", "new", { view: "split", lineNumbers: false }).ready;
      });
      assert.equal(await page.locator("tbody tr").count(), 1);
      assert.equal(await page.locator("tbody td").count(), 2);
      assert.equal(await page.locator(".byDIFFnoNewline").count(), 2);
    });

    await t.test("trailing newlines change the final blank row instead of unchanged text", async () => {
      const before = "A small document\nKeep this line\nOld wording\nLast line";
      const after = "A small document\nAn added line\nKeep this line\nNew wording\nLast line\n";
      for (const mode of ["light", "dark"]) {
        for (const view of ["unified", "split"]) {
          for (const reverse of [false, true]) {
            for (const lineNumbers of [true, false]) {
              const oldSource = reverse ? after : before,
                newSource = reverse ? before : after;
              const result = await page.evaluate(
                async ({ mode, view, oldSource, newSource, lineNumbers }) => {
                  root.dataset.theme = mode;
                  await byDIFFviewer(root, oldSource, newSource, { view, lineNumbers, statusBar: true, copyOldButton: true, loadMore: false }).ready;
                  const edits = byDIFFviewer.diff(oldSource, newSource);
                  const last = edits.find((edit) => edit.oldText?.startsWith("Last line") && edit.newText?.startsWith("Last line"));
                  return { last: last?.type, oldText: edits.map((edit) => edit.oldText ?? "").join(""), newText: edits.map((edit) => edit.newText ?? "").join("") };
                },
                { mode, view, oldSource, newSource, lineNumbers }
              );
              assert.deepEqual(result, { last: "equal", oldText: oldSource, newText: newSource });
              const context = page.locator("tbody tr").filter({ has: page.locator(".byDIFFtext", { hasText: "Last line" }) });
              assert.equal(await context.count(), 1);
              assert.equal(await context.getAttribute("class"), "byDIFFequal");
              const newline = page.locator(".byDIFFnewline");
              assert.equal(await newline.count(), 1);
              assert.equal(await newline.locator("xpath=ancestor::tr").getAttribute("class"), reverse ? "byDIFFdelete" : "byDIFFinsert");
              assert.equal((await page.locator("tbody .byDIFFnumber").count()) > 0, lineNumbers);
              assert.match(await page.locator(".byVIEWstatus").textContent(), reverse ? /1 additions.*3 deletions/ : /3 additions.*1 deletions/);
              assert.equal(await page.locator("tbody tr").count(), view === "split" ? 6 : 7);
              await page.locator(".byVIEWcopy").click();
              assert.equal(await page.evaluate(() => copies.at(-1)), newSource);
              await page.getByRole("button", { name: "Copy old source", exact: true }).click();
              assert.equal(await page.evaluate(() => copies.at(-1)), oldSource);
            }
          }
        }
      }
      const cases = await page.evaluate(() => {
        const result = [];
        for (const ignoreWhitespace of [false, "trim", "all"]) {
          for (const [before, after] of [
            ["a", "a\n"],
            ["a\n", "a"],
            ["a", "a\r\n"],
            ["a\r\n", "a"],
            ["a\n\n", "a\n"]
          ]) {
            const edits = byDIFFviewer.diff(before, after, { ignoreWhitespace });
            result.push(edits.filter((edit) => edit.type !== "equal").map((edit) => ({ type: edit.type, oldText: edit.oldText, newText: edit.newText })));
          }
        }
        return result;
      });
      for (let index = 0; index < cases.length; index++) {
        const deletion = index % 5 === 1 || index % 5 === 3 || index % 5 === 4;
        assert.deepEqual(cases[index], [{ type: deletion ? "delete" : "insert", oldText: deletion ? "" : null, newText: deletion ? null : "" }]);
      }
    });

    await t.test("duplicate loading and source independence", async () => {
      await page.evaluate(() => {
        window.original = byDIFFviewer;
      });
      await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
      assert.equal(await page.evaluate(() => original === byDIFFviewer), true);
      assert.deepEqual(requests, []);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close();
  }
});

/* --- CONTAINER THEMES --- */
test("container themes are scoped, independent, and compatible with legacy links", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.setContent('<div id="outside" class="dark">Host</div><div id="first" data-theme="dark"></div><div id="second" class="light"></div><div id="third"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(
      async (args) => {
        window.renderTheme = async (element) => {
          const controller = window.byDIFFviewer(element, ...args.slice(0, 2), { ...args[2], animations: false });
          if (controller?.ready) await controller.ready;
        };
        for (const id of ["first", "second", "third"]) await renderTheme(document.getElementById(id));
      },
      ["before\n", "after\n"]
    );
    const color = (id) => page.locator("#" + id).evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(await color("first"), "rgb(39, 40, 34)");
    assert.equal(await color("second"), "rgb(250, 250, 245)");
    assert.equal(await page.locator("#outside").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-muted")), "");
    assert.equal(await page.locator("#first .byVIEWtoolbar").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-muted").trim()), "#75715e");
    await page.locator("#first .byVIEWthemeToggle").click();
    assert.equal(await page.locator("#first").getAttribute("data-theme"), "light");
    assert.equal(await color("second"), "rgb(250, 250, 245)");
    await page.locator("#second .byVIEWthemeToggle").click();
    assert.equal(
      await page
        .locator("#second")
        .getAttribute("class")
        .then((classes) => classes.split(/\s+/).includes("dark")),
      true
    );
    assert.equal(await page.locator("#second").getAttribute("data-theme"), null);
    assert.equal(await color("second"), "rgb(39, 40, 34)");
    await page.evaluate(async () => {
      const second = document.getElementById("second");
      second.dataset.theme = "light";
      await renderTheme(second);
    });
    assert.equal(await color("second"), "rgb(250, 250, 245)");
    await page.evaluate(() => {
      const first = document.getElementById("first");
      first.style.setProperty("--by-view-bg", "#123456");
    });
    assert.equal(await color("first"), "rgb(18, 52, 86)");
    assert.equal(await color("second"), "rgb(250, 250, 245)");
    await page.evaluate(() => document.getElementById("first").style.removeProperty("--by-view-bg"));
    assert.equal(requests.length, 0, "Container theme changes must not fetch stylesheets");

    await page.route("https://legacy.test/**", (route) => route.fulfill({ body: legacyThemeCSS(route.request().url().includes(".dark.css") ? "dark" : "light"), contentType: "text/css" }));
    await page.evaluate(async () => {
      const second = document.getElementById("second");
      second.removeAttribute("data-theme");
      second.classList.remove("light", "dark");
      await new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.id = "byVIEWtheme";
        link.rel = "stylesheet";
        link.href = "https://legacy.test/diff.light.css?cache=1#theme";
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
      });
      await renderTheme(second);
      await renderTheme(document.getElementById("third"));
    });
    await page.locator("#second .byVIEWthemeToggle").click();
    await page.waitForFunction(() => getComputedStyle(document.getElementById("second")).backgroundColor === "rgb(39, 40, 34)");
    assert.equal(await color("third"), "rgb(39, 40, 34)");
    assert.equal(await color("first"), "rgb(250, 250, 245)");
    assert.equal(await page.locator("#first .byVIEWthemeToggle").getAttribute("aria-label"), "Switch to dark theme");
    assert.equal(await page.locator("#byVIEWtheme").getAttribute("href"), "https://legacy.test/diff.dark.css?cache=1#theme");
    await page.evaluate(async () => {
      document.getElementById("byVIEWtheme").remove();
      await renderTheme(document.getElementById("second"));
    });
    await page.locator("#second .byVIEWthemeToggle").click();
    assert.equal(await page.locator("#second").getAttribute("data-theme"), "dark");
    assert.equal(await color("third"), "rgb(250, 250, 245)");
  } finally {
    await browser.close();
  }
});

/* --- PALETTES AND CONTRAST --- */
test("named palettes retain mode, isolate custom CSS, and meet High Contrast targets", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    const warnings = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("diff.themes.css")) warnings.push(message.text());
    });
    await page.setContent('<div id="outside">Host</div><div id="viewer"></div><div id="other" data-theme="dark"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(
      async (args) => {
        window.renderPalette = async (id) => {
          const controller = window.byDIFFviewer(document.getElementById(id), ...args.slice(0, 2), { ...args[2], animations: false });
          if (controller?.ready) await controller.ready;
        };
        await renderPalette("viewer");
        await renderPalette("other");
      },
      ["before\nsame\n", "after\nsame\n"]
    );
    const root = page.locator("#viewer");
    const background = () => root.evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(await background(), "rgb(250, 250, 245)", "Default remains Monokai Light");
    for (const [palette, colors] of Object.entries({
      monokai: ["rgb(250, 250, 245)", "rgb(39, 40, 34)"],
      github: ["rgb(255, 255, 255)", "rgb(13, 17, 23)"],
      solarized: ["rgb(253, 246, 227)", "rgb(0, 43, 54)"],
      "high-contrast": ["rgb(255, 255, 255)", "rgb(0, 0, 0)"]
    })) {
      await root.evaluate((element, palette) => {
        element.dataset.theme = palette;
        element.classList.remove("light", "dark");
      }, palette);
      assert.equal(await background(), colors[0], palette);
      await root.locator(".byVIEWthemeToggle").click();
      assert.equal(await root.getAttribute("data-theme"), palette);
      assert.equal(await background(), colors[1], palette);
      await page.evaluate(() => renderPalette("viewer"));
      assert.equal(await background(), colors[1], "Rendering preserves the palette and mode");
      await root.locator(".byVIEWthemeToggle").click();
      assert.equal(await background(), colors[0]);
    }
    assert.equal(warnings.length, 0, "Core palettes need no optional pack");
    await root.evaluate((element) => {
      element.dataset.theme = "dracula";
    });
    await page.evaluate(() => renderPalette("viewer"));
    assert.match(warnings[0], /diff\.themes\.css/);
    await page.evaluate(() => renderPalette("viewer"));
    assert.equal(warnings.length, 1, "Repeated renders do not repeat a missing-pack warning");
    await root.evaluate((element) => {
      element.dataset.theme = "custom-user";
    });
    await page.evaluate(() => renderPalette("viewer"));
    assert.equal(warnings.length, 1, "Custom CSS names are supported without a pack");
    await page.addStyleTag({ path: path.join(__dirname, "../diff.themes.css") });
    await root.evaluate((element) => {
      element.dataset.theme = "bubblegum";
    });
    await page.evaluate(() => renderPalette("viewer"));
    assert.equal(warnings.length, 1, "Loaded packs do not warn for other presets");
    const paletteSelect = require("node:fs")
      .readFileSync(path.join(__dirname, "../index.html"), "utf8")
      .match(/<select id="preview-palette"[\s\S]*?<\/select>/)[0];
    const paletteNames = [...paletteSelect.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]).filter((name) => name !== "custom");
    assert.equal(paletteNames.length, 48);
    assert.equal(new Set(paletteNames).size, 48);
    const readme = require("node:fs").readFileSync(path.join(__dirname, "../README.md"), "utf8");
    for (const name of paletteNames) assert.match(readme, new RegExp("\\|\\s*`" + name + "`\\s*\\|"), `${name} must be documented`);
    const failures = await root.evaluate((element, names) => {
      const luminance = (value) => {
        const channels = value.startsWith("#")
          ? value
              .slice(1)
              .match(/../g)
              .map((part) => parseInt(part, 16))
          : value
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number);
        const linear = channels.map((channel) => channel / 255).map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
      const failures = [];
      for (const name of names.filter((name) => !["monokai", "github", "solarized", "high-contrast"].includes(name))) {
        element.dataset.theme = name;
        for (const mode of ["light", "dark"]) {
          element.classList.toggle("dark", mode === "dark");
          element.classList.toggle("light", mode === "light");
          const style = getComputedStyle(element);
          const variables = [...style].map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, value]) => /^#[\da-f]{6}$/i.test(value));
          const backgrounds = [style.backgroundColor, ...variables.filter(([name]) => /-(?:alt|code-bg|add|remove)$/.test(name)).map(([, value]) => value)];
          const textColors = [["text", style.color], ...variables.filter(([name]) => /-(?:text|secondary|accent|string|literal|error|warn|info|debug|comment|keyword|number|property|tag|link|quote|toggle|placeholder|muted)$/.test(name))];
          for (const [property, value] of textColors) {
            if (backgrounds.some((background) => contrast(value, background) < 4.5)) failures.push(`${name} ${mode} ${property}`);
          }
          const border = variables.find(([name]) => /^--by-(?:view|json|md)-border$/.test(name))?.[1];
          if (border && contrast(border, style.backgroundColor) < 3) failures.push(`${name} ${mode} border`);
        }
      }
      element.dataset.theme = "high-contrast";
      return failures;
    }, paletteNames);
    assert.deepEqual(failures, [], "New palettes must keep text and control boundaries readable in both modes");
    for (const mode of ["light", "dark"]) {
      await root.evaluate((element, mode) => {
        element.classList.toggle("dark", mode === "dark");
        element.classList.toggle("light", mode === "light");
      }, mode);
      await root.locator(".byVIEWcopy").focus();
      const measurements = await root.evaluate((element) => {
        const style = getComputedStyle(element);
        const luminance = (color) => {
          const channels = color.startsWith("#")
            ? color
                .slice(1)
                .match(/../g)
                .map((part) => parseInt(part, 16))
            : color
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number);
          const values = channels.map((channel) => channel / 255).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        const variables = [...style].filter((property) => property.startsWith("--by-")).map((property) => [property, style.getPropertyValue(property).trim()]);
        const backgrounds = [style.backgroundColor, ...variables.filter(([property]) => /-(?:alt|code-bg|add|remove)$/.test(property)).map(([, value]) => value)];
        const text = variables.filter(([property, value]) => /^#[0-9a-f]{6}$/i.test(value) && !/-(?:bg|border|alt|add|remove)$/.test(property));
        const button = getComputedStyle(element.querySelector(".byVIEWcopy"));
        return {
          text: text.flatMap(([property, value]) => backgrounds.map((bg) => ({ property, ratio: contrast(value, bg) }))),
          border: contrast(button.borderTopColor, style.backgroundColor),
          focus: contrast(button.outlineColor, style.backgroundColor),
          outline: parseFloat(button.outlineWidth)
        };
      });
      assert.ok(measurements.text.length >= 5);
      for (const { property, ratio } of measurements.text) assert.ok(ratio >= 7, mode + " " + property + ": " + ratio.toFixed(2));
      assert.ok(measurements.border >= 3);
      assert.ok(measurements.focus >= 3 && measurements.outline >= 2);
    }
    await root.evaluate((element) => {
      element.classList.add("light", "dark");
      element.dataset.theme = "github";
    });
    assert.equal(await background(), "rgb(13, 17, 23)", "Dark wins when both classes exist");
    await root.evaluate((element) => {
      element.dataset.theme = "light";
    });
    assert.equal(await background(), "rgb(250, 250, 245)", "Legacy mode aliases override classes");
    await page.addStyleTag({ content: '.byDIFFdocument.light[data-theme="custom-ocean"] { --by-view-bg: #f3f8fc; } .byDIFFdocument.dark[data-theme="custom-ocean"] { --by-view-bg: #102a43; }' });
    await root.evaluate((element) => {
      element.dataset.theme = "custom-ocean";
      element.classList.remove("light", "dark");
    });
    await page.route("https://legacy.test/**", (route) => route.fulfill({ body: "", contentType: "text/css" }));
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const link = document.createElement("link");
          link.id = "byVIEWtheme";
          link.rel = "stylesheet";
          link.href = "https://legacy.test/diff.dark.css?cache=1#theme";
          link.onload = resolve;
          document.head.appendChild(link);
        })
    );
    await page.evaluate(() => renderPalette("viewer"));
    assert.equal(await background(), "rgb(250, 250, 245)", "An unclassified custom palette starts in Light");
    await root.locator(".byVIEWthemeToggle").click();
    assert.equal(await background(), "rgb(16, 42, 67)");
    assert.equal(await root.getAttribute("data-theme"), "custom-ocean");
    assert.equal(await page.locator("#byVIEWtheme").getAttribute("href"), "https://legacy.test/diff.dark.css?cache=1#theme");
    assert.equal(await page.locator("#other").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(39, 40, 34)");
    assert.equal(await page.locator("#outside").evaluate((element) => getComputedStyle(element).getPropertyValue("--by-view-muted")), "");
  } finally {
    await browser.close();
  }
});

/* --- CONTROLS AND CLIPBOARD FEEDBACK --- */
test("viewer defaults, optional tools, and copy feedback", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 720 }, reducedMotion: "reduce" });
    await page.setContent('<div id="viewer"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(
      (args) => {
        window.renderUI = async (options = {}) => {
          const result = byDIFFviewer(document.getElementById("viewer"), ...args, options);
          await result?.ready;
        };
      },
      ["needle\nold\n", "needle\nnew\n"]
    );
    await page.evaluate(() => renderUI());
    assert.equal(await page.locator(".byVIEWcontrols button").count(), 5);
    assert.equal(await page.locator(".byVIEWfontSizes").count(), 1);
    assert.equal(await page.locator(".byVIEWactions :is(input, select, button):visible").count(), 0);
    assert.equal(await page.locator(".byVIEWstatus:visible").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const controlsPosition of ["top", "bottom"]) {
      for (const toolbar of [true, false]) {
        const edges = await page.evaluate(
          async (options) => {
            await renderUI(options);
            const host = document.getElementById("viewer");
            const bounds = host.getBoundingClientRect();
            const style = getComputedStyle(host);
            const panel = host.querySelector(".byVIEWpanel").getBoundingClientRect();
            const first = host.firstElementChild,
              last = host.lastElementChild;
            const topToolbar = first.classList.contains("byVIEWtoolbar");
            const bottomToolbar = last.classList.contains("byVIEWtoolbar");
            const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
            return [
              ((topToolbar ? first.getBoundingClientRect().top : panel.top) - bounds.top - parseFloat(style.borderTopWidth)) / rem,
              (bounds.bottom - parseFloat(style.borderBottomWidth) - (bottomToolbar ? last.getBoundingClientRect().bottom : panel.bottom)) / rem
            ];
          },
          { controlsPosition, toolbar }
        );
        const expected = [toolbar && controlsPosition === "top" ? 0 : 0.75, toolbar && controlsPosition === "bottom" ? 0 : 0.75];
        assert.ok(
          edges.every((edge, index) => Math.abs(edge - expected[index]) < 0.01),
          `${controlsPosition}, toolbar=${toolbar}: ${edges}`
        );
      }
    }
    await page.evaluate(() => renderUI({ displayContainer: false, statusBar: true }));
    assert.equal(await page.locator(".byVIEWstatus:visible").count(), 0);
    assert.equal(await page.locator(".byVIEWpanel").evaluate((panel) => parseFloat(getComputedStyle(panel).borderTopWidth)), 0);
    assert.match(await page.locator(".byVIEWcontent").textContent(), /needle/);
    await page.evaluate(() => renderUI({ displayContainer: true, statusBar: false }));
    assert.equal(await page.locator(".byVIEWstatus:visible").count(), 0);
    assert.ok(await page.locator(".byVIEWpanel").evaluate((panel) => parseFloat(getComputedStyle(panel).borderTopWidth) > 0));
    await page.evaluate(() => renderUI());
    await page.evaluate(() => renderUI({ fontSizeControls: false, statusBar: false }));
    assert.equal(await page.locator(".byVIEWfontSizes").count(), 0);
    assert.equal(await page.locator(".byVIEWstatus:visible").count(), 0);
    await page.evaluate(() => renderUI());
    await page.evaluate(() => renderUI({ controlsSize: "invalid" }));
    assert.equal(await page.locator(".byVIEWtoolbar").getAttribute("data-size"), "regular");
    for (const scale of [1, 1.5]) {
      for (const controlsSize of ["xs", "small", "regular", "large", "xl"]) {
        for (const font of ["ui-monospace, monospace", "Georgia, serif"]) {
          for (const mode of ["light", "dark"]) {
            const errors = await page.evaluate(
              async ({ scale, controlsSize, font, mode }) => {
                document.documentElement.style.fontSize = `${scale}rem`;
                const host = document.getElementById("viewer");
                host.dataset.theme = mode;
                host.style.setProperty("--by-view-controls-font", font);
                await renderUI({ controlsSize });
                const button = host.querySelector(".byVIEWthemeToggle");
                const rect = button.getBoundingClientRect();
                const style = getComputedStyle(button),
                  thumb = getComputedStyle(button, "::after");
                const innerWidth = rect.width - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
                const innerHeight = rect.height - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
                const position = (value, extent) => (value.endsWith("%") ? (parseFloat(value) * extent) / 100 : parseFloat(value));
                const transform = new DOMMatrixReadOnly(thumb.transform);
                const centerX = rect.left + parseFloat(style.borderLeftWidth) + position(thumb.left, innerWidth) + transform.m41 + parseFloat(thumb.width) / 2;
                const centerY = rect.top + parseFloat(style.borderTopWidth) + position(thumb.top, innerHeight) + transform.m42 + parseFloat(thumb.height) / 2;
                const icons = [...button.querySelectorAll("svg")];
                const icon = icons[mode === "dark" ? 1 : 0].getBoundingClientRect();
                const toolbarSize = parseFloat(getComputedStyle(host.querySelector(".byVIEWtoolbar")).fontSize);
                const expectedSize = { xs: 0.5, small: 0.7, regular: 0.875, large: 1, xl: 1.25 }[controlsSize] * parseFloat(getComputedStyle(document.documentElement).fontSize);
                return [Math.abs(centerX - icon.x - icon.width / 2), Math.abs(centerY - icon.y - icon.height / 2), Math.abs(centerY - rect.y - rect.height / 2), Math.abs(toolbarSize - expectedSize)];
              },
              { scale, controlsSize, font, mode }
            );
            assert.ok(
              errors.every((error) => error < 0.06),
              `${scale} ${controlsSize} ${font} ${mode}: ${errors}`
            );
          }
        }
      }
    }
    await page.evaluate(async () => {
      document.documentElement.style.fontSize = "";
      document.getElementById("viewer").style.removeProperty("--by-view-controls-font");
      await renderUI();
    });
    for (const mode of ["light", "dark"]) {
      await page.locator("#viewer").evaluate((element, mode) => {
        element.dataset.theme = mode;
      }, mode);
      await page.evaluate(() => renderUI({ toolbar: false, controlsPosition: "bottom", sorting: false, pagination: false, collapsible: false, details: false, lineNumbers: false, loadMore: false }));
      assert.equal(await page.locator("#viewer :is(button, input, select, summary):visible").count(), 0);
      assert.equal(await page.locator(".byVIEWtoolbar").count(), 0);
      assert.equal(await page.locator("#viewer").evaluate((element) => element.classList.contains("byVIEWbottom")), false);
      assert.match(await page.locator("#viewer").textContent(), /needle/);
    }
    await page.evaluate(() => renderUI({ batchSize: 1 }));
    assert.equal(await page.getByRole("button", { name: "Load more", exact: false }).isVisible(), true);
    await page.evaluate(() => renderUI({ batchSize: 1, loadMore: false }));
    assert.equal(await page.locator(".byDIFFtable tbody tr").count(), 4);
    assert.equal(await page.getByRole("button", { name: "Load more", exact: false }).isVisible(), false);
    await page.evaluate(() => renderUI({ credits: false }));
    assert.equal(await page.locator(".byVIEWinfo").count(), 0);
    assert.equal(await page.locator(".byVIEWcontrols button").count(), 5);
    await page.evaluate(() => renderUI({ credits: false, themeToggle: false, fontSizeControls: false, copyButton: false }));
    assert.equal(await page.locator(".byVIEWtoolbar").count(), 0);
    await page.evaluate((options) => renderUI({ fontSizeControls: true, ...options }), { viewSelect: true, copyOldButton: true, statusBar: true });
    assert.equal(await page.locator(".byVIEWfontSize").count(), 3);
    assert.equal(await page.locator(".byVIEWpanel > .byVIEWstatus:visible").count(), 1);
    assert.ok(await page.locator(".byVIEWpanel > .byVIEWstatus").evaluate((status) => parseFloat(getComputedStyle(status).borderBottomWidth) > 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("Denied");
          }
        }
      });
    });
    await page.locator(".byVIEWcopy").click();
    await page.mouse.move(0, 0);
    await page.locator(".byVIEWcopy").evaluate((element) => element.blur());
    assert.equal(await page.locator(".byVIEWcopy").getAttribute("data-state"), "error");
    assert.equal(await page.locator(".byVIEWcopy").textContent(), "Failed");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async (value) => {
        window.copiedSource = value;
      };
    });
    await page.locator(".byVIEWcopy").click();
    assert.equal(await page.locator(".byVIEWcopy").getAttribute("data-state"), "success");
    assert.match(await page.evaluate(() => copiedSource), /needle/);
  } finally {
    await browser.close();
  }
});

/* --- DOCUMENT AND CONTENT SURFACES --- */
test("document and content backgrounds stay independent through theme and toolbar changes", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, channel: process.env.BROWSER_CHANNEL || "chrome" });
  try {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
    await page.setContent('<div id="viewer" data-theme="light"></div><div id="neighbor" data-theme="light"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(async () => {
      for (const id of ["viewer", "neighbor"]) {
        const result = byDIFFviewer(document.getElementById(id), "before", "after");
        await result?.ready;
      }
    });
    const root = page.locator("#viewer");
    const neighbor = await page.locator("#neighbor").evaluate((element) => getComputedStyle(element).backgroundColor);
    await root.evaluate((element) => {
      element.style.setProperty("--by-view-document-bg", "transparent");
      element.style.setProperty("--by-view-container-bg", "#123456");
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#viewer .byVIEWcopy")).backgroundColor === "rgb(18, 52, 86)");
    for (const changeMode of [false, true]) {
      if (changeMode) await root.locator(".byVIEWthemeToggle").click();
      assert.equal(await root.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
      assert.equal(await root.locator(".byVIEWpanel").evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(18, 52, 86)");
      assert.equal(
        await root
          .locator(".byVIEWcopy")
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgb(18, 52, 86)"
      );
      assert.equal(await root.locator(".byVIEWtoolbar").evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
    }
    assert.equal(await page.locator("#neighbor").evaluate((element) => getComputedStyle(element).backgroundColor), neighbor);
    await root.evaluate((element) => element.style.removeProperty("--by-view-container-bg"));
    await page.waitForFunction(() => getComputedStyle(document.querySelector("#viewer .byVIEWcopy")).backgroundColor === "rgb(39, 40, 34)");
    assert.notEqual(
      await root
        .locator(".byVIEWcopy")
        .first()
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(0, 0, 0, 0)"
    );
  } finally {
    await browser.close();
  }
});

/* --- INTERACTION MOTION --- */
test("animation options preserve initial visibility and override system motion preferences", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "chrome", executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("https://cdn.jsdelivr.net/**", (route) => (route.request().url().endsWith("fontawesome.min.css") ? route.fulfill({ body: "", contentType: "text/css" }) : route.abort()));
    await page.setContent('<div id="motion-viewer" data-theme="light"></div>');
    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(() => {
      window.renderMotion = async (animations, appearAnimation = false) => {
        window.motionController = byDIFFviewer(document.getElementById("motion-viewer"), "before", "after", { animations, appearAnimation });
        await motionController?.ready;
      };
    });
    await page.evaluate(() => renderMotion());
    const root = page.locator("#motion-viewer");
    assert.equal(await root.evaluate((element) => element.classList.contains("byVIEWmotion")), true);
    assert.equal(await root.evaluate((element) => getComputedStyle(element).opacity), "1");
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0, "Initial content does not animate");
    assert.equal(
      await root
        .locator("button")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration.split(",")[0]),
      "0.18s"
    );
    const disclosure = await root.evaluateHandle((element) => {
      const details = document.createElement("details");
      details.id = "motion-disclosure";
      details.innerHTML = "<summary>Details</summary><p>Already available content</p>";
      element.append(details);
      getComputedStyle(details, "::details-content").blockSize;
      return details;
    });
    await disclosure.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "0");
    const opening = await disclosure.evaluate(async (details) => {
      details.open = true;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Number(getComputedStyle(details, "::details-content").opacity);
    });
    assert.ok(opening > 0 && opening < 1, "A deliberate disclosure eases in even with reduced motion requested");
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "1");
    await disclosure.evaluate((details) => {
      details.open = false;
    });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("motion-disclosure"), "::details-content").opacity === "0");
    assert.equal(await disclosure.evaluate((details) => details.open), false);
    await page.evaluate(() => renderMotion(false));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    assert.equal(await root.evaluate((element) => element.classList.contains("byVIEWmotion")), false);
    assert.equal(
      await root
        .locator("button")
        .first()
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      "0s"
    );
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0);
    await page.emulateMedia({ media: "screen", reducedMotion: "reduce" });
    await page.evaluate(() => renderMotion(true));
    await page.waitForFunction(() => document.getElementById("motion-viewer").classList.contains("byVIEWready"));
    const fade = await root.evaluate((element) => {
      const before = getComputedStyle(element).backgroundColor;
      element.querySelector('[aria-label^="Switch to"]').click();
      const transition = element.getAnimations().find((animation) => animation.transitionProperty === "background-color");
      if (!transition) return { active: false };
      transition.pause();
      transition.currentTime = 90;
      const middle = getComputedStyle(element).backgroundColor;
      transition.finish();
      return { active: true, before, middle, after: getComputedStyle(element).backgroundColor, fontTransition: getComputedStyle(element).transitionProperty.includes("font-size") };
    });
    assert.equal(fade.active, true, "Theme backgrounds fade after the first paint");
    assert.notEqual(fade.middle, fade.before);
    assert.notEqual(fade.middle, fade.after);
    assert.equal(fade.fontTransition, false);
    await root.evaluate((element) => {
      element.dataset.theme = "high-contrast";
    });
    assert.equal(await root.evaluate((element) => element.getAnimations().filter((animation) => animation.transitionProperty === "background-color").length), 0);
    const entrance = await page.evaluate(async () => {
      await renderMotion(true, true);
      const element = document.getElementById("motion-viewer");
      const animation = element.getAnimations().find((animation) => animation.animationName === "byVIEWappear");
      if (!animation) return { active: false };
      animation.pause();
      animation.currentTime = 90;
      return { active: true, opacity: Number(getComputedStyle(element).opacity), content: element.textContent.length };
    });
    assert.equal(entrance.active, true, "Entrance motion is explicit even when the system requests reduced motion");
    assert.ok(entrance.opacity > 0 && entrance.opacity < 1);
    assert.ok(entrance.content > 0, "Rendering completes without waiting for the animation");
    await page.evaluate(() => renderMotion(false, true));
    assert.equal(await root.evaluate((element) => element.getAnimations({ subtree: true }).length), 0, "Animations off overrides the requested entrance");
  } finally {
    await browser.close();
  }
});

/* --- INITIAL APPEARANCE --- */
test("appearance options override markup and preserve independent viewer state", async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ body: "", contentType: "text/css" }));
    await page.setContent('<style>html{font-size:20px}</style><div id="appearance" class="host light" data-theme="light"></div><div id="neighbor" class="dark" data-theme="monokai" style="font-size:2rem">Neighbor</div>');

    await page.addStyleTag({ path: path.join(__dirname, "../diff.css") });
    await page.addScriptTag({ path: path.join(__dirname, "../diff.js") });
    await page.evaluate(() => {
      window.appearanceTarget = document.getElementById("appearance");
      window.renderAppearance = async (options = {}) => {
        window.appearanceInstance = byDIFFviewer(appearanceTarget, "Old", "New", options);
        await appearanceInstance?.ready;
      };
    });
    const neighbor = await page.locator("#neighbor").evaluate((element) => element.outerHTML);
    await page.evaluate(() => renderAppearance({ theme: "dark", palette: "github", fontSize: 1.5, animations: false }));
    assert.deepEqual(
      await page
        .locator("#appearance")
        .evaluate((element) => [element.classList.contains("host"), element.classList.contains("dark"), element.classList.contains("light"), element.dataset.theme, element.style.fontSize, getComputedStyle(element).fontSize]),
      [true, true, false, "github", "1.5rem", "30px"]
    );
    const controls = page.locator("#appearance .byVIEWthemeToggle");
    assert.equal(await controls.getAttribute("aria-label"), "Switch to light theme");
    await controls.click();
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.classList.contains("light"), element.dataset.theme, element.style.fontSize]), [true, "github", "1.5rem"]);
    const buttonSize = await controls.evaluate((element) => getComputedStyle(element).fontSize);
    await page.getByRole("button", { name: "Increase text size", exact: true }).click();
    await page.evaluate(() => renderAppearance());
    assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), "1.625rem");
    await page.getByRole("button", { name: "Reset text size", exact: true }).click();
    assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), "1.5rem");
    assert.equal(await controls.evaluate((element) => getComputedStyle(element).fontSize), buttonSize);
    await page.evaluate(() => renderAppearance({ fontSize: 1.25 }));
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "25px");
    await page.getByRole("button", { name: "Increase text size", exact: true }).click();
    await page.getByRole("button", { name: "Reset text size", exact: true }).click();
    assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), "1.25rem");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "24px";
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "30px", "The multiplier follows root text-size changes");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    for (const [fontSize, expected] of [
      ["1.25rem", 25],
      ["1.25em", 25],
      ["20px", 20],
      ["125%", 25],
      ["1px", 10],
      ["100px", 60],
      ["4em", 60]
    ]) {
      await page.evaluate((fontSize) => renderAppearance({ fontSize }), fontSize);
      assert.equal(await page.locator("#appearance").evaluate((element) => parseFloat(getComputedStyle(element).fontSize)), expected, fontSize);
      const preset = await page.locator("#appearance").evaluate((element) => [element.style.fontSize, element.dataset.byViewDefaultFontSize]);
      assert.equal(preset[0], preset[1]);
      await page.getByRole("button", { name: expected === 60 ? "Decrease text size" : "Increase text size", exact: true }).click();
      await page.getByRole("button", { name: "Reset text size", exact: true }).click();
      assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), preset[0]);
    }
    await page.evaluate(() => {
      document.body.style.fontSize = "1.5rem";
      return renderAppearance({ fontSize: "1em" });
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "30px", "em remains relative to the parent");
    await page.evaluate(() => {
      document.body.style.fontSize = "";
      document.documentElement.style.fontSize = "24px";
      return renderAppearance({ fontSize: "100px" });
    });
    assert.equal(await page.locator("#appearance").evaluate((element) => getComputedStyle(element).fontSize), "72px", "CSS values retain the rem limit when the root size changes");
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "20px";
    });
    for (const [requested, expected] of [
      [-1, 0.5],
      [0, 0.5],
      [0.25, 0.5],
      [0.5, 0.5],
      [3, 3],
      [4, 3]
    ]) {
      await page.evaluate((fontSize) => renderAppearance({ fontSize }), requested);
      assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), `${expected}rem`);
      assert.equal(await page.locator("#appearance").evaluate((element) => element.dataset.byViewDefaultFontSize), `${expected}rem`);
      assert.equal(await page.getByRole("button", { name: "Decrease text size", exact: true }).isDisabled(), expected === 0.5);
      assert.equal(await page.getByRole("button", { name: "Increase text size", exact: true }).isDisabled(), expected === 3);
      await page.getByRole("button", { name: expected === 3 ? "Decrease text size" : "Increase text size", exact: true }).click();
      await page.getByRole("button", { name: "Reset text size", exact: true }).click();
      assert.equal(await page.locator("#appearance").evaluate((element) => element.style.fontSize), `${expected}rem`);
    }
    await page.evaluate(() => {
      appearanceTarget.dataset.theme = "dark";
      appearanceTarget.classList.remove("dark");
      appearanceTarget.classList.add("light");
      return renderAppearance({ palette: "high-contrast", toolbar: false });
    });
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), getComputedStyle(element).colorScheme]), ["high-contrast", true, "dark"]);
    await page.evaluate(() => {
      appearanceTarget.dataset.theme = "dark";
      return renderAppearance({ theme: "light", toolbar: false });
    });
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), element.classList.contains("light")]), ["light", false, true]);
    await page.evaluate(() => renderAppearance({ theme: "dark", palette: "custom-ocean", fontSize: 1.125, toolbar: false }));
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.dataset.theme, element.classList.contains("dark"), element.style.fontSize]), ["custom-ocean", true, "1.125rem"]);
    const preserved = await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]);
    await page.evaluate(() => renderAppearance());
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]), preserved);
    await page.evaluate(() => renderAppearance({ theme: null, palette: null, fontSize: null }));
    assert.deepEqual(await page.locator("#appearance").evaluate((element) => [element.className, element.dataset.theme, element.style.fontSize]), preserved, "Blank exported appearance fields retain the container settings");
    for (const options of [
      { theme: "sepia" },
      { palette: "dark" },
      { palette: "bad name" },
      { fontSize: NaN },
      { fontSize: Infinity },
      { fontSize: "wrong" },
      { fontSize: "inherit" },
      { fontSize: true },
      { theme: "light", palette: "github", fontSize: "1.25" }
    ]) {
      const before = await page.locator("#appearance").evaluate((element) => element.outerHTML);
      const name = await page.evaluate(async (options) => {
        try {
          await renderAppearance(options);
        } catch (error) {
          return error.name;
        }
      }, options);
      assert.equal(name, "RangeError");
      assert.equal(await page.locator("#appearance").evaluate((element) => element.outerHTML), before, "Invalid appearance must not replace the current document");
    }

    assert.equal(await page.locator("#neighbor").evaluate((element) => element.outerHTML), neighbor);
  } finally {
    await browser.close();
  }
});
