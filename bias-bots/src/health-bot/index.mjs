#!/usr/bin/env node
// Запуск: HEALTH_BOT_TOKEN=… node src/health-bot/index.mjs   (или npm run health-bot)
import { loadEnv } from '../lib/env.mjs';
import { openDb } from '../lib/db.mjs';
import { createHealthBot } from './bot.mjs';

loadEnv();
const token = process.env.HEALTH_BOT_TOKEN;
if (!token) {
  console.error('Нужен HEALTH_BOT_TOKEN (получите у @BotFather) — см. .env.example');
  process.exit(1);
}

const store = openDb();
const { bot, startScheduler } = createHealthBot({ token, store });

await bot.api.setMyCommands([
  { command: 'tracker', description: 'Трекер привычек' },
  { command: 'facts', description: 'Доказано наукой: факты из двойных слепых исследований' },
  { command: 'start', description: 'Главное меню' },
  { command: 'terms', description: 'Условия' },
  { command: 'paysupport', description: 'Помощь с оплатой' },
]);

startScheduler();
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
await bot.start({
  allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
  onStart: (me) => console.log(`@${me.username} запущен`),
});
