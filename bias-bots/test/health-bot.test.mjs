import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './harness.mjs';
import { createHealthBot, BOT, health, streak } from '../src/health-bot/bot.mjs';
import { getBias } from '../src/lib/data.mjs';
import { localNow } from '../src/lib/tg.mjs';

const make = () => harness(createHealthBot, { username: 'HealthTestBot', biasUsername: 'BiasTestBot', adminIds: [42] });

test('каждый совет ссылается на существующее искажение и влезает в подпись', async () => {
  const h = make();
  for (const t of health.tips) {
    assert.ok(getBias(t.bias), `${t.id}: нет искажения ${t.bias}`);
    assert.ok(h.tipCaption(t).length <= 1024, t.id);
  }
});

test('streak считает серию до сегодня или до вчера', () => {
  assert.equal(streak([1, 2, 3], 3), 3);
  assert.equal(streak([1, 2, 3], 4), 3, 'сегодня ещё не отмечено — серия жива');
  assert.equal(streak([1, 2, 3], 5), 0);
  assert.equal(streak([1, 3, 4, 5], 5), 3);
});

test('/start from_bias: приветствие, совет дня со ссылкой в Кодекс, предложение трекера', async () => {
  const h = make();
  await h.send('/start from_bias');
  assert.equal(h.store.getUser(BOT, 42).source, 'from_bias');
  const photo = h.last('sendPhoto');
  assert.match(photo.payload.caption, /Ловушка мышления/);
  assert.match(photo.payload.caption, /t\.me\/BiasTestBot\?start=b\d+_health/);
  assert.match(h.last('sendMessage').payload.text, /привычки/);
});

test('тема выдаёт непросмотренные советы по очереди', async () => {
  const h = make();
  await h.send('/start');
  h.reset();
  await h.send('🥗 Продукты');
  await h.click('t:food');
  const captions = h.calls.filter((c) => c.method === 'sendPhoto').map((c) => c.payload.caption.split('\n')[0]);
  assert.equal(captions.length, 2);
  assert.notEqual(captions[0], captions[1]);
});

test('трекер: выбор привычек, лимит 3, отметка и серия', async () => {
  const h = make();
  await h.send('/start');
  await h.click('h:pick');
  for (const id of ['steps', 'workout', 'veggies', 'sleep']) await h.click(`h:t:${id}`);
  assert.deepEqual(h.store.getUser(BOT, 42).data.habits.list, ['steps', 'workout', 'veggies']);
  assert.match(h.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1).payload.text, /Не больше трёх/);
  await h.click('h:done');
  assert.equal(h.store.getUser(BOT, 42).daily_hour, 21, 'напоминание включается по умолчанию');

  const today = localNow().day;
  h.store.updateData(BOT, 42, (d) => { d.habits.log.steps = [today - 2, today - 1]; return d; });
  await h.click('h:c:steps');
  const toast = h.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1).payload;
  assert.match(toast.text, /3 дня подряд/);
  assert.equal(toast.show_alert, true);
  assert.match(h.last('editMessageText').payload.text, /🔥 3 дня подряд/);
});

test('вечернее напоминание уходит только тем, у кого есть привычки', async () => {
  const h = make();
  await h.send('/start');
  await h.click('h:pick');
  await h.click('h:t:steps');
  await h.click('h:done');
  h.reset();
  const day = localNow().day + 1;
  await h.runDaily({ hour: 21, minute: 0, day });
  await h.runDaily({ hour: 21, minute: 3, day });
  const sent = h.calls.filter((c) => c.method === 'sendMessage');
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.text, /Вечерняя отметка[\s\S]*Совет дня/);
});
