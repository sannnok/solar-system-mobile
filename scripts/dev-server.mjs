/**
 * A tiny static file server so `npm start` works with no dependencies.
 * The app is plain ES modules — any static host will do just as well.
 *
 * `npm run mobile` binds every interface and prints a QR code for the LAN
 * address, so a phone on the same Wi-Fi can scan it and open the orrery.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrToAnsi } from './qr.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT ?? 5173);
// `--host` works the same on every shell; HOST= is there for anyone used to it.
const wantsLan = process.argv.includes('--host') || process.env.HOST === '0.0.0.0';
const host = wantsLan ? '0.0.0.0' : process.env.HOST ?? '127.0.0.1';
const exposed = host === '0.0.0.0' || host === '::';

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
  '.md': 'text/markdown; charset=utf-8',
};

/** First non-loopback IPv4 address, which is what a phone can reach. */
function lanAddress() {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const details of interfaces ?? []) {
      if (details.family === 'IPv4' && !details.internal) return details.address;
    }
  }
  return null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const requested = decodeURIComponent(url.pathname);
    const relative = normalize(requested).replace(/^(\.\.[/\\])+/, '');

    // This server can be put on a local network, so never hand out dotfiles —
    // .git in particular sits right next to the app.
    if (relative.split(/[/\\]/).some((segment) => segment.startsWith('.') && segment.length > 1)) {
      response.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
      return;
    }

    let filePath = join(root, relative);

    // Keep traversal inside the project directory.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      response.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden');
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
  const lan = exposed ? lanAddress() : null;
  console.log(`\n  Orrery\n`);
  console.log(`  local    http://localhost:${port}`);

  if (!exposed) {
    console.log(`\n  To open it on a phone, run \`npm run mobile\` for a scannable QR code.\n`);
    return;
  }

  if (!lan) {
    console.log(`\n  No local network address found — is this machine online?\n`);
    return;
  }

  const address = `http://${lan}:${port}`;
  console.log(`  network  ${address}`);
  console.log(`\n  Scan with a phone on the same Wi-Fi:\n`);
  console.log(
    qrToAnsi(address)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
  );
  console.log('');
});
