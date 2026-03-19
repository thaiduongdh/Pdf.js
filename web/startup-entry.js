(function () {
  "use strict";

  function getStartupMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("startup");
      return mode && mode.trim() ? mode.trim() : null;
    } catch {
      return null;
    }
  }

  function hasFileParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      return !!params.get("file");
    } catch {
      return false;
    }
  }

  function waitForElement(selector, callback, attempts = 60) {
    const element = document.querySelector(selector);
    if (element) {
      callback(element);
      return;
    }
    if (attempts <= 0) {
      return;
    }
    window.setTimeout(() => {
      waitForElement(selector, callback, attempts - 1);
    }, 100);
  }

  function openPdfPicker() {
    if (hasFileParam()) {
      return;
    }
    waitForElement("#fileInput", fileInput => {
      fileInput.setAttribute("accept", ".pdf,application/pdf");
      window.setTimeout(() => {
        fileInput.click();
      }, 0);
    });
  }

  function openEpubPicker() {
    if (hasFileParam()) {
      return;
    }
    const openInput = document.getElementById("openInput");
    if (!openInput) {
      return;
    }
    window.setTimeout(() => {
      openInput.click();
    }, 0);
  }

  function init() {
    const startupMode = getStartupMode();
    if (!startupMode) {
      return;
    }
    if (startupMode === "open-pdf") {
      openPdfPicker();
      return;
    }
    if (startupMode === "open-epub") {
      openEpubPicker();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
