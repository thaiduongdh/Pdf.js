// Drag-and-Drop handler for PDF.js and EPUB viewers.
//
// Shows a full-screen overlay when files are dragged over, and opens
// dropped PDF/EPUB files in the appropriate viewer.
(function () {
    "use strict";

    const OVERLAY_ID = "dropOverlay";
    let dragCounter = 0;

    function isPdfViewer() {
        return !!window.PDFViewerApplication;
    }

    function isEpubViewer() {
        return window.location.pathname.includes("epub-viewer");
    }

    function createOverlay() {
        if (document.getElementById(OVERLAY_ID)) {
            return;
        }
        const overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.innerHTML = `
      <div style="
        position: fixed; inset: 0; z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(4px);
        pointer-events: none;
        transition: opacity 0.15s;
      ">
        <div style="
          background: rgba(255,255,255,0.12);
          border: 2px dashed rgba(255,255,255,0.5);
          border-radius: 16px;
          padding: 40px 60px;
          color: #fff;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 18px;
          font-weight: 600;
          text-align: center;
          user-select: none;
        ">
          <div style="font-size: 36px; margin-bottom: 8px;">📄</div>
          Drop PDF or EPUB to open
        </div>
      </div>
    `;
        overlay.style.display = "none";
        document.body.appendChild(overlay);
    }

    function showOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            overlay.style.display = "block";
        }
    }

    function hideOverlay() {
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) {
            overlay.style.display = "none";
        }
    }

    function getFileExtension(file) {
        const name = (file.name || "").toLowerCase();
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.slice(dot) : "";
    }

    function hasFileDrag(evt) {
        if (!evt.dataTransfer) {
            return false;
        }
        // Check types for "Files"
        const types = evt.dataTransfer.types;
        if (types) {
            for (let i = 0; i < types.length; i++) {
                if (types[i] === "Files") {
                    return true;
                }
            }
        }
        return false;
    }

    function openPdfFile(file) {
        const url = URL.createObjectURL(file);
        // PDF.js can open blob URLs directly via its open method.
        const app = window.PDFViewerApplication;
        if (app && typeof app.open === "function") {
            app.open({ url });
            // Record in recent files.
            try {
                window.pdfjsRecentFiles?.record(url, file.name, "pdf");
            } catch {
                // ignore
            }
            // Hide the recent files overlay if visible.
            const rfOverlay = document.getElementById("recentFilesOverlay");
            if (rfOverlay) {
                rfOverlay.hidden = true;
            }
            return;
        }
        // Fallback: navigate.
        window.location.href = `viewer.html?file=${encodeURIComponent(url)}`;
    }

    function openEpubFile(file) {
        // Use the exposed function from epub-viewer.js.
        if (typeof window.epubViewerOpenFile === "function") {
            window.epubViewerOpenFile(file);
            return;
        }
        // Fallback: for non-epub-viewer pages, navigate to the epub viewer.
        // We can't pass a File across navigation, so create a blob URL.
        const url = URL.createObjectURL(file);
        window.location.href = `epub-viewer.html?file=${encodeURIComponent(url)}`;
    }

    function handleDrop(evt) {
        dragCounter = 0;
        hideOverlay();

        if (!evt.dataTransfer) {
            return;
        }
        evt.preventDefault();

        const file = evt.dataTransfer.files && evt.dataTransfer.files[0];
        if (!file) {
            return;
        }

        const ext = getFileExtension(file);

        if (ext === ".pdf") {
            if (isEpubViewer()) {
                // On the EPUB viewer but got a PDF — open PDF viewer.
                const url = URL.createObjectURL(file);
                window.location.href = `viewer.html?file=${encodeURIComponent(url)}`;
            } else {
                openPdfFile(file);
            }
        } else if (ext === ".epub") {
            if (isEpubViewer()) {
                openEpubFile(file);
            } else {
                // On the PDF viewer but got an EPUB — open EPUB viewer.
                // Can't transfer the File across navigation easily, so use blob URL.
                const url = URL.createObjectURL(file);
                window.location.href = `epub-viewer.html?file=${encodeURIComponent(url)}`;
            }
        }
        // Ignore unsupported file types silently.
    }

    function init() {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", init, { once: true });
            return;
        }

        createOverlay();

        document.addEventListener("dragenter", (evt) => {
            if (!hasFileDrag(evt)) {
                return;
            }
            evt.preventDefault();
            dragCounter++;
            if (dragCounter === 1) {
                showOverlay();
            }
        });

        document.addEventListener("dragover", (evt) => {
            if (!hasFileDrag(evt)) {
                return;
            }
            evt.preventDefault();
            if (evt.dataTransfer) {
                evt.dataTransfer.dropEffect = "copy";
            }
        });

        document.addEventListener("dragleave", (evt) => {
            if (!hasFileDrag(evt)) {
                return;
            }
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                hideOverlay();
            }
        });

        document.addEventListener("drop", handleDrop);
    }

    init();
})();
