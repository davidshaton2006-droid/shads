const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// preflight.js делает `const { getSupabase } = require('../lib/supabase')` при загрузке модуля,
// поэтому подменяем '../lib/supabase' в require.cache ДО первого require('../src/guardrails/preflight').
// currentFake — мутируемая ссылка: каждый тест переставляет её на нужный фейковый клиент,
// getSupabase() читает currentFake в момент вызова, а не в момент require.
let currentFake;
const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: { getSupabase: () => currentFake },
};

const { requestAction, recordExecution, ActionRequiresConfirmation } = require('../src/guardrails/preflight');

const PROJECT_ID = 'project-1';

test('requestAction создаёт pending_action и бросает ActionRequiresConfirmation, когда требуется подтверждение', async () => {
  const insertedRows = [];

  currentFake = createFakeSupabase({
    project_action_settings: (state) => {
      assert.equal(state.op, 'select');
      assert.equal(state.filters.project_id, PROJECT_ID);
      assert.equal(state.filters.action_key, 'budget.update');
      return { data: { requires_confirmation: true }, error: null };
    },
    pending_actions: (state) => {
      assert.equal(state.op, 'insert');
      assert.equal(state.payload.status, 'pending');
      insertedRows.push(state.payload);
      return { data: { id: 'pending-123', ...state.payload }, error: null };
    },
  });

  await assert.rejects(
    () =>
      requestAction({
        projectId: PROJECT_ID,
        actionKey: 'budget.update',
        provider: 'yandex_direct',
        payload: { campaignId: 1, dailyBudgetMicros: 500000000 },
        reasoning: 'тест',
      }),
    (err) => {
      assert.ok(err instanceof ActionRequiresConfirmation);
      assert.equal(err.pendingActionId, 'pending-123');
      return true;
    }
  );

  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].action_key, 'budget.update');
});

test('requestAction не бросает и возвращает autoApproved, когда действие разрешено автономно', async () => {
  currentFake = createFakeSupabase({
    project_action_settings: () => ({ data: { requires_confirmation: false }, error: null }),
    pending_actions: (state) => {
      assert.equal(state.payload.status, 'approved');
      return { data: { id: 'pending-456', ...state.payload }, error: null };
    },
  });

  const result = await requestAction({
    projectId: PROJECT_ID,
    actionKey: 'negative_keyword.add',
    provider: 'yandex_direct',
    payload: { campaignId: 1, negativeKeywords: ['бесплатно'] },
    reasoning: 'разбор поисковых запросов',
  });

  assert.deepEqual(result, { autoApproved: true, pendingActionId: 'pending-456' });
});

test('requestAction по умолчанию требует подтверждения, если настройка для проекта не задана', async () => {
  currentFake = createFakeSupabase({
    project_action_settings: () => ({ data: null, error: null }), // .maybeSingle() без строки
    pending_actions: (state) => ({ data: { id: 'pending-789', ...state.payload }, error: null }),
  });

  await assert.rejects(
    () =>
      requestAction({
        projectId: PROJECT_ID,
        actionKey: 'campaign.pause',
        provider: 'vk_ads',
        payload: { campaignId: 'vk-1' },
        reasoning: 'тест',
      }),
    ActionRequiresConfirmation
  );
});

test('requestAction отклоняет неизвестный тип действия до обращения к Supabase', async () => {
  currentFake = createFakeSupabase({}); // ни одна таблица не должна быть вызвана
  await assert.rejects(
    () => requestAction({ projectId: PROJECT_ID, actionKey: 'not_a_real_action', provider: 'yandex_direct', payload: {} }),
    /Неизвестный тип действия/
  );
});

test('recordExecution пишет в action_log и обновляет статус pending_action', async () => {
  const logRows = [];
  const updates = [];

  currentFake = createFakeSupabase({
    action_log: (state) => {
      assert.equal(state.op, 'insert');
      logRows.push(state.payload);
      return { data: null, error: null };
    },
    pending_actions: (state) => {
      assert.equal(state.op, 'update');
      updates.push(state.payload);
      return { data: null, error: null };
    },
  });

  await recordExecution({
    projectId: PROJECT_ID,
    pendingActionId: 'pending-123',
    actionKey: 'budget.update',
    provider: 'yandex_direct',
    payload: { campaignId: 1 },
    result: { ok: true },
    status: 'success',
  });

  assert.equal(logRows.length, 1);
  assert.equal(logRows[0].status, 'success');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, 'executed');
});

// Подтверждаем, что сам файл теста лежит рядом с исходником, а не потерялся при рефакторинге путей.
test('preflight.js резолвится по ожидаемому пути', () => {
  assert.match(supabasePath, /src[\\/]lib[\\/]supabase\.js$/);
  assert.equal(path.basename(require.resolve('../src/guardrails/preflight')), 'preflight.js');
});
