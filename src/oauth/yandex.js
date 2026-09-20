const { encryptToken } = require('../lib/encryption');
const { getSupabase } = require('../lib/supabase');

// Яндекс OAuth (oauth.yandex.ru) — один флоу выдаёт токен, годный и для Директа, и для Метрики,
// если оба scope запрошены при регистрации приложения на oauth.yandex.ru.
// Доки: https://yandex.ru/dev/direct/doc/start/token.html

function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.YANDEX_CLIENT_ID,
    redirect_uri: process.env.YANDEX_REDIRECT_URI,
    state,
  });
  return `https://oauth.yandex.ru/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const res = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.YANDEX_CLIENT_ID,
      client_secret: process.env.YANDEX_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Яндекс OAuth token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth.yandex.ru/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.YANDEX_CLIENT_ID,
      client_secret: process.env.YANDEX_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Яндекс OAuth refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function saveConnection(projectId, provider, tokenResponse, externalAccountId) {
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
  const { error } = await supabase.from('connections').upsert(
    {
      project_id: projectId,
      provider,
      external_account_id: externalAccountId ?? null,
      access_token_encrypted: encryptToken(tokenResponse.access_token),
      refresh_token_encrypted: tokenResponse.refresh_token ? encryptToken(tokenResponse.refresh_token) : null,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,provider' }
  );
  if (error) throw new Error(`Не удалось сохранить connection: ${error.message}`);
}

module.exports = { getAuthorizeUrl, exchangeCodeForToken, refreshAccessToken, saveConnection };
