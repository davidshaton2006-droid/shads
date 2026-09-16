const { encryptToken } = require('../lib/encryption');
const { getSupabase } = require('../lib/supabase');

// VK ID OAuth 2.1 (PKCE) для доступа к VK Ads API. Доки: https://dev.vk.com/ru/api/access-token/getting-started
// ВАЖНО: точный флоу (VK ID vs. старый OAuth) и scope для рекламного кабинета нужно свериться
// в актуальной справке VK Ads на момент регистрации приложения — площадка меняет флоу чаще Яндекса.

function getAuthorizeUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.VK_CLIENT_ID,
    redirect_uri: process.env.VK_REDIRECT_URI,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: 'ads',
  });
  return `https://id.vk.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code, codeVerifier, deviceId) {
  const res = await fetch('https://id.vk.com/oauth2/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: process.env.VK_CLIENT_ID,
      device_id: deviceId,
      redirect_uri: process.env.VK_REDIRECT_URI,
    }),
  });
  if (!res.ok) throw new Error(`VK OAuth token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, user_id, ... }
}

async function saveConnection(projectId, tokenResponse, externalAccountId) {
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
  const { error } = await supabase.from('connections').upsert(
    {
      project_id: projectId,
      provider: 'vk_ads',
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

module.exports = { getAuthorizeUrl, exchangeCodeForToken, saveConnection };
