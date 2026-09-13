/**
 * A tiny static file server so `npm start` works with no dependencies.
 * The app is plain ES modules — any static host will do just as well.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname);
    const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(root, relative);

    // Keep traversal inside the project directory.
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    response.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-cache',
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
  }
});

server.listen(port, host, () => {
  console.log(`Orrery running at http://${host}:${port}`);
});
