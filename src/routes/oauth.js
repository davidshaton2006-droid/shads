const express = require('express');
const crypto = require('crypto');
const yandexOAuth = require('../oauth/yandex');
const vkOAuth = require('../oauth/vk');

const router = express.Router();

// state = projectId, чтобы callback знал, к какому проекту привязать подключение.
// В однопользовательской системе этого достаточно; для многопользовательской добавить подпись state.

router.get('/yandex/start', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).send('projectId обязателен');
  res.redirect(yandexOAuth.getAuthorizeUrl(projectId));
});

router.get('/yandex/callback', async (req, res) => {
  const { code, state: projectId, error } = req.query;
  if (error) return res.status(400).send(`Яндекс OAuth отклонён: ${error}`);
  try {
    const token = await yandexOAuth.exchangeCodeForToken(code);
    // Один токен Яндекса покрывает Директ и Метрику при правильных scope на oauth.yandex.ru —
    // сохраняем под обоими провайдерами.
    await yandexOAuth.saveConnection(projectId, 'yandex_direct', token);
    await yandexOAuth.saveConnection(projectId, 'yandex_metrika', token);
    res.redirect(`/?connected=yandex&project=${projectId}`);
  } catch (err) {
    res.status(500).send(`Ошибка подключения Яндекса: ${err.message}`);
  }
});

// VK ID OAuth 2.1 требует PKCE — code_verifier храним в подписанной cookie на время флоу.
router.get('/vk/start', (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.status(400).send('projectId обязателен');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  res.cookie('vk_code_verifier', codeVerifier, { httpOnly: true, maxAge: 5 * 60 * 1000 });
  res.redirect(vkOAuth.getAuthorizeUrl(projectId, codeChallenge));
});

router.get('/vk/callback', async (req, res) => {
  const { code, state: projectId, device_id: deviceId, error } = req.query;
  if (error) return res.status(400).send(`VK OAuth отклонён: ${error}`);
  const codeVerifier = req.cookies?.vk_code_verifier;
  if (!codeVerifier) return res.status(400).send('Истёк code_verifier, начните подключение заново');
  try {
    const token = await vkOAuth.exchangeCodeForToken(code, codeVerifier, deviceId);
    await vkOAuth.saveConnection(projectId, token);
    res.redirect(`/?connected=vk&project=${projectId}`);
  } catch (err) {
    res.status(500).send(`Ошибка подключения VK: ${err.message}`);
  }
});

module.exports = router;
