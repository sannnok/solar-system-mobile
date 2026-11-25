#!/usr/bin/env node
// Запуск: BIAS_BOT_TOKEN=… node src/bias-bot/index.mjs   (или npm run bias-bot)
import { loadEnv } from '../lib/env.mjs';
import { openDb } from '../lib/db.mjs';
import { createBiasBot } from './bot.mjs';

loadEnv();
const token = process.env.BIAS_BOT_TOKEN;
if (!token) {
  console.error('Нужен BIAS_BOT_TOKEN (получите у @BotFather) — см. .env.example');
  process.exit(1);
}

const store = openDb();
const { bot, startScheduler } = createBiasBot({ token, store });

await bot.api.setMyCommands([
  { command: 'today', description: 'Искажение дня' },
  { command: 'random', description: 'Случайное искажение' },
  { command: 'map', description: 'Карта кодекса' },
  { command: 'quiz', description: 'Квиз: угадай искажение' },
  { command: 'myths', description: 'Плацебо и мифы: разборы исследований' },
  { command: 'subscribe', description: 'Ежедневная рассылка' },
]);

startScheduler();
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
await bot.start({
  allowed_updates: ['message', 'callback_query', 'inline_query'],
  onStart: (me) => console.log(`@${me.username} запущен`),
});
