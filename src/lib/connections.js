const { getSupabase } = require('./supabase');
const { decryptToken } = require('./encryption');
const yandexOAuth = require('../oauth/yandex');

// Один OAuth-токен Яндекса покрывает и Директ, и Метрику и хранится в двух строках connections.
// Refresh-токен Яндекса может ротироваться, поэтому после обновления пишем новые токены в обе
// строки — иначе вторая останется с уже недействительным refresh-токеном.
const YANDEX_PROVIDERS = ['yandex_direct', 'yandex_metrika'];

async function refreshYandexConnection(projectId, row) {
  if (!row.refresh_token_encrypted) {
    throw new Error(`Токен ${row.provider} истёк, а refresh-токена нет — пройдите OAuth заново`);
  }
  const token = await yandexOAuth.refreshAccessToken(decryptToken(row.refresh_token_encrypted));
  for (const provider of YANDEX_PROVIDERS) {
    await yandexOAuth.saveConnection(projectId, provider, token, row.external_account_id);
  }
  return token.access_token;
}

/** Возвращает расшифрованный access_token для проекта+провайдера, обновляя истёкший токен. */
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

  const expired = data.token_expires_at && new Date(data.token_expires_at) < new Date();
  if (!expired) {
    return { accessToken: decryptToken(data.access_token_encrypted), externalAccountId: data.external_account_id };
  }

  if (YANDEX_PROVIDERS.includes(provider)) {
    const accessToken = await refreshYandexConnection(projectId, data);
    return { accessToken, externalAccountId: data.external_account_id };
  }

  // VK ID требует device_id для refresh, а мы его не сохраняем — автообновление невозможно.
  throw new Error(`Токен ${provider} для проекта ${projectId} истёк — пройдите OAuth заново (автообновление VK не реализовано)`);
}

module.exports = { getAccessToken };
