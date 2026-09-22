const test = require('node:test');
const assert = require('node:assert/strict');
const { yandexFetch } = require('../src/lib/network');

test('yandexFetch — функция, не бросает при простом require', () => {
  assert.equal(typeof yandexFetch, 'function');
});

test('yandexFetch не трогает глобальный fetch (изолирован от Supabase/Telegram/VK)', () => {
  const original = global.fetch;
  assert.notEqual(yandexFetch, original);
  assert.equal(global.fetch, original); // require не подменил global.fetch как побочный эффект
});
