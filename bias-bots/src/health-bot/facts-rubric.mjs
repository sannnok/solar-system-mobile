// Рубрика «🔬 Доказано наукой» в ЗОЖ-боте — факты про тело (питание, тренировки,
// сон, долголетие, добавки) с уровнем доказанности A/B/C — и её разблокировка
// «за чашку кофе». Несколько фактов бесплатны — витрина; остальные открываются разовой покупкой
// в Telegram Stars (XTR). Цифровые товары в Telegram продаются только за Stars,
// внешний платёжный провайдер не нужен — provider_token не передаём.
// Telegram требует у платных ботов /paysupport и /terms — они здесь же.
import { InlineKeyboard } from 'grammy';
import { getBias } from '../lib/data.mjs';
import { renderFactCard } from '../lib/cards.mjs';
import { factsFor, getFact as getAnyFact, factCaption, pubmedUrl, FACT_TOPICS, LEVELS, levelBadge } from '../lib/facts.mjs';

export const facts = factsFor('health');
export const freeFacts = facts.filter((f) => f.free);
const getFact = (id) => (getAnyFact(id)?.rubric === 'health' ? getAnyFact(id) : null);
import { esc, sendPhotoCached } from '../lib/tg.mjs';

export const PRODUCT = 'facts';
export const PAYLOAD = 'facts:v1';
export const BTN_FACTS = '🔬 Доказано наукой';

export function installFacts(bot, {
  store, BOT, me, biasLink, adminIds,
  price = Number(process.env.FACTS_PRICE_STARS ?? 50),
  allFree = process.env.FACTS_FREE === '1',
}) {
  const hasAccess = (userId) => allFree || adminIds.includes(userId) || Boolean(store.activePurchase(BOT, userId, PRODUCT));
  const canSee = (userId, f) => f.free || hasAccess(userId);
  const seen = (userId) => new Set(store.getUser(BOT, userId)?.data.seenFacts ?? []);
  const lockedCount = facts.length - freeFacts.length;

  const intro = (userId) => {
    const open = hasAccess(userId);
    const lines = [
      `🔬 <b>Доказано наукой</b> — малоизвестные факты о питании, тренировках, сне и долголетии.`,
      '',
      'Только опубликованные исследования, и у каждого — честный уровень доказанности, проверенный по PubMed:',
      ...Object.entries(LEVELS).map(([k, l]) => `<b>${k}</b> — ${esc(l.explain)} (${facts.filter((f) => f.level === k).length})`),
      '',
      'К каждой карточке — журнал, год, размер выборки, ограничения и ссылка на PubMed.',
      '',
      open
        ? `✅ Вам открыты все ${facts.length} фактов.`
        : `Бесплатно: ${freeFacts.length}. Ещё ${lockedCount} — за ☕ чашку кофе (${price} ⭐), разово и навсегда.`,
    ];
    const kb = new InlineKeyboard().text('➡️ Читать', 'f:next').text('📚 Все факты', 'f:list');
    if (!open) kb.row().text(`☕ Открыть всё за ${price} ⭐`, 'f:buy');
    return { text: lines.join('\n'), kb };
  };

  async function sendFact(ctx, f) {
    const handle = me() ? `@${me()}` : '';
    const bias = getBias(f.bias);
    const kb = new InlineKeyboard().text('➡️ Следующий факт', 'f:next').url('📄 PubMed', pubmedUrl(f.pmid));
    if (bias && biasLink(bias)) kb.row().url(`🧠 ${bias.name_ru}`, biasLink(bias, 'facts'));
    await sendPhotoCached(ctx.api, store, ctx.chat.id, `fact:${f.id}:${handle}`,
      () => renderFactCard(f, bias, { handle, topicTitle: FACT_TOPICS[f.topic], badge: levelBadge(f), color: LEVELS[f.level].color }),
      { caption: factCaption(f, { biasLink: biasLink(bias) ? (b) => biasLink(b, 'facts') : null }), parse_mode: 'HTML', reply_markup: kb });
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, seenFacts: [...new Set([...(d.seenFacts ?? []), f.id])] }));
    store.log(BOT, ctx.from.id, 'fact', f.id);
  }

  async function paywall(ctx, teaser) {
    const s = seen(ctx.from.id);
    const next = facts.filter((f) => !f.free && !s.has(f.id)).slice(0, 4);
    store.log(BOT, ctx.from.id, 'paywall', teaser?.id ?? null);
    await ctx.reply([
      teaser ? `🔒 «${esc(teaser.title)}» — в закрытой части рубрики.` : '🔓 Бесплатные факты закончились.',
      '',
      `Дальше ещё ${lockedCount} — например:`,
      ...next.map((f) => `• ${esc(f.title)}`),
      '',
      `Открыть всю рубрику — ☕ ${price} ⭐ (примерно как чашка кофе). Разовая покупка, новые факты тоже войдут.`,
    ].join('\n'), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(`☕ Открыть за ${price} ⭐`, 'f:buy') });
  }

  async function sendNext(ctx) {
    const s = seen(ctx.from.id);
    const available = facts.filter((f) => canSee(ctx.from.id, f));
    const next = available.find((f) => !s.has(f.id));
    if (next) return sendFact(ctx, next);
    if (!hasAccess(ctx.from.id)) return paywall(ctx);
    // всё прочитано — по кругу, начиная со случайного
    return sendFact(ctx, available[Math.floor(Math.random() * available.length)]);
  }

  async function sendInvoice(ctx) {
    if (hasAccess(ctx.from.id)) return ctx.reply('✅ Рубрика уже открыта — спасибо!', { reply_markup: new InlineKeyboard().text('➡️ Читать', 'f:next') });
    store.log(BOT, ctx.from.id, 'invoice', price);
    await ctx.replyWithInvoice(
      'Рубрика «Доказано наукой»',
      `Все ${facts.length} фактов о питании, тренировках, сне и долголетии — с уровнем доказанности и ссылками на PubMed. Разовая покупка — как чашка кофе ☕`,
      PAYLOAD, 'XTR', [{ label: 'Доступ к рубрике', amount: price }],
    );
  }

  // ---------- навигация ----------

  const openRubric = async (ctx) => {
    store.log(BOT, ctx.from.id, 'facts_open');
    const v = intro(ctx.from.id);
    await ctx.reply(v.text, { parse_mode: 'HTML', reply_markup: v.kb });
  };
  bot.command('facts', openRubric);
  bot.hears(BTN_FACTS, openRubric);

  bot.callbackQuery('f:next', async (ctx) => { await ctx.answerCallbackQuery(); await sendNext(ctx); });
  bot.callbackQuery('f:buy', async (ctx) => { await ctx.answerCallbackQuery(); await sendInvoice(ctx); });
  bot.command('buy', sendInvoice);

  bot.callbackQuery('f:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = seen(ctx.from.id);
    const kb = new InlineKeyboard();
    for (const f of facts) {
      const mark = canSee(ctx.from.id, f) ? (s.has(f.id) ? '✓' : '•') : '🔒';
      kb.text(`${mark} ${f.title}`.slice(0, 64), `f:o:${f.id}`).row();
    }
    await ctx.reply(`📚 Все факты рубрики (${facts.length}). 🔒 — в закрытой части.`, { reply_markup: kb });
  });

  bot.callbackQuery(/^f:o:([\w-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const f = getFact(ctx.match[1]);
    if (!f) return;
    if (canSee(ctx.from.id, f)) return sendFact(ctx, f);
    return paywall(ctx, f);
  });

  // ---------- оплата Stars ----------

  bot.on('pre_checkout_query', async (ctx) => {
    const q = ctx.preCheckoutQuery;
    if (q.invoice_payload !== PAYLOAD || q.currency !== 'XTR' || q.total_amount !== price) {
      return ctx.answerPreCheckoutQuery(false, { error_message: 'Счёт устарел — нажмите «Открыть» ещё раз, пришлю новый.' });
    }
    if (store.activePurchase(BOT, q.from.id, PRODUCT)) {
      return ctx.answerPreCheckoutQuery(false, { error_message: 'Рубрика у вас уже открыта — повторно платить не нужно.' });
    }
    return ctx.answerPreCheckoutQuery(true);
  });

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    if (p.invoice_payload !== PAYLOAD) return;
    store.addPurchase({ bot: BOT, userId: ctx.from.id, product: PRODUCT, currency: p.currency, amount: p.total_amount, chargeId: p.telegram_payment_charge_id });
    await ctx.reply(`☕ Спасибо за кофе! Открыты все ${facts.length} фактов.\n\nЕсли что-то не так с оплатой — /paysupport.`,
      { reply_markup: new InlineKeyboard().text('➡️ Читать дальше', 'f:next').text('📚 Все факты', 'f:list') });
    for (const id of adminIds) {
      bot.api.sendMessage(id, `💰 Покупка: ${p.total_amount} ⭐ от ${ctx.from.id} (${esc(ctx.from.first_name ?? '')})`).catch(() => {});
    }
  });

  bot.command('terms', (ctx) => ctx.reply([
    '<b>Условия</b>',
    '',
    `• Покупка за ${price} ⭐ открывает рубрику «Доказано наукой» в этом боте навсегда, включая будущие факты.`,
    '• Это просветительский контент, а не медицинская консультация. Решения о лечении принимайте с врачом.',
    '• Источники — открытые научные публикации; ссылки на PubMed в каждой карточке.',
    '• Проблемы с оплатой и возврат — /paysupport.',
  ].join('\n'), { parse_mode: 'HTML' }));

  bot.command('paysupport', async (ctx) => {
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, awaitingSupport: true }));
    const p = store.activePurchase(BOT, ctx.from.id, PRODUCT);
    await ctx.reply(`Опишите проблему с оплатой одним сообщением — передам администратору.${p ? '\nВаша покупка найдена, номер платежа приложу автоматически.' : ''}`);
  });

  // сообщение после /paysupport — администраторам (ставить до общего обработчика текста)
  bot.on('message:text', async (ctx, next) => {
    const u = store.getUser(BOT, ctx.from.id);
    if (!u?.data.awaitingSupport || ctx.message.text.startsWith('/')) return next();
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, awaitingSupport: false }));
    const p = store.activePurchase(BOT, ctx.from.id, PRODUCT);
    for (const id of adminIds) {
      await bot.api.sendMessage(id, [
        `🆘 /paysupport от ${ctx.from.id} (${esc(ctx.from.first_name ?? '')}${ctx.from.username ? ` @${ctx.from.username}` : ''})`,
        p ? `Покупка: ${p.amount} ⭐, charge_id <code>${esc(p.charge_id)}</code>` : 'Активных покупок нет',
        '', esc(ctx.message.text),
        '', `Вернуть: /refund ${ctx.from.id}`,
      ].join('\n'), { parse_mode: 'HTML' }).catch(() => {});
    }
    store.log(BOT, ctx.from.id, 'paysupport');
    await ctx.reply('Передал. Ответим здесь же.');
  });

  bot.command('refund', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) return;
    const userId = Number(ctx.match.trim());
    const p = userId && store.activePurchase(BOT, userId, PRODUCT);
    if (!p) return ctx.reply('Не нашёл активной покупки. Формат: /refund <user_id>');
    await bot.api.refundStarPayment(userId, p.charge_id);
    store.markRefunded(p.charge_id);
    store.log(BOT, userId, 'refund', p.amount);
    await bot.api.sendMessage(userId, `Вернули ${p.amount} ⭐. Доступ к закрытой части рубрики закрыт — бесплатные факты остаются.`).catch(() => {});
    await ctx.reply(`Возврат ${p.amount} ⭐ пользователю ${userId} выполнен.`);
  });

  return { hasAccess, intro, sendNext };
}
