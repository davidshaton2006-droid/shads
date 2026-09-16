const direct = require('../providers/yandexDirect');
const vk = require('../providers/vkAds');
const { getSupabase } = require('../lib/supabase');
const { checkProjectStopRules } = require('./stopCran');
const { notifyStopCranTriggered } = require('../lib/telegram');

// Провайдер-специфичная реализация зависимостей checkProjectStopRules. Держим отдельно от
// stopCran.js, чтобы логика правил (когда срабатывает стоп) не зависела от того, как именно
// достаются метрики и как именно ставится пауза на конкретной площадке.

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Реальный сбор spend/conversions за windowHours по всем провайдерам, подключённым к проекту.
 * Директ: CAMPAIGN_PERFORMANCE_REPORT (Reports API) за период. VK Ads: statistics/ad_plans/day.json.
 * Огрубление: Reports API Директа оперирует днями, а не часами — при windowHours < 24 всё равно
 * берём текущие сутки целиком (более узкое окно на уровне API недоступно), из-за чего порог
 * может сработать чуть раньше/позже часовой границы. Это осознанный компромисс, а не ошибка.
 */
async function getSpendAndConversionsFor(project, windowHours) {
  const supabase = getSupabase();
  const { data: connections } = await supabase.from('connections').select('provider').eq('project_id', project.id);
  const providers = (connections ?? []).map((c) => c.provider);

  const now = new Date();
  const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const dateFrom = toDateOnly(from);
  const dateTo = toDateOnly(now);

  let spend = 0;
  let conversions = 0;

  if (providers.includes('yandex_direct')) {
    const rows = await direct.getCampaignPerformanceReport(project.id, { dateFrom, dateTo });
    for (const row of rows) {
      spend += row.cost;
      conversions += row.conversions;
    }
  }

  if (providers.includes('vk_ads')) {
    const stats = await vk.getStats(project.id, { date_from: dateFrom, date_to: dateTo });
    const vkTotals = vk.sumSpendAndConversions(stats);
    spend += vkTotals.spend;
    conversions += vkTotals.conversions;
  }

  const cpa = conversions > 0 ? spend / conversions : 0;
  return { spend, conversions, cpa };
}

async function pauseAllCampaignsFor(project) {
  const supabase = getSupabase();
  const { data: connections } = await supabase.from('connections').select('provider, external_account_id').eq('project_id', project.id);

  for (const conn of connections ?? []) {
    if (conn.provider === 'yandex_direct') {
      const campaigns = await direct.getCampaigns(project.id);
      for (const c of campaigns?.Campaigns ?? []) {
        if (c.Status === 'ACCEPTED' || c.State === 'ON') await direct.suspendCampaign(project.id, c.Id);
      }
    }
    if (conn.provider === 'vk_ads') {
      const campaigns = await vk.getCampaigns(project.id);
      for (const c of campaigns?.items ?? []) {
        if (c.status === 'active') await vk.pauseCampaign(project.id, c.id);
      }
    }
  }
}

async function notifyOwnerFor(project, rule, metricValue) {
  console.warn(
    `[STOP-CRAN] Проект "${project.name}" (${project.id}) остановлен: правило ${rule.rule_type}, значение ${metricValue}, порог ${rule.threshold}`
  );
  try {
    await notifyStopCranTriggered(project, rule, metricValue);
  } catch (err) {
    console.error('[TELEGRAM] notifyStopCranTriggered:', err.message);
  }
}

async function runStopCranForAllProjects() {
  const supabase = getSupabase();
  const { data: projects } = await supabase.from('projects').select('id').eq('status', 'active');
  for (const p of projects ?? []) {
    try {
      await checkProjectStopRules(p.id, {
        getSpendAndConversions: getSpendAndConversionsFor,
        pauseAllCampaigns: pauseAllCampaignsFor,
        notifyOwner: notifyOwnerFor,
      });
    } catch (err) {
      console.error(`[STOP-CRAN] Ошибка проверки проекта ${p.id}:`, err.message);
    }
  }
}

module.exports = { runStopCranForAllProjects, getSpendAndConversionsFor, pauseAllCampaignsFor, notifyOwnerFor };
