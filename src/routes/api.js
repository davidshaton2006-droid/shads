const express = require('express');
const { getSupabase } = require('../lib/supabase');
const { decideAction, recordExecution } = require('../guardrails/preflight');
const { ACTION_TYPES } = require('../guardrails/actionTypes');
const direct = require('../providers/yandexDirect');
const vk = require('../providers/vkAds');
const { buildCampaignDefinition } = require('../mcp/tools/yandex');
const leadgen = require('../leadgen/service');

const router = express.Router();

// ---------- Лидген (см. src/leadgen/) ----------
// Отправки здесь нет и не будет намеренно: дашборд отдаёт готовый черновик + контакт,
// владелец сам копирует и пишет из своего Telegram/WhatsApp/почты.

router.get('/leads', async (req, res) => {
  try {
    const { owner_id, status, niche, city } = req.query;
    res.json(await leadgen.listLeads({ ownerId: owner_id, status, niche, city }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leads/search', async (req, res) => {
  try {
    const { owner_id, niche, city, source, limit } = req.body;
    const leads = await leadgen.findLeads({ ownerId: owner_id, niche, city, source, limit });
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/leads/:id', async (req, res) => {
  try {
    const patch = { ...req.body };
    if (patch.status === 'contacted' && !patch.contacted_at) patch.contacted_at = new Date().toISOString();
    res.json(await leadgen.updateLead(req.params.id, patch));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/leads/:id/regenerate-draft', async (req, res) => {
  try {
    res.json(await leadgen.regenerateDraft(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects', async (req, res) => {
  const { data, error } = await getSupabase().from('projects').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/projects', async (req, res) => {
  const { name, goal_type, goal_value, daily_budget_limit, currency, owner_id } = req.body;
  const { data, error } = await getSupabase()
    .from('projects')
    .insert({ name, goal_type, goal_value, daily_budget_limit, currency: currency ?? 'RUB', owner_id })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/action-types', (req, res) => {
  res.json(ACTION_TYPES);
});

router.get('/projects/:id/action-settings', async (req, res) => {
  const { data, error } = await getSupabase().from('project_action_settings').select('*').eq('project_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.put('/projects/:id/action-settings/:actionKey', async (req, res) => {
  const { requires_confirmation } = req.body;
  const { data, error } = await getSupabase()
    .from('project_action_settings')
    .upsert(
      { project_id: req.params.id, action_key: req.params.actionKey, requires_confirmation, updated_at: new Date().toISOString() },
      { onConflict: 'project_id,action_key' }
    )
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

function groupDirectReportByCampaign(rows) {
  const byId = {};
  for (const r of rows) {
    if (!byId[r.campaignId]) byId[r.campaignId] = { cost: 0, conversions: 0, byDate: {} };
    byId[r.campaignId].cost += r.cost;
    byId[r.campaignId].conversions += r.conversions;
    if (r.date) byId[r.campaignId].byDate[r.date] = (byId[r.campaignId].byDate[r.date] ?? 0) + r.cost;
  }
  return byId;
}

/** Последние `days` календарных дат (включительно, по возрастанию) в формате YYYY-MM-DD. */
function lastNDates(days) {
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Обзор кампаний проекта: статус, дневной бюджет, расход за сегодня/7 дней и разбивка расхода
 * по дням (для графика в дашборде) по каждой подключённой площадке. Данные читаются напрямую у
 * провайдеров (не кэшируются) — для MVP-дашборда это приемлемо, при росте числа проектов стоит
 * завести периодический снапшот.
 */
async function getCampaignsForProject(projectId) {
  const { data: connections, error: connError } = await getSupabase().from('connections').select('provider').eq('project_id', projectId);
  if (connError) throw new Error(connError.message);
  const providers = (connections ?? []).map((c) => c.provider);

  const week = lastNDates(7);
  const dateToday = week[week.length - 1];
  const dateWeekAgo = week[0];

  const campaigns = [];

  if (providers.includes('yandex_direct')) {
    const [campaignsResult, todayReport, weekReport] = await Promise.all([
      direct.getCampaigns(projectId),
      direct.getCampaignPerformanceReport(projectId, { dateFrom: dateToday, dateTo: dateToday }),
      direct.getCampaignPerformanceReport(projectId, { dateFrom: dateWeekAgo, dateTo: dateToday }),
    ]);
    const todayByCampaign = groupDirectReportByCampaign(todayReport);
    const weekByCampaign = groupDirectReportByCampaign(weekReport);

    for (const c of campaignsResult?.Campaigns ?? []) {
      const byDate = weekByCampaign[c.Id]?.byDate ?? {};
      campaigns.push({
        provider: 'yandex_direct',
        id: c.Id,
        name: c.Name,
        status: c.Status,
        state: c.State,
        // DailyBudget.Amount в Директ API v5 задаётся в микро-единицах валюты (1 ₽ = 1_000_000) —
        // переводим в рубли для отображения, иначе дашборд показывает бюджет завышенным в 1e6 раз.
        dailyBudget: c.DailyBudget?.Amount != null ? c.DailyBudget.Amount / 1_000_000 : null,
        spendToday: todayByCampaign[c.Id]?.cost ?? 0,
        spend7d: weekByCampaign[c.Id]?.cost ?? 0,
        dailySpend: week.map((date) => ({ date, spend: byDate[date] ?? 0 })),
      });
    }
  }

  if (providers.includes('vk_ads')) {
    const [campaignsResult, todayStats, weekStats] = await Promise.all([
      vk.getCampaigns(projectId),
      vk.getStats(projectId, { date_from: dateToday, date_to: dateToday }),
      vk.getStats(projectId, { date_from: dateWeekAgo, date_to: dateToday }),
    ]);
    const todayByCampaign = vk.statsByCampaignId(todayStats);
    const weekByCampaign = vk.statsByCampaignId(weekStats);
    const weekByCampaignDaily = vk.dailySpendByCampaignId(weekStats);

    for (const c of campaignsResult?.items ?? []) {
      const byDate = weekByCampaignDaily[c.id] ?? {};
      campaigns.push({
        provider: 'vk_ads',
        id: c.id,
        name: c.name,
        status: c.status,
        state: null,
        dailyBudget: c.budget_limit_day ?? null,
        spendToday: todayByCampaign[c.id]?.spend ?? 0,
        spend7d: weekByCampaign[c.id]?.spend ?? 0,
        dailySpend: week.map((date) => ({ date, spend: byDate[date] ?? 0 })),
      });
    }
  }

  return campaigns;
}

router.get('/projects/:id/campaigns', async (req, res) => {
  try {
    res.json(await getCampaignsForProject(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Сводка по всем проектам сразу — для обзорного экрана дашборда (карточка на каждого клиента:
// статус, расход сегодня против дневного лимита, сколько действий ждёт подтверждения).
router.get('/overview', async (req, res) => {
  try {
    const { data: projects, error } = await getSupabase().from('projects').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const overview = await Promise.all(
      (projects ?? []).map(async (p) => {
        const [campaigns, pendingResult] = await Promise.all([
          getCampaignsForProject(p.id).catch(() => []),
          getSupabase().from('pending_actions').select('id').eq('project_id', p.id).eq('status', 'pending'),
        ]);
        const spendToday = campaigns.reduce((sum, c) => sum + (c.spendToday || 0), 0);
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          dailyBudgetLimit: p.daily_budget_limit,
          currency: p.currency,
          spendToday,
          campaignCount: campaigns.length,
          pendingCount: pendingResult?.data?.length ?? 0,
        };
      })
    );

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/pending-actions', async (req, res) => {
  const { data, error } = await getSupabase()
    .from('pending_actions')
    .select('*')
    .eq('project_id', req.params.id)
    .order('requested_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Единственное место, где pending write-действие реально исполняется после ручного подтверждения.
router.post('/pending-actions/:id/approve', async (req, res) => {
  try {
    const pending = await decideAction(req.params.id, 'approved');
    const result = await executePendingAction(pending);
    await recordExecution({
      projectId: pending.project_id,
      pendingActionId: pending.id,
      actionKey: pending.action_key,
      provider: pending.provider,
      payload: pending.payload,
      status: 'success',
      result,
    });
    res.json({ status: 'executed', result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pending-actions/:id/reject', async (req, res) => {
  try {
    const pending = await decideAction(req.params.id, 'rejected');
    res.json(pending);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:id/action-log', async (req, res) => {
  const { data, error } = await getSupabase()
    .from('action_log')
    .select('*')
    .eq('project_id', req.params.id)
    .order('executed_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/projects/:id/stop-events', async (req, res) => {
  const { data, error } = await getSupabase()
    .from('stop_events')
    .select('*')
    .eq('project_id', req.params.id)
    .order('triggered_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/projects/:id/stop-rules', async (req, res) => {
  const { data, error } = await getSupabase().from('stop_rules').select('*').eq('project_id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/projects/:id/stop-rules', async (req, res) => {
  const { rule_type, threshold, window_hours } = req.body;
  const { data, error } = await getSupabase()
    .from('stop_rules')
    .insert({ project_id: req.params.id, rule_type, threshold, window_hours: window_hours ?? 24 })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Диспетчер выполнения одобренного действия — зеркало execute() в MCP-инструментах
// (src/mcp/tools/yandex.js, vk.js), но вызывается после ручного approve из дашборда, а не агентом.
async function executePendingAction(pending) {
  const { provider, action_key, payload, project_id } = pending;

  if (provider === 'yandex_direct') {
    if (action_key === 'negative_keyword.add') return direct.addNegativeKeywords(project_id, payload.campaignId, payload.negativeKeywords);
    if (action_key === 'bid.update') return direct.updateKeywordBids(project_id, payload.bids);
    if (action_key === 'budget.update') return direct.updateCampaignBudget(project_id, payload.campaignId, payload.dailyBudgetMicros);
    if (action_key === 'campaign.pause') return direct.suspendCampaign(project_id, payload.campaignId);
    if (action_key === 'campaign.resume') return direct.resumeCampaign(project_id, payload.campaignId);
    if (action_key === 'campaign.create') {
      const definition = buildCampaignDefinition({ name: payload.name, type: payload.type, dailyBudgetMicros: payload.dailyBudgetMicros });
      return direct.createCampaign(project_id, definition);
    }
    if (action_key === 'ad_group.create') {
      const adGroupResult = await direct.createAdGroup(project_id, payload.campaignId, payload.name);
      const adGroupId = adGroupResult?.AddResults?.[0]?.Id;
      if (!adGroupId) throw new Error(`Не удалось создать группу объявлений: ${JSON.stringify(adGroupResult)}`);
      await direct.addKeywords(project_id, adGroupId, payload.keywords);
      await direct.addAdGroupNegativeKeywords(project_id, adGroupId, payload.negativeKeywords);
      return { adGroupId };
    }
    if (action_key === 'ad.create') return direct.createAds(project_id, payload.adGroupId, payload.ads);
  }
  if (provider === 'vk_ads') {
    if (action_key === 'budget.update') return vk.updateBudget(project_id, payload.campaignId, payload.dailyBudget);
    if (action_key === 'campaign.pause') return vk.pauseCampaign(project_id, payload.campaignId);
    if (action_key === 'campaign.resume') return vk.resumeCampaign(project_id, payload.campaignId);
    if (action_key === 'audience.update') return vk.updateTargeting(project_id, payload.adGroupId, payload.targeting);
    if (action_key === 'campaign.create') return vk.createCampaign(project_id, { name: payload.name, objective: payload.objective, budget_limit_day: payload.dailyBudget });
    if (action_key === 'ad_group.create') {
      const results = [];
      for (const group of payload.adGroups) {
        results.push(await vk.createAdGroup(project_id, { ad_plan_id: payload.campaignId, name: group.name, targetings: group.targeting }));
      }
      return results;
    }
    if (action_key === 'ad.create') {
      const results = [];
      for (const creative of payload.creatives) {
        results.push(await vk.createAd(project_id, { ad_group_id: payload.adGroupId, name: creative.name, content: creative.content }));
      }
      return results;
    }
  }
  throw new Error(`Нет обработчика выполнения для ${provider}/${action_key}`);
}

module.exports = router;
