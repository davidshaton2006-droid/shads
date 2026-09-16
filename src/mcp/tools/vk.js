const vk = require('../../providers/vkAds');
const { guardedWrite } = require('./writeHelper');

const projectIdProp = { projectId: { type: 'string', description: 'UUID проекта в Supabase' } };

const tools = [
  // --- read ---
  {
    name: 'vk_get_campaigns',
    description: 'Список кампаний (ad_plans) VK Ads проекта.',
    inputSchema: { type: 'object', properties: { ...projectIdProp }, required: ['projectId'] },
    riskLevel: 'read',
    handler: async ({ projectId }) => ({ content: [{ type: 'text', text: JSON.stringify(await vk.getCampaigns(projectId)) }] }),
  },
  {
    name: 'vk_get_stats',
    description: 'Статистика по кампаниям за период (расход, показы, клики, конверсии по дням).',
    inputSchema: { type: 'object', properties: { ...projectIdProp, params: { type: 'object' } }, required: ['projectId', 'params'] },
    riskLevel: 'read',
    handler: async ({ projectId, params }) => ({ content: [{ type: 'text', text: JSON.stringify(await vk.getStats(projectId, params)) }] }),
  },
  {
    name: 'vk_get_pixel_status',
    description:
      'Проверяет статус пикселя ("Данные поступают" / "Данные не поступают"). ОБЯЗАТЕЛЬНО проверить перед запуском кампании с целью "конверсии" (плейбук, раздел 2 и 9).',
    inputSchema: { type: 'object', properties: { ...projectIdProp, pixelId: { type: 'string' } }, required: ['projectId', 'pixelId'] },
    riskLevel: 'read',
    handler: async ({ projectId, pixelId }) => ({ content: [{ type: 'text', text: JSON.stringify(await vk.getPixelStatus(projectId, pixelId)) }] }),
  },

  // --- write ---
  {
    name: 'vk_update_budget',
    description: 'Меняет дневной бюджет кампании. High-risk — по плейбуку расширение тестового бюджета всегда требует подтверждения (раздел 9).',
    inputSchema: { type: 'object', properties: { ...projectIdProp, campaignId: { type: 'string' }, dailyBudget: { type: 'number' }, reasoning: { type: 'string' } }, required: ['projectId', 'campaignId', 'dailyBudget', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, dailyBudget, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'budget.update',
        provider: 'vk_ads',
        payload: { campaignId, dailyBudget },
        reasoning,
        execute: () => vk.updateBudget(projectId, campaignId, dailyBudget),
      }),
  },
  {
    name: 'vk_pause_campaign',
    description: 'Останавливает кампанию.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, campaignId: { type: 'string' }, reasoning: { type: 'string' } }, required: ['projectId', 'campaignId', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'campaign.pause',
        provider: 'vk_ads',
        payload: { campaignId },
        reasoning,
        execute: () => vk.pauseCampaign(projectId, campaignId),
      }),
  },
  {
    name: 'vk_resume_campaign',
    description: 'Возобновляет остановленную кампанию.',
    inputSchema: { type: 'object', properties: { ...projectIdProp, campaignId: { type: 'string' }, reasoning: { type: 'string' } }, required: ['projectId', 'campaignId', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'campaign.resume',
        provider: 'vk_ads',
        payload: { campaignId },
        reasoning,
        execute: () => vk.resumeCampaign(projectId, campaignId),
      }),
  },
  {
    name: 'vk_update_targeting',
    description:
      'Меняет таргетинг/аудитории группы объявлений. Не объединять ретаргетинг и холодный трафик в одну группу ни при каких оптимизациях (плейбук, раздел 9).',
    inputSchema: { type: 'object', properties: { ...projectIdProp, adGroupId: { type: 'string' }, targeting: { type: 'object' }, reasoning: { type: 'string' } }, required: ['projectId', 'adGroupId', 'targeting', 'reasoning'] },
    riskLevel: 'write',
    handler: async ({ projectId, adGroupId, targeting, reasoning }) =>
      guardedWrite({
        projectId,
        actionKey: 'audience.update',
        provider: 'vk_ads',
        payload: { adGroupId, targeting },
        reasoning,
        execute: () => vk.updateTargeting(projectId, adGroupId, targeting),
      }),
  },
  {
    name: 'vk_create_campaign',
    description:
      'Создаёт кампанию. objective обязателен и определяет, под что оптимизирует алгоритм VK (плейбук, раздел 3) — ' +
      '"не выбирать трафик, если реальная задача — заявки/продажи". Если objective="traffic", нужно явно передать ' +
      'confirmTrafficObjective=true, подтверждая, что охватная/трафиковая задача — осознанный выбор, а не дефолт по незнанию. High-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        name: { type: 'string' },
        objective: { type: 'string', enum: ['conversions', 'lead_form', 'catalog', 'app', 'traffic', 'reach'] },
        confirmTrafficObjective: { type: 'boolean', description: 'Обязателен и должен быть true, если objective="traffic"' },
        dailyBudget: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'name', 'objective', 'dailyBudget', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, name, objective, confirmTrafficObjective, dailyBudget, reasoning }) => {
      if (objective === 'traffic' && !confirmTrafficObjective) {
        throw new Error(
          'objective="traffic" требует явного confirmTrafficObjective=true — плейбук (раздел 3) запрещает выбирать ' +
            '"трафик" по умолчанию, когда реальная задача — заявки/продажи'
        );
      }
      return guardedWrite({
        projectId,
        actionKey: 'campaign.create',
        provider: 'vk_ads',
        payload: { name, objective, dailyBudget },
        reasoning,
        execute: () => vk.createCampaign(projectId, { name, objective, budget_limit_day: dailyBudget }),
      });
    },
  },
  {
    name: 'vk_create_ad_group',
    description:
      'Создаёт группы объявлений пачкой. adGroups должен содержать минимум 2 сегмента аудитории — плейбук (раздел 5): ' +
      '"не одна широкая аудитория, а минимум 2-3 параллельных сегмента" (например холодная по интересам + look-alike + ретаргетинг). ' +
      'Ретаргетинг передавать отдельной группой, не смешивая с холодным трафиком (плейбук, раздел 9). High-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        campaignId: { type: 'string' },
        adGroups: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, targeting: { type: 'object' } },
            required: ['name', 'targeting'],
          },
        },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'campaignId', 'adGroups', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, campaignId, adGroups, reasoning }) => {
      if (!adGroups || adGroups.length < 2) {
        throw new Error(
          `Нужно минимум 2 сегмента аудитории/группы за один вызов (плейбук, раздел 5), передано: ${adGroups?.length ?? 0}`
        );
      }
      return guardedWrite({
        projectId,
        actionKey: 'ad_group.create',
        provider: 'vk_ads',
        payload: { campaignId, adGroups },
        reasoning,
        execute: async () => {
          const results = [];
          for (const group of adGroups) {
            results.push(await vk.createAdGroup(projectId, { ad_plan_id: campaignId, name: group.name, targetings: group.targeting }));
          }
          return results;
        },
      });
    },
  },
  {
    name: 'vk_create_ad',
    description:
      'Создаёт объявления в группе. creatives — минимум 2 варианта на группу (плейбук, раздел 6): алгоритм VK сам ' +
      'перераспределит показы в пользу лучшего варианта, но только если есть из чего выбирать. High-risk.',
    inputSchema: {
      type: 'object',
      properties: {
        ...projectIdProp,
        adGroupId: { type: 'string' },
        creatives: {
          type: 'array',
          minItems: 2,
          items: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'object' } }, required: ['name', 'content'] },
        },
        reasoning: { type: 'string' },
      },
      required: ['projectId', 'adGroupId', 'creatives', 'reasoning'],
    },
    riskLevel: 'write',
    handler: async ({ projectId, adGroupId, creatives, reasoning }) => {
      if (!creatives || creatives.length < 2) {
        throw new Error(`Нужно минимум 2 варианта креатива на группу (плейбук, раздел 6), передано: ${creatives?.length ?? 0}`);
      }
      return guardedWrite({
        projectId,
        actionKey: 'ad.create',
        provider: 'vk_ads',
        payload: { adGroupId, creatives },
        reasoning,
        execute: async () => {
          const results = [];
          for (const creative of creatives) {
            results.push(await vk.createAd(projectId, { ad_group_id: adGroupId, name: creative.name, content: creative.content }));
          }
          return results;
        },
      });
    },
  },
];

module.exports = { tools };
