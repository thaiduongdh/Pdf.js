(function () {
  "use strict";

  const STORAGE_KEY = "chromeviewera3-files-current-path";
  const app = document.getElementById("filesApp");
  const state = {
    loading: false,
    data: null,
    error: "",
    filter: "",
    selectedPath: "",
    requestToken: 0,
  };

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

  function formatDateTime(value) {
    if (!Number.isFinite(value)) {
      return "";
    }
    try {
      return new Date(value).toLocaleString();
    } catch {
      return "";
    }
  }

  function formatBytes(size) {
    if (!Number.isFinite(size) || size < 0) {
      return "";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = size;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const rounded = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
    return `${rounded} ${units[unitIndex]}`;
  }

  function getStoredPath() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored && stored.trim() ? stored.trim() : null;
    } catch {
      return null;
    }
  }

  function setStoredPath(pathValue) {
    try {
      if (!pathValue) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, pathValue);
      }
    } catch {
      // Ignore storage failures.
    }
  }

  function getRequestedPath() {
    try {
      const params = new URLSearchParams(window.location.search);
      const pathValue = params.get("path");
      return pathValue && pathValue.trim() ? pathValue.trim() : null;
    } catch {
      return null;
    }
  }

  function isCurrentPath(targetPath) {
    const currentPath = state.data && state.data.currentPath ? state.data.currentPath : "";
    if (!currentPath || !targetPath) {
      return false;
    }
    const normalizedCurrent = currentPath.replace(/[\\/]+$/, "").toLowerCase();
    const normalizedTarget = targetPath.replace(/[\\/]+$/, "").toLowerCase();
    return normalizedCurrent === normalizedTarget ||
      normalizedCurrent.startsWith(`${normalizedTarget}\\`) ||
      normalizedCurrent.startsWith(`${normalizedTarget}/`);
  }

  function buildStreamUrl(filePath) {
    return `/stream?path=${encodeURIComponent(filePath)}`;
  }

  function buildAbsoluteFileUrl(fileUrl) {
    return new URL(fileUrl, window.location.origin).href;
  }

  function buildEntryUrl(entry) {
    if (!entry || entry.kind === "directory") {
      return "";
    }
    const fileUrl = buildAbsoluteFileUrl(buildStreamUrl(entry.path));
    if (entry.reader === "epub") {
      return `epub-viewer.html?file=${encodeURIComponent(fileUrl)}`;
    }
    if (entry.reader === "pdf") {
      return `viewer.html?file=${encodeURIComponent(fileUrl)}`;
    }
    return fileUrl;
  }

  function getTypeLabel(entry) {
    if (!entry || entry.kind === "directory") {
      return "Folder";
    }
    if (entry.reader === "pdf") {
      return "PDF";
    }
    if (entry.reader === "epub") {
      return "EPUB";
    }
    const extension = String(entry.extension || "").replace(/^\./, "").trim();
    return extension ? extension.toUpperCase() : "FILE";
  }

  function getBadgeKind(entry) {
    if (!entry || entry.kind === "directory") {
      return "directory";
    }
    if (entry.reader === "pdf" || entry.reader === "epub") {
      return entry.reader;
    }
    return "file";
  }

  function getFilteredEntries() {
    const entries = state.data && Array.isArray(state.data.entries) ? state.data.entries : [];
    const query = state.filter.trim().toLowerCase();
    if (!query) {
      return entries;
    }
    return entries.filter(entry => String(entry.name || "").toLowerCase().includes(query));
  }

  function getSelectedEntry(entries) {
    if (!state.selectedPath) {
      return null;
    }
    return entries.find(entry => entry.path === state.selectedPath) || null;
  }

  function selectEntry(pathValue) {
    state.selectedPath = pathValue || "";
    syncSelection();
  }

  function openEntry(entry) {
    if (!entry) {
      return;
    }
    if (entry.kind === "directory") {
      loadDirectory(entry.path, false);
      return;
    }
    const entryUrl = buildEntryUrl(entry);
    if (!entryUrl) {
      return;
    }
    if (entry.reader === "pdf" || entry.reader === "epub") {
      window.location.assign(entryUrl);
      return;
    }
    const openedWindow = window.open(entryUrl, "_blank");
    if (openedWindow) {
      openedWindow.opener = null;
    }
  }

  function renderSidebarSection(title, items, kind) {
    if (!Array.isArray(items) || items.length === 0) {
      return "";
    }

    let html = `<section class="fb-sidebarSection">`;
    html += `<h2 class="fb-sidebarLabel">${escapeHtml(title)}</h2>`;
    html += `<div class="fb-sidebarList">`;
    for (const item of items) {
      const itemLabel = item.label || item.name || item.path;
      html += `<button class="fb-sidebarButton${isCurrentPath(item.path) ? " is-active" : ""}"`;
      html += ` type="button" data-nav-path="${escapeAttr(item.path)}">`;
      html += `<span class="fb-sidebarIcon" data-kind="${escapeAttr(kind)}">${escapeHtml(kind === "root" ? "DRV" : "DIR")}</span>`;
      html += `<span class="fb-sidebarText">`;
      html += `<span class="fb-sidebarTitle">${escapeHtml(itemLabel)}</span>`;
      html += `<span class="fb-sidebarMeta">${escapeHtml(item.path)}</span>`;
      html += `</span>`;
      html += `</button>`;
    }
    html += `</div>`;
    html += `</section>`;
    return html;
  }

  function renderBreadcrumbs() {
    const breadcrumbs = state.data && Array.isArray(state.data.breadcrumbs)
      ? state.data.breadcrumbs
      : [];

    if (breadcrumbs.length === 0) {
      return `<div class="fb-breadcrumbs"><span class="fb-statusText">Choose a folder to begin.</span></div>`;
    }

    let html = `<div class="fb-breadcrumbs">`;
    for (let index = 0; index < breadcrumbs.length; index += 1) {
      const crumb = breadcrumbs[index];
      html += `<button class="fb-breadcrumbButton" type="button" data-nav-path="${escapeAttr(crumb.path)}">${escapeHtml(crumb.label)}</button>`;
      if (index < breadcrumbs.length - 1) {
        html += `<span class="fb-breadcrumbSep">/</span>`;
      }
    }
    html += `</div>`;
    return html;
  }

  function renderTable(entries) {
    if (entries.length === 0) {
      const emptyMessage = state.filter
        ? "No folders or files match this search."
        : "This folder has no visible folders or files.";
      return (
        `<div class="fb-empty">` +
          `<div>` +
            `<h2 class="fb-emptyTitle">Nothing to show</h2>` +
            `<p class="fb-emptyMeta">${escapeHtml(emptyMessage)}</p>` +
          `</div>` +
        `</div>`
      );
    }

    let html = "";
    html += `<table class="fb-table">`;
    html += `<thead><tr><th>Name</th><th>Type</th><th>Modified</th><th>Size</th></tr></thead>`;
    html += `<tbody>`;
    for (const entry of entries) {
      const isSelected = entry.path === state.selectedPath;
      const typeLabel = getTypeLabel(entry);
      const timeLabel = formatDateTime(entry.modifiedMs);
      const sizeLabel = entry.kind === "directory" ? "" : formatBytes(entry.size);
      const badgeKind = getBadgeKind(entry);

      html += `<tr class="fb-row${isSelected ? " is-selected" : ""}" data-entry-path="${escapeAttr(entry.path)}"`;
      html += ` data-entry-kind="${escapeAttr(entry.kind)}" data-entry-type="${escapeAttr(entry.extension || "")}">`;
      html += `<td>`;
      html += `<button class="fb-rowButton" type="button" data-entry-path="${escapeAttr(entry.path)}" title="${escapeAttr(entry.path)}">`;
      html += `<span class="fb-typeBadge" data-kind="${escapeAttr(badgeKind)}">${escapeHtml(entry.kind === "directory" ? "DIR" : typeLabel)}</span>`;
      html += `<span class="fb-rowText">`;
      html += `<span class="fb-rowName">${escapeHtml(entry.name)}</span>`;
      html += `<span class="fb-rowMeta">${escapeHtml(entry.path)}</span>`;
      html += `</span>`;
      html += `</button>`;
      html += `</td>`;
      html += `<td class="fb-cellMuted">${escapeHtml(typeLabel)}</td>`;
      html += `<td class="fb-cellMuted">${escapeHtml(timeLabel || "-")}</td>`;
      html += `<td class="fb-cellMuted">${escapeHtml(sizeLabel || "-")}</td>`;
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    return html;
  }

  function renderStatus(entries) {
    const total = state.data && Array.isArray(state.data.entries) ? state.data.entries.length : 0;
    const folders = entries.filter(entry => entry.kind === "directory").length;
    const files = entries.length - folders;
    const parts = [
      `${entries.length} item${entries.length === 1 ? "" : "s"} visible`,
      `${folders} folder${folders === 1 ? "" : "s"}`,
      `${files} file${files === 1 ? "" : "s"}`,
    ];
    if (entries.length !== total) {
      parts.push(`filtered from ${total}`);
    }
    return parts.join(" | ");
  }

  function syncSelection() {
    if (!app) {
      return;
    }
    const rows = app.querySelectorAll(".fb-row[data-entry-path]");
    for (const row of rows) {
      row.classList.toggle("is-selected", row.getAttribute("data-entry-path") === state.selectedPath);
    }
    const openButton = app.querySelector("[data-action=\"open\"]");
    if (openButton) {
      openButton.disabled = !getSelectedEntry(getFilteredEntries());
    }
  }

  function render() {
    const activeElement = document.activeElement;
    const activeId = activeElement && activeElement.id ? activeElement.id : "";
    const selectionStart = activeElement && typeof activeElement.selectionStart === "number"
      ? activeElement.selectionStart
      : null;
    const selectionEnd = activeElement && typeof activeElement.selectionEnd === "number"
      ? activeElement.selectionEnd
      : null;
    const data = state.data;
    const entries = getFilteredEntries();
    const selectedEntry = getSelectedEntry(entries);
    const currentPath = data && data.currentPath ? data.currentPath : "";
    const canGoUp = !!(data && data.parentPath);
    const statusText = state.error || (data ? renderStatus(entries) : "Loading local files...");

    let html = "";
    html += `<div class="fb-shell">`;
    html += `<header class="fb-topbar">`;
    html += `<a class="fb-brand" href="start.html">`;
    html += `<span class="fb-brandMark">C3</span>`;
    html += `<span><span class="fb-brandTitle">ChromeViewerA3</span><span class="fb-brandSub">Built-in browser</span></span>`;
    html += `</a>`;
    html += `<div class="fb-toolbar">`;
    html += `<button class="fb-button" type="button" data-action="up"${canGoUp ? "" : " disabled"}>Up</button>`;
    html += `<button class="fb-button" type="button" data-action="home">Home</button>`;
    html += `<button class="fb-button" type="button" data-action="workspace">Workspace</button>`;
    html += `<button class="fb-button" type="button" data-action="refresh">Refresh</button>`;
    html += `</div>`;
    html += `<div class="fb-toolbarMeta">`;
    html += `<span class="fb-currentPath" title="${escapeAttr(currentPath || "Loading...")}">${escapeHtml(currentPath || "Loading...")}</span>`;
    html += `</div>`;
    html += `</header>`;

    html += `<div class="fb-layout">`;
    html += `<aside class="fb-sidebar">`;
    html += renderSidebarSection("Quick Access", data && data.places, "place");
    html += renderSidebarSection("Drives", data && data.roots, "root");
    html += `</aside>`;

    html += `<section class="fb-content">`;
    html += `<div class="fb-pathbar">`;
    html += `<form class="fb-pathForm" id="pathForm">`;
    html += `<input class="fb-pathInput" id="pathInput" name="path" type="text" value="${escapeAttr(currentPath)}" placeholder="Open folder path" autocomplete="off" spellcheck="false" />`;
    html += `<button class="fb-button fb-buttonPrimary" type="submit">Go</button>`;
    html += `</form>`;
    html += `<label class="fb-searchWrap">`;
    html += `<input class="fb-searchInput" id="filterInput" type="search" value="${escapeAttr(state.filter)}" placeholder="Search this folder" autocomplete="off" spellcheck="false" />`;
    html += `</label>`;
    html += `</div>`;

    html += renderBreadcrumbs();

    html += `<div class="fb-listing">`;
    html += `<div class="fb-card">`;
    html += `<div class="fb-cardHeader">`;
    html += `<div><h1 class="fb-cardTitle">Browse Files</h1><p class="fb-cardHint">Built-in browser shell. Folders open in place. PDFs and EPUBs use their reader. Other files open in the browser.</p></div>`;
    html += `<div class="fb-statusText">${escapeHtml(statusText)}</div>`;
    html += `</div>`;

    if (state.error) {
      html += `<div class="fb-error">${escapeHtml(state.error)}</div>`;
    } else if (state.loading && !data) {
      html += `<div class="fb-loading">Loading local files...</div>`;
    } else {
      html += `<div class="fb-scroll">`;
      html += renderTable(entries);
      html += `</div>`;
    }

    html += `</div>`;
    html += `</div>`;

    html += `<footer class="fb-footer">`;
    html += `<div class="fb-statusText" title="${escapeAttr(statusText)}">${escapeHtml(statusText)}</div>`;
    html += `<div class="fb-footerActions">`;
    html += `<button class="fb-button" type="button" data-action="start">Start Screen</button>`;
    html += `<button class="fb-button fb-buttonPrimary" type="button" data-action="open"${selectedEntry ? "" : " disabled"}>Open</button>`;
    html += `</div>`;
    html += `</footer>`;
    html += `</section>`;
    html += `</div>`;
    html += `</div>`;

    app.innerHTML = html;
    syncSelection();

    if (activeId) {
      const nextActive = document.getElementById(activeId);
      if (nextActive && typeof nextActive.focus === "function") {
        nextActive.focus();
        if (selectionStart !== null && selectionEnd !== null &&
            typeof nextActive.setSelectionRange === "function") {
          nextActive.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
  }

  async function loadDirectory(pathValue, allowFallback) {
    const requestedPath = typeof pathValue === "string" && pathValue.trim()
      ? pathValue.trim()
      : null;

    state.requestToken += 1;
    const token = state.requestToken;
    state.loading = true;
    state.error = "";
    render();

    try {
      const url = requestedPath
        ? `/api/local-files?path=${encodeURIComponent(requestedPath)}`
        : "/api/local-files";
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Unable to load local files (${response.status}).`);
      }
      if (token !== state.requestToken) {
        return;
      }
      state.loading = false;
      state.data = payload;
      state.error = "";
      if (!payload.entries || !payload.entries.some(entry => entry.path === state.selectedPath)) {
        state.selectedPath = "";
      }
      setStoredPath(payload.currentPath || null);
      render();
    } catch (error) {
      if (token !== state.requestToken) {
        return;
      }
      if (requestedPath && allowFallback) {
        setStoredPath(null);
        loadDirectory(null, false);
        return;
      }
      state.loading = false;
      state.data = null;
      state.error = error && error.message ? error.message : "Unable to load local files.";
      render();
    }
  }

  function onClick(event) {
    const navButton = event.target.closest("[data-nav-path]");
    if (navButton) {
      loadDirectory(navButton.getAttribute("data-nav-path"), false);
      return;
    }

    const rowButton = event.target.closest("[data-entry-path]");
    if (rowButton) {
      selectEntry(rowButton.getAttribute("data-entry-path"));
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) {
      return;
    }
    const action = actionButton.getAttribute("data-action");
    if (action === "start") {
      window.location.assign("start.html");
      return;
    }
    if (action === "refresh") {
      loadDirectory(state.data && state.data.currentPath, false);
      return;
    }
    if (action === "home" && state.data && state.data.homePath) {
      loadDirectory(state.data.homePath, false);
      return;
    }
    if (action === "workspace" && state.data && state.data.workspacePath) {
      loadDirectory(state.data.workspacePath, false);
      return;
    }
    if (action === "up" && state.data && state.data.parentPath) {
      loadDirectory(state.data.parentPath, false);
      return;
    }
    if (action === "open") {
      openEntry(getSelectedEntry(getFilteredEntries()));
    }
  }

  function onDoubleClick(event) {
    const row = event.target.closest("[data-entry-path]");
    if (!row) {
      return;
    }
    const entryPath = row.getAttribute("data-entry-path");
    const entry = getFilteredEntries().find(item => item.path === entryPath);
    openEntry(entry);
  }

  function onInput(event) {
    if (event.target && event.target.id === "filterInput") {
      state.filter = event.target.value || "";
      render();
    }
  }

  function onSubmit(event) {
    const form = event.target.closest("#pathForm");
    if (!form) {
      return;
    }
    event.preventDefault();
    const formData = new FormData(form);
    const nextPath = String(formData.get("path") || "").trim();
    if (nextPath) {
      loadDirectory(nextPath, false);
    }
  }

  function onKeyDown(event) {
    if (event.key !== "Enter") {
      return;
    }
    const row = event.target.closest("[data-entry-path]");
    if (!row) {
      return;
    }
    event.preventDefault();
    const entry = getFilteredEntries().find(item => item.path === row.getAttribute("data-entry-path"));
    openEntry(entry);
  }

  function init() {
    if (!app) {
      return;
    }
    app.addEventListener("click", onClick);
    app.addEventListener("dblclick", onDoubleClick);
    app.addEventListener("input", onInput);
    app.addEventListener("submit", onSubmit);
    app.addEventListener("keydown", onKeyDown);
    render();
    const initialPath = getRequestedPath() || getStoredPath();
    loadDirectory(initialPath, !!initialPath);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
