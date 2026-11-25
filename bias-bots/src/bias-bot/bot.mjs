// Бот «Кодекс когнитивных искажений».
// Сценарий воронки: пришёл по ссылке из ролика/канала (?start=b19_reels) →
// сразу получил карточку (ценность в первую секунду) → подписался на «искажение
// дня» → после нескольких карточек увидел приглашение во второй бот (ЗОЖ).
import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import {
  biases, quadrants, getBias, getQuadrant, getGroup, groupsOf, biasesOf,
  biasOfDay, randomBias, search, quizQuestion,
} from '../lib/data.mjs';
import { renderCard } from '../lib/cards.mjs';
import { biasCaption, biasMoreText } from '../lib/captions.mjs';
import { esc, sendPhotoCached, parseStartPayload, deepLink, localNow, broadcast, everyMinute } from '../lib/tg.mjs';

export const BOT = 'bias';

const BTN = {
  today: '📅 Искажение дня',
  random: '🎲 Случайное',
  map: '🗺 Карта кодекса',
  quiz: '🧠 Квиз',
  sub: '🔔 Рассылка',
  health: '💪 ЗОЖ и мотивация',
};
const HOURS = [8, 9, 12, 18, 21];
const PROMO_AFTER_CARDS = 5;
const PAGE = 8;

export function createBiasBot({
  token, store, botInfo, healthUsername = process.env.HEALTH_BOT_USERNAME || '',
  adminIds = (process.env.ADMIN_IDS ?? '').split(',').filter(Boolean).map(Number),
  webAppUrl = process.env.WEBAPP_URL || '',
}) {
  const bot = new Bot(token, botInfo ? { botInfo } : {});
  const me = () => bot.botInfo?.username ?? '';

  const mainKeyboard = () => {
    const kb = new Keyboard().text(BTN.today).text(BTN.random).row().text(BTN.map).text(BTN.quiz).row().text(BTN.sub);
    if (healthUsername) kb.text(BTN.health);
    return kb.resized().persistent();
  };

  const cardKeyboard = (b) => {
    const kb = new InlineKeyboard()
      .text('📖 Подробнее', `more:${b.n}`)
      .switchInline('📤 Поделиться', b.name_ru).row()
      .text('🎲 Ещё', 'rnd')
      .text('🗂 Вся группа', `g:${b.group}:0`);
    return kb;
  };

  // ---------- карточка ----------

  async function sendBias(ctx, bias, { via = 'card' } = {}) {
    const handle = me() ? `@${me()}` : '';
    await sendPhotoCached(ctx.api, store, ctx.chat.id, `bias:post:${bias.id}:${handle}`,
      () => renderCard(bias, { format: 'post', handle }),
      { caption: biasCaption(bias, { botUsername: me() }), parse_mode: 'HTML', reply_markup: cardKeyboard(bias) });
    store.log(BOT, ctx.from?.id, via, bias.id);
    const data = store.updateData(BOT, ctx.from.id, (d) => {
      d.seen = [...new Set([...(d.seen ?? []), bias.n])].slice(-200);
      d.cards = (d.cards ?? 0) + 1;
      return d;
    });
    if (data && healthUsername && data.cards >= PROMO_AFTER_CARDS && !data.promoShown) {
      store.updateData(BOT, ctx.from.id, (d) => ({ ...d, promoShown: true }));
      await ctx.reply(
        'Кстати: многие искажения — причина, почему не получается начать тренироваться, правильно питаться и не бросить через неделю.\n\n'
        + 'Во втором боте — короткие советы по ЗОЖ и трекер привычек, где эти ловушки работают <b>на</b> вас. 💪',
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('Открыть ЗОЖ-бота', deepLink(healthUsername, 'from_bias')) });
      store.log(BOT, ctx.from.id, 'promo_health');
    }
  }

  const welcome = (name) => [
    `Привет${name ? `, ${esc(name)}` : ''}! Это карманный <b>«Кодекс когнитивных искажений»</b> — ${biases.length} ловушек мышления, разложенных по полочкам.`,
    '',
    'Каждая карточка — что это, пример из жизни и как не попасться.',
    'Можно просто написать название — например, «якорь» или «ошибка выжившего», — я найду.',
  ].join('\n');

  // ---------- команды ----------

  bot.command('start', async (ctx) => {
    const p = parseStartPayload(ctx.match);
    const { isNew } = store.touchUser(BOT, ctx.from, p.source);
    store.log(BOT, ctx.from.id, 'start', ctx.match || null);
    if (p.kind === 'b' && getBias(p.n)) {
      if (isNew) await ctx.reply(welcome(ctx.from.first_name), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
      return sendBias(ctx, getBias(p.n), { via: 'deeplink' });
    }
    await ctx.reply(welcome(ctx.from.first_name), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
    await ctx.reply('Начнём с искажения дня 👇');
    await sendBias(ctx, biasOfDay(), { via: 'today' });
    if (isNew) await askSubscription(ctx, true);
  });

  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.inlineQuery) store.touchUser(BOT, ctx.from);
    await next();
  });

  bot.command('today', (ctx) => sendBias(ctx, biasOfDay(), { via: 'today' }));
  bot.hears(BTN.today, (ctx) => sendBias(ctx, biasOfDay(), { via: 'today' }));

  const sendRandom = (ctx) => {
    const seen = store.getUser(BOT, ctx.from.id)?.data.seen ?? [];
    return sendBias(ctx, randomBias(biases.filter((b) => seen.includes(b.n)).map((b) => b.id)), { via: 'random' });
  };
  bot.command('random', sendRandom);
  bot.hears(BTN.random, sendRandom);
  bot.callbackQuery('rnd', async (ctx) => { await ctx.answerCallbackQuery(); await sendRandom(ctx); });

  bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const b = getBias(Number(ctx.match[1]));
    if (b) await sendBias(ctx, b, { via: 'browse' });
  });

  bot.callbackQuery(/^more:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const b = getBias(Number(ctx.match[1]));
    if (!b) return;
    const neighbours = biasesOf(b.group).filter((x) => x.id !== b.id).slice(0, 4);
    const kb = new InlineKeyboard();
    neighbours.forEach((x, i) => { kb.text(x.name_ru, `b:${x.n}`); if (i % 2) kb.row(); });
    await ctx.reply(`${biasMoreText(b)}\n\n<b>Рядом на карте:</b>`, {
      parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true },
    });
    store.log(BOT, ctx.from.id, 'more', b.id);
  });

  // ---------- карта: квадранты → группы → искажения ----------

  const mapText = () => [
    '<b>Кодекс когнитивных искажений</b>',
    '',
    'Мозг экономит силы и решает четыре задачи. У каждой — свои ловушки:',
    '',
    ...quadrants.map((q) => `${q.emoji} <b>${esc(q.title_ru)}</b> — ${esc(q.problem_ru)}`),
  ].join('\n');

  const mapKeyboard = () => {
    const kb = new InlineKeyboard();
    for (const q of quadrants) {
      const count = biases.filter((b) => b.quadrant === q.id).length;
      kb.text(`${q.emoji} ${q.title_ru} · ${count}`, `q:${q.id}`).row();
    }
    if (webAppUrl) kb.webApp('🌀 Интерактивная карта', `${webAppUrl}${webAppUrl.includes('?') ? '&' : '?'}bot=${me()}`);
    return kb;
  };

  const showMap = async (ctx) => {
    const opts = { parse_mode: 'HTML', reply_markup: mapKeyboard() };
    if (ctx.callbackQuery) { await ctx.answerCallbackQuery(); return ctx.editMessageText(mapText(), opts); }
    return ctx.reply(mapText(), opts);
  };
  bot.command('map', showMap);
  bot.hears(BTN.map, showMap);
  bot.callbackQuery('map', showMap);

  bot.callbackQuery(/^q:(q\d)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const q = getQuadrant(ctx.match[1]);
    const kb = new InlineKeyboard();
    for (const g of groupsOf(q.id)) kb.text(`${g.title_ru} · ${biasesOf(g.id).length}`, `g:${g.id}:0`).row();
    kb.text('⬅️ Все ветви', 'map');
    await ctx.editMessageText(`${q.emoji} <b>${esc(q.title_ru)}</b>\n\n${esc(q.problem_ru)}\n\nВыберите группу:`, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.callbackQuery(/^g:(q\dg\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const g = getGroup(ctx.match[1]);
    if (!g) return;
    const page = Number(ctx.match[2]);
    const list = biasesOf(g.id);
    const pages = Math.ceil(list.length / PAGE);
    const kb = new InlineKeyboard();
    list.slice(page * PAGE, page * PAGE + PAGE).forEach((b, i) => { kb.text(b.name_ru, `b:${b.n}`); if (i % 2) kb.row(); });
    kb.row();
    if (page > 0) kb.text('◀️', `g:${g.id}:${page - 1}`);
    if (page < pages - 1) kb.text('▶️', `g:${g.id}:${page + 1}`);
    kb.row().text('⬅️ Назад', `q:${g.quadrant}`);
    const text = `${getQuadrant(g.quadrant).emoji} <b>${esc(g.title_ru)}</b>\n\n${list.length} искажений${pages > 1 ? ` · стр. ${page + 1}/${pages}` : ''}:`;
    // из карточки (фото) редактировать нечего — шлём новое сообщение
    if (ctx.callbackQuery.message?.photo) return ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  // ---------- квиз ----------

  async function sendQuiz(ctx) {
    const { answer, options } = quizQuestion();
    const kb = new InlineKeyboard();
    options.forEach((o) => kb.text(o.name_ru, `qa:${answer.n}:${o.n}`).row());
    await ctx.reply(`🧠 <b>Какое это искажение?</b>\n\n«${esc(answer.example_ru)}»`, { parse_mode: 'HTML', reply_markup: kb });
    store.log(BOT, ctx.from.id, 'quiz_q', answer.id);
  }
  bot.command('quiz', sendQuiz);
  bot.hears(BTN.quiz, sendQuiz);
  bot.callbackQuery('quiz', async (ctx) => { await ctx.answerCallbackQuery(); await sendQuiz(ctx); });

  bot.callbackQuery(/^qa:(\d+):(\d+)$/, async (ctx) => {
    const answer = getBias(Number(ctx.match[1]));
    const pick = getBias(Number(ctx.match[2]));
    const right = answer.n === pick.n || answer.name_ru === pick.name_ru;
    const d = store.updateData(BOT, ctx.from.id, (x) => {
      x.quiz = x.quiz ?? { right: 0, total: 0, streak: 0, best: 0 };
      x.quiz.total++;
      if (right) { x.quiz.right++; x.quiz.streak++; x.quiz.best = Math.max(x.quiz.best, x.quiz.streak); } else x.quiz.streak = 0;
      return x;
    });
    await ctx.answerCallbackQuery(right ? '✅ Верно!' : '❌ Мимо');
    store.log(BOT, ctx.from.id, right ? 'quiz_right' : 'quiz_wrong', answer.id);
    const s = d?.quiz ?? { right: 0, total: 0, streak: 0 };
    const text = [
      right ? '✅ <b>Верно!</b>' : `❌ Это не «${esc(pick.name_ru)}».`,
      '',
      `«${esc(answer.example_ru)}»`,
      '',
      `Это <b>${esc(answer.name_ru)}</b>: ${esc(answer.summary_ru)}`,
      '',
      `Счёт: ${s.right} из ${s.total}${s.streak > 1 ? ` · серия ${s.streak} 🔥` : ''}`,
    ].join('\n');
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard().text('➡️ Следующий вопрос', 'quiz').text('🃏 Карточка', `b:${answer.n}`),
    });
  });

  // ---------- рассылка ----------

  async function askSubscription(ctx, soft = false) {
    const u = store.getUser(BOT, ctx.from.id);
    const kb = new InlineKeyboard();
    HOURS.forEach((h) => kb.text(`${u?.daily_hour === h ? '✅ ' : ''}${String(h).padStart(2, '0')}:00`, `sub:${h}`));
    kb.row().text(u?.daily_hour == null ? (soft ? 'Не сейчас' : '🔕 Не присылать') : '🔕 Отключить', 'sub:off');
    const text = soft
      ? 'Хотите получать <b>одно искажение в день</b>? Это 30 секунд чтения. Выберите время (мск):'
      : `🔔 <b>Искажение дня</b>\n\n${u?.daily_hour == null ? 'Сейчас рассылка выключена.' : `Сейчас приходит в ${u.daily_hour}:00 (мск).`}\nВо сколько присылать?`;
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: kb });
  }
  bot.command('subscribe', (ctx) => askSubscription(ctx));
  bot.hears(BTN.sub, (ctx) => askSubscription(ctx));

  bot.callbackQuery(/^sub:(\d+|off)$/, async (ctx) => {
    const v = ctx.match[1];
    const hour = v === 'off' ? null : Number(v);
    store.setDailyHour(BOT, ctx.from.id, hour);
    // подписался после сегодняшней рассылки — первая карточка придёт завтра
    if (hour != null && localNow().hour >= hour) store.markDaily(BOT, ctx.from.id, localNow().day);
    store.log(BOT, ctx.from.id, hour == null ? 'unsubscribe' : 'subscribe', hour);
    await ctx.answerCallbackQuery(hour == null ? 'Рассылка выключена' : `Готово: каждый день в ${hour}:00`);
    await ctx.editMessageText(hour == null
      ? 'Ок, не буду присылать. Включить снова — кнопка «🔔 Рассылка».'
      : `✅ Каждый день в <b>${hour}:00</b> (мск) пришлю одно искажение.\nИзменить — кнопка «🔔 Рассылка».`, { parse_mode: 'HTML' });
  });

  // ---------- второй бот ----------

  bot.hears(BTN.health, async (ctx) => {
    store.log(BOT, ctx.from.id, 'open_health');
    await ctx.reply(
      '💪 <b>ЗОЖ без самообмана</b>\n\nКак выбирать продукты, не бросать тренировки и где мозг обманывает нас с мотивацией. '
      + 'Короткие карточки + трекер привычек с сериями.',
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('Открыть', deepLink(healthUsername, 'from_bias')) });
  });

  // ---------- админ ----------

  bot.command('stats', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return;
    const s = store.stats(BOT);
    await ctx.reply([
      `<b>Статистика</b>`,
      `Пользователей: ${s.users} (+${s.new24h} за сутки), активны за сутки: ${s.active24h}`,
      `Подписаны: ${s.subscribed}, заблокировали: ${s.blocked}`,
      '', '<b>Источники:</b>', ...s.sources.map((r) => `${esc(r.source)}: ${r.n}`),
      '', '<b>События за сутки:</b>', ...s.events24h.map((r) => `${esc(r.type)}: ${r.n}`),
    ].join('\n'), { parse_mode: 'HTML' });
  });

  // ---------- inline-режим: делиться карточками в любом чате ----------

  bot.on('inline_query', async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    const list = q ? search(q, 10) : [biasOfDay(), ...search('эффект', 9)];
    const handle = me() ? `@${me()}` : '';
    const results = list.map((b) => {
      const caption = biasCaption(b, { botUsername: me() });
      const markup = new InlineKeyboard().url('Все искажения →', deepLink(me(), `b${b.n}_inline`));
      const fileId = store.cacheGet(`bias:post:${b.id}:${handle}`);
      if (fileId) {
        return { type: 'photo', id: `b${b.n}`, photo_file_id: fileId, title: b.name_ru, description: b.summary_ru, caption, parse_mode: 'HTML', reply_markup: markup };
      }
      return {
        type: 'article', id: `b${b.n}`, title: b.name_ru, description: b.summary_ru,
        input_message_content: { message_text: caption, parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
        reply_markup: markup,
      };
    });
    await ctx.answerInlineQuery(results, { cache_time: 300, is_personal: false });
    store.log(BOT, ctx.from.id, 'inline', q || '∅');
  });

  // ---------- поиск по любому тексту ----------

  bot.on('message:text', async (ctx) => {
    const found = search(ctx.message.text);
    store.log(BOT, ctx.from.id, 'search', ctx.message.text.slice(0, 60));
    if (found.length === 1 || (found.length && search(ctx.message.text, 1)[0].name_ru.toLowerCase() === ctx.message.text.trim().toLowerCase())) {
      return sendBias(ctx, found[0], { via: 'search' });
    }
    if (!found.length) {
      return ctx.reply('Не нашёл такого искажения 🤔 Попробуйте другое слово или откройте карту.', {
        reply_markup: new InlineKeyboard().text('🗺 Карта кодекса', 'map').text('🎲 Случайное', 'rnd'),
      });
    }
    const kb = new InlineKeyboard();
    found.forEach((b) => kb.text(b.name_ru, `b:${b.n}`).row());
    await ctx.reply('Нашлось несколько:', { reply_markup: kb });
  });

  bot.catch((err) => console.error('[bias-bot]', err.error?.description ?? err.error ?? err));

  // ---------- ежедневные задачи ----------

  async function runDaily(local, { channelId = process.env.CHANNEL_ID, channelHour = Number(process.env.CHANNEL_POST_HOUR ?? 10) } = {}) {
    if (local.minute > 10) return; // окно в начале часа — переживём рестарт
    const bias = biasOfDay();
    const handle = me() ? `@${me()}` : '';
    const due = store.dueForDaily(BOT, local.hour, local.day);
    if (due.length) {
      const sent = await broadcast(due, (u) => sendPhotoCached(bot.api, store, u.id, `bias:post:${bias.id}:${handle}`,
        () => renderCard(bias, { format: 'post', handle }),
        { caption: `☀️ <b>Искажение дня</b>\n\n${biasCaption(bias, { botUsername: me() })}`.slice(0, 1024), parse_mode: 'HTML', reply_markup: cardKeyboard(bias) }),
      { store, bot: BOT, onSent: (u) => store.markDaily(BOT, u.id, local.day) });
      store.log(BOT, null, 'daily_sent', `${bias.id}:${sent}/${due.length}`);
    }
    if (channelId && local.hour === channelHour && store.kvGet('channel_last_day') !== String(local.day)) {
      store.kvSet('channel_last_day', local.day);
      await sendPhotoCached(bot.api, store, channelId, `bias:post:${bias.id}:${handle}`,
        () => renderCard(bias, { format: 'post', handle }),
        {
          caption: biasCaption(bias, { botUsername: me() }), parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().url(`Ещё ${biases.length - 1} искажений →`, deepLink(me(), `b${bias.n}_channel`)),
        });
      store.log(BOT, null, 'channel_post', bias.id);
    }
  }

  return { bot, runDaily, startScheduler: () => everyMinute((local) => runDaily(local)), mainKeyboard };
}
