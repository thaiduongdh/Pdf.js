// Smart page inversion for PDF.js viewer.
//
// - Automatically enables page inversion when the viewer UI is in dark mode.
// - Uses a lightweight per-page pixel heuristic to avoid inverting pages that are
//   already dark or are image/color heavy (to reduce negative-image effects).
// - Toggleable via a toolbar button; persisted in localStorage.
(function () {
  "use strict";

  // Legacy boolean toggle; keep reading/writing to avoid breaking existing prefs.
  const LEGACY_ENABLED_STORAGE_KEY = "pdfjs-smart-invert-enabled";
  // New: tri-state inversion level (0=off, 1=mild, 2=full).
  const LEVEL_STORAGE_KEY = "pdfjs-smart-invert-level";
  const MODE_STORAGE_KEY = "pdfjs-smart-invert-mode";
  const ROOT_ACTIVE_CLASS = "dark-mode"; // Enables rules in dark-mode.css.
  const ROOT_LEVEL_MILD_CLASS = "pdfjs-invert-mild";
  const ROOT_LEVEL_FULL_CLASS = "pdfjs-invert-full";
  const SMART_INVERT_CLASS = "pdfjs-smart-invert"; // Per page/thumbnail.
  const BUTTON_ID = "smartInvertToggle";

  // Keep prior behavior: inversion enabled by default (full) when dark mode is active.
  const DEFAULT_LEVEL = 2; // 0=off, 1=mild, 2=full
  const DEFAULT_MODE = "smart"; // "smart" | "always"

  const decisionByPage = new Map(); // pageNumber -> boolean
  const analysisScheduled = new Set(); // pageNumber
  let eventBusAttached = false;
  let cachedActive = false;

  // Reused canvas for sampling (avoid allocating ImageData from large canvases).
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

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
      // Ignore storage errors (e.g. disabled cookies).
    }
  }

  function clampLevel(level) {
    if (level === 0 || level === 1 || level === 2) {
      return level;
    }
    return DEFAULT_LEVEL;
  }

  function getLevel() {
    const raw = safeGetStorageItem(LEVEL_STORAGE_KEY);
    if (raw === "0" || raw === "1" || raw === "2") {
      return clampLevel(Number.parseInt(raw, 10));
    }

    // Back-compat: map legacy boolean to the default "full" level.
    const legacy = safeGetStorageItem(LEGACY_ENABLED_STORAGE_KEY);
    if (legacy === "0") {
      return 0;
    }
    if (legacy === "1") {
      return DEFAULT_LEVEL;
    }
    return DEFAULT_LEVEL;
  }

  function setLevel(level) {
    const next = clampLevel(level);
    safeSetStorageItem(LEVEL_STORAGE_KEY, String(next));
    // Keep legacy boolean in sync.
    safeSetStorageItem(LEGACY_ENABLED_STORAGE_KEY, next > 0 ? "1" : "0");
  }

  function getMode() {
    const raw = safeGetStorageItem(MODE_STORAGE_KEY);
    if (raw === "always" || raw === "smart") {
      return raw;
    }
    return DEFAULT_MODE;
  }

  function setMode(mode) {
    if (mode !== "always" && mode !== "smart") {
      mode = DEFAULT_MODE;
    }
    safeSetStorageItem(MODE_STORAGE_KEY, mode);
  }

  function isAlwaysMode() {
    return getMode() === "always";
  }

  function parseRgbColor(cssColor) {
    // Supports:
    // - rgb(r, g, b)
    // - rgba(r, g, b, a)
    // - rgb(r g b)
    // - rgb(r g b / a)
    const m = cssColor && cssColor.match(/rgba?\\(([^)]+)\\)/);
    if (!m) {
      return null;
    }
    const parts = m[1].trim().split(/\\s*[,\\s\\/]\\s*/).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return null;
    }
    return [r, g, b];
  }

  function getRelativeLuminanceFromRgb(r, g, b) {
    // Fast approximate luminance (sufficient for theme detection).
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function isViewerInDarkMode() {
    // Prefer a "real" signal from the rendered UI to stay in sync with native
    // viewer theming (prefers-color-scheme and any forced overrides).
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const rgb = parseRgbColor(bg);
      if (rgb) {
        const lum = getRelativeLuminanceFromRgb(rgb[0], rgb[1], rgb[2]);
        return lum < 0.5;
      }
    } catch {
      // ignore
    }
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function isInversionActive() {
    return cachedActive;
  }

  function setRootActive(active) {
    document.documentElement.classList.toggle(ROOT_ACTIVE_CLASS, active);
    document.body.classList.toggle(ROOT_ACTIVE_CLASS, active);
  }

  function setRootLevel(level) {
    const mild = level === 1;
    const full = level === 2;

    document.documentElement.classList.toggle(ROOT_LEVEL_MILD_CLASS, mild);
    document.body.classList.toggle(ROOT_LEVEL_MILD_CLASS, mild);

    document.documentElement.classList.toggle(ROOT_LEVEL_FULL_CLASS, full);
    document.body.classList.toggle(ROOT_LEVEL_FULL_CLASS, full);
  }

  function getPageDiv(pageNumber) {
    return document.querySelector(`.page[data-page-number=\"${pageNumber}\"]`);
  }

  function getThumbnailDiv(pageNumber) {
    return document.querySelector(`.thumbnail[page-number=\"${pageNumber}\"]`);
  }

  function clearAllDomInversion() {
    for (const el of document.querySelectorAll(`.page.${SMART_INVERT_CLASS}`)) {
      el.classList.remove(SMART_INVERT_CLASS);
    }
    for (const el of document.querySelectorAll(
      `.thumbnail.${SMART_INVERT_CLASS}`
    )) {
      el.classList.remove(SMART_INVERT_CLASS);
    }
  }

  function applyDecisionToDom(pageNumber) {
    const invert = decisionByPage.get(pageNumber);
    if (typeof invert !== "boolean") {
      return;
    }
    const active = isInversionActive();
    const pageDiv = getPageDiv(pageNumber);
    if (pageDiv) {
      pageDiv.classList.toggle(SMART_INVERT_CLASS, active && invert);
    }
    const thumbDiv = getThumbnailDiv(pageNumber);
    if (thumbDiv) {
      thumbDiv.classList.toggle(SMART_INVERT_CLASS, active && invert);
    }
  }

  function updateToggleButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) {
      return;
    }
    const level = getLevel();
    const mode = getMode();
    const active = isInversionActive();
    const levelLabel =
      level === 0 ? "off" : level === 1 ? "mild-black" : "black";

    btn.setAttribute("aria-pressed", level > 0 ? "true" : "false");
    btn.dataset.invertLevel = String(level);
    btn.title =
      (level > 0
        ? active
          ? `Inversion: ${levelLabel} (dark mode)`
          : `Inversion: ${levelLabel} (light mode)`
        : "Inversion: off") +
      ` | Mode: ${mode === "always" ? "Foxit (always invert)" : "Smart"}` +
      " | Click: cycle off/mild/black" +
      " | Shift+click: change mode";

    // Stable label to avoid font/layout shifts (use title for state).
    btn.textContent = "";
    const span = document.createElement("span");
    span.textContent = "INV";
    btn.appendChild(span);
  }

  function computeSmartInvert(el) {
    // Conservative fallback: keep prior behavior (invert) if we can't sample.
    if (!sampleCtx) {
      return true;
    }

    let srcW, srcH;
    if (el instanceof HTMLCanvasElement) {
      srcW = el.width;
      srcH = el.height;
    } else if (el instanceof HTMLImageElement) {
      srcW = el.naturalWidth || el.width;
      srcH = el.naturalHeight || el.height;
    } else {
      return true;
    }
    if (!srcW || !srcH) {
      return true;
    }

    const maxDim = 160;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    sampleCanvas.width = w;
    sampleCanvas.height = h;
    sampleCtx.imageSmoothingEnabled = true;
    sampleCtx.clearRect(0, 0, w, h);

    try {
      sampleCtx.drawImage(el, 0, 0, w, h);
    } catch {
      return true;
    }

    let data;
    try {
      data = sampleCtx.getImageData(0, 0, w, h).data;
    } catch {
      return true;
    }

    const margin = Math.max(1, Math.round(Math.min(w, h) * 0.08));

    let opaque = 0;
    let sumLum = 0;
    let borderCount = 0;
    let borderLumSum = 0;

    for (let y = 0; y < h; y++) {
      const isBorderY = y < margin || y >= h - margin;
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const a = data[idx + 3];
        if (a < 16) {
          continue;
        }
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        opaque++;
        const lum = getRelativeLuminanceFromRgb(r, g, b);
        sumLum += lum;

        if (isBorderY || x < margin || x >= w - margin) {
          borderCount++;
          borderLumSum += lum;
        }
      }
    }

    if (opaque === 0) {
      return true;
    }

    const avgLum = sumLum / opaque;
    const borderLum = borderCount > 0 ? borderLumSum / borderCount : avgLum;

    // Heuristic: invert pages that are likely "light paper" (bright borders).
    // This is intentionally conservative; use "always" mode for Foxit-like behavior.
    if (borderLum < 0.55) {
      return false;
    }
    // If the border is moderately bright, require the page to be at least mid-bright.
    if (borderLum < 0.7 && avgLum < 0.55) {
      return false;
    }
    return true;
  }

  function scheduleAnalysis(pageNumber, el) {
    if (isAlwaysMode()) {
      decisionByPage.set(pageNumber, true);
      applyDecisionToDom(pageNumber);
      return;
    }
    if (decisionByPage.has(pageNumber) || analysisScheduled.has(pageNumber)) {
      applyDecisionToDom(pageNumber);
      return;
    }
    analysisScheduled.add(pageNumber);

    const run = () => {
      analysisScheduled.delete(pageNumber);
      let invert = true;
      try {
        invert = computeSmartInvert(el);
      } catch {
        invert = true;
      }
      decisionByPage.set(pageNumber, invert);
      applyDecisionToDom(pageNumber);
    };

    if (window.requestIdleCallback) {
      window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 0);
    }
  }

  function onPageRendered(evt) {
    if (!evt || evt.error) {
      return;
    }
    const pageNumber = evt.pageNumber;
    if (!Number.isFinite(pageNumber)) {
      return;
    }

    if (!isInversionActive()) {
      getPageDiv(pageNumber)?.classList.remove(SMART_INVERT_CLASS);
      return;
    }

    if (isAlwaysMode()) {
      decisionByPage.set(pageNumber, true);
      getPageDiv(pageNumber)?.classList.add(SMART_INVERT_CLASS);
      applyDecisionToDom(pageNumber);
      return;
    }

    // Optimistic default in dark mode: invert until analysis says otherwise.
    getPageDiv(pageNumber)?.classList.add(SMART_INVERT_CLASS);

    // Avoid analyzing detail-view tiles; rely on the main page render.
    if (evt.isDetailView) {
      applyDecisionToDom(pageNumber);
      return;
    }

    if (decisionByPage.has(pageNumber)) {
      applyDecisionToDom(pageNumber);
      return;
    }

    const canvas = evt.source?.canvas;
    if (canvas instanceof HTMLCanvasElement) {
      scheduleAnalysis(pageNumber, canvas);
      return;
    }
    const fallbackCanvas = getPageDiv(pageNumber)?.querySelector("canvas");
    if (fallbackCanvas instanceof HTMLCanvasElement) {
      scheduleAnalysis(pageNumber, fallbackCanvas);
    }
  }

  function onThumbnailRendered(evt) {
    if (!evt) {
      return;
    }
    const pageNumber = evt.pageNumber;
    if (!Number.isFinite(pageNumber)) {
      return;
    }

    if (decisionByPage.has(pageNumber)) {
      applyDecisionToDom(pageNumber);
      return;
    }
    if (!isInversionActive()) {
      return;
    }

    if (isAlwaysMode()) {
      decisionByPage.set(pageNumber, true);
      getThumbnailDiv(pageNumber)?.classList.add(SMART_INVERT_CLASS);
      applyDecisionToDom(pageNumber);
      return;
    }

    // Optimistic default in dark mode: invert until analysis says otherwise.
    getThumbnailDiv(pageNumber)?.classList.add(SMART_INVERT_CLASS);

    const img = evt.source?.image;
    if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) {
      scheduleAnalysis(pageNumber, img);
      return;
    }

    const fallbackImg =
      getThumbnailDiv(pageNumber)?.querySelector("img.thumbnailImage");
    if (
      fallbackImg instanceof HTMLImageElement &&
      fallbackImg.complete &&
      fallbackImg.naturalWidth > 0
    ) {
      scheduleAnalysis(pageNumber, fallbackImg);
    }
  }

  function attachEventBusWhenReady() {
    if (eventBusAttached) {
      return;
    }
    const eventBus = window.PDFViewerApplication?.eventBus;
    if (eventBus && typeof eventBus.on === "function") {
      eventBus.on("pagerendered", onPageRendered);
      eventBus.on("thumbnailrendered", onThumbnailRendered);
      eventBusAttached = true;
      return;
    }
    // Retry shortly; viewer sets up eventBus during initialization.
    setTimeout(attachEventBusWhenReady, 100);
  }

  function insertButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.className = "toolbarButton";
    btn.type = "button";
    btn.tabIndex = 0;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Toggle smart inversion");

    btn.addEventListener("click", evt => {
      if (evt.shiftKey) {
        setMode(isAlwaysMode() ? "smart" : "always");
        // Mode affects cached decisions.
        decisionByPage.clear();
        analysisScheduled.clear();
        updateAll();
        return;
      }
      // Cycle: off -> mild -> black -> off
      setLevel((getLevel() + 1) % 3);
      updateAll();
    });

    const toolbar = document.getElementById("toolbarViewerRight");
    if (toolbar) {
      const secondaryToggle = document.getElementById("secondaryToolbarToggle");
      if (secondaryToggle) {
        toolbar.insertBefore(btn, secondaryToggle);
      } else {
        toolbar.appendChild(btn);
      }
    } else {
      // Fallback (shouldn't happen).
      document.body.appendChild(btn);
    }

    updateToggleButton();
  }

  function updateAll() {
    const level = getLevel();
    const active = (cachedActive = level > 0 && isViewerInDarkMode());
    setRootActive(active);
    setRootLevel(level);
    updateToggleButton();

    if (!active) {
      clearAllDomInversion();
      return;
    }

    if (isAlwaysMode()) {
      for (const pageDiv of document.querySelectorAll(".page")) {
        pageDiv.classList.add(SMART_INVERT_CLASS);
      }
      for (const thumbDiv of document.querySelectorAll(".thumbnail")) {
        thumbDiv.classList.add(SMART_INVERT_CLASS);
      }
      return;
    }

    // Apply cached decisions, then try to analyze any currently rendered pages.
    for (const pageNumber of decisionByPage.keys()) {
      applyDecisionToDom(pageNumber);
    }

    for (const pageDiv of document.querySelectorAll(".page")) {
      const pageNumber = Number.parseInt(
        pageDiv.getAttribute("data-page-number"),
        10
      );
      if (!Number.isFinite(pageNumber) || decisionByPage.has(pageNumber)) {
        continue;
      }
      const canvas = pageDiv.querySelector("canvas");
      // Optimistic default in dark mode: invert until analysis says otherwise.
      pageDiv.classList.add(SMART_INVERT_CLASS);
      if (canvas instanceof HTMLCanvasElement) {
        scheduleAnalysis(pageNumber, canvas);
      }
    }

    for (const thumbDiv of document.querySelectorAll(".thumbnail")) {
      const pageNumber = Number.parseInt(thumbDiv.getAttribute("page-number"), 10);
      if (!Number.isFinite(pageNumber) || decisionByPage.has(pageNumber)) {
        continue;
      }
      // Optimistic default in dark mode: invert until analysis says otherwise.
      thumbDiv.classList.add(SMART_INVERT_CLASS);
    }
  }

  function bindThemeListeners() {
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", updateAll);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(updateAll);
      }
    }

    // Track forced theme changes via inline styles/classes.
    const mo = new MutationObserver(updateAll);
    try {
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      mo.observe(document.body, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    } catch {
      // ignore
    }
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }

    insertButton();
    bindThemeListeners();
    attachEventBusWhenReady();
    updateAll();
  }

  init();
})();
