const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.epub': 'application/epub+zip', // Add EPUB support
};

const server = http.createServer((req, res) => {
    // Parse URL to separate pathname and query
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    let filePath = path.join(ROOT, decodeURIComponent(parsedUrl.pathname));

    // Redirect .epub requests to the viewer (unless it's a direct fetch from the viewer itself)
    // If the request is just "/path/to/book.epub" in the browser address bar, we redirect.
    // We detect this by checking if the Accept header prefers HTML.
    if (parsedUrl.pathname.toLowerCase().endsWith('.epub') &&
        req.headers['accept'] && req.headers['accept'].includes('text/html')) {
        res.writeHead(302, { 'Location': `/web/epub-viewer.html?file=${encodeURIComponent(parsedUrl.pathname)}` });
        res.end();
        return;
    }

    // Redirect root to viewer
    if (req.url === '/' || req.url === '') {
        res.writeHead(302, { 'Location': '/web/viewer.html' });
        res.end();
        return;
    }

    // Handle file streaming (fixes local file access restriction)
    // Supports PDFs and EPUBs from anywhere on disk.
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    if (urlObj.pathname === '/stream') {
        const targetPath = urlObj.searchParams.get('path');
        if (!targetPath || !fs.existsSync(targetPath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('404 Not Found');
            return;
        }

        const stat = fs.statSync(targetPath);
        if (!stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(targetPath).toLowerCase();
        const allowed = new Set(['.pdf', '.epub']);
        if (!allowed.has(ext)) {
            res.writeHead(415, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('415 Unsupported Media Type');
            return;
        }

        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const range = req.headers.range;
        const commonHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Accept-Ranges': 'bytes'
        };

        if (range) {
            // Example: "bytes=0-499" / "bytes=500-" / "bytes=-500"
            const m = String(range).match(/bytes=(\\d*)-(\\d*)/);
            if (!m) {
                res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }

            let start = m[1] ? parseInt(m[1], 10) : null;
            let end = m[2] ? parseInt(m[2], 10) : null;

            if (start === null && end === null) {
                res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }

            if (start === null) {
                // suffix length: last `end` bytes
                const suffixLength = end;
                if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
                    res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` });
                    res.end();
                    return;
                }
                start = Math.max(0, stat.size - suffixLength);
                end = stat.size - 1;
            } else if (end === null) {
                end = stat.size - 1;
            }

            if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
                res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }

            const chunkSize = end - start + 1;
            res.writeHead(206, {
                ...commonHeaders,
                'Content-Length': chunkSize,
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            });
            fs.createReadStream(targetPath, { start, end }).pipe(res);
            return;
        }

        res.writeHead(200, { ...commonHeaders, 'Content-Length': stat.size });
        fs.createReadStream(targetPath).pipe(res);
        return;
    }

    // Handle directory requests
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`PDF.js server running at http://localhost:${PORT}`);
    console.log(`Open a PDF: http://localhost:${PORT}/web/viewer.html?file=/path/to/your.pdf`);
});
