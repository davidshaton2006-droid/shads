const test = require('node:test');
const assert = require('node:assert/strict');

// getAccessToken обычно читает Supabase + расшифровывает токен — здесь это не нужно,
// провайдер лишь обязан вызвать правильный HTTP-эндпоинт/операцию.
const connectionsPath = require.resolve('../src/lib/connections');
require.cache[connectionsPath] = {
  id: connectionsPath,
  filename: connectionsPath,
  loaded: true,
  exports: {
    getAccessToken: async () => ({ accessToken: 'fake-token', externalAccountId: 'fake-login' }),
  },
};

// providers/yandexDirect.js ходит к Яндексу через yandexFetch (src/lib/network.js), а не через
// глобальный fetch — см. комментарий в network.js: глобальный fetch/dispatcher трогать нельзя,
// это ломает decompression у @supabase/supabase-js. Поэтому мокаем сам network.js.
let currentYandexFetch;
const networkPath = require.resolve('../src/lib/network');
require.cache[networkPath] = {
  id: networkPath,
  filename: networkPath,
  loaded: true,
  exports: { yandexFetch: (...args) => currentYandexFetch(...args) },
};

const direct = require('../src/providers/yandexDirect');

function mockFetchOnce(responseBody, status = 200) {
  const calls = [];
  currentYandexFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return { calls, restore: () => {} };
}

test('suspendCampaign вызывает Campaigns.suspend с SelectionCriteria.Ids, а не campaigns.get', async () => {
  const { calls, restore } = mockFetchOnce({ result: { SuspendResults: [{ Id: 42 }] } });
  try {
    const result = await direct.suspendCampaign('project-1', 42);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.direct.yandex.com/json/v5/campaigns');

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.method, 'suspend');
    assert.deepEqual(body.params, { SelectionCriteria: { Ids: [42] } });
    assert.deepEqual(result, { SuspendResults: [{ Id: 42 }] });
  } finally {
    restore();
  }
});

test('resumeCampaign вызывает Campaigns.resume с SelectionCriteria.Ids', async () => {
  const { calls, restore } = mockFetchOnce({ result: { ResumeResults: [{ Id: 7 }] } });
  try {
    await direct.resumeCampaign('project-1', 7);

    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.method, 'resume');
    assert.deepEqual(body.params, { SelectionCriteria: { Ids: [7] } });
  } finally {
    restore();
  }
});

test('suspendCampaign пробрасывает ошибку Директа с кодом и описанием', async () => {
  const { restore } = mockFetchOnce({
    error: { error_code: 54, error_string: 'Campaign not found', error_detail: 'Id=42' },
  });
  try {
    await assert.rejects(() => direct.suspendCampaign('project-1', 42), /\[54\] Campaign not found/);
  } finally {
    restore();
  }
});

test('getCampaigns по-прежнему шлёт operation="campaigns" (без операции suspend/resume) — регресс на существующее поведение', async () => {
  const { calls, restore } = mockFetchOnce({ result: { Campaigns: [{ Id: 1 }] } });
  try {
    await direct.getCampaigns('project-1');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.method, 'campaigns');
  } finally {
    restore();
  }
});
