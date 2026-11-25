// ЗОЖ-бот «без самообмана»: советы по питанию, движению, мотивации и сну,
// каждый привязан к когнитивному искажению из Кодекса (ссылка ведёт в первый бот),
// плюс трекер привычек с сериями — удерживает аудиторию каждый день.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import { ROOT, getBias } from '../lib/data.mjs';
import { renderTipCard } from '../lib/cards.mjs';
import { esc, sendPhotoCached, parseStartPayload, deepLink, localNow, broadcast, everyMinute } from '../lib/tg.mjs';
import { installFacts, BTN_FACTS } from './facts-rubric.mjs';

export const BOT = 'health';
export const health = JSON.parse(readFileSync(path.join(ROOT, 'data', 'health-ru.json'), 'utf8'));

const topicById = new Map(health.topics.map((t) => [t.id, t]));
const tipById = new Map(health.tips.map((t) => [t.id, t]));
const habitById = new Map(health.habits.map((x) => [x.id, x]));
const BTN = { tracker: '✅ Трекер привычек', biases: '🧠 Ловушки мышления' };
const REMIND_HOURS = [19, 20, 21, 22];
const MILESTONES = [3, 7, 14, 21, 30, 60, 100];

// ---------- серии ----------

export function streak(days = [], today) {
  const set = new Set(days);
  let d = set.has(today) ? today : today - 1;
  let n = 0;
  while (set.has(d)) { n++; d--; }
  return n;
}

export function tipOfDay(day) {
  return health.tips[((day % health.tips.length) + health.tips.length) % health.tips.length];
}

export function createHealthBot({
  token, store, botInfo, biasUsername = process.env.BIAS_BOT_USERNAME || '',
  adminIds = (process.env.ADMIN_IDS ?? '').split(',').filter(Boolean).map(Number),
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const me = () => bot.botInfo?.username ?? '';
  const biasLink = (bias, src = 'health') => deepLink(biasUsername, bias ? `b${bias.n}_${src}` : `from_${src}`);

  const mainKeyboard = () => {
    const kb = new Keyboard();
    health.topics.forEach((t, i) => { kb.text(t.button); if (i % 2) kb.row(); });
    kb.text(BTN_FACTS).text(BTN.tracker);
    if (biasUsername) kb.row().text(BTN.biases);
    return kb.resized().persistent();
  };

  // ---------- советы ----------

  function tipCaption(tip) {
    const bias = getBias(tip.bias);
    const lines = [`<b>${esc(tip.title)}</b>`, '', esc(tip.body), '', `👉 <b>Попробуйте:</b> ${esc(tip.action)}`];
    if (bias) {
      const name = biasUsername ? `<a href="${biasLink(bias)}">${esc(bias.name_ru)}</a>` : `<b>${esc(bias.name_ru)}</b>`;
      lines.push('', `🧠 <b>Ловушка мышления:</b> ${name} — ${esc(bias.summary_ru.charAt(0).toLowerCase() + bias.summary_ru.slice(1))}`);
    }
    lines.push('', `<i>${esc(health.disclaimer)}</i>`);
    return lines.join('\n').slice(0, 1024);
  }

  function tipKeyboard(tip) {
    const bias = getBias(tip.bias);
    const kb = new InlineKeyboard().text('➡️ Ещё совет', `t:${tip.topic}`).text('✅ Трекер', 'h:menu');
    if (bias && biasUsername) kb.row().url(`🧠 ${bias.name_ru} — разбор`, biasLink(bias));
    return kb;
  }

  async function sendTip(ctx, tip, via = 'tip') {
    const handle = me() ? `@${me()}` : '';
    await sendPhotoCached(ctx.api, store, ctx.chat.id, `tip:${tip.id}:${handle}`,
      () => renderTipCard(tip, topicById.get(tip.topic), getBias(tip.bias), { handle }),
      { caption: tipCaption(tip), parse_mode: 'HTML', reply_markup: tipKeyboard(tip) });
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, seenTips: [...new Set([...(d.seenTips ?? []), tip.id])] }));
    store.log(BOT, ctx.from.id, via, tip.id);
  }

  function nextTip(userId, topicId) {
    const seen = new Set(store.getUser(BOT, userId)?.data.seenTips ?? []);
    const pool = health.tips.filter((t) => t.topic === topicId);
    return pool.find((t) => !seen.has(t.id)) ?? pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- старт ----------

  bot.command('start', async (ctx) => {
    const p = parseStartPayload(ctx.match);
    const source = p.source ?? (p.kind ? `deeplink_${p.kind}` : null);
    const { isNew } = store.touchUser(BOT, ctx.from, source);
    store.log(BOT, ctx.from.id, 'start', ctx.match || null);
    await ctx.reply([
      `Привет${ctx.from.first_name ? `, ${esc(ctx.from.first_name)}` : ''}! Это <b>ЗОЖ без самообмана</b>.`,
      '',
      'Как выбирать продукты, двигаться и не бросать через неделю — с поправкой на то, как на самом деле работает мозг. '
      + 'К каждому совету — ловушка мышления, которая мешает.',
      '',
      'Выберите тему внизу или заведите трекер привычек 👇',
    ].join('\n'), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
    // пришёл из «Плацебо и мифов» Кодекса — сразу в рубрику «Доказано наукой»
    if (source?.startsWith('facts')) {
      const v = factsRubric.intro(ctx.from.id);
      await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.kb });
      return;
    }
    await sendTip(ctx, tipOfDay(localNow().day), 'tip_start');
    if (isNew) {
      await ctx.reply('Хотите отмечать 1–3 полезные привычки и копить серии дней? Это 10 секунд в день.', {
        reply_markup: new InlineKeyboard().text('✅ Да, выбрать привычки', 'h:pick').text('Позже', 'h:later'),
      });
    }
  });

  bot.use(async (ctx, next) => {
    if (ctx.from) store.touchUser(BOT, ctx.from);
    await next();
  });

  for (const t of health.topics) {
    bot.hears(t.button, (ctx) => sendTip(ctx, nextTip(ctx.from.id, t.id)));
  }
  bot.callbackQuery(/^t:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (topicById.has(ctx.match[1])) await sendTip(ctx, nextTip(ctx.from.id, ctx.match[1]));
  });
  bot.callbackQuery(/^tip:([\w-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const tip = tipById.get(ctx.match[1]);
    if (tip) await sendTip(ctx, tip);
  });
  bot.callbackQuery('h:later', async (ctx) => {
    await ctx.answerCallbackQuery('Трекер — в меню внизу');
    await ctx.editMessageText('Ок! Трекер всегда под кнопкой «✅ Трекер привычек».');
  });

  bot.hears(BTN.biases, async (ctx) => {
    store.log(BOT, ctx.from.id, 'open_bias');
    await ctx.reply(
      '🧠 <b>Кодекс когнитивных искажений</b>\n\n187 ловушек мышления — карточки с примерами, квиз и «искажение дня». '
      + 'Все советы здесь опираются на них.',
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('Открыть Кодекс', biasLink(null)) });
  });

  // ---------- трекер привычек ----------

  function trackerView(userId) {
    const u = store.getUser(BOT, userId);
    const hb = u?.data.habits ?? { list: [], log: {} };
    const today = localNow().day;
    if (!hb.list.length) {
      return { text: 'У вас пока нет привычек в трекере.', kb: new InlineKeyboard().text('➕ Выбрать привычки', 'h:pick') };
    }
    const lines = ['✅ <b>Трекер привычек</b> — отметьте, что сделали сегодня:', ''];
    const kb = new InlineKeyboard();
    let doneCount = 0;
    for (const id of hb.list) {
      const h = habitById.get(id);
      if (!h) continue;
      const done = (hb.log[id] ?? []).includes(today);
      if (done) doneCount++;
      const s = streak(hb.log[id], today);
      lines.push(`${h.emoji} ${esc(h.title)} — ${s ? `🔥 ${s} ${plural(s, 'день', 'дня', 'дней')} подряд` : 'серия не начата'}`);
      kb.text(`${done ? '✅' : '⬜'} ${h.emoji} ${h.title}`, `h:c:${id}`).row();
    }
    if (doneCount === hb.list.length) lines.push('', 'Всё на сегодня выполнено 💪');
    lines.push('', u.daily_hour == null ? '⏰ Напоминание выключено' : `⏰ Напоминание в ${u.daily_hour}:00 (мск)`);
    kb.text('⚙️ Привычки', 'h:pick').text('⏰ Напоминание', 'h:rem').text('📊 Неделя', 'h:week');
    return { text: lines.join('\n'), kb };
  }

  const showTracker = async (ctx, edit = false) => {
    const v = trackerView(ctx.from.id);
    if (edit) return ctx.editMessageText(v.text, { parse_mode: 'HTML', reply_markup: v.kb });
    return ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.kb });
  };
  bot.command('tracker', (ctx) => showTracker(ctx));
  bot.hears(BTN.tracker, (ctx) => showTracker(ctx));
  bot.callbackQuery('h:menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showTracker(ctx, !ctx.callbackQuery.message?.photo);
  });

  const pickView = (userId) => {
    const list = store.getUser(BOT, userId)?.data.habits?.list ?? [];
    const kb = new InlineKeyboard();
    for (const h of health.habits) kb.text(`${list.includes(h.id) ? '✅' : '⬜'} ${h.emoji} ${h.title}`, `h:t:${h.id}`).row();
    kb.text('Готово ➡️', 'h:done');
    return { text: 'Выберите 1–3 привычки. Меньше — лучше: маленькие шаги держатся дольше.', kb };
  };
  bot.callbackQuery('h:pick', async (ctx) => {
    await ctx.answerCallbackQuery();
    const v = pickView(ctx.from.id);
    if (ctx.callbackQuery.message?.photo) return ctx.reply(v.text, { reply_markup: v.kb });
    await ctx.editMessageText(v.text, { reply_markup: v.kb });
  });
  bot.callbackQuery(/^h:t:(\w+)$/, async (ctx) => {
    const id = ctx.match[1];
    let tooMany = false;
    store.updateData(BOT, ctx.from.id, (d) => {
      d.habits = d.habits ?? { list: [], log: {} };
      if (d.habits.list.includes(id)) d.habits.list = d.habits.list.filter((x) => x !== id);
      else if (d.habits.list.length >= 3) tooMany = true;
      else if (habitById.has(id)) d.habits.list.push(id);
      return d;
    });
    await ctx.answerCallbackQuery(tooMany ? 'Не больше трёх — так проще удержать' : undefined);
    const v = pickView(ctx.from.id);
    await ctx.editMessageText(v.text, { reply_markup: v.kb });
  });
  bot.callbackQuery('h:done', async (ctx) => {
    await ctx.answerCallbackQuery();
    const u = store.getUser(BOT, ctx.from.id);
    store.log(BOT, ctx.from.id, 'habits_set', (u.data.habits?.list ?? []).join(','));
    if (u.daily_hour == null && u.data.habits?.list?.length) {
      store.setDailyHour(BOT, ctx.from.id, 21);
      store.log(BOT, ctx.from.id, 'subscribe', 21);
    }
    await showTracker(ctx, true);
  });

  bot.callbackQuery(/^h:c:(\w+)$/, async (ctx) => {
    const id = ctx.match[1];
    const today = localNow().day;
    let nowDone = false;
    const d = store.updateData(BOT, ctx.from.id, (x) => {
      x.habits = x.habits ?? { list: [], log: {} };
      const log = new Set(x.habits.log[id] ?? []);
      if (log.has(today)) log.delete(today); else { log.add(today); nowDone = true; }
      x.habits.log[id] = [...log].sort((a, b) => a - b).slice(-400);
      return x;
    });
    const s = streak(d?.habits?.log[id], today);
    store.log(BOT, ctx.from.id, nowDone ? 'checkin' : 'uncheck', id);
    let toast = nowDone ? '✅ Отмечено' : 'Отметка снята';
    if (nowDone && MILESTONES.includes(s)) {
      toast = `🔥 ${s} ${plural(s, 'день', 'дня', 'дней')} подряд! Теперь жалко прерывать — неприятие потерь работает на вас.`;
    }
    await ctx.answerCallbackQuery({ text: toast, show_alert: nowDone && MILESTONES.includes(s) });
    await showTracker(ctx, true);
  });

  bot.callbackQuery('h:rem', async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    REMIND_HOURS.forEach((h) => kb.text(`${h}:00`, `h:r:${h}`));
    kb.row().text('🔕 Без напоминаний', 'h:r:off').row().text('⬅️ Назад', 'h:menu');
    await ctx.editMessageText('Во сколько напоминать отметить привычки? (мск)\nВместе с напоминанием пришлю совет дня.', { reply_markup: kb });
  });
  bot.callbackQuery(/^h:r:(\d+|off)$/, async (ctx) => {
    const hour = ctx.match[1] === 'off' ? null : Number(ctx.match[1]);
    store.setDailyHour(BOT, ctx.from.id, hour);
    store.log(BOT, ctx.from.id, hour == null ? 'unsubscribe' : 'subscribe', hour);
    await ctx.answerCallbackQuery(hour == null ? 'Напоминания выключены' : `Напомню в ${hour}:00`);
    await showTracker(ctx, true);
  });

  bot.callbackQuery('h:week', async (ctx) => {
    await ctx.answerCallbackQuery();
    const hb = store.getUser(BOT, ctx.from.id)?.data.habits ?? { list: [], log: {} };
    const today = localNow().day;
    const lines = ['📊 <b>Последние 7 дней</b>', ''];
    for (const id of hb.list) {
      const h = habitById.get(id);
      const log = new Set(hb.log[id] ?? []);
      const row = Array.from({ length: 7 }, (_, i) => (log.has(today - 6 + i) ? '🟩' : '⬜')).join('');
      const n = [...log].filter((x) => x > today - 7).length;
      lines.push(`${h.emoji} ${row} ${n}/7`);
    }
    lines.push('', 'Пропуски — нормально. Главное правило: не пропускать дважды подряд.');
    await ctx.editMessageText(lines.join('\n'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('⬅️ К трекеру', 'h:menu') });
  });

  // ---------- админ ----------

  bot.command('stats', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return;
    const s = store.stats(BOT);
    await ctx.reply([
      '<b>Статистика ЗОЖ-бота</b>',
      `Пользователей: ${s.users} (+${s.new24h}), активны за сутки: ${s.active24h}`,
      `С напоминаниями: ${s.subscribed}, заблокировали: ${s.blocked}`,
      ...store.revenue(BOT).map((r) => `💰 ${r.product}: ${r.purchases} покупок, ${r.amount} ${r.currency === 'XTR' ? '⭐' : r.currency}`),
      '', '<b>Источники:</b>', ...s.sources.map((r) => `${esc(r.source)}: ${r.n}`),
      '', '<b>События за сутки:</b>', ...s.events24h.map((r) => `${esc(r.type)}: ${r.n}`),
    ].join('\n'), { parse_mode: 'HTML' });
  });

  const factsRubric = installFacts(bot, { store, BOT, me, biasLink: (b, src = 'health') => (biasUsername ? biasLink(b, src) : null), adminIds });

  bot.on('message:text', (ctx) => ctx.reply('Выберите тему на клавиатуре внизу 👇', { reply_markup: mainKeyboard() }));
  bot.catch((err) => console.error('[health-bot]', err.error?.description ?? err.error ?? err));

  // ---------- вечернее напоминание ----------

  async function runDaily(local) {
    if (local.minute > 10) return;
    const due = store.dueForDaily(BOT, local.hour, local.day).filter((u) => u.data.habits?.list?.length);
    if (!due.length) return;
    const tip = tipOfDay(local.day);
    const sent = await broadcast(due, async (u) => {
      const v = trackerView(u.id);
      await bot.api.sendMessage(u.id, `🌙 Вечерняя отметка\n\n${v.text}\n\n💡 Совет дня: «${esc(tip.title)}»`, {
        parse_mode: 'HTML', reply_markup: v.kb.row().text('💡 Открыть совет', `tip:${tip.id}`),
      });
    }, { store, bot: BOT, onSent: (u) => store.markDaily(BOT, u.id, local.day) });
    store.log(BOT, null, 'reminder_sent', `${sent}/${due.length}`);
  }

  return { bot, runDaily, startScheduler: () => everyMinute(runDaily), tipCaption, factsRubric };
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
