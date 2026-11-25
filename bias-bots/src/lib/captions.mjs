// Подписи к карточкам: HTML для Telegram (лимит подписи к фото — 1024 символа)
// и простой текст для Reels/Shorts/VK.
import { esc } from './tg.mjs';
import { biases, getQuadrant, getGroup } from './data.mjs';

const hashtag = (s) => '#' + s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '_').replace(/^_|_$/g, '');

export function biasCaption(bias, { botUsername = '' } = {}) {
  const q = getQuadrant(bias.quadrant);
  const g = getGroup(bias.group);
  const lines = [
    `<b>${esc(bias.name_ru)}</b> · <i>${esc(bias.name_en)}</i>`,
    '',
    esc(bias.summary_ru),
  ];
  if (bias.example_ru) lines.push('', `<b>Пример.</b> ${esc(bias.example_ru)}`);
  if (bias.tip_ru) lines.push('', `<b>Как не попасться.</b> ${esc(bias.tip_ru)}`);
  lines.push('', `${q.emoji} <i>${esc(q.title_ru)} → ${esc(g.title_ru)}</i>`);
  lines.push(`${hashtag(q.title_ru)} #когнитивные_искажения${botUsername ? ` · @${botUsername}` : ''}`);
  const caption = lines.join('\n');
  return caption.length <= 1024 ? caption : caption.slice(0, 1020) + '…';
}

export function biasPlainCaption(bias, { botUsername = '', cta = '' } = {}) {
  const q = getQuadrant(bias.quadrant);
  return [
    `${bias.name_ru} (${bias.name_en})`,
    '',
    bias.summary_ru,
    bias.example_ru ? `\nПример: ${bias.example_ru}` : '',
    bias.tip_ru ? `\nКак не попасться: ${bias.tip_ru}` : '',
    '',
    cta || (botUsername ? `Все ${biases.length} искажений с примерами — в Telegram: @${botUsername}` : ''),
    '',
    `${hashtag(q.title_ru)} #когнитивныеискажения #психология #мышление #саморазвитие`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();
}

export function biasMoreText(bias) {
  const q = getQuadrant(bias.quadrant);
  const g = getGroup(bias.group);
  const parts = [`<b>${esc(bias.name_ru)}</b>`, ''];
  if (bias.wiki_summary_ru) parts.push(`📚 <b>Википедия:</b> ${esc(bias.wiki_summary_ru)}`, '');
  else if (bias.summary_en) parts.push(`📚 <b>Wikipedia (en):</b> <i>${esc(bias.summary_en)}</i>`, '');
  parts.push(`🗺 <b>Где на карте:</b> ${q.emoji} ${esc(q.title_ru)}`, `↳ ${esc(g.title_ru)}`, '', `<i>${esc(q.problem_ru)}</i>`);
  const links = [bias.wiki_ru && `<a href="${bias.wiki_ru}">Википедия</a>`, `<a href="${bias.wiki_en}">Wikipedia (en)</a>`].filter(Boolean);
  parts.push('', links.join(' · '));
  return parts.join('\n');
}
