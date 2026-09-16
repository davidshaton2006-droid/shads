const { getAccessToken } = require('../lib/connections');

// Тонкая обёртка над VK Ads API. Доки: https://ads.vk.com/help/api (актуальный домен/версию
// уточнить при регистрации приложения — VK периодически переносит API между доменами).
// Бизнес-правила — в src/mcp/tools/vk.js, со ссылкой на skills/vk-ads-playbook.md.

const API_URL = 'https://ads.vk.com/api/v2';

async function request(projectId, method, path, body) {
  const { accessToken } = await getAccessToken(projectId, 'vk_ads');
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`VK Ads API ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// --- read ---
const getCampaigns = (projectId) => request(projectId, 'GET', '/ad_plans.json');
const getAdGroups = (projectId, campaignId) => request(projectId, 'GET', `/ad_groups.json?ad_plan_id=${campaignId}`);
const getStats = (projectId, params) => request(projectId, 'GET', `/statistics/ad_plans/day.json?${new URLSearchParams(params)}`);
const getPixelStatus = (projectId, pixelId) => request(projectId, 'GET', `/pixels/${pixelId}.json`);

/**
 * Разбивает ответ statistics/ad_plans/day.json по campaign id (item.id).
 * Ожидаемая форма ответа: { items: [{ id, rows: [{ date, base: { spent }, events: { conversions } }] }] }.
 * TODO: сверить точные имена полей events.* с реальным ответом при первом live-подключении —
 * VK периодически меняет состав метрик; пока используется приоритетный список правдоподобных
 * названий (conversions / goals), а не единственное непроверенное имя.
 */
function statsByCampaignId(statsResponse) {
  const byId = {};
  for (const item of statsResponse?.items ?? []) {
    let spend = 0;
    let conversions = 0;
    for (const row of item.rows ?? []) {
      spend += Number(row.base?.spent) || 0;
      conversions += Number(row.events?.conversions ?? row.events?.goals ?? 0) || 0;
    }
    byId[item.id] = { spend, conversions };
  }
  return byId;
}

/** Суммирует расход и конверсии по всем кампаниям из ответа statistics/ad_plans/day.json. */
function sumSpendAndConversions(statsResponse) {
  return Object.values(statsByCampaignId(statsResponse)).reduce(
    (acc, c) => ({ spend: acc.spend + c.spend, conversions: acc.conversions + c.conversions }),
    { spend: 0, conversions: 0 }
  );
}

/** Расход по дням на кампанию: { [campaignId]: { [date]: spend } } — для графика в дашборде. */
function dailySpendByCampaignId(statsResponse) {
  const byId = {};
  for (const item of statsResponse?.items ?? []) {
    const byDate = {};
    for (const row of item.rows ?? []) {
      if (!row.date) continue;
      byDate[row.date] = (byDate[row.date] || 0) + (Number(row.base?.spent) || 0);
    }
    byId[item.id] = byDate;
  }
  return byId;
}

// --- write (только через preflight в MCP-слое) ---
const updateBudget = (projectId, campaignId, dailyBudget) =>
  request(projectId, 'PATCH', `/ad_plans/${campaignId}.json`, { autobidding_mode: undefined, budget_limit_day: dailyBudget });

const pauseCampaign = (projectId, campaignId) => request(projectId, 'PATCH', `/ad_plans/${campaignId}.json`, { status: 'blocked' });
const resumeCampaign = (projectId, campaignId) => request(projectId, 'PATCH', `/ad_plans/${campaignId}.json`, { status: 'active' });
const updateTargeting = (projectId, adGroupId, targeting) => request(projectId, 'PATCH', `/ad_groups/${adGroupId}.json`, { targetings: targeting });

// --- создание кампаний/групп/объявлений ---
// TODO: перед первым live-подключением сверить точные пути/поля с актуальной справкой VK Ads —
// в частности, актуальное имя ресурса для объявлений (ads.json vs banners.json) периодически
// менялось у площадки; ad_plans.json/ad_groups.json подтверждены плейбуком (раздел 1).

/** campaignDefinition — { name, objective, budget_limit_day, ... } (objective — обязателен, см. MCP-инструмент). */
const createCampaign = (projectId, campaignDefinition) => request(projectId, 'POST', '/ad_plans.json', campaignDefinition);

/** adGroupDefinition — { name, ad_plan_id, targetings, autobidding_mode, ... }. */
const createAdGroup = (projectId, adGroupDefinition) => request(projectId, 'POST', '/ad_groups.json', adGroupDefinition);

/** adDefinition — { ad_group_id, name, content: { ... } }. */
const createAd = (projectId, adDefinition) => request(projectId, 'POST', '/ads.json', adDefinition);

module.exports = {
  getCampaigns,
  getAdGroups,
  getStats,
  getPixelStatus,
  statsByCampaignId,
  sumSpendAndConversions,
  dailySpendByCampaignId,
  updateBudget,
  pauseCampaign,
  resumeCampaign,
  updateTargeting,
  createCampaign,
  createAdGroup,
  createAd,
};
