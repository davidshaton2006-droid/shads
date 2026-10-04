const { getSupabase } = require('./supabase');

// Привязка кампаний площадок к проектам SHADS (таблица project_campaigns, миграция 0004).
// Без привязки проект не видит и не трогает никакие кампании — это безопасный дефолт: лучше
// показать пустой список, чем дать стоп-крану одного клиента остановить кампании другого.

/** Id кампаний площадки, привязанных к проекту, как массив строк. */
async function getBoundCampaignIds(projectId, provider) {
  const { data, error } = await getSupabase()
    .from('project_campaigns')
    .select('external_campaign_id')
    .eq('project_id', projectId)
    .eq('provider', provider);
  if (error) throw new Error(`Не удалось прочитать project_campaigns: ${error.message}`);
  return (data ?? []).map((row) => String(row.external_campaign_id));
}

/** Привязывает кампанию к проекту. Если она уже закреплена за другим проектом — бросает ошибку. */
async function bindCampaign(projectId, provider, externalCampaignId) {
  const supabase = getSupabase();
  const id = String(externalCampaignId);

  const { data: existing, error: readError } = await supabase
    .from('project_campaigns')
    .select('project_id')
    .eq('provider', provider)
    .eq('external_campaign_id', id)
    .maybeSingle();
  if (readError) throw new Error(`Не удалось прочитать project_campaigns: ${readError.message}`);
  if (existing) {
    if (existing.project_id === projectId) return;
    throw new Error(`Кампания ${provider}/${id} уже привязана к другому проекту`);
  }

  const { error } = await supabase
    .from('project_campaigns')
    .insert({ project_id: projectId, provider, external_campaign_id: id });
  if (error) throw new Error(`Не удалось привязать кампанию: ${error.message}`);
}

/** Запрещает write-действие над чужой/непривязанной кампанией. */
async function assertCampaignInProject(projectId, provider, campaignId) {
  const bound = await getBoundCampaignIds(projectId, provider);
  if (!bound.includes(String(campaignId))) {
    throw new Error(
      `Кампания ${campaignId} не привязана к этому проекту (${provider}) — действие отклонено, чтобы не затронуть кампании других проектов. ` +
        'Привяжите её к проекту (POST /api/projects/:id/campaigns/bind) или создайте через SHADS — созданные кампании привязываются автоматически.'
    );
  }
}

/** Привязывает кампанию, только что созданную Campaigns.add (Директ): Id лежит в AddResults[0]. */
async function bindCreatedYandexCampaign(projectId, addResult) {
  const id = addResult?.AddResults?.[0]?.Id;
  if (!id) throw new Error(`Директ не вернул Id созданной кампании: ${JSON.stringify(addResult)}`);
  await bindCampaign(projectId, 'yandex_direct', id);
}

module.exports = { getBoundCampaignIds, bindCampaign, assertCampaignInProject, bindCreatedYandexCampaign };
