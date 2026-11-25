// Офлайн-обвязка для тестов: перехватывает все вызовы Telegram Bot API и
// подставляет правдоподобные ответы, апдейты подаются напрямую в bot.handleUpdate.
import { openDb } from '../src/lib/db.mjs';

export function harness(create, opts = {}) {
  const calls = [];
  const store = openDb(':memory:');
  const botInfo = {
    id: 1, is_bot: true, first_name: 'Test', username: opts.username ?? 'TestBot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: true,
    can_connect_to_business: false, has_main_web_app: false,
  };
  const created = create({ token: '0:test', store, botInfo, ...opts });
  const { bot } = created;
  let msgId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const chat = { id: payload.chat_id, type: 'private' };
    let result = true;
    if (method === 'sendPhoto') {
      msgId++;
      result = { message_id: msgId, date: 0, chat, photo: [{ file_id: `FILE_${msgId}`, file_unique_id: `u${msgId}`, width: 1080, height: 1350 }] };
    } else if (method.startsWith('send') || method === 'editMessageText') {
      result = { message_id: ++msgId, date: 0, chat, text: payload.text };
    }
    return { ok: true, result };
  });

  let updateId = 1;
  const user = { id: 42, is_bot: false, first_name: 'Аня', language_code: 'ru' };
  const chat = { id: 42, type: 'private', first_name: 'Аня' };
  const send = (text) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: updateId, date: 0, chat, from: user, text,
      ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
    },
  });
  const click = (data, { photo = false } = {}) => bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`, from: user, chat_instance: 'ci', data,
      message: { message_id: 7, date: 0, chat, ...(photo ? { photo: [{ file_id: 'x', file_unique_id: 'x', width: 1, height: 1 }], caption: 'c' } : { text: 'x' }) },
    },
  });
  const inline = (query) => bot.handleUpdate({ update_id: updateId++, inline_query: { id: 'iq', from: user, query, offset: '' } });
  const last = (method) => calls.filter((c) => !method || c.method === method).at(-1);
  const reset = () => { calls.length = 0; };
  return { ...created, store, calls, send, click, inline, last, reset, user };
}
