const { getSupabase } = require('./supabase');
const { decryptToken } = require('./encryption');

/** Возвращает расшифрованный access_token для проекта+провайдера, либо бросает ошибку. */
async function getAccessToken(projectId, provider) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('project_id', projectId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw new Error(`Ошибка чтения connection: ${error.message}`);
  if (!data) throw new Error(`Нет подключения ${provider} для проекта ${projectId} — сначала пройдите OAuth`);

  if (data.token_expires_at && new Date(data.token_expires_at) < new Date()) {
    throw new Error(`Токен ${provider} для проекта ${projectId} истёк — требуется refresh (TODO: авто-refresh)`);
  }

  return { accessToken: decryptToken(data.access_token_encrypted), externalAccountId: data.external_account_id };
}

module.exports = { getAccessToken };
