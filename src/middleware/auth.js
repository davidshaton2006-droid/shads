const crypto = require('crypto');

// HTTP Basic Auth на весь дашборд и /api (браузер запоминает креды и сам шлёт их в fetch).
// DASHBOARD_PASSWORD не задан -> закрыто по умолчанию: пускаем только запросы с localhost, чтобы
// локальная разработка работала, а случайно выставленный наружу сервер не был открыт всем.

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isLoopback(req) {
  const ip = req.socket?.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireAuth(req, res, next) {
  const password = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER || 'admin';

  if (!password) {
    if (isLoopback(req)) return next();
    return res.status(403).send('DASHBOARD_PASSWORD не задан — доступ разрешён только с localhost');
  }

  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep !== -1 && safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), password)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="SHADS", charset="UTF-8"');
  return res.status(401).send('Требуется авторизация');
}

module.exports = { requireAuth };
