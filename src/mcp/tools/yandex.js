const direct = require('../../providers/yandexDirect');
const metrika = require('../../providers/yandexMetrika');
const { guardedWrite } = require('./writeHelper');

const projectIdProp = { projectId: { type: 'string', description: 'UUID проекта в Supabase' } };

/**
 * Поиск и РСЯ — всегда разные кампании (плейбук, раздел 1). Тип обязателен и без дефолта —
 * агент не может создать кампанию, "забыв" его указать. type='SEARCH' отключает показы в сетях,
 * type='RSYA' — оставляет только сетевые показы, поисковая выдача не участвует.
 * StartDate — Campaigns.add требует его явно (подтверждено вживую: без поля Директ отвечает
 * [8000] "В элементе массива Campaigns отсутствует обязательное поле StartDate"), по умолчанию —
 * сегодняшняя дата, можно передать позже для отложенного старта.
 * TODO: сверить точный состав BiddingStrategy с документацией Campaigns.add перед следующим
 * live-вызовом — HIGHEST_POSITION уже проверен и работает, но не все варианты стратегии.
 */
function buildCampaignDefinition({ name, type, dailyBudgetMicros, startDate }) {
  if (type !== 'SEARCH' && type !== 'RSYA') {
    throw new Error(`Тип кампании должен быть явно указан как 'SEARCH' или 'RSYA' (плейбук, раздел 1), получено: ${type}`);
  }
  return {
    Name: name,
    StartDate: startDate ?? new Date().toISOString().slice(0, 10),
    DailyBudget: { Amount: dailyBudgetMicros, Mode: 'STANDARD' },
    TextCampaign: {
      BiddingStrategy: {
        Search: { BiddingStrategyType: type === 'SEARCH' ? 'HIGHEST_POSITION' : 'SERVING_OFF' },
        Network: { BiddingStrategyType: type === 'RSYA' ? 'HIGHEST_POSITION' : 'SERVING_OFF' },
      },
    },
  };
}

const tools = [
  // --- read ---
  {
    name: 'yandex_get_campaigns',
    description: 'Список кампаний Яндекс.Директа проекта со статусами и дневными бюджетами.',
    inputSchema: { type: 'object', properties: { ...projectIdProp }, required: ['projectId'] },
    riskLevel: 'read',
    handler: async ({ projectId }) => ({ content: [{ type: 'text', text: JSON.stringify(await direct.getCampaigns(projectId)) }] }),
  },
  {
    name: 'yandex_get_keywords',
    description: 'Ключевые фразы и их ставки для указанных групп объявлений.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, adGroupIds: { type: 'array', items: { type: 'number' } } }, required: ['projectId', 'adGroupIds'] },
    riskLevel: 'read',
    handler: async ({ projectId, adGroupIds }) => ({ content: [{ type: 'text', text: JSON.stringify(await direct.getKeywords(projectId, adGroupIds)) }] }),
  },
  {
    name: 'yandex_get_search_queries_report',
    description: 'Отчёт по поисковым запросам — использовать минимум раз в неделю для разбора и пополнения минус-слов (см. плейбук, раздел 2 и 9).',
    inputSchema: { type: 'object', properties: { ...projectIdProp, reportDefinition: { type: 'object' } }, required: ['projectId', 'reportDefinition'] },
    riskLevel: 'read',
    handler: async ({ projectId, reportDefinition }) => ({ content: [{ type: 'text', text: JSON.stringify(await direct.getKeywordsStats(projectId, reportDefinition)) }] }),
  },
  {
    name: 'yandex_metrika_get_goals',
    description: 'Список целей Яндекс.Метрики, привязанных к счётчику проекта.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, counterId: { type: 'string' } }, required: ['projectId', 'counterId'] },
    riskLevel: 'read',
    handler: async ({ projectId, counterId }) => ({ content: [{ type: 'text', text: JSON.stringify(await metrika.getGoals(projectId, counterId)) }] }),
  },
  {
    name: 'yandex_metrika_get_conversions',
    description: 'Конверсии по цели за период — использовать для проверки, накоплено ли ~10 конверсий/неделю перед переходом на оплату за конверсии (см. плейбук, раздел 3).',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp, counterId: { type: 'string' }, goalId: { type: 'string' }, date1: { type: 'string' }, date2: { type: 'string' } },
      required: ['projectId', 'counterId', 'goalId', 'date1', 'date2'],
    },
    riskLevel: 'read',
    handler: async ({ projectId, counterId, goalId, date1, date2 }) => ({
      content: [{ type: 'text', text: JSON.stringify(await metrika.getConversions(projectId, counterId, { date1, date2, goalId })) }],
    }),
  },

  // --- write (все идут через guardedWrite → preflight) ---
  {
    name: 'yandex_add_negative_keywords',
    description:
      'Добавляет минус-слова/фразы к кампании. Перед вызовом убедись, что список собран по итогам разбора отчёта поисковых запросов, а не наугад (плейбук, раздел 2).',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp, campaignId: { type: 'number' }, negativeKeywords: { type: 'array', items: { type: 'string' } }, reasoning: { type: 'string' } },
      required: ['projectId', 'campaignId', 'negativeKeywords', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, negativeKeywords, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'negative_keyword.add',
        provider: 'yandex_direct',
        payload: { campaignId, negativeKeywords },
        reasoning,
        execute: () => direct.addNegativeKeywords(projectId, campaignId, negativeKeywords),
      }),
  },
  {
    name: 'yandex_update_keyword_bids',
    description: 'Изменяет ставки по ключевым фразам.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        bids: { type: 'array', items: { type: 'object', properties: { KeywordId: { type: 'number' }, Bid: { type: 'number' } } } },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'bids', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, bids, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'bid.update',
        provider: 'yandex_direct',
        payload: { bids },
        reasoning,
        execute: () => direct.updateKeywordBids(projectId, bids),
      }),
  },
  {
    name: 'yandex_update_campaign_budget',
    description:
      'Меняет дневной бюджет кампании. High-risk: по плейбуку (раздел 9) это всегда должно требовать подтверждения человека — не пытайся пометить этот тип действия автономным.',
    inputSchema: {
      type: 'object',
      properties: { ...projectIdProp, campaignId: { type: 'number' }, dailyBudgetMicros: { type: 'number' }, reasoning: { type: 'string' } },
      required: ['projectId', 'campaignId', 'dailyBudgetMicros', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, dailyBudgetMicros, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'budget.update',
        provider: 'yandex_direct',
        payload: { campaignId, dailyBudgetMicros },
        reasoning,
        execute: () => direct.updateCampaignBudget(projectId, campaignId, dailyBudgetMicros),
      }),
  },
  {
    name: 'yandex_pause_campaign',
    description:
      'Останавливает кампанию. НЕ использовать на кампании в фазе обучения автостратегии (первые 1-2 недели) без крайней необходимости (плейбук, раздел 9) — это сбрасывает обучение.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, campaignId: { type: 'number' }, reasoning: { type: 'string' } }, required: ['projectId', 'campaignId', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'campaign.pause',
        provider: 'yandex_direct',
        payload: { campaignId },
        reasoning,
        execute: () => direct.suspendCampaign(projectId, campaignId),
      }),
  },
  {
    name: 'yandex_resume_campaign',
    description: 'Возобновляет остановленную кампанию.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, campaignId: { type: 'number' }, reasoning: { type: 'string' } }, required: ['projectId', 'campaignId', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'campaign.resume',
        provider: 'yandex_direct',
        payload: { campaignId },
        reasoning,
        execute: () => direct.resumeCampaign(projectId, campaignId),
      }),
  },
  {
    name: 'yandex_create_campaign',
    description:
      'Создаёт новую кампанию. type обязателен (SEARCH или RSYA) — поиск и РСЯ никогда не смешиваются в одной кампании ' +
      '(плейбук, раздел 1). High-risk, всегда требует подтверждения.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        name: { type: 'string' },
        type: { type: 'string', enum: ['SEARCH', 'RSYA'], description: 'Явный тип кампании — без дефолта' },
        dailyBudgetMicros: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'name', 'type', 'dailyBudgetMicros', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, name, type, dailyBudgetMicros, reasoning }) => {
      const campaignDefinition = buildCampaignDefinition({ name, type, dailyBudgetMicros });
      return guardedWrite({
        projectId,
        actionKey: 'campaign.create',
        provider: 'yandex_direct',
        payload: { name, type, dailyBudgetMicros },
        reasoning,
        execute: () => direct.createCampaign(projectId, campaignDefinition),
      });
    },
  },
  {
    name: 'yandex_create_ad_group_with_keywords',
    description:
      'Создаёт группу объявлений вместе с ключевыми фразами и стартовым списком минус-слов одним вызовом ' +
      '(плейбук, раздел 1-2). negativeKeywords обязателен и не может быть пустым — пустой список минус-слов до ' +
      'запуска прямо запрещён плейбуком (раздел 2: "список минус-слов формируется до запуска, не после"). High-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        campaignId: { type: 'number' },
        name: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' }, minItems: 1 },
        negativeKeywords: { type: 'array', items: { type: 'string' }, minItems: 1 },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'campaignId', 'name', 'keywords', 'negativeKeywords', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, name, keywords, negativeKeywords, reasoning }) => {
      if (!keywords?.length) throw new Error('keywords не может быть пустым — группе нужна хотя бы одна ключевая фраза');
      if (!negativeKeywords?.length) {
        throw new Error(
          'negativeKeywords не может быть пустым — плейбук (раздел 2) требует стартовый список минус-слов ДО запуска, не после'
        );
      }
      return guardedWrite({
        projectId,
        actionKey: 'ad_group.create',
        provider: 'yandex_direct',
        payload: { campaignId, name, keywords, negativeKeywords },
        reasoning,
        execute: async () => {
          const adGroupResult = await direct.createAdGroup(projectId, campaignId, name);
          const adGroupId = adGroupResult?.AddResults?.[0]?.Id;
          if (!adGroupId) throw new Error(`Не удалось создать группу объявлений: ${JSON.stringify(adGroupResult)}`);
          await direct.addKeywords(projectId, adGroupId, keywords);
          await direct.addAdGroupNegativeKeywords(projectId, adGroupId, negativeKeywords);
          return { adGroupId };
        },
      });
    },
  },
  {
    name: 'yandex_create_ads',
    description:
      'Создаёт объявления в группе. Каждое объявление обязано иметь хотя бы одно расширение (быстрые ссылки ' +
      'или уточнения) — объявление без расширений снижает CTR и повышает цену клика (плейбук, раздел 5). High-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        adGroupId: { type: 'number' },
        ads: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              title2: { type: 'string' },
              text: { type: 'string' },
              href: { type: 'string' },
              extensions: {
                type: 'object',
                properties: {
                  sitelinksSetId: { type: 'number' },
                  calloutIds: { type: 'array', items: { type: 'number' } },
                },
              },
            },
            required: ['title', 'text', 'href', 'extensions'],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'adGroupId', 'ads', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, adGroupId, ads, reasoning }) => {
      if (!ads?.length) throw new Error('ads не может быть пустым');
      for (const ad of ads) {
        const hasExtension = ad.extensions?.sitelinksSetId || ad.extensions?.calloutIds?.length;
        if (!hasExtension) {
          throw new Error(
            `Объявление "${ad.title}" не имеет ни быстрых ссылок, ни уточнений — плейбук (раздел 5) требует ` +
              'заполнять расширения у каждого объявления'
          );
        }
      }
      return guardedWrite({
        projectId,
        actionKey: 'ad.create',
        provider: 'yandex_direct',
        payload: { adGroupId, ads },
        reasoning,
        execute: () => direct.createAds(projectId, adGroupId, ads),
      });
    },
  },
];

module.exports = { tools, buildCampaignDefinition };
