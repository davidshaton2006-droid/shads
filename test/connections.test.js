const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.YANDEX_CLIENT_ID = 'cid';
process.env.YANDEX_CLIENT_SECRET = 'csecret';

let currentFake;
const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabase: () => currentFake } };

// oauth/yandex.js (refreshAccessToken) ходит к Яндексу через yandexFetch (src/lib/network.js),
// не через глобальный fetch — см. комментарий в network.js. Мокаем сам network.js.
let currentYandexFetch = async () => { throw new Error('yandexFetch не замокан в этом тесте'); };
const networkPath = require.resolve('../src/lib/network');
require.cache[networkPath] = {
  id: networkPath,
  filename: networkPath,
  loaded: true,
  exports: { yandexFetch: (...args) => currentYandexFetch(...args) },
};

const { encryptToken, decryptToken } = require('../src/lib/encryption');
const { getAccessToken } = require('../src/lib/connections');

function connectionRow(provider, { expiresAt, refresh = 'old-refresh' } = {}) {
  return {
    project_id: 'p1',
    provider,
    external_account_id: 'login1',
    access_token_encrypted: encryptToken('old-access'),
    refresh_token_encrypted: refresh ? encryptToken(refresh) : null,
    token_expires_at: expiresAt,
  };
}

const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

test('действующий токен возвращается без обращения к сети', async () => {
  currentFake = createFakeSupabase({ connections: () => ({ data: connectionRow('yandex_direct', { expiresAt: future() }), error: null }) });
  currentYandexFetch = async () => { throw new Error('сеть не нужна'); };
  assert.deepEqual(await getAccessToken('p1', 'yandex_direct'), { accessToken: 'old-access', externalAccountId: 'login1' });
});

test('истёкший токен Яндекса обновляется и сохраняется в обе строки (Директ и Метрика)', async () => {
  const upserts = [];
  currentFake = createFakeSupabase({
    connections: (state) => {
      if (state.op === 'upsert') {
        upserts.push(state.payload);
        return { data: null, error: null };
      }
      return { data: connectionRow('yandex_direct', { expiresAt: past() }), error: null };
    },
  });
  const calls = [];
  currentYandexFetch = async (url, options) => {
    calls.push({ url, body: options.body.toString() });
    return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), text: async () => '' };
  };

  const result = await getAccessToken('p1', 'yandex_direct');
  assert.equal(result.accessToken, 'new-access');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth.yandex.ru/token');
  assert.match(calls[0].body, /grant_type=refresh_token/);
  assert.match(calls[0].body, /refresh_token=old-refresh/);
  assert.deepEqual(upserts.map((u) => u.provider).sort(), ['yandex_direct', 'yandex_metrika']);
  assert.equal(decryptToken(upserts[0].access_token_encrypted), 'new-access');
  assert.equal(decryptToken(upserts[0].refresh_token_encrypted), 'new-refresh');
});

test('истёкший токен без refresh-токена даёт понятную ошибку', async () => {
  currentFake = createFakeSupabase({ connections: () => ({ data: connectionRow('yandex_direct', { expiresAt: past(), refresh: null }), error: null }) });
  await assert.rejects(() => getAccessToken('p1', 'yandex_direct'), /refresh-токена нет/);
});

test('истёкший токен VK просит пройти OAuth заново', async () => {
  currentFake = createFakeSupabase({ connections: () => ({ data: connectionRow('vk_ads', { expiresAt: past() }), error: null }) });
  await assert.rejects(() => getAccessToken('p1', 'vk_ads'), /пройдите OAuth заново/);
});
