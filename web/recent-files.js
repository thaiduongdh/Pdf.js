(function () {
  "use strict";

  const STORAGE_KEY = "pdfjs-recent-files";
  const MAX_ENTRIES = 20;
  const OVERLAY_ID = "recentFilesOverlay";

  function sanitizeEntries(entries) {
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries.filter(entry => {
      return entry &&
        typeof entry.url === "string" &&
        entry.url &&
        !entry.url.startsWith("blob:");
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const entries = sanitizeEntries(JSON.parse(raw));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return entries;
    } catch {
      return [];
    }
  }

  function save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeEntries(entries)));
    } catch {
      // Ignore storage errors.
    }
  }

  function record(url, name, type) {
    if (!url || String(url).startsWith("blob:")) {
      return;
    }

    if (!name) {
      try {
        const decoded = decodeURIComponent(url);
        const parts = decoded.replace(/\\/g, "/").split("/");
        name = parts[parts.length - 1] || decoded;
      } catch {
        name = url;
      }
    }

    if (!type) {
      const lower = (name || url).toLowerCase();
      type = lower.endsWith(".epub") ? "epub" : "pdf";
    }

    const filtered = load().filter(entry => entry.url !== url);
    filtered.unshift({ url, name, type, ts: Date.now() });
    if (filtered.length > MAX_ENTRIES) {
      filtered.length = MAX_ENTRIES;
    }
    save(filtered);
  }

  function remove(url) {
    save(load().filter(entry => entry.url !== url));
  }

  function clear() {
    save([]);
  }

  window.pdfjsRecentFiles = { record, remove, clear, load };

  function hasFileParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      return !!params.get("file");
    } catch {
      return false;
    }
  }

  function isEpubViewer() {
    return window.location.pathname.includes("epub-viewer");
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function buildRecentViewerUrl(entry) {
    const page = entry.type === "epub" ? "epub-viewer.html" : "viewer.html";
    try {
      const absoluteUrl = new URL(entry.url, window.location.origin).href;
      return `${page}?file=${encodeURIComponent(absoluteUrl)}`;
    } catch {
      // Fall back to the raw value below.
    }
    return `${page}?file=${encodeURIComponent(entry.url)}`;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  function escapeAttr(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatRelativeTime(timestamp) {
    try {
      const then = new Date(timestamp);
      const diffMinutes = Math.floor((Date.now() - then.getTime()) / 60000);
      if (diffMinutes < 1) {
        return "Just now";
      }
      if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
      }
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) {
        return `${diffHours}h ago`;
      }
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) {
        return `${diffDays}d ago`;
      }
      return then.toLocaleDateString();
    } catch {
      return "";
    }
  }

  function openPdfPicker() {
    const fileInput = document.getElementById("fileInput");
    if (!fileInput) {
      return;
    }
    fileInput.setAttribute("accept", ".pdf,application/pdf");
    fileInput.click();
  }

  function renderOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      return;
    }

    const recentEntries = load();
    let html = "";
    html += `<div class="rf-card">`;
    html += `<div class="rf-header">`;
    html += `<div>`;
    html += `<h2 class="rf-title">Choose a Document</h2>`;
    html += `<p class="rf-subtitle">Use the local browser for folders or reopen a recent document.</p>`;
    html += `</div>`;
    html += `<div class="rf-actions">`;
    html += `<button class="rf-actionButton" type="button" data-action="open-pdf">Open PDF</button>`;
    html += `<a class="rf-actionButton" href="epub-viewer.html">Open EPUB</a>`;
    html += `<a class="rf-actionButton rf-actionButtonPrimary" href="files-classic.html">Open Built-In Browser</a>`;
    html += `<a class="rf-actionButton" href="files.html">Open File Browser</a>`;
    html += `</div>`;
    html += `</div>`;

    html += `<section class="rf-panel">`;
    html += `<div class="rf-panelHeader">`;
    html += `<h3 class="rf-sectionTitle">Recent Files</h3>`;
    html += `<p class="rf-panelHint">PDFs and EPUBs opened from ChromeViewerA3.</p>`;
    html += `</div>`;

    if (recentEntries.length === 0) {
      html += `<div class="rf-empty">No recent files yet.</div>`;
    } else {
      html += `<ul class="rf-list">`;
      for (const entry of recentEntries) {
        const viewerUrl = buildRecentViewerUrl(entry);
        const time = formatRelativeTime(entry.ts);
        html += `<li class="rf-listRow">`;
        html += `<a class="rf-item" href="${viewerUrl}" title="${escapeAttr(entry.name || "")}">`;
        html += `<span class="rf-icon" data-type="${escapeAttr(entry.type || "pdf")}">${escapeHtml((entry.type || "pdf").toUpperCase())}</span>`;
        html += `<span class="rf-info">`;
        html += `<span class="rf-name">${escapeHtml(entry.name || entry.url)}</span>`;
        if (time) {
          html += `<span class="rf-meta">${escapeHtml(time)}</span>`;
        }
        html += `</span>`;
        html += `</a>`;
        html += `<button class="rf-remove" type="button" data-url="${escapeAttr(entry.url)}" title="Remove from recent files">x</button>`;
        html += `</li>`;
      }
      html += `</ul>`;
      html += `<div class="rf-footer"><button class="rf-clear" type="button">Clear all</button></div>`;
    }

    html += `</section>`;
    html += `</div>`;

    overlay.innerHTML = html;
    overlay.hidden = false;

    for (const button of overlay.querySelectorAll(".rf-remove")) {
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        remove(button.getAttribute("data-url"));
        renderOverlay();
      });
    }

    const clearButton = overlay.querySelector(".rf-clear");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        clear();
        renderOverlay();
      });
    }

    const openPdfButton = overlay.querySelector("[data-action=\"open-pdf\"]");
    if (openPdfButton) {
      openPdfButton.addEventListener("click", event => {
        event.preventDefault();
        openPdfPicker();
      });
    }
  }

  function autoRecordPdf() {
    let recorded = false;

    function recordCurrentPdf() {
      if (recorded) {
        return;
      }
      recorded = true;
      try {
        const params = new URLSearchParams(window.location.search);
        const fileParam = params.get("file");
        if (fileParam && !String(fileParam).startsWith("blob:")) {
          let name = fileParam;
          try {
            const decoded = decodeURIComponent(fileParam);
            const parts = decoded.replace(/\\/g, "/").split("/");
            name = parts[parts.length - 1] || decoded;
            if (decoded.includes("/stream?path=") || decoded.includes("/stream?")) {
              const url = new URL(decoded, window.location.origin);
              const streamPath = url.searchParams.get("path");
              if (streamPath) {
                const streamParts = streamPath.replace(/\\/g, "/").split("/");
                name = streamParts[streamParts.length - 1] || name;
              }
            }
          } catch {
            // Keep the raw file param.
          }
          record(fileParam, name, "pdf");
        }
      } catch {
        // Ignore record failures.
      }
    }

    function waitForEventBus(app, attempts = 120) {
      const bus = app.eventBus;
      if (bus && typeof bus.on === "function") {
        bus.on("documentloaded", () => {
          hideOverlay();
          recordCurrentPdf();
        });
        if (app.pdfDocument) {
          recordCurrentPdf();
        }
        return;
      }
      if (attempts <= 0) {
        return;
      }
      setTimeout(() => {
        waitForEventBus(app, attempts - 1);
      }, 100);
    }

    function waitForApp(attempts = 120) {
      const app = window.PDFViewerApplication;
      if (app) {
        waitForEventBus(app);
        return;
      }
      if (attempts <= 0) {
        return;
      }
      setTimeout(() => {
        waitForApp(attempts - 1);
      }, 100);
    }

    waitForApp();
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }

    if (!isEpubViewer()) {
      if (!hasFileParam()) {
        const container = document.getElementById("viewerContainer");
        if (container && !document.getElementById(OVERLAY_ID)) {
          const overlay = document.createElement("div");
          overlay.id = OVERLAY_ID;
          container.appendChild(overlay);
          renderOverlay();
        }
      }
      autoRecordPdf();
    }
  }

  init();
})();
