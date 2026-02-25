// Minimal EPUB reader UI on top of epub.js.
//
// Features:
// - Open via ?file=... (including /stream?path=...) or via file picker.
// - Auto-resume per-book using stored CFI in localStorage.
// - TOC sidebar, basic search, font size, paginated/scrolled flow, theme (auto/light/dark).
(function () {
  "use strict";

  const PREF_THEME = "pdfjs-epub-theme"; // "auto" | "light" | "dark"
  const PREF_FLOW = "pdfjs-epub-flow"; // "paginated" | "scrolled"
  const PREF_FONT_SCALE = "pdfjs-epub-font-scale"; // number (percent)
  const PREF_INVERT = "pdfjs-epub-invert-level"; // 0 | 1 | 2

  const POS_PREFIX = "pdfjs-epub-pos:"; // + hash(bookId)

  const DEFAULT_THEME = "auto";
  const DEFAULT_FLOW = "paginated";
  const DEFAULT_FONT_SCALE = 100;
  const MIN_FONT_SCALE = 70;
  const MAX_FONT_SCALE = 180;

  let book = null;
  let rendition = null;
  let currentBookId = null;
  let currentBookLabel = null;
  let currentObjectUrl = null;
  let lastLocationCfi = null;
  let searchToken = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function safeGetStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSetStorageItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  function safeRemoveStorageItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  function clampInt(v, min, max, fallback) {
    if (!Number.isFinite(v)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, v | 0));
  }

  function fnv1a32(str) {
    // Simple, fast hash for localStorage keys (not crypto).
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }

  function getFileParam() {
    const params = new URLSearchParams(window.location.search);
    const file = params.get("file");
    return file && file.trim() ? file.trim() : null;
  }

  function decodeStreamPathIfPresent(fileParam) {
    if (!fileParam) {
      return null;
    }
    try {
      const u = new URL(fileParam, window.location.href);
      if (u.pathname === "/stream") {
        const p = u.searchParams.get("path");
        if (p) {
          return decodeURIComponent(p);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  function computeBookIdFromUrl(fileParam) {
    // Prefer the real on-disk path when using /stream?path=..., so the key is stable.
    const streamPath = decodeStreamPathIfPresent(fileParam);
    if (streamPath) {
      return streamPath;
    }
    return fileParam;
  }

  function computeBookIdFromFile(file) {
    if (!file) {
      return null;
    }
    const name = file.name || "book.epub";
    const size = Number.isFinite(file.size) ? file.size : 0;
    const lm = Number.isFinite(file.lastModified) ? file.lastModified : 0;
    return `${name}|${size}|${lm}`;
  }

  function posKey(bookId) {
    return POS_PREFIX + fnv1a32(bookId);
  }

  function loadSavedPositionCfi(bookId) {
    if (!bookId) {
      return null;
    }
    const raw = safeGetStorageItem(posKey(bookId));
    if (!raw) {
      return null;
    }
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.cfi === "string" && obj.cfi.length) {
        return obj.cfi;
      }
    } catch {
      // ignore
    }
    return null;
  }

  function savePositionCfi(bookId, cfi) {
    if (!bookId || !cfi) {
      return;
    }
    safeSetStorageItem(
      posKey(bookId),
      JSON.stringify({ cfi, updatedAt: Date.now() })
    );
  }

  function clearSavedPosition(bookId) {
    if (!bookId) {
      return;
    }
    safeRemoveStorageItem(posKey(bookId));
  }

  function getThemePref() {
    const raw = safeGetStorageItem(PREF_THEME);
    if (raw === "auto" || raw === "light" || raw === "dark") {
      return raw;
    }
    return DEFAULT_THEME;
  }

  function setThemePref(value) {
    if (value !== "auto" && value !== "light" && value !== "dark") {
      value = DEFAULT_THEME;
    }
    safeSetStorageItem(PREF_THEME, value);
  }

  function getFlowPref() {
    const raw = safeGetStorageItem(PREF_FLOW);
    if (raw === "paginated" || raw === "scrolled") {
      return raw;
    }
    return DEFAULT_FLOW;
  }

  function setFlowPref(value) {
    if (value !== "paginated" && value !== "scrolled") {
      value = DEFAULT_FLOW;
    }
    safeSetStorageItem(PREF_FLOW, value);
  }

  function getFontScalePref() {
    const raw = safeGetStorageItem(PREF_FONT_SCALE);
    const n = Number.parseInt(raw || "", 10);
    return clampInt(n, MIN_FONT_SCALE, MAX_FONT_SCALE, DEFAULT_FONT_SCALE);
  }

  function setFontScalePref(value) {
    const n = clampInt(value, MIN_FONT_SCALE, MAX_FONT_SCALE, DEFAULT_FONT_SCALE);
    safeSetStorageItem(PREF_FONT_SCALE, String(n));
  }

  function getInvertLevel() {
    const raw = safeGetStorageItem(PREF_INVERT);
    if (raw === "0" || raw === "1" || raw === "2") {
      return Number.parseInt(raw, 10);
    }
    return 0; // default off
  }

  function setInvertLevel(level) {
    const v = (level === 0 || level === 1 || level === 2) ? level : 0;
    safeSetStorageItem(PREF_INVERT, String(v));
  }

  function systemPrefersDark() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function getEffectiveTheme() {
    const pref = getThemePref();
    if (pref === "auto") {
      return systemPrefersDark() ? "dark" : "light";
    }
    return pref;
  }

  function updateToolbarState() {
    const hasBook = !!(book && rendition);
    $("prevBtn").disabled = !hasBook;
    $("nextBtn").disabled = !hasBook;
    $("resetPosBtn").disabled = !hasBook;
    $("fontMinusBtn").disabled = !hasBook;
    $("fontPlusBtn").disabled = !hasBook;
    $("fontResetBtn").disabled = !hasBook;
    $("flowBtn").disabled = !hasBook;
    $("tocBtn").disabled = !hasBook;
    $("searchBtn").disabled = !hasBook;
    $("searchInput").disabled = !hasBook;

    const themePref = getThemePref();
    const flowPref = getFlowPref();
    const fontScale = getFontScalePref();

    $("themeBtn").textContent =
      themePref === "auto"
        ? "Theme: Auto"
        : themePref === "dark"
          ? "Theme: Dark"
          : "Theme: Light";
    $("flowBtn").textContent = flowPref === "scrolled" ? "Flow: Scroll" : "Flow: Paged";
    $("fontResetBtn").textContent = `A ${fontScale}%`;

    $("bookTitle").textContent = currentBookLabel || "EPUB";

    const invertLevel = getInvertLevel();
    const invertBtn = $("invertBtn");
    if (invertBtn) {
      invertBtn.disabled = !hasBook;
      const label = invertLevel === 0 ? "Off" : invertLevel === 1 ? "Mild" : "Full";
      invertBtn.textContent = `INV: ${label}`;
      invertBtn.title = `Content inversion: ${label} — Click to cycle`;
    }
  }

  function applyUiTheme() {
    const effective = getEffectiveTheme();
    document.body.classList.toggle("theme-dark", effective === "dark");
    document.body.classList.toggle("theme-light", effective === "light");
  }

  function applyRenditionTheme() {
    if (!rendition) {
      return;
    }
    const effective = getEffectiveTheme();
    const isDark = effective === "dark";

    // epub.js themes are injected into the iframe contents.
    const themeStyles = isDark
      ? {
        body: {
          color: "#e6e6e6 !important",
          background: "#121212 !important",
        },
        a: { color: "#8ab4f8 !important" },
      }
      : {
        body: {
          color: "#111111 !important",
          background: "#ffffff !important",
        },
        a: { color: "#0645ad !important" },
      };

    try {
      rendition.themes.register("pdfjs-ui", themeStyles);
      rendition.themes.select("pdfjs-ui");
      rendition.themes.fontSize(getFontScalePref() + "%");
    } catch {
      // ignore
    }

    applyInversion();
  }

  function applyInversion() {
    if (!rendition) {
      return;
    }
    const level = getInvertLevel();
    const effective = getEffectiveTheme();
    const isDark = effective === "dark";
    const active = isDark && level > 0;

    // CSS to inject into the epub.js iframe.
    // When active: invert the body, then un-invert images/videos/svgs so they look correct.
    const invertPct = level === 1 ? "88%" : "100%";
    const invertStyles = active
      ? {
        body: {
          filter: `invert(${invertPct}) hue-rotate(180deg) !important`,
        },
        "img, video, svg, picture, canvas": {
          filter: `invert(${invertPct}) hue-rotate(180deg) !important`,
        },
      }
      : {
        body: { filter: "none !important" },
        "img, video, svg, picture, canvas": { filter: "none !important" },
      };

    try {
      rendition.themes.register("pdfjs-invert", invertStyles);
      rendition.themes.select("pdfjs-invert");
      // Re-apply the main theme on top so colors don't get lost.
      rendition.themes.select("pdfjs-ui");
    } catch {
      // ignore
    }
  }

  function setSidebarOpen(open) {
    const sidebar = $("sidebar");
    sidebar.hidden = !open;
    $("tocBtn").setAttribute("aria-pressed", open ? "true" : "false");
  }

  function renderTocItem(item, depth) {
    const a = document.createElement("a");
    a.className = "item" + (depth > 0 ? " indent" : "");
    a.href = "#";
    a.textContent = item.label || item.title || item.id || "Untitled";
    a.addEventListener("click", evt => {
      evt.preventDefault();
      if (!rendition) {
        return;
      }
      const href = item.href || item.url;
      if (href) {
        rendition.display(href);
      }
    });
    return a;
  }

  function renderToc(toc) {
    const container = $("tocList");
    container.textContent = "";
    if (!Array.isArray(toc) || toc.length === 0) {
      const empty = document.createElement("div");
      empty.className = "status";
      empty.style.color = "var(--muted)";
      empty.textContent = "No table of contents.";
      container.appendChild(empty);
      return;
    }

    const walk = (items, depth) => {
      for (const item of items) {
        container.appendChild(renderTocItem(item, depth));
        if (Array.isArray(item.subitems) && item.subitems.length) {
          walk(item.subitems, depth + 1);
        }
      }
    };
    walk(toc, 0);
  }

  function setStatus(text) {
    $("statusText").textContent = text || "";
  }

  function formatPct(pct) {
    if (!Number.isFinite(pct)) {
      return null;
    }
    const v = Math.round(pct * 100);
    if (!Number.isFinite(v)) {
      return null;
    }
    return Math.max(0, Math.min(100, v));
  }

  function onRelocated(location) {
    // location.start.cfi and location.start.percentage
    try {
      const cfi = location?.start?.cfi;
      if (typeof cfi === "string" && cfi.length) {
        lastLocationCfi = cfi;
        savePositionCfi(currentBookId, cfi);
      }
      const pct = formatPct(location?.start?.percentage);
      const pctText = pct === null ? "" : ` ${pct}%`;
      setStatus((currentBookLabel || "EPUB") + pctText);
    } catch {
      // ignore
    }
  }

  function cleanupBook() {
    setStatus("");
    lastLocationCfi = null;
    searchToken++;
    $("searchResults").textContent = "";
    $("searchStatus").textContent = "";
    $("tocList").textContent = "";

    try {
      rendition?.destroy?.();
    } catch {
      // ignore
    }
    try {
      book?.destroy?.();
    } catch {
      // ignore
    }
    rendition = null;
    book = null;

    if (currentObjectUrl) {
      try {
        URL.revokeObjectURL(currentObjectUrl);
      } catch {
        // ignore
      }
      currentObjectUrl = null;
    }
    currentBookId = null;
    currentBookLabel = null;
  }

  async function openBookFromUrl(fileParam) {
    cleanupBook();

    if (!fileParam) {
      updateToolbarState();
      applyUiTheme();
      setSidebarOpen(false);
      $("viewer").textContent = "No book specified. Use ?file=... or click Open.";
      return;
    }

    $("viewer").textContent = "";

    currentBookId = computeBookIdFromUrl(fileParam);
    currentBookLabel = fileParam;
    updateToolbarState();

    if (typeof window.ePub !== "function") {
      $("viewer").textContent = "EPUB engine missing (epub.min.js).";
      return;
    }

    book = window.ePub(fileParam);
    rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%",
      flow: getFlowPref(),
    });

    rendition.on("relocated", onRelocated);
    rendition.on("rendered", applyRenditionTheme);

    applyUiTheme();
    applyRenditionTheme();

    try {
      const metadata = await book.loaded.metadata;
      const title = metadata?.title;
      if (title && typeof title === "string") {
        currentBookLabel = title;
        updateToolbarState();
      }
    } catch {
      // ignore
    }

    // Record in recent files.
    try {
      window.pdfjsRecentFiles?.record(fileParam, currentBookLabel, "epub");
    } catch {
      // ignore
    }

    try {
      const navigation = await book.loaded.navigation;
      renderToc(navigation?.toc || []);
    } catch {
      renderToc([]);
    }

    const saved = loadSavedPositionCfi(currentBookId);
    if (saved) {
      try {
        await rendition.display(saved);
        setStatus((currentBookLabel || "EPUB") + " (resumed)");
        return;
      } catch {
        // ignore and fall back
      }
    }
    rendition.display();
  }

  async function openBookFromFile(file) {
    cleanupBook();
    if (!file) {
      return;
    }
    if (typeof window.ePub !== "function") {
      $("viewer").textContent = "EPUB engine missing (epub.min.js).";
      return;
    }
    const url = URL.createObjectURL(file);
    currentObjectUrl = url;
    currentBookId = computeBookIdFromFile(file);
    currentBookLabel = file.name || "book.epub";
    updateToolbarState();

    $("viewer").textContent = "";

    book = window.ePub(url);
    rendition = book.renderTo("viewer", {
      width: "100%",
      height: "100%",
      flow: getFlowPref(),
    });

    rendition.on("relocated", onRelocated);
    rendition.on("rendered", applyRenditionTheme);

    applyUiTheme();
    applyRenditionTheme();

    // Record in recent files (name-only for local files).
    try {
      window.pdfjsRecentFiles?.record(file.name, file.name, "epub");
    } catch {
      // ignore
    }

    try {
      const navigation = await book.loaded.navigation;
      renderToc(navigation?.toc || []);
    } catch {
      renderToc([]);
    }

    const saved = loadSavedPositionCfi(currentBookId);
    if (saved) {
      try {
        await rendition.display(saved);
        setStatus((currentBookLabel || "EPUB") + " (resumed)");
        return;
      } catch {
        // ignore
      }
    }
    rendition.display();
  }

  // Expose for drag-and-drop handler.
  window.epubViewerOpenFile = function (file) {
    openBookFromFile(file);
  };

  async function resetPosition() {
    if (!rendition || !currentBookId) {
      return;
    }
    clearSavedPosition(currentBookId);
    lastLocationCfi = null;
    try {
      await rendition.display();
    } catch {
      // ignore
    }
  }

  async function rebuildRenditionKeepingLocation() {
    if (!book) {
      return;
    }
    // For flow changes we re-open the book, keeping the best-known CFI.
    const cfi =
      lastLocationCfi || (currentBookId ? loadSavedPositionCfi(currentBookId) : null);
    const fileParam = getFileParam();
    const reopeningFromUrl = !!fileParam && currentBookId === computeBookIdFromUrl(fileParam);

    if (reopeningFromUrl) {
      await openBookFromUrl(fileParam);
      if (cfi && rendition) {
        try {
          await rendition.display(cfi);
        } catch { }
      }
      return;
    }

    // If we opened via file picker, try to keep the current object URL.
    if (currentObjectUrl) {
      const keepUrl = currentObjectUrl;
      const keepId = currentBookId;
      const keepLabel = currentBookLabel;

      // Recreate book/rendition without revoking the blob URL.
      try {
        rendition?.destroy?.();
      } catch { }
      try {
        book?.destroy?.();
      } catch { }
      rendition = null;
      book = null;

      book = window.ePub(keepUrl);
      rendition = book.renderTo("viewer", {
        width: "100%",
        height: "100%",
        flow: getFlowPref(),
      });
      currentBookId = keepId;
      currentBookLabel = keepLabel;
      updateToolbarState();

      rendition.on("relocated", onRelocated);
      rendition.on("rendered", applyRenditionTheme);
      applyUiTheme();
      applyRenditionTheme();

      try {
        const navigation = await book.loaded.navigation;
        renderToc(navigation?.toc || []);
      } catch {
        renderToc([]);
      }

      try {
        if (cfi) {
          await rendition.display(cfi);
        } else {
          await rendition.display();
        }
      } catch {
        // ignore
      }
    }
  }

  async function runSearch(query) {
    if (!book || !rendition) {
      return;
    }
    const token = ++searchToken;
    $("searchResults").textContent = "";
    $("searchStatus").textContent = "";

    const q = (query || "").trim();
    if (!q) {
      return;
    }

    $("searchStatus").textContent = "Searching...";

    // Attempt to enumerate spine sections in a resilient way.
    try {
      await book.loaded.spine;
    } catch {
      // ignore
    }

    const spine = book.spine;
    const sections = [];
    if (spine) {
      if (Array.isArray(spine.spineItems)) {
        sections.push(...spine.spineItems);
      } else if (Array.isArray(spine.items)) {
        sections.push(...spine.items);
      } else if (typeof spine.each === "function") {
        try {
          spine.each(section => sections.push(section));
        } catch {
          // ignore
        }
      }
    }

    if (sections.length === 0) {
      $("searchStatus").textContent = "Search is not available for this book.";
      return;
    }

    const resultsContainer = $("searchResults");
    let totalMatches = 0;

    for (let i = 0; i < sections.length; i++) {
      if (token !== searchToken) {
        return;
      }
      const section = sections[i];
      let matches = [];
      try {
        matches = await section.find(q);
      } catch {
        matches = [];
      }

      if (Array.isArray(matches) && matches.length) {
        for (const m of matches) {
          if (token !== searchToken) {
            return;
          }
          const cfi = m?.cfi;
          const excerpt = m?.excerpt;
          if (typeof cfi !== "string" || !cfi) {
            continue;
          }
          totalMatches++;

          const a = document.createElement("a");
          a.className = "item";
          a.href = "#";
          a.textContent = excerpt && typeof excerpt === "string" ? excerpt.trim() : cfi;
          if (excerpt && typeof excerpt === "string") {
            const meta = document.createElement("span");
            meta.className = "meta";
            meta.textContent = cfi;
            a.appendChild(meta);
          }
          a.addEventListener("click", evt => {
            evt.preventDefault();
            rendition.display(cfi);
          });
          resultsContainer.appendChild(a);
        }
      }

      $("searchStatus").textContent = `Searching... (${i + 1}/${sections.length})`;
    }

    if (token !== searchToken) {
      return;
    }

    $("searchStatus").textContent =
      totalMatches === 0 ? "No matches." : `Matches: ${totalMatches}`;
    if (totalMatches > 0) {
      setSidebarOpen(true);
    }
  }

  function bindUi() {
    $("openBtn").addEventListener("click", () => $("openInput").click());
    $("openInput").addEventListener("change", evt => {
      const file = evt.target.files && evt.target.files[0];
      if (file) {
        openBookFromFile(file);
      }
      // Allow picking the same file again.
      evt.target.value = "";
    });

    $("prevBtn").addEventListener("click", () => rendition?.prev());
    $("nextBtn").addEventListener("click", () => rendition?.next());

    $("tocBtn").addEventListener("click", () => {
      const open = $("sidebar").hidden;
      setSidebarOpen(open);
    });
    $("closeSidebarBtn").addEventListener("click", () => setSidebarOpen(false));

    $("themeBtn").addEventListener("click", () => {
      const cur = getThemePref();
      const next = cur === "auto" ? "dark" : cur === "dark" ? "light" : "auto";
      setThemePref(next);
      applyUiTheme();
      applyRenditionTheme();
      updateToolbarState();
    });

    $("fontMinusBtn").addEventListener("click", () => {
      setFontScalePref(getFontScalePref() - 10);
      applyRenditionTheme();
      updateToolbarState();
    });
    $("fontPlusBtn").addEventListener("click", () => {
      setFontScalePref(getFontScalePref() + 10);
      applyRenditionTheme();
      updateToolbarState();
    });
    $("fontResetBtn").addEventListener("click", () => {
      setFontScalePref(DEFAULT_FONT_SCALE);
      applyRenditionTheme();
      updateToolbarState();
    });

    $("flowBtn").addEventListener("click", async () => {
      const cur = getFlowPref();
      const next = cur === "paginated" ? "scrolled" : "paginated";
      setFlowPref(next);
      updateToolbarState();
      await rebuildRenditionKeepingLocation();
    });

    $("invertBtn").addEventListener("click", () => {
      setInvertLevel((getInvertLevel() + 1) % 3);
      applyInversion();
      updateToolbarState();
    });

    $("resetPosBtn").addEventListener("click", () => resetPosition());

    $("searchBtn").addEventListener("click", () =>
      runSearch($("searchInput").value)
    );
    $("searchInput").addEventListener("keydown", evt => {
      if (evt.key === "Enter") {
        runSearch($("searchInput").value);
      }
    });

    // Keyboard navigation.
    document.addEventListener("keyup", e => {
      if (!rendition) {
        return;
      }
      if (e.key === "ArrowLeft") {
        rendition.prev();
      } else if (e.key === "ArrowRight") {
        rendition.next();
      } else if (e.key === "Home") {
        resetPosition();
      }
    });

    // Drag & drop an .epub onto the page.
    document.addEventListener("dragover", evt => {
      if (evt.dataTransfer) {
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "copy";
      }
    });
    document.addEventListener("drop", evt => {
      if (!evt.dataTransfer) {
        return;
      }
      evt.preventDefault();
      const f = evt.dataTransfer.files && evt.dataTransfer.files[0];
      if (!f) {
        return;
      }
      const name = (f.name || "").toLowerCase();
      if (name.endsWith(".epub")) {
        openBookFromFile(f);
      }
    });

    // Sync with system theme changes in auto mode.
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (getThemePref() !== "auto") {
          return;
        }
        applyUiTheme();
        applyRenditionTheme();
      };
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(onChange);
      }
    }
  }

  function init() {
    bindUi();
    applyUiTheme();
    updateToolbarState();
    setSidebarOpen(false);

    const fileParam = getFileParam();
    openBookFromUrl(fileParam);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
