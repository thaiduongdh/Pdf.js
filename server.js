const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 8080;
const ROOT = __dirname;
const SUITE_NAME = "ChromeViewerA3";
const FILE_BROWSER_BASE_PORT = 8081;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".epub": "application/epub+zip",
};

const READER_FILE_TYPES = new Map([
  [".pdf", "pdf"],
  [".epub", "epub"],
]);

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function getWindowsRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(drive)) {
      roots.push(drive);
    }
  }
  return roots;
}

function getRoots() {
  if (process.platform === "win32") {
    return getWindowsRoots();
  }
  return [path.parse(ROOT).root || path.sep];
}

function buildFileBrowserTargets() {
  return getRoots().map((rootPath, index) => ({
    name: formatRoot(rootPath),
    rootPath,
    port: FILE_BROWSER_BASE_PORT + index,
    url: `http://localhost:${FILE_BROWSER_BASE_PORT + index}/files/`,
  }));
}

function normalizeComparablePath(targetPath) {
  return path.resolve(targetPath).replace(/[\\/]+$/, "").toLowerCase();
}

function getFileBrowserTargetForPath(targetPath) {
  if (!targetPath) {
    return null;
  }

  const normalizedTargetPath = normalizeComparablePath(targetPath);
  for (const target of buildFileBrowserTargets()) {
    const normalizedRoot = normalizeComparablePath(target.rootPath);
    if (normalizedTargetPath === normalizedRoot ||
        normalizedTargetPath.startsWith(`${normalizedRoot}\\`) ||
        normalizedTargetPath.startsWith(`${normalizedRoot}/`)) {
      return target;
    }
  }

  return null;
}

function buildFileBrowserUrlForPath(targetPath) {
  const target = getFileBrowserTargetForPath(targetPath);
  if (!target) {
    return null;
  }

  const relativePath = path.relative(target.rootPath, path.resolve(targetPath));
  if (!relativePath || relativePath === ".") {
    return target.url;
  }

  const encodedSegments = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");

  return encodedSegments ? `${target.url}${encodedSegments}` : target.url;
}

function getFileExtension(fileName) {
  return path.extname(fileName || "").toLowerCase();
}

function getMimeType(targetPath) {
  return MIME_TYPES[getFileExtension(targetPath)] || "application/octet-stream";
}

function isDirectory(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return false;
  }
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function getHomePath() {
  const homePath = os.homedir();
  return isDirectory(homePath) ? homePath : null;
}

function getDefaultBrowsePath() {
  const homePath = getHomePath();
  const candidates = [];
  if (homePath) {
    candidates.push(path.join(homePath, "Downloads"));
    candidates.push(path.join(homePath, "Documents"));
    candidates.push(homePath);
  }
  candidates.push(...getRoots());
  candidates.push(ROOT);

  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      return candidate;
    }
  }

  return ROOT;
}

function getParentPath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  const rootPath = path.parse(resolvedPath).root;
  if (resolvedPath === rootPath) {
    return null;
  }
  const parentPath = path.dirname(resolvedPath);
  return parentPath === resolvedPath ? null : parentPath;
}

function formatRoot(rootPath) {
  if (process.platform === "win32") {
    return rootPath.replace(/[\\/]+$/, "");
  }
  return rootPath;
}

function addPlace(places, seenPaths, label, targetPath) {
  if (!isDirectory(targetPath)) {
    return;
  }
  const resolvedPath = path.resolve(targetPath);
  if (seenPaths.has(resolvedPath)) {
    return;
  }
  seenPaths.add(resolvedPath);
  places.push({
    label,
    path: resolvedPath,
  });
}

function buildPlaces() {
  const places = [];
  const seenPaths = new Set();
  const homePath = getHomePath();

  addPlace(places, seenPaths, "Home", homePath);
  if (homePath) {
    addPlace(places, seenPaths, "Downloads", path.join(homePath, "Downloads"));
    addPlace(places, seenPaths, "Documents", path.join(homePath, "Documents"));
    addPlace(places, seenPaths, "Desktop", path.join(homePath, "Desktop"));
  }
  addPlace(places, seenPaths, "Workspace", ROOT);

  return places;
}

function buildFileBrowserMeta() {
  const defaultBrowsePath = getDefaultBrowsePath();
  const fileBrowserTargets = buildFileBrowserTargets();
  const places = buildPlaces().map(place => ({
    ...place,
    url: buildFileBrowserUrlForPath(place.path),
  }));
  const roots = fileBrowserTargets.map(target => ({
    name: target.name,
    path: target.rootPath,
    port: target.port,
    url: target.url,
  }));

  return {
    suiteName: SUITE_NAME,
    workspacePath: ROOT,
    homePath: getHomePath(),
    defaultBrowsePath,
    defaultFileBrowserUrl: buildFileBrowserUrlForPath(defaultBrowsePath),
    fileBrowserTargets: roots,
    places,
  };
}

function buildBreadcrumbs(currentPath) {
  const resolvedPath = path.resolve(currentPath);
  const rootPath = path.parse(resolvedPath).root;
  const breadcrumbs = [];

  if (process.platform === "win32") {
    breadcrumbs.push({
      label: formatRoot(rootPath),
      path: rootPath,
    });
    const suffix = resolvedPath.slice(rootPath.length);
    const segments = suffix.split(/[\\/]+/).filter(Boolean);
    let runningPath = rootPath;
    for (const segment of segments) {
      runningPath = path.join(runningPath, segment);
      breadcrumbs.push({
        label: segment,
        path: runningPath,
      });
    }
    return breadcrumbs;
  }

  breadcrumbs.push({ label: rootPath || path.sep, path: rootPath || path.sep });
  const segments = resolvedPath.split(path.sep).filter(Boolean);
  let runningPath = "";
  for (const segment of segments) {
    runningPath = path.join(runningPath || path.sep, segment);
    breadcrumbs.push({
      label: segment,
      path: runningPath,
    });
  }
  return breadcrumbs;
}

function buildDirectoryEntry(parentPath, dirent) {
  const fullPath = path.join(parentPath, dirent.name);
  const extension = dirent.isFile() ? getFileExtension(dirent.name) : "";
  const entry = {
    kind: dirent.isDirectory() ? "directory" : "file",
    name: dirent.name,
    path: fullPath,
    extension,
    reader: extension ? READER_FILE_TYPES.get(extension) || null : null,
    mimeType: dirent.isFile() ? getMimeType(fullPath) : null,
    size: null,
    modifiedMs: null,
  };

  try {
    const stat = fs.statSync(fullPath);
    entry.modifiedMs = Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
    if (dirent.isFile()) {
      entry.size = Number.isFinite(stat.size) ? stat.size : null;
    }
  } catch {
    // Ignore per-entry stat failures so the listing still renders.
  }

  return entry;
}

function readLocalDirectory(requestedPath) {
  const currentPath = requestedPath && requestedPath.trim()
    ? path.resolve(requestedPath)
    : getDefaultBrowsePath();

  if (!fs.existsSync(currentPath)) {
    return {
      status: 404,
      payload: { error: "Folder not found." },
    };
  }

  let currentStat;
  try {
    currentStat = fs.statSync(currentPath);
  } catch {
    return {
      status: 403,
      payload: { error: "This folder cannot be opened." },
    };
  }

  if (!currentStat.isDirectory()) {
    return {
      status: 400,
      payload: { error: "The requested path is not a folder." },
    };
  }

  let dirents;
  try {
    dirents = fs.readdirSync(currentPath, { withFileTypes: true });
  } catch (error) {
    return {
      status: error && error.code === "EACCES" ? 403 : 500,
      payload: { error: "Unable to read this folder." },
    };
  }

  const entries = [];

  for (const dirent of dirents) {
    if (dirent.isDirectory()) {
      entries.push(buildDirectoryEntry(currentPath, dirent));
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    entries.push(buildDirectoryEntry(currentPath, dirent));
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });

  return {
    status: 200,
    payload: {
      currentPath,
      parentPath: getParentPath(currentPath),
      homePath: getHomePath(),
      defaultPath: getDefaultBrowsePath(),
      workspacePath: ROOT,
      places: buildPlaces(),
      roots: getRoots().map(rootPath => ({
        name: formatRoot(rootPath),
        path: rootPath,
      })),
      fileBrowserTargets: buildFileBrowserTargets().map(target => ({
        name: target.name,
        path: target.rootPath,
        port: target.port,
        url: target.url,
      })),
      breadcrumbs: buildBreadcrumbs(currentPath),
      entries,
      readerTypes: Array.from(READER_FILE_TYPES.values()),
    },
  };
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(ROOT, decodeURIComponent(parsedUrl.pathname));

  if (parsedUrl.pathname.toLowerCase().endsWith(".epub") &&
      req.headers.accept && req.headers.accept.includes("text/html")) {
    res.writeHead(302, {
      Location: `/web/epub-viewer.html?file=${encodeURIComponent(parsedUrl.pathname)}`,
    });
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "") {
    res.writeHead(302, { Location: "/web/start.html" });
    res.end();
    return;
  }

  if (parsedUrl.pathname === "/api/local-files") {
    const result = readLocalDirectory(parsedUrl.searchParams.get("path"));
    writeJson(res, result.status, result.payload);
    return;
  }

  if (parsedUrl.pathname === "/api/app-meta") {
    writeJson(res, 200, buildFileBrowserMeta());
    return;
  }

  if (parsedUrl.pathname === "/stream") {
    const targetPath = parsedUrl.searchParams.get("path");
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404, {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      });
      res.end("404 Not Found");
      return;
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
      res.writeHead(404, {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      });
      res.end("404 Not Found");
      return;
    }

    const contentType = getMimeType(targetPath);
    const range = req.headers.range;
    const commonHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    };

    if (range) {
      const match = String(range).match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        res.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${stat.size}`,
        });
        res.end();
        return;
      }

      let start = match[1] ? parseInt(match[1], 10) : null;
      let end = match[2] ? parseInt(match[2], 10) : null;

      if (start === null && end === null) {
        res.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${stat.size}`,
        });
        res.end();
        return;
      }

      if (start === null) {
        const suffixLength = end;
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
          res.writeHead(416, {
            ...commonHeaders,
            "Content-Range": `bytes */${stat.size}`,
          });
          res.end();
          return;
        }
        start = Math.max(0, stat.size - suffixLength);
        end = stat.size - 1;
      } else if (end === null) {
        end = stat.size - 1;
      }

      if (!Number.isFinite(start) || !Number.isFinite(end) ||
          start < 0 || end < start || start >= stat.size) {
        res.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${stat.size}`,
        });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        ...commonHeaders,
        "Content-Length": chunkSize,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      });
      fs.createReadStream(targetPath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      ...commonHeaders,
      "Content-Length": stat.size,
    });
    fs.createReadStream(targetPath).pipe(res);
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`${SUITE_NAME} server running at http://localhost:${PORT}`);
  console.log(`Open ${SUITE_NAME}: http://localhost:${PORT}/`);
});
