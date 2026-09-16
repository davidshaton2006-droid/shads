const { getSupabase } = require('../lib/supabase');

// Автоматический стоп-кран — работает независимо от решений агента. Проверяется отдельным
// планировщиком (см. src/server.js: setInterval на checkAllProjects), а не вызывается агентом,
// чтобы агент не мог его обойти, отложить или "уговорить себя" не останавливать кампанию.
//
// Два типа правил (см. supabase/migrations/0001_init.sql: stop_rules):
//   cpa_ceiling            — фактический CPA за window_hours превышает threshold
//   spend_no_conversions_pct — потрачено > threshold% дневного бюджета без единой конверсии

async function checkProjectStopRules(projectId, { getSpendAndConversions, pauseAllCampaigns, notifyOwner }) {
  const supabase = getSupabase();

  const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).single();
  if (!project || project.status !== 'active') return;

  const { data: rules } = await supabase
    .from('stop_rules')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true);
  if (!rules || rules.length === 0) return;

  for (const rule of rules) {
    // getSpendAndConversions — функция, переданная извне (зависит от провайдера), возвращает
    // { spend, conversions, cpa } за rule.window_hours для проекта.
    const metrics = await getSpendAndConversions(project, rule.window_hours);

    let triggered = false;
    let metricValue = 0;

    if (rule.rule_type === 'cpa_ceiling' && metrics.conversions > 0) {
      metricValue = metrics.cpa;
      triggered = metrics.cpa > rule.threshold;
    }

    if (rule.rule_type === 'spend_no_conversions_pct') {
      const spendPct = (metrics.spend / project.daily_budget_limit) * 100;
      metricValue = spendPct;
      triggered = metrics.conversions === 0 && spendPct > rule.threshold;
    }

    if (triggered) {
      await pauseAllCampaigns(project);

      await supabase.from('stop_events').insert({
        project_id: project.id,
        stop_rule_id: rule.id,
        metric_value: metricValue,
        action_taken: 'campaign_paused',
      });

      await supabase.from('projects').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('id', project.id);

      await notifyOwner(project, rule, metricValue);
    }
  }
}

module.exports = { checkProjectStopRules };
