const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCampaignDefinition } = require('../src/mcp/tools/yandex');

// Регресс: Campaigns.add реально падает с [8000] "отсутствует обязательное поле StartDate",
// если его не передать — обнаружено вживую при первом реальном создании кампании.
test('buildCampaignDefinition всегда включает StartDate', () => {
  const def = buildCampaignDefinition({ name: 'Тест', type: 'SEARCH', dailyBudgetMicros: 300_000_000 });
  assert.match(def.StartDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(def.StartDate, new Date().toISOString().slice(0, 10));
});

test('buildCampaignDefinition принимает явный startDate вместо сегодняшней даты', () => {
  const def = buildCampaignDefinition({ name: 'Тест', type: 'RSYA', dailyBudgetMicros: 300_000_000, startDate: '2026-12-01' });
  assert.equal(def.StartDate, '2026-12-01');
});
