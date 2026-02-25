// Reading position helpers for PDF.js viewer.
//
// PDF.js already persists "previous view" (page/zoom/scroll) in localStorage.
// This adds a toolbar button to reset the saved position for the *current* PDF.
(function () {
  "use strict";

  const BUTTON_ID = "resetReadPosButton";

  function getApp() {
    return window.PDFViewerApplication || null;
  }

  function getEventBus() {
    const app = getApp();
    return app && app.eventBus ? app.eventBus : null;
  }

  function isReady() {
    const app = getApp();
    return !!(app && app.pdfDocument && app.pdfViewer && app.store);
  }

  function computeTopLeftForFirstPage() {
    const app = getApp();
    const pdfViewer = app?.pdfViewer;
    if (!pdfViewer || typeof pdfViewer.getPageView !== "function") {
      return null;
    }

    const pageView = pdfViewer.getPageView(0);
    if (!pageView || typeof pageView.getPagePoint !== "function") {
      return null;
    }

    // Viewport point (0,0) is top-left in CSS pixels; convert to PDF point
    // (origin bottom-left), giving x=0, y=pageHeight.
    const pt = pageView.getPagePoint(0, 0);
    if (!Array.isArray(pt) || pt.length < 2) {
      return null;
    }

    const x = Math.round(pt[0]);
    const y = Math.round(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  async function resetSavedPositionForCurrentFile() {
    const app = getApp();
    if (!isReady()) {
      return;
    }

    const topLeft = computeTopLeftForFirstPage();
    if (!topLeft) {
      // If we can't compute a valid top-left position, avoid persisting a bogus
      // coordinate (it could restore to the bottom of the page next time).
      try {
        await app.store.setMultiple({ page: null });
      } catch {
        // ignore
      }
    } else {
      const scrollLeft = topLeft.x;
      const scrollTop = topLeft.y;

      // Persist the reset. Must go through the in-memory ViewHistory instance,
      // otherwise it may overwrite localStorage again on the next update.
      try {
        await app.store.setMultiple({
          page: 1,
          scrollLeft,
          scrollTop,
        });
      } catch {
        // ignore
      }
    }

    // Jump to the beginning without changing zoom.
    try {
      app.pdfViewer.scrollPageIntoView({
        pageNumber: 1,
        destArray: [null, { name: "XYZ" }, 0, null, null],
        allowNegativeOffset: true,
        ignoreDestinationZoom: true,
      });
    } catch {
      // ignore
    }
  }

  function updateButtonState() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) {
      return;
    }
    const ready = isReady() && !!computeTopLeftForFirstPage();
    btn.disabled = !ready;
    btn.title = ready
      ? "Reset saved position for this PDF (jump to page 1)"
      : "Reset saved position (open a PDF first)";
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
    btn.setAttribute("aria-label", "Reset saved position");

    btn.addEventListener("click", evt => {
      evt.preventDefault();
      resetSavedPositionForCurrentFile();
    });

    const span = document.createElement("span");
    span.textContent = "RST";
    btn.appendChild(span);

    const toolbar = document.getElementById("toolbarViewerRight");
    if (toolbar) {
      const before =
        document.getElementById("smartInvertToggle") ||
        document.getElementById("secondaryToolbarToggle");
      if (before) {
        toolbar.insertBefore(btn, before);
      } else {
        toolbar.appendChild(btn);
      }
    } else {
      document.body.appendChild(btn);
    }

    updateButtonState();
  }

  function attachWhenReady() {
    const eventBus = getEventBus();
    if (!eventBus) {
      setTimeout(attachWhenReady, 100);
      return;
    }

    // Update button enabled/disabled as documents open/close.
    eventBus.on("documentloaded", updateButtonState);
    eventBus.on("pagesinit", updateButtonState);
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }
    insertButton();
    attachWhenReady();
    updateButtonState();
  }

  init();
})();
