import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';
import { createBiasBot, BOT } from '../src/bias-bot/bot.mjs';
import { biasOfDay, getBias, biases } from '../src/lib/data.mjs';

const make = (o = {}) => harness(createBiasBot, { username: 'BiasTestBot', healthUsername: 'HealthTestBot', adminIds: [42], ...o });

test('/start: приветствие, карточка дня, предложение подписки', async () => {
  const h = make();
  await h.send('/start');
  const methods = h.calls.map((c) => c.method);
  assert.deepEqual(methods, ['sendMessage', 'sendMessage', 'sendPhoto', 'sendMessage']);
  assert.match(h.calls[0].payload.text, /Кодекс когнитивных искажений/);
  assert.ok(h.calls[0].payload.reply_markup.keyboard, 'постоянная клавиатура меню');
  assert.ok(h.calls[2].payload.caption.includes(biasOfDay().name_ru));
  assert.match(h.calls[3].payload.text, /одно искажение в день/);
});

test('deep link b19_reels открывает карточку и запоминает источник', async () => {
  const h = make();
  await h.send('/start b19_reels');
  const photo = h.last('sendPhoto');
  assert.ok(photo.payload.caption.includes(getBias(19).name_ru));
  assert.equal(h.store.getUser(BOT, 42).source, 'reels');
});

test('повторная отправка карточки идёт по file_id из кеша', async () => {
  const h = make();
  await h.send('/start b19');
  await h.click('b:19');
  const sends = h.calls.filter((c) => c.method === 'sendPhoto');
  assert.equal(typeof sends[0].payload.photo, 'object'); // InputFile с PNG
  assert.match(sends[1].payload.photo, /^FILE_/);
});

test('поиск по слову находит искажение', async () => {
  const h = make();
  await h.send('/start b1');
  h.reset();
  await h.send('якорь');
  assert.ok(h.last('sendPhoto').payload.caption.includes('Эффект якоря'));
  h.reset();
  await h.send('ошибка');
  assert.equal(h.last().method, 'sendMessage');
  assert.match(h.last().payload.text, /несколько/);
  h.reset();
  await h.send('абракадабра');
  assert.match(h.last().payload.text, /Не нашёл/);
});

test('карта: квадрант → группа → список', async () => {
  const h = make();
  await h.send('/start b1');
  await h.click('map');
  assert.match(h.last('editMessageText').payload.text, /четыре задачи/);
  await h.click('q:q3');
  assert.match(h.last('editMessageText').payload.text, /Нужно действовать быстро/);
  await h.click('g:q3g1:0');
  const kb = h.last('editMessageText').payload.reply_markup.inline_keyboard.flat();
  assert.ok(kb.some((b) => b.callback_data === 'g:q3g1:1'), 'есть пагинация для большой группы');
  await h.click('g:q1g1:0', { photo: true });
  assert.equal(h.last().method, 'sendMessage', 'из фото-карточки — новым сообщением');
});

test('квиз считает очки', async () => {
  const h = make();
  await h.send('/start b1');
  await h.click('quiz');
  const q = h.last('sendMessage');
  const buttons = q.payload.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 4);
  const [, answerN] = buttons[0].callback_data.split(':');
  await h.click(`qa:${answerN}:${answerN}`);
  assert.match(h.last('editMessageText').payload.text, /Верно[\s\S]*Счёт: 1 из 1/);
  assert.equal(h.store.getUser(BOT, 42).data.quiz.right, 1);
});

test('подписка и ежедневная рассылка без дублей', async () => {
  const h = make();
  await h.send('/start b1');
  await h.click('sub:9');
  assert.equal(h.store.getUser(BOT, 42).daily_hour, 9);
  h.store.db.prepare('UPDATE users SET last_daily = NULL').run();
  h.reset();
  await h.runDaily({ hour: 9, minute: 1, day: 1000 }, { channelId: '' });
  assert.equal(h.calls.filter((c) => c.method === 'sendPhoto').length, 1);
  assert.match(h.last('sendPhoto').payload.caption, /Искажение дня/);
  await h.runDaily({ hour: 9, minute: 2, day: 1000 }, { channelId: '' });
  assert.equal(h.calls.filter((c) => c.method === 'sendPhoto').length, 1, 'второй раз в тот же день не шлём');
});

test('пост в канал раз в день с кнопкой в бота', async () => {
  const h = make();
  await h.runDaily({ hour: 10, minute: 0, day: 5 }, { channelId: '@chan', channelHour: 10 });
  await h.runDaily({ hour: 10, minute: 1, day: 5 }, { channelId: '@chan', channelHour: 10 });
  const posts = h.calls.filter((c) => c.method === 'sendPhoto' && c.payload.chat_id === '@chan');
  assert.equal(posts.length, 1);
  assert.match(posts[0].payload.reply_markup.inline_keyboard[0][0].url, /t\.me\/BiasTestBot\?start=b\d+_channel/);
});

test('после 5 карточек — одно приглашение во второй бот', async () => {
  const h = make();
  await h.send('/start b1');
  for (let i = 2; i <= 7; i++) await h.click(`b:${i}`);
  const promos = h.calls.filter((c) => c.method === 'sendMessage' && /HealthTestBot/.test(JSON.stringify(c.payload.reply_markup ?? {})));
  assert.equal(promos.length, 1);
});

test('inline-режим отдаёт результаты, с фото из кеша', async () => {
  const h = make();
  await h.send('/start b19');
  await h.inline('якор');
  const res = h.last('answerInlineQuery').payload.results;
  assert.ok(res.length >= 1);
  assert.equal(res[0].type, 'photo');
  assert.match(res[0].photo_file_id, /^FILE_/);
});

test('/stats доступна админу', async () => {
  const h = make();
  await h.send('/start reels');
  await h.send('/stats');
  assert.match(h.last('sendMessage').payload.text, /Пользователей: 1[\s\S]*reels: 1/);
});

test('подписи укладываются в лимит Telegram', async () => {
  const { biasCaption } = await import('../src/lib/captions.mjs');
  for (const b of biases) assert.ok(biasCaption(b, { botUsername: 'SomeLongBotUsernameBot' }).length <= 1024, b.id);
});

test('квиз: всегда 4 разных варианта без двойников', async () => {
  const { quizQuestion } = await import('../src/lib/data.mjs');
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const { answer, options } = quizQuestion(rand);
    assert.equal(options.length, 4);
    assert.equal(new Set(options.map((o) => o.id)).size, 4);
    assert.ok(options.includes(answer));
    assert.ok(!['barnum-effect', 'baader-meinhof-phenomenon'].includes(answer.id));
  }
});
