// Рубрика «🎭 Плацебо и мифы» в боте «Кодекс»: как ожидания, ноцебо и «операции-
// пустышки» обманывают нас в вопросах здоровья. Все факты — из рандомизированных
// двойных слепых исследований (уровень A, проверено по PubMed). Рубрика бесплатная:
// это витрина, которая ведёт в платную «Доказано наукой» ЗОЖ-бота.
import { InlineKeyboard } from 'grammy';
import { getBias } from '../lib/data.mjs';
import { renderFactCard } from '../lib/cards.mjs';
import { factsFor, getFact, factCaption, pubmedUrl, FACT_TOPICS, LEVELS, levelBadge } from '../lib/facts.mjs';
import { esc, sendPhotoCached, deepLink } from '../lib/tg.mjs';

export const BTN_MYTHS = '🎭 Плацебо и мифы';
export const myths = factsFor('myths');

export function installMyths(bot, { store, BOT, me, healthUsername }) {
  const seen = (userId) => new Set(store.getUser(BOT, userId)?.data.seenMyths ?? []);
  const healthLink = () => deepLink(healthUsername, 'facts_codex');

  const intro = () => [
    '🎭 <b>Плацебо и мифы</b>',
    '',
    `${myths.length} историй о том, как ожидания меняют самочувствие: боли от «таблетки», которая оказалась пустышкой, `
    + 'операции, которые не лучше имитации, и пищевые страшилки, которые не повторяются в эксперименте.',
    '',
    `Все — из <b>рандомизированных двойных слепых</b> исследований: ${esc(LEVELS.A.explain)}. Источник и ссылка на PubMed — в каждой карточке.`,
  ].join('\n');

  async function sendMyth(ctx, f) {
    const handle = me() ? `@${me()}` : '';
    const bias = getBias(f.bias);
    const kb = new InlineKeyboard().text('➡️ Следующий', 'm:next').url('📄 PubMed', pubmedUrl(f.pmid));
    if (bias) kb.row().text(`🧠 ${bias.name_ru}`, `b:${bias.n}`);
    await sendPhotoCached(ctx.api, store, ctx.chat.id, `myth:${f.id}:${handle}`,
      () => renderFactCard(f, bias, { handle, topicTitle: `Плацебо и мифы · ${FACT_TOPICS[f.topic]}`, badge: levelBadge(f), color: LEVELS[f.level].color }),
      { caption: factCaption(f), parse_mode: 'HTML', reply_markup: kb });
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, seenMyths: [...new Set([...(d.seenMyths ?? []), f.id])] }));
    store.log(BOT, ctx.from.id, 'myth', f.id);
  }

  async function sendNext(ctx) {
    const s = seen(ctx.from.id);
    const next = myths.find((f) => !s.has(f.id));
    if (next) return sendMyth(ctx, next);
    store.log(BOT, ctx.from.id, 'myths_done');
    const kb = new InlineKeyboard().text('🔁 Сначала', 'm:reset');
    if (healthUsername) kb.row().url('🔬 Доказано наукой — про тело', healthLink());
    return ctx.reply([
      `Вы прочитали все ${myths.length} 🎉`,
      healthUsername
        ? '\nХотите такие же разборы про питание, тренировки, сон и долголетие — что работает, а что нет? Это рубрика «Доказано наукой» в нашем ЗОЖ-боте.'
        : '',
    ].join('\n'), { reply_markup: kb });
  }

  const open = async (ctx) => {
    store.log(BOT, ctx.from.id, 'myths_open');
    await ctx.reply(intro(), { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('➡️ Читать', 'm:next').text('📚 Все', 'm:list') });
  };
  bot.command('myths', open);
  bot.hears(BTN_MYTHS, open);
  bot.callbackQuery('m:next', async (ctx) => { await ctx.answerCallbackQuery(); await sendNext(ctx); });
  bot.callbackQuery('m:reset', async (ctx) => {
    await ctx.answerCallbackQuery();
    store.updateData(BOT, ctx.from.id, (d) => ({ ...d, seenMyths: [] }));
    await sendNext(ctx);
  });
  bot.callbackQuery('m:list', async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = seen(ctx.from.id);
    const kb = new InlineKeyboard();
    for (const f of myths) kb.text(`${s.has(f.id) ? '✓' : '•'} ${f.title}`.slice(0, 64), `m:o:${f.id}`).row();
    await ctx.reply(`🎭 Все разборы (${myths.length}):`, { reply_markup: kb });
  });
  bot.callbackQuery(/^m:o:([\w-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const f = getFact(ctx.match[1]);
    if (f?.rubric === 'myths') await sendMyth(ctx, f);
  });
}
