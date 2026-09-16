const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// stopCran.js/stopCranRunner.js читают '../lib/supabase' и '../providers/*' на верхнем уровне —
// подменяем их в require.cache ДО первого require этих модулей. currentFake/currentDirect/currentVk —
// мутируемые ссылки, которые каждый тест переставляет на нужный сценарий.
let currentFake;
let currentDirect;
let currentVk;

const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabase: () => currentFake } };

const directPath = require.resolve('../src/providers/yandexDirect');
require.cache[directPath] = {
  id: directPath,
  filename: directPath,
  loaded: true,
  exports: new Proxy({}, { get: (_t, prop) => (...args) => currentDirect[prop](...args) }),
};

const vkPath = require.resolve('../src/providers/vkAds');
require.cache[vkPath] = {
  id: vkPath,
  filename: vkPath,
  loaded: true,
  exports: new Proxy({}, { get: (_t, prop) => (...args) => currentVk[prop](...args) }),
};

const { checkProjectStopRules } = require('../src/guardrails/stopCran');
const { getSpendAndConversionsFor, pauseAllCampaignsFor } = require('../src/guardrails/stopCranRunner');

const PROJECT = { id: 'project-1', name: 'Тестовый проект', status: 'active', daily_budget_limit: 1000 };

function baseDirectStub(overrides = {}) {
  return {
    getCampaignPerformanceReport: async () => [],
    getCampaigns: async () => ({ Campaigns: [{ Id: 1, Status: 'ACCEPTED', State: 'ON' }] }),
    suspendCampaign: async () => ({ SuspendResults: [{ Id: 1 }] }),
    ...overrides,
  };
}

function baseVkStub(overrides = {}) {
  return {
    getStats: async () => ({ items: [] }),
    sumSpendAndConversions: (stats) => {
      // реальная логика суммирования (не мок) — проверяем интеграцию, а не подменяем расчёт
      let spend = 0;
      let conversions = 0;
      for (const item of stats?.items ?? []) {
        for (const row of item.rows ?? []) {
          spend += Number(row.base?.spent) || 0;
          conversions += Number(row.events?.conversions ?? row.events?.goals ?? 0) || 0;
        }
      }
      return { spend, conversions };
    },
    getCampaigns: async () => ({ items: [] }),
    pauseCampaign: async () => ({}),
    ...overrides,
  };
}

function fakeSupabaseFor({ connections, stopRules, onProjectUpdate, onStopEvent }) {
  return createFakeSupabase({
    projects: (state) => {
      if (state.op === 'update') {
        onProjectUpdate?.(state.payload);
        return { data: null, error: null };
      }
      return { data: { ...PROJECT }, error: null };
    },
    stop_rules: () => ({ data: stopRules, error: null }),
    connections: () => ({ data: connections, error: null }),
    stop_events: (state) => {
      onStopEvent?.(state.payload);
      return { data: null, error: null };
    },
  });
}

test('getSpendAndConversionsFor суммирует расход/конверсии Директа и VK и считает CPA', async () => {
  currentFake = createFakeSupabase({
    connections: () => ({ data: [{ provider: 'yandex_direct' }, { provider: 'vk_ads' }], error: null }),
  });
  currentDirect = baseDirectStub({
    getCampaignPerformanceReport: async () => [
      { campaignId: '1', cost: 1000, conversions: 2 },
      { campaignId: '2', cost: 500, conversions: 0 },
    ],
  });
  currentVk = baseVkStub({
    getStats: async () => ({ items: [{ id: 1, rows: [{ base: { spent: '300' }, events: { conversions: 1 } }] }] }),
  });

  const result = await getSpendAndConversionsFor(PROJECT, 24);

  assert.equal(result.spend, 1800); // 1000 + 500 + 300
  assert.equal(result.conversions, 3); // 2 + 0 + 1
  assert.equal(result.cpa, 600); // 1800 / 3
});

test('checkProjectStopRules ставит кампании на паузу через pauseAllCampaigns, когда CPA превышает cpa_ceiling', async () => {
  const suspendCalls = [];
  const stopEvents = [];
  const projectUpdates = [];

  currentDirect = baseDirectStub({
    getCampaignPerformanceReport: async () => [{ campaignId: '1', cost: 1500, conversions: 2 }], // CPA = 750
    suspendCampaign: async (projectId, campaignId) => {
      suspendCalls.push({ projectId, campaignId });
      return { SuspendResults: [{ Id: campaignId }] };
    },
  });
  currentVk = baseVkStub();

  currentFake = fakeSupabaseFor({
    connections: [{ provider: 'yandex_direct' }],
    stopRules: [{ id: 'rule-1', project_id: PROJECT.id, rule_type: 'cpa_ceiling', threshold: 300, window_hours: 24, is_active: true }],
    onProjectUpdate: (payload) => projectUpdates.push(payload),
    onStopEvent: (payload) => stopEvents.push(payload),
  });

  await checkProjectStopRules(PROJECT.id, {
    getSpendAndConversions: getSpendAndConversionsFor,
    pauseAllCampaigns: pauseAllCampaignsFor,
    notifyOwner: async () => {},
  });

  assert.equal(suspendCalls.length, 1);
  assert.deepEqual(suspendCalls[0], { projectId: PROJECT.id, campaignId: 1 });
  assert.equal(stopEvents.length, 1);
  assert.equal(stopEvents[0].metric_value, 750);
  assert.equal(projectUpdates.length, 1);
  assert.equal(projectUpdates[0].status, 'paused');
});

test('checkProjectStopRules ставит на паузу, когда потрачено больше spend_no_conversions_pct % бюджета без конверсий', async () => {
  const suspendCalls = [];
  const stopEvents = [];

  currentDirect = baseDirectStub({
    getCampaignPerformanceReport: async () => [{ campaignId: '1', cost: 600, conversions: 0 }], // 60% от daily_budget_limit=1000
    suspendCampaign: async (projectId, campaignId) => {
      suspendCalls.push({ projectId, campaignId });
    },
  });
  currentVk = baseVkStub();

  currentFake = fakeSupabaseFor({
    connections: [{ provider: 'yandex_direct' }],
    stopRules: [{ id: 'rule-2', project_id: PROJECT.id, rule_type: 'spend_no_conversions_pct', threshold: 50, window_hours: 24, is_active: true }],
    onStopEvent: (payload) => stopEvents.push(payload),
  });

  await checkProjectStopRules(PROJECT.id, {
    getSpendAndConversions: getSpendAndConversionsFor,
    pauseAllCampaigns: pauseAllCampaignsFor,
    notifyOwner: async () => {},
  });

  assert.equal(suspendCalls.length, 1);
  assert.equal(stopEvents[0].metric_value, 60);
});

test('checkProjectStopRules НЕ ставит на паузу, когда метрики ниже порогов', async () => {
  const suspendCalls = [];
  const stopEvents = [];

  currentDirect = baseDirectStub({
    getCampaignPerformanceReport: async () => [{ campaignId: '1', cost: 100, conversions: 5 }], // CPA = 20
    suspendCampaign: async (projectId, campaignId) => {
      suspendCalls.push({ projectId, campaignId });
    },
  });
  currentVk = baseVkStub();

  currentFake = fakeSupabaseFor({
    connections: [{ provider: 'yandex_direct' }],
    stopRules: [{ id: 'rule-3', project_id: PROJECT.id, rule_type: 'cpa_ceiling', threshold: 300, window_hours: 24, is_active: true }],
    onStopEvent: (payload) => stopEvents.push(payload),
  });

  await checkProjectStopRules(PROJECT.id, {
    getSpendAndConversions: getSpendAndConversionsFor,
    pauseAllCampaigns: pauseAllCampaignsFor,
    notifyOwner: async () => {},
  });

  assert.equal(suspendCalls.length, 0);
  assert.equal(stopEvents.length, 0);
});
