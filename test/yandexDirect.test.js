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

// Раньше operation по умолчанию совпадала с именем сервиса (напр. method:"campaigns") — на
// живом API это давало [55] "Операция не найдена". Подтверждено вживую после одобрения доступа
// к API: правильная операция для чтения — 'get'. Регресс-тесты ниже фиксируют исправленное
// поведение для всех read-методов и для updateKeywordBids (который слал method:"bids" вместо "set").

test('getCampaigns шлёт method="get" на сервис campaigns', async () => {
  const { calls, restore } = mockFetchOnce({ result: { Campaigns: [{ Id: 1 }] } });
  try {
    await direct.getCampaigns('project-1');
    assert.equal(calls[0].url, 'https://api.direct.yandex.com/json/v5/campaigns');
    assert.equal(JSON.parse(calls[0].options.body).method, 'get');
  } finally {
    restore();
  }
});

test('getAdGroups шлёт method="get" на сервис adgroups', async () => {
  const { calls, restore } = mockFetchOnce({ result: { AdGroups: [] } });
  try {
    await direct.getAdGroups('project-1', [1, 2]);
    assert.equal(calls[0].url, 'https://api.direct.yandex.com/json/v5/adgroups');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.method, 'get');
    assert.deepEqual(body.params.SelectionCriteria, { CampaignIds: [1, 2] });
  } finally {
    restore();
  }
});

test('getKeywords шлёт method="get" на сервис keywords', async () => {
  const { calls, restore } = mockFetchOnce({ result: { Keywords: [] } });
  try {
    await direct.getKeywords('project-1', [10]);
    assert.equal(calls[0].url, 'https://api.direct.yandex.com/json/v5/keywords');
    assert.equal(JSON.parse(calls[0].options.body).method, 'get');
  } finally {
    restore();
  }
});

test('updateKeywordBids шлёт method="set" на сервис bids', async () => {
  const { calls, restore } = mockFetchOnce({ result: { SetResults: [{ KeywordId: 1 }] } });
  try {
    await direct.updateKeywordBids('project-1', [{ KeywordId: 1, Bid: 50000000 }]);
    assert.equal(calls[0].url, 'https://api.direct.yandex.com/json/v5/bids');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.method, 'set');
    assert.deepEqual(body.params, { Bids: [{ KeywordId: 1, Bid: 50000000 }] });
  } finally {
    restore();
  }
});
