// Recent Files tracker and landing page for PDF.js / EPUB viewer.
//
// - Tracks opened PDFs and EPUBs in localStorage.
// - Shows a landing page with recent files when no ?file= param is present.
// - Exposes window.pdfjsRecentFiles.record(url, name) for cross-viewer use.
(function () {
  "use strict";

  const STORAGE_KEY = "pdfjs-recent-files";
  const MAX_ENTRIES = 20;
  const OVERLAY_ID = "recentFilesOverlay";

  // ── Storage helpers ──────────────────────────────────────────────────

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          return arr;
        }
      }
    } catch {
      // ignore
    }
    return [];
  }

  function save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // ignore
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Record a file as recently opened.
   * @param {string} url  – The URL used to open the file (viewer ?file= value).
   * @param {string} name – Human-readable display name (filename).
   * @param {string} [type] – "pdf" or "epub". Auto-detected from name if omitted.
   */
  function record(url, name, type) {
    if (!url) {
      return;
    }
    if (!name) {
      // Derive name from URL.
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

    const entries = load();
    // Remove duplicate.
    const filtered = entries.filter(
      (e) => e.url !== url
    );
    filtered.unshift({ url, name, type, ts: Date.now() });
    // Cap.
    if (filtered.length > MAX_ENTRIES) {
      filtered.length = MAX_ENTRIES;
    }
    save(filtered);
  }

  function remove(url) {
    const entries = load().filter((e) => e.url !== url);
    save(entries);
  }

  function clear() {
    save([]);
  }

  // Expose globally so epub-viewer.js (and others) can call it.
  window.pdfjsRecentFiles = { record, remove, clear, load };

  // ── Landing Page ─────────────────────────────────────────────────────

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

  function formatTime(ts) {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return "Just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 7) return `${diffDay}d ago`;
      return d.toLocaleDateString();
    } catch {
      return "";
    }
  }

  function buildViewerUrl(entry) {
    if (entry.type === "epub") {
      return `epub-viewer.html?file=${encodeURIComponent(entry.url)}`;
    }
    return `viewer.html?file=${encodeURIComponent(entry.url)}`;
  }

  function renderOverlay() {
    const entries = load();
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      return;
    }

    let html = `<div class="rf-card">`;
    html += `<h2 class="rf-title">Recent Files</h2>`;
    html += `<p class="rf-subtitle">PDFs and EPUBs you've opened recently</p>`;

    if (entries.length === 0) {
      html += `<div class="rf-empty">No recent files yet.<br>Open a PDF or EPUB to get started.</div>`;
    } else {
      html += `<ul class="rf-list">`;
      for (const entry of entries) {
        const viewerUrl = buildViewerUrl(entry);
        const typeUpper = (entry.type || "pdf").toUpperCase();
        const time = formatTime(entry.ts);
        html += `<li>`;
        html += `<a class="rf-item" href="${viewerUrl}" title="${entry.name || ""}">`;
        html += `<span class="rf-icon" data-type="${entry.type || "pdf"}">${typeUpper}</span>`;
        html += `<span class="rf-info">`;
        html += `<span class="rf-name">${escapeHtml(entry.name || entry.url)}</span>`;
        if (time) {
          html += `<span class="rf-meta">${time}</span>`;
        }
        html += `</span>`;
        html += `</a>`;
        html += `<button class="rf-remove" data-url="${escapeAttr(entry.url)}" title="Remove">×</button>`;
        html += `</li>`;
      }
      html += `</ul>`;
      html += `<div class="rf-footer"><button class="rf-clear" type="button">Clear all</button></div>`;
    }

    html += `</div>`;
    overlay.innerHTML = html;
    overlay.hidden = false;

    // Bind remove buttons.
    for (const btn of overlay.querySelectorAll(".rf-remove")) {
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        remove(btn.dataset.url);
        renderOverlay();
      });
    }

    // Bind clear button.
    const clearBtn = overlay.querySelector(".rf-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        clear();
        renderOverlay();
      });
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Auto-record for PDF viewer ──────────────────────────────────────

  function autoRecordPdf() {
    const app = window.PDFViewerApplication;
    if (!app) {
      return;
    }

    function waitForEventBus() {
      const bus = app.eventBus;
      if (bus && typeof bus.on === "function") {
        bus.on("documentloaded", () => {
          // Hide landing UI when a document is opened without ?file= (e.g. local file picker).
          hideOverlay();
          try {
            const params = new URLSearchParams(window.location.search);
            const fileParam = params.get("file");
            if (fileParam) {
              // Try to derive a nice name.
              let name = fileParam;
              try {
                const decoded = decodeURIComponent(fileParam);
                const parts = decoded.replace(/\\/g, "/").split("/");
                name = parts[parts.length - 1] || decoded;
                // If it's a /stream?path=... URL, extract the filename.
                if (decoded.includes("/stream?path=") || decoded.includes("/stream?")) {
                  const u = new URL(decoded, window.location.origin);
                  const p = u.searchParams.get("path");
                  if (p) {
                    const pp = p.replace(/\\/g, "/").split("/");
                    name = pp[pp.length - 1] || name;
                  }
                }
              } catch {
                // keep raw
              }
              record(fileParam, name, "pdf");
            }
          } catch {
            // ignore
          }
        });
        return;
      }
      setTimeout(waitForEventBus, 100);
    }

    waitForEventBus();
  }

  // ── Init ─────────────────────────────────────────────────────────────

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
      return;
    }

    // Only show landing page on PDF viewer (epub-viewer has its own flow).
    if (!isEpubViewer()) {
      if (!hasFileParam()) {
        // Inject overlay container.
        const container = document.getElementById("viewerContainer");
        if (container) {
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
