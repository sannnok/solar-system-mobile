import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness } from './harness.mjs';
import { createHealthBot, BOT } from '../src/health-bot/bot.mjs';
import { PAYLOAD } from '../src/health-bot/facts-rubric.mjs';
import { facts, freeFacts, factCaption, unverified } from '../src/lib/facts.mjs';
import { verifyRecord } from '../scripts/verify-facts.mjs';
import { getBias } from '../src/lib/data.mjs';

const raw = JSON.parse(readFileSync(new URL('../data/facts-ru.json', import.meta.url), 'utf8'));

test('правило отбора: нужны и рандомизация, и двойное ослепление', () => {
  const ok = verifyRecord({ title: 'X', types: ['Randomized Controlled Trial'], abstract: 'METHODS: We conducted a multicenter, randomized, double-blind, sham-controlled trial.' });
  assert.equal(ok.verified, true);
  assert.match(ok.evidence.double_blind, /double-blind/);
  // как у VITAL: рандомизированное плацебо-контролируемое, но про ослепление в аннотации ни слова
  const noBlind = verifyRecord({ title: 'X', types: ['Randomized Controlled Trial'], abstract: 'We conducted a nationwide, randomized, placebo-controlled trial.' });
  assert.equal(noBlind.verified, false);
  const noRandom = verifyRecord({ title: 'X: a double-blind, placebo-controlled, cross-over trial', types: ['Controlled Clinical Trial'], abstract: 'in a double-blind design' });
  assert.equal(noRandom.verified, false);
  assert.equal(verifyRecord({ title: 'X', types: [], abstract: 'Patients were randomly assigned. Patients and assessors of outcome were blinded to the treatment-group assignment.' }).verified, true);
});

test('все факты рубрики прошли проверку PubMed и ссылаются на искажения', () => {
  assert.deepEqual(unverified, []);
  assert.equal(facts.length, raw.facts.length);
  assert.equal(new Set(raw.facts.map((f) => f.pmid)).size, raw.facts.length, 'PMID не повторяются');
  for (const f of facts) {
    assert.ok(getBias(f.bias), `${f.id}: нет искажения ${f.bias}`);
    assert.ok(f.source.verified && f.source.randomized && f.source.double_blind, f.id);
    for (const k of ['title', 'body', 'takeaway', 'limits']) assert.ok(f[k]?.length > 10, `${f.id}.${k}`);
    const visible = factCaption(f, { biasLink: () => 'https://t.me/x?start=b1_facts' }).replace(/<[^>]+>/g, '');
    assert.ok(visible.length <= 1024, `${f.id}: подпись ${visible.length}`);
  }
  assert.equal(freeFacts.length, 3);
});

const make = (adminIds = [7]) => harness(createHealthBot, { username: 'HealthTestBot', biasUsername: 'BiasTestBot', adminIds });
const admin = { id: 7, is_bot: false, first_name: 'Админ' };
const paid = (h, amount = 50) => h.raw({
  message: {
    message_id: 900, date: 0, chat: h.chat, from: h.user,
    successful_payment: { currency: 'XTR', total_amount: amount, invoice_payload: PAYLOAD, telegram_payment_charge_id: 'stxCHARGE1', provider_payment_charge_id: '' },
  },
});
const preCheckout = (h, { amount = 50, payload = PAYLOAD } = {}) => h.raw({
  pre_checkout_query: { id: 'pcq1', from: h.user, currency: 'XTR', total_amount: amount, invoice_payload: payload },
});

test('витрина: бесплатные факты, потом пейволл со счётом в Stars', async () => {
  const h = make();
  await h.send('/start');
  h.reset();
  await h.send('🔬 Доказано наукой');
  assert.match(h.last('sendMessage').payload.text, /двойные слепые[\s\S]*Бесплатно: 3/);
  for (let i = 0; i < 3; i++) await h.click('f:next');
  const shown = h.calls.filter((c) => c.method === 'sendPhoto');
  assert.equal(shown.length, 3);
  assert.ok(shown.every((c) => /pubmed\.ncbi\.nlm\.nih\.gov\/\d+/.test(c.payload.caption)));
  assert.deepEqual(new Set(shown.map((c) => c.payload.caption.split('\n')[0])).size, 3);
  await h.click('f:next');
  assert.match(h.last('sendMessage').payload.text, /Бесплатные факты закончились/);
  await h.click('f:buy');
  const inv = h.last('sendInvoice').payload;
  assert.equal(inv.currency, 'XTR');
  assert.equal(inv.payload, PAYLOAD);
  assert.deepEqual(inv.prices, [{ label: 'Доступ к рубрике', amount: 50 }]);
  assert.equal(inv.provider_token, undefined, 'для Stars провайдер не нужен');
});

test('закрытый факт из списка открывает пейволл, а не карточку', async () => {
  const h = make();
  await h.send('/start');
  const locked = facts.find((f) => !f.free);
  h.reset();
  await h.click(`f:o:${locked.id}`);
  assert.equal(h.calls.filter((c) => c.method === 'sendPhoto').length, 0);
  assert.match(h.last('sendMessage').payload.text, new RegExp(`🔒 «${locked.title.slice(0, 15)}`));
});

test('оплата: pre-checkout, покупка, доступ, без повторной оплаты', async () => {
  const h = make();
  await h.send('/start');
  await preCheckout(h, { amount: 1 });
  assert.equal(h.last('answerPreCheckoutQuery').payload.ok, false, 'чужая сумма — отказ');
  await preCheckout(h);
  assert.equal(h.last('answerPreCheckoutQuery').payload.ok, true);
  await paid(h);
  assert.equal(h.store.activePurchase(BOT, 42, 'facts').charge_id, 'stxCHARGE1');
  assert.ok(h.calls.some((c) => c.method === 'sendMessage' && c.payload.chat_id === 7 && /Покупка: 50/.test(c.payload.text)), 'админу пришло уведомление');
  h.reset();
  for (let i = 0; i < 4; i++) await h.click('f:next');
  assert.equal(h.calls.filter((c) => c.method === 'sendPhoto').length, 4, 'после оплаты пейволла нет');
  await preCheckout(h);
  assert.equal(h.last('answerPreCheckoutQuery').payload.ok, false, 'второй раз платить не нужно');
  assert.deepEqual(h.store.revenue(BOT), [{ product: 'facts', currency: 'XTR', purchases: 1, amount: 50 }]);
});

test('/paysupport пересылает админу, /refund возвращает звёзды и закрывает доступ', async () => {
  const h = make();
  await h.send('/start');
  await paid(h);
  await h.send('/paysupport');
  await h.send('Хочу вернуть, случайно нажал');
  const toAdmin = h.calls.filter((c) => c.method === 'sendMessage' && c.payload.chat_id === 7).at(-1);
  assert.match(toAdmin.payload.text, /paysupport от 42[\s\S]*stxCHARGE1[\s\S]*случайно нажал[\s\S]*\/refund 42/);
  await h.send('/refund 42', { from: { id: 99, is_bot: false, first_name: 'Чужой' } });
  assert.equal(h.calls.filter((c) => c.method === 'refundStarPayment').length, 0, 'не админ не может вернуть');
  await h.send('/refund 42', { from: admin });
  const r = h.last('refundStarPayment').payload;
  assert.equal(r.user_id, 42);
  assert.equal(r.telegram_payment_charge_id, 'stxCHARGE1');
  assert.equal(h.store.activePurchase(BOT, 42, 'facts'), null);
  assert.equal(h.factsRubric.hasAccess(42), false);
});

test('в /stats видна выручка', async () => {
  const h = make([42]);
  await h.send('/start');
  await paid(h);
  await h.send('/stats');
  assert.match(h.last('sendMessage').payload.text, /💰 facts: 1 покупок, 50 ⭐/);
});
