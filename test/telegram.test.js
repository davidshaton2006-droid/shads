const test = require('node:test');
const assert = require('node:assert/strict');
const { sendTelegramMessage } = require('../src/lib/telegram');

test('sendTelegramMessage не бросает и не бьёт по сети, если токен/chat_id не заданы', async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch не должен вызываться без конфигурации');
  };

  try {
    await assert.doesNotReject(() => sendTelegramMessage('тест'));
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
  }
});

test('sendTelegramMessage вызывает Telegram Bot API с правильным chat_id и текстом, когда настроен', async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = 'fake-bot-token';
  process.env.TELEGRAM_CHAT_ID = '12345';

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    await sendTelegramMessage('привет владелец');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/botfake-bot-token/sendMessage');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.chat_id, '12345');
    assert.equal(body.text, 'привет владелец');
  } finally {
    global.fetch = originalFetch;
    if (originalToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (originalChatId !== undefined) process.env.TELEGRAM_CHAT_ID = originalChatId;
    else delete process.env.TELEGRAM_CHAT_ID;
  }
});
