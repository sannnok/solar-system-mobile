// Минимальная загрузка .env без зависимостей (Node 22 умеет --env-file, но
// так .env подхватывается и при запуске через npm без лишних флагов).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './data.mjs';

export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
