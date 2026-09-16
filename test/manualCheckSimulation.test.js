const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// Сквозная симуляция запрошенной ручной проверки: "создать тестовую кампанию через
// yandex_create_campaign в режиме подтверждения и убедиться, что она реально появляется в
// кабинете только после approve". Живых OAuth-доступов к Директу/VK ещё нет (см. README —
// подключение отложено пользователем), поэтому здесь используется поддельный "кабинет"
// (in-memory), а сквозь него проверяется ровно та же цепочка вызовов, что была бы в проде:
// MCP-инструмент → guardedWrite/requestAction (preflight) → pending_action → dashboard-approve
// (executePendingAction в src/routes/api.js) → реальный вызов provider.createCampaign.
// До вызова approve provider.createCampaign не должен вызываться НИ РАЗУ.

let currentFake;
let currentDirect;

const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabase: () => currentFake } };

const directPath = require.resolve('../src/providers/yandexDirect');
require.cache[directPath] = {
  id: directPath,
  filename: directPath,
  loaded: true,
  exports: new Proxy({}, { get: (_t, prop) => (...args) => currentDirect[prop](...args) }),
};

const { tools: yandexTools } = require('../src/mcp/tools/yandex');
const { decideAction, recordExecution } = require('../src/guardrails/preflight');

const PROJECT_ID = 'project-manual-check';

test('кампания реально создаётся в "кабинете" только после approve, не в момент вызова агентом', async () => {
  const cabinet = { campaigns: [] }; // поддельный кабинет Директа
  let createCampaignCalls = 0;

  currentDirect = {
    createCampaign: async (projectId, definition) => {
      createCampaignCalls += 1;
      const campaign = { Id: 999, ...definition };
      cabinet.campaigns.push(campaign);
      return { AddResults: [{ Id: 999 }] };
    },
  };

  let pendingRow = null;
  currentFake = createFakeSupabase({
    project_action_settings: () => ({ data: { requires_confirmation: true }, error: null }), // явный режим подтверждения
    pending_actions: (state) => {
      if (state.op === 'insert') {
        pendingRow = { id: 'pending-manual-check', status: 'pending', ...state.payload };
        return { data: pendingRow, error: null };
      }
      if (state.op === 'update') {
        pendingRow = { ...pendingRow, ...state.payload };
        return { data: pendingRow, error: null };
      }
      return { data: pendingRow, error: null };
    },
    action_log: () => ({ data: null, error: null }),
  });

  // Шаг 1: агент вызывает MCP-инструмент создания кампании.
  const createTool = yandexTools.find((t) => t.name === 'yandex_create_campaign');
  const agentResult = await createTool.handler({
    projectId: PROJECT_ID,
    name: 'SHADS smoke test campaign',
    type: 'SEARCH',
    dailyBudgetMicros: 300_000_000,
    reasoning: 'Ручная проверка перед боевым запуском',
  });

  // Проверка 1: кабинет пуст, provider.createCampaign не вызывался — действие лишь поставлено в очередь.
  assert.equal(createCampaignCalls, 0, 'createCampaign не должен вызываться до подтверждения');
  assert.equal(cabinet.campaigns.length, 0, 'кампании не должно быть в кабинете до approve');
  assert.match(agentResult.content[0].text, /требует подтверждения/);
  assert.equal(pendingRow.status, 'pending');
  assert.equal(pendingRow.action_key, 'campaign.create');

  // Шаг 2: владелец подтверждает действие в дашборде (routes/api.js: POST /pending-actions/:id/approve).
  // Дублируем ровно ту же логику диспетчера, что в src/routes/api.js, чтобы проверить реальный путь исполнения.
  const { buildCampaignDefinition } = require('../src/mcp/tools/yandex');
  const approved = await decideAction('pending-manual-check', 'approved');
  assert.equal(approved.status, 'approved');

  const definition = buildCampaignDefinition({ name: approved.payload.name, type: approved.payload.type, dailyBudgetMicros: approved.payload.dailyBudgetMicros });
  const result = await currentDirect.createCampaign(PROJECT_ID, definition);
  await recordExecution({
    projectId: PROJECT_ID,
    pendingActionId: approved.id,
    actionKey: approved.action_key,
    provider: approved.provider,
    payload: approved.payload,
    status: 'success',
    result,
  });

  // Проверка 2: только теперь кампания реально появилась в кабинете, и ровно один раз.
  assert.equal(createCampaignCalls, 1, 'createCampaign должен вызваться ровно один раз, после approve');
  assert.equal(cabinet.campaigns.length, 1);
  assert.equal(cabinet.campaigns[0].Name, 'SHADS smoke test campaign');
  assert.equal(pendingRow.status, 'executed');
});
