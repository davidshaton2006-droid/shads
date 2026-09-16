const { getAccessToken } = require('../lib/connections');

// Тонкая обёртка над Яндекс.Директ API v5 (JSON). Доки: https://yandex.ru/dev/direct/doc/ref-v5/concepts/about.html
// Каждый метод — один вызов метода API. Бизнес-правила (когда можно менять ставку, стратегию и т.д.)
// живут не здесь, а в MCP-инструментах (src/mcp/tools/yandex.js), которые обязаны сверяться
// с skills/yandex-direct-playbook.md перед вызовом write-методов.

const API_URL = 'https://api.direct.yandex.com/json/v5';

// service — сегмент URL (.../json/v5/<service>), operation — значение поля "method" в теле
// запроса. Для большинства вызовов они совпадали в старой версии этого файла, что валидно для
// части операций, НО не для campaigns.suspend/campaigns.resume (см. ниже) — там сервис
// остаётся "campaigns", а операция другая. По умолчанию operation = service, чтобы не менять
// поведение уже работающих вызовов ниже.
async function callMethod(projectId, service, params, operation = service) {
  const { accessToken, externalAccountId } = await getAccessToken(projectId, 'yandex_direct');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
    'Accept-Language': 'ru',
  };
  if (externalAccountId) headers['Client-Login'] = externalAccountId;

  const res = await fetch(`${API_URL}/${service}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method: operation, params }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(`Direct API ${operation}: [${json.error.error_code}] ${json.error.error_string} — ${json.error.error_detail}`);
  }
  return json.result;
}

// Reports API v5 — отдельный протокол (не {method, params}, а params напрямую в теле), ответ —
// TSV, а не JSON, плюс возможен статус 201/202 (отчёт ещё считается, повторить позже).
// Доки: https://yandex.ru/dev/direct/doc/reports/reports.html
async function requestReport(projectId, reportDefinition) {
  const { accessToken, externalAccountId } = await getAccessToken(projectId, 'yandex_direct');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=utf-8',
    'Accept-Language': 'ru',
    processingMode: 'auto',
    returnMoneyInMicros: 'false',
    skipReportHeader: 'true',
    skipReportSummary: 'true',
  };
  if (externalAccountId) headers['Client-Login'] = externalAccountId;

  const res = await fetch(`${API_URL}/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ params: reportDefinition }),
  });

  if (res.status === 201 || res.status === 202) {
    throw new Error('Отчёт Директа ещё формируется (offline-режим) — повторите запрос позже');
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Direct Reports API: ${res.status} ${text}`);
  }
  return text;
}

function parseTsvReport(tsv) {
  return tsv
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
}

// --- read ---
const getCampaigns = (projectId, params = {}) =>
  callMethod(projectId, 'campaigns', { SelectionCriteria: {}, FieldNames: ['Id', 'Name', 'Status', 'State', 'DailyBudget'], ...params });

const getAdGroups = (projectId, campaignIds) =>
  callMethod(projectId, 'adgroups', { SelectionCriteria: { CampaignIds: campaignIds }, FieldNames: ['Id', 'Name', 'CampaignId', 'Status'] });

const getKeywords = (projectId, adGroupIds) =>
  callMethod(projectId, 'keywords', { SelectionCriteria: { AdGroupIds: adGroupIds }, FieldNames: ['Id', 'Keyword', 'AdGroupId', 'Bid', 'Status'] });

const getKeywordsStats = (projectId, reportDefinition) => callMethod(projectId, 'reports', reportDefinition);

/**
 * Отчёт CAMPAIGN_PERFORMANCE_REPORT за период — расход и конверсии по кампаниям, с разбивкой по
 * дням (поле Date). Используется стоп-краном (src/guardrails/stopCranRunner.js, где строки просто
 * суммируются — разбивка по дням не влияет на сумму за окно) и дашбордом (src/routes/api.js) для
 * графика расхода за 7 дней. dateFrom/dateTo — 'YYYY-MM-DD' (Reports API оперирует днями, не
 * часами — при window_hours < 24 берём текущие сутки целиком, это огрубление отмечено в вызывающем коде).
 * Возвращает [{ campaignId, date, cost, conversions }].
 */
async function getCampaignPerformanceReport(projectId, { campaignIds, dateFrom, dateTo }) {
  const filter = campaignIds?.length ? [{ Field: 'CampaignId', Operator: 'IN', Values: campaignIds.map(String) }] : undefined;

  const tsv = await requestReport(projectId, {
    SelectionCriteria: { DateFrom: dateFrom, DateTo: dateTo, Filter: filter },
    FieldNames: ['CampaignId', 'Date', 'Cost', 'Conversions'],
    ReportName: `SHADS_CPR_${Date.now()}`,
    ReportType: 'CAMPAIGN_PERFORMANCE_REPORT',
    DateRangeType: 'CUSTOM_DATE',
    Format: 'TSV',
    IncludeVAT: 'YES',
  });

  return parseTsvReport(tsv).map(([campaignId, date, cost, conversions]) => ({
    campaignId,
    date,
    cost: Number(cost) || 0,
    conversions: Number(conversions) || 0,
  }));
}

// --- write (все вызываются ТОЛЬКО после preflight/requestAction в MCP-слое) ---
const updateKeywordBids = (projectId, bids) => callMethod(projectId, 'bids', { SetAuto: undefined, Bids: bids });

const addNegativeKeywords = (projectId, campaignId, negativeKeywords) =>
  callMethod(projectId, 'campaigns', { Campaigns: [{ Id: campaignId, NegativeKeywords: { Items: negativeKeywords } }] }, 'update');

const updateCampaignBudget = (projectId, campaignId, dailyBudgetMicros) =>
  callMethod(projectId, 'campaigns', { Campaigns: [{ Id: campaignId, DailyBudget: { Amount: dailyBudgetMicros, Mode: 'STANDARD' } }] }, 'update');

// Campaigns service, операции "suspend"/"resume": принимают только SelectionCriteria с Ids —
// без Campaigns/FieldNames. Источник: https://yandex.ru/dev/direct/doc/ref-v5/campaigns/suspend.html
// и .../campaigns/resume.html
const suspendCampaign = (projectId, campaignId) =>
  callMethod(projectId, 'campaigns', { SelectionCriteria: { Ids: [campaignId] } }, 'suspend');
const resumeCampaign = (projectId, campaignId) =>
  callMethod(projectId, 'campaigns', { SelectionCriteria: { Ids: [campaignId] } }, 'resume');

// --- создание кампаний/групп/объявлений ---
// Разбиение на отдельные вызовы (создать кампанию → создать группу → добавить ключевые фразы →
// добавить минус-слова → создать объявления) соответствует структуре Директ API v5: каждая
// сущность создаётся своим сервисом (Campaigns.add / AdGroups.add / Keywords.add / Ads.add).
// Бизнес-правила (обязательный явный тип кампании, обязательные минус-слова, обязательные
// расширения) — в src/mcp/tools/yandex.js, здесь только сырые вызовы API.

/**
 * campaignDefinition собирается в MCP-инструменте (yandex_create_campaign) в зависимости от
 * типа ('SEARCH' | 'RSYA') — см. buildCampaignDefinition в src/mcp/tools/yandex.js.
 * TODO: перед первым live-вызовом сверить точный состав полей TextCampaign.BiddingStrategy для
 * разделения поиска и РСЯ с актуальной документацией Campaigns.add — в Direct API v5 это не
 * буквально "тип кампании", а комбинация настроек показа в сетях внутри TextCampaign.
 */
const createCampaign = (projectId, campaignDefinition) => callMethod(projectId, 'campaigns', { Campaigns: [campaignDefinition] }, 'add');

const createAdGroup = (projectId, campaignId, name) =>
  callMethod(projectId, 'adgroups', { AdGroups: [{ Name: name, CampaignId: campaignId }] }, 'add');

const addKeywords = (projectId, adGroupId, keywordTexts) =>
  callMethod(projectId, 'keywords', { Keywords: keywordTexts.map((k) => ({ AdGroupId: adGroupId, Keyword: k })) }, 'add');

/** Минус-слова на уровне группы объявлений (не кампании) — AdGroups.update. */
const addAdGroupNegativeKeywords = (projectId, adGroupId, negativeKeywords) =>
  callMethod(projectId, 'adgroups', { AdGroups: [{ Id: adGroupId, NegativeKeywords: { Items: negativeKeywords } }] }, 'update');

/**
 * ads — массив { title, title2, text, href }. Расширения (быстрые ссылки/уточнения) в Direct
 * API v5 создаются отдельными сервисами (Sitelinks.add возвращает SitelinksSetId, Callouts.add
 * возвращает Id уточнений) и затем ссылаются в теле объявления по Id/SetId — здесь передаём их
 * как уже подготовленный набор ссылок через extensions, а не создаём заново на каждый вызов.
 * TODO: перед первым live-вызовом сверить точные поля Ads.add для TextAd.Sitelinks/CalloutIds.
 */
const createAds = (projectId, adGroupId, ads) =>
  callMethod(
    projectId,
    'ads',
    {
      Ads: ads.map((ad) => ({
        AdGroupId: adGroupId,
        TextAd: {
          Title: ad.title,
          Title2: ad.title2,
          Text: ad.text,
          Href: ad.href,
          ...(ad.extensions?.sitelinksSetId ? { SitelinksSetId: ad.extensions.sitelinksSetId } : {}),
          ...(ad.extensions?.calloutIds ? { CalloutIds: ad.extensions.calloutIds } : {}),
        },
      })),
    },
    'add'
  );

module.exports = {
  getCampaigns,
  getAdGroups,
  getKeywords,
  getKeywordsStats,
  getCampaignPerformanceReport,
  updateKeywordBids,
  addNegativeKeywords,
  updateCampaignBudget,
  suspendCampaign,
  resumeCampaign,
  createCampaign,
  createAdGroup,
  addKeywords,
  addAdGroupNegativeKeywords,
  createAds,
};
