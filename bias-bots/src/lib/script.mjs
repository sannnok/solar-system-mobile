// Сценарий ролика (Reels / Shorts / TikTok, ~30 с) для одного искажения.
// С ANTHROPIC_API_KEY пишет Claude (structured output по JSON-схеме), без ключа —
// шаблон из готовых текстов карточки, чтобы конвейер работал и так.
import Anthropic from '@anthropic-ai/sdk';
import { getQuadrant, getGroup, biases } from './data.mjs';

export const MODEL = process.env.SCRIPT_MODEL || 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string', description: 'Крючок на первые 2 секунды: вопрос или парадокс из жизни, до 60 символов' },
    voiceover: { type: 'string', description: 'Текст озвучки на 25–35 секунд, 60–90 слов, разговорный русский' },
    title: { type: 'string', description: 'Заголовок для YouTube Shorts, до 80 символов' },
    caption: { type: 'string', description: 'Описание под роликом: 2–4 коротких предложения и призыв перейти в Telegram-бот' },
    hashtags: { type: 'array', items: { type: 'string' }, description: '5–8 хештегов без пробелов, с #' },
  },
  required: ['hook', 'voiceover', 'title', 'caption', 'hashtags'],
  additionalProperties: false,
};

const SYSTEM = `Ты пишешь сценарии коротких вертикальных роликов (Reels, Shorts, TikTok) о когнитивных искажениях для русскоязычной аудитории 20–40 лет.
Тон: живой, дружелюбный, без канцелярита и без морализаторства. Говори на «ты» или безлично.
Структура озвучки: крючок → что это за искажение простыми словами → бытовой пример, узнаваемый с первой фразы → как не попасться → короткий призыв.
Призыв всегда ведёт в Telegram-бот, имя которого дано во входных данных; не выдумывай других ссылок, цифр и исследований.
Опирайся только на факты из входных данных. Не обещай лечение и не давай медицинских советов.`;

const clip = (s, n) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n - 1)).replace(/[,.:;—-]+$/, '') + '…');

export function templateScript(bias, { botUsername = '' } = {}) {
  const hooks = [
    `Почему мы ${bias.example_ru?.toLowerCase().startsWith('вы') ? 'так делаем' : 'на это попадаемся'}?`,
    'Ваш мозг делает это каждый день',
    'Эта ловушка мышления стоит денег и нервов',
  ];
  const hook = hooks[bias.n % hooks.length];
  const bot = botUsername ? `@${botUsername}` : 'наш Telegram-бот';
  return {
    hook,
    voiceover: [
      `${bias.name_ru}.`, bias.summary_ru,
      bias.example_ru ? `Например: ${bias.example_ru}` : '',
      bias.tip_ru ? `Как не попасться? ${bias.tip_ru}` : '',
      `Ещё ${biases.length - 1} таких ловушек — в ${bot}.`,
    ].filter(Boolean).join(' '),
    title: clip(`${bias.name_ru}: ${bias.summary_ru}`, 80),
    caption: `${bias.summary_ru}\n\nПример: ${bias.example_ru ?? ''}\n\nВсе ${biases.length} искажений с примерами — ${bot}`,
    hashtags: ['#когнитивныеискажения', '#психология', '#мышление', '#саморазвитие', '#shorts'],
    source: 'template',
  };
}

export async function generateReelScript(bias, { botUsername = '', client } = {}) {
  if (!client && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return templateScript(bias, { botUsername });
  }
  const anthropic = client ?? new Anthropic();
  const q = getQuadrant(bias.quadrant);
  const g = getGroup(bias.group);
  const facts = {
    name_ru: bias.name_ru, name_en: bias.name_en, summary: bias.summary_ru,
    example: bias.example_ru, tip: bias.tip_ru, wiki: bias.wiki_summary_ru ?? bias.summary_en,
    codex_branch: `${q.title_ru} → ${g.title_ru}`,
    telegram_bot: botUsername ? `@${botUsername}` : 'Telegram-бот (имя не указано — пиши «бот по ссылке в профиле»)',
  };

  // Сервер сам перезапустит запрос на запасной модели, если основная откажет
  // (fallbacks: "default"); отказ всей цепочки проверяем по stop_reason ниже.
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Напиши сценарий ролика про это искажение:\n${JSON.stringify(facts, null, 2)}` }],
  });

  if (response.stop_reason === 'refusal') {
    console.warn(`[script] ${bias.id}: отказ (${response.stop_details?.category ?? '—'}), беру шаблон`);
    return templateScript(bias, { botUsername });
  }
  if (response.stop_reason === 'max_tokens') {
    console.warn(`[script] ${bias.id}: ответ обрезан, беру шаблон`);
    return templateScript(bias, { botUsername });
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  try {
    return { ...JSON.parse(text), source: response.model };
  } catch {
    console.warn(`[script] ${bias.id}: невалидный JSON, беру шаблон`);
    return templateScript(bias, { botUsername });
  }
}
