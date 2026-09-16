const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

// preflight.js (через guardedWrite) и провайдеры yandexDirect/vkAds требуются на верхнем уровне
// в src/mcp/tools/yandex.js и vk.js — подменяем зависимости в require.cache ДО первого require
// этих модулей инструментов. currentFake/currentDirect/currentVk — мутируемые ссылки, каждый
// тест переставляет их на нужный сценарий.
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

const { tools: yandexTools } = require('../src/mcp/tools/yandex');
const { tools: vkTools } = require('../src/mcp/tools/vk');

function findTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `инструмент ${name} не найден`);
  return tool;
}

const PROJECT_ID = 'project-1';

// requiresConfirmation=true (дефолт) — pending_action создаётся, execute() не вызывается.
// requiresConfirmation=false — execute() вызывается сразу, pending считается approved.
function fakeSupabaseForAction({ requiresConfirmation, onInsert, onLog } = {}) {
  return createFakeSupabase({
    project_action_settings: () => ({ data: requiresConfirmation === undefined ? null : { requires_confirmation: requiresConfirmation }, error: null }),
    pending_actions: (state) => {
      if (state.op === 'insert') {
        onInsert?.(state.payload);
        return { data: { id: 'pending-1', ...state.payload }, error: null };
      }
      return { data: null, error: null }; // update в recordExecution
    },
    action_log: (state) => {
      onLog?.(state.payload);
      return { data: null, error: null };
    },
  });
}

test('yandex_create_campaign: без валидного type бросает ошибку и не трогает Supabase', async () => {
  currentFake = createFakeSupabase({}); // ни одна таблица не должна быть вызвана
  const tool = findTool(yandexTools, 'yandex_create_campaign');

  await assert.rejects(
    () => tool.handler({ projectId: PROJECT_ID, name: 'Тест', type: 'BOTH', dailyBudgetMicros: 500000000, reasoning: 'тест' }),
    /Тип кампании должен быть явно указан/
  );
});

test('yandex_create_campaign: валидный вызов ставится в очередь на подтверждение (high-risk, дефолт)', async () => {
  const inserted = [];
  currentFake = fakeSupabaseForAction({ onInsert: (p) => inserted.push(p) });
  currentDirect = { createCampaign: async () => { throw new Error('не должен вызываться без подтверждения'); } };

  const tool = findTool(yandexTools, 'yandex_create_campaign');
  const result = await tool.handler({ projectId: PROJECT_ID, name: 'Тест', type: 'SEARCH', dailyBudgetMicros: 500000000, reasoning: 'тест' });

  assert.match(result.content[0].text, /требует подтверждения/);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].action_key, 'campaign.create');
  assert.equal(inserted[0].status, 'pending');
});

test('yandex_create_ad_group_with_keywords: пустой negativeKeywords запрещён на уровне валидации', async () => {
  currentFake = createFakeSupabase({});
  const tool = findTool(yandexTools, 'yandex_create_ad_group_with_keywords');

  await assert.rejects(
    () =>
      tool.handler({
        projectId: PROJECT_ID,
        campaignId: 1,
        name: 'Группа',
        keywords: ['купить диван'],
        negativeKeywords: [],
        reasoning: 'тест',
      }),
    /negativeKeywords не может быть пустым/
  );
});

test('yandex_create_ad_group_with_keywords: при автономном разрешении создаёт группу, ключевые фразы и минус-слова', async () => {
  const calls = [];
  currentFake = fakeSupabaseForAction({ requiresConfirmation: false });
  currentDirect = {
    createAdGroup: async (projectId, campaignId, name) => {
      calls.push(['createAdGroup', projectId, campaignId, name]);
      return { AddResults: [{ Id: 555 }] };
    },
    addKeywords: async (projectId, adGroupId, keywords) => {
      calls.push(['addKeywords', projectId, adGroupId, keywords]);
      return { AddResults: keywords.map(() => ({ Id: 1 })) };
    },
    addAdGroupNegativeKeywords: async (projectId, adGroupId, negativeKeywords) => {
      calls.push(['addAdGroupNegativeKeywords', projectId, adGroupId, negativeKeywords]);
      return {};
    },
  };

  const tool = findTool(yandexTools, 'yandex_create_ad_group_with_keywords');
  const result = await tool.handler({
    projectId: PROJECT_ID,
    campaignId: 1,
    name: 'Группа',
    keywords: ['купить диван'],
    negativeKeywords: ['бесплатно'],
    reasoning: 'тест',
  });

  assert.match(result.content[0].text, /выполнено автономно/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'createAdGroup');
  assert.equal(calls[1][0], 'addKeywords');
  assert.equal(calls[1][2], 555); // adGroupId, взятый из результата createAdGroup
  assert.equal(calls[2][0], 'addAdGroupNegativeKeywords');
  assert.equal(calls[2][2], 555);
});

test('yandex_create_ads: объявление без расширений запрещено на уровне валидации', async () => {
  currentFake = createFakeSupabase({});
  const tool = findTool(yandexTools, 'yandex_create_ads');

  await assert.rejects(
    () =>
      tool.handler({
        projectId: PROJECT_ID,
        adGroupId: 1,
        ads: [{ title: 'Заголовок', text: 'Текст', href: 'https://example.com', extensions: {} }],
        reasoning: 'тест',
      }),
    /не имеет ни быстрых ссылок, ни уточнений/
  );
});

test('yandex_create_ads: объявление с уточнениями проходит валидацию и ставится на подтверждение', async () => {
  const inserted = [];
  currentFake = fakeSupabaseForAction({ onInsert: (p) => inserted.push(p) });

  const tool = findTool(yandexTools, 'yandex_create_ads');
  const result = await tool.handler({
    projectId: PROJECT_ID,
    adGroupId: 1,
    ads: [{ title: 'Заголовок', text: 'Текст', href: 'https://example.com', extensions: { calloutIds: [1, 2] } }],
    reasoning: 'тест',
  });

  assert.match(result.content[0].text, /требует подтверждения/);
  assert.equal(inserted[0].action_key, 'ad.create');
});

test('vk_create_campaign: objective="traffic" без confirmTrafficObjective запрещён', async () => {
  currentFake = createFakeSupabase({});
  const tool = findTool(vkTools, 'vk_create_campaign');

  await assert.rejects(
    () => tool.handler({ projectId: PROJECT_ID, name: 'Кампания', objective: 'traffic', dailyBudget: 500, reasoning: 'тест' }),
    /требует явного confirmTrafficObjective=true/
  );
});

test('vk_create_campaign: objective="traffic" с confirmTrafficObjective=true проходит валидацию', async () => {
  const inserted = [];
  currentFake = fakeSupabaseForAction({ onInsert: (p) => inserted.push(p) });

  const tool = findTool(vkTools, 'vk_create_campaign');
  const result = await tool.handler({
    projectId: PROJECT_ID,
    name: 'Кампания',
    objective: 'traffic',
    confirmTrafficObjective: true,
    dailyBudget: 500,
    reasoning: 'осознанный охватный запуск',
  });

  assert.match(result.content[0].text, /требует подтверждения/);
  assert.equal(inserted[0].action_key, 'campaign.create');
});

test('vk_create_ad_group: меньше 2 сегментов аудитории запрещено', async () => {
  currentFake = createFakeSupabase({});
  const tool = findTool(vkTools, 'vk_create_ad_group');

  await assert.rejects(
    () =>
      tool.handler({
        projectId: PROJECT_ID,
        campaignId: 'vk-1',
        adGroups: [{ name: 'Холодная аудитория', targeting: {} }],
        reasoning: 'тест',
      }),
    /Нужно минимум 2 сегмента/
  );
});

test('vk_create_ad_group: 2 сегмента при автономном разрешении создают 2 группы', async () => {
  const calls = [];
  currentFake = fakeSupabaseForAction({ requiresConfirmation: false });
  currentVk = {
    createAdGroup: async (projectId, def) => {
      calls.push(def);
      return { id: calls.length };
    },
  };

  const tool = findTool(vkTools, 'vk_create_ad_group');
  const result = await tool.handler({
    projectId: PROJECT_ID,
    campaignId: 'vk-1',
    adGroups: [
      { name: 'Холодная по интересам', targeting: { interests: ['мебель'] } },
      { name: 'Look-alike', targeting: { lookalike: true } },
    ],
    reasoning: 'тест',
  });

  assert.match(result.content[0].text, /выполнено автономно/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].ad_plan_id, 'vk-1');
});

test('vk_create_ad: меньше 2 креативов запрещено', async () => {
  currentFake = createFakeSupabase({});
  const tool = findTool(vkTools, 'vk_create_ad');

  await assert.rejects(
    () =>
      tool.handler({
        projectId: PROJECT_ID,
        adGroupId: 'ag-1',
        creatives: [{ name: 'Вариант 1', content: {} }],
        reasoning: 'тест',
      }),
    /Нужно минимум 2 варианта креатива/
  );
});
