import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDb } from '../src/lib/db.mjs';

const dir = new URL('../n8n/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const f of files) {
  test(`n8n/${f}: связи указывают на существующие узлы`, () => {
    const wf = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, 'имена узлов уникальны');
    assert.equal(new Set(wf.nodes.map((n) => n.id)).size, wf.nodes.length, 'id узлов уникальны');
    for (const [from, { main }] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `нет узла ${from}`);
      for (const out of main) for (const c of out) assert.ok(names.has(c.node), `${from} → ${c.node}`);
    }
    // ссылки вида $('Имя узла') в выражениях
    const refs = [...JSON.stringify(wf).matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
    for (const r of refs) assert.ok(names.has(r), `выражение ссылается на неизвестный узел «${r}»`);
  });
}

test('код отчёта воронки работает на реальном ответе /api/stats', () => {
  const wf = JSON.parse(readFileSync(new URL('funnel-report.json', dir), 'utf8'));
  const code = wf.nodes.find((n) => n.type === 'n8n-nodes-base.code').parameters.jsCode;
  const store = openDb(':memory:');
  store.touchUser('bias', { id: 1, first_name: 'A' }, 'reels');
  store.log('bias', 1, 'today', 'x');
  const stats = { bias: store.stats('bias'), health: store.stats('health'), videos_published: 3, videos_left: 184 };
  const $input = { first: () => ({ json: stats }) };
  const out = new Function('$input', code)($input);
  assert.match(out[0].json.text, /Кодекс<\/b>: 1 польз[\s\S]*reels: 1[\s\S]*Роликов опубликовано: 3/);
});
