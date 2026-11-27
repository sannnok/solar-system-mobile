/**
 * Assemble the ArmLab prototype into dist/ for static hosting (Render, or any
 * other static host).
 *
 * There is nothing to compile. The page imports three.js from ../vendor, so the
 * output keeps the same layout — dist/armwrestling next to dist/vendor — and
 * only those two directories are published, never the rest of the repository.
 * The root index.html forwards to /armwrestling/ for anyone who opens the bare
 * domain; the Mini App URL itself should point at /armwrestling/.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const skip = (path) => /(^|[/\\])\.|README\.md$/.test(path.slice(root.length));
cpSync(join(root, 'armwrestling'), join(out, 'armwrestling'), { recursive: true, filter: (p) => !skip(p) });
cpSync(join(root, 'vendor', 'three'), join(out, 'vendor', 'three'), { recursive: true, filter: (p) => !skip(p) });

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0; url=./armwrestling/" />
    <title>ArmLab</title>
    <script>location.replace('./armwrestling/' + location.search + location.hash);</script>
  </head>
  <body><a href="./armwrestling/">ArmLab</a></body>
</html>
`,
);

console.log(`ArmLab built into ${out}`);
