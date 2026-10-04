const https = require('node:https');
const zlib = require('node:zlib');

// На части сетей (в т.ч. у владельца при разработке) IPv6-маршрут до серверов Яндекса битый:
// пакеты уходят в никуда, а обычный fetch сперва пробует IPv6 и висит на коннекте ~10 секунд,
// прежде чем упасть с ConnectTimeoutError (curl и https.request с family:4 подключаются мгновенно).
//
// Первая попытка фикса — форсировать IPv4 через отдельный Agent из npm-пакета `undici` — сломала
// Supabase: сам факт require('undici') (даже без единого вызова из него) ломает автоматическую
// gzip-распаковку у параллельных запросов через ГЛОБАЛЬНЫЙ fetch, которым пользуется
// @supabase/supabase-js — подтверждено экспериментом (3 параллельных запроса к Supabase падали
// с "мусором" вместо JSON, как только в процессе был хотя бы раз вызван require('undici')).
// Поэтому здесь используется только встроенный node:https с ручной распаковкой — без каких-либо
// npm-пакетов, чтобы не трогать глобальный fetch/undici вообще.
// Встроенный fetch принимал URLSearchParams как тело (так шлёт запросы oauth/yandex.js), а голый
// https.request.write() — только строку/Buffer. Приводим тело к тому, что понимает https.
function serializeBody(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError(`yandexFetch: неподдерживаемый тип тела запроса: ${Object.prototype.toString.call(body)}`);
}

function yandexFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = serializeBody(options.body);
    const headers = { ...(options.headers || {}) };
    const hasHeader = (name) => Object.keys(headers).some((k) => k.toLowerCase() === name);
    if (options.body instanceof URLSearchParams && !hasHeader('content-type')) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (body !== undefined && !hasHeader('content-length')) headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers,
        family: 4,
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          let buf = Buffer.concat(chunks);
          const encoding = (res.headers['content-encoding'] || '').toLowerCase();
          try {
            if (encoding === 'gzip') buf = zlib.gunzipSync(buf);
            else if (encoding === 'br') buf = zlib.brotliDecompressSync(buf);
            else if (encoding === 'deflate') buf = zlib.inflateSync(buf);
          } catch (err) {
            reject(new Error(`Не удалось распаковать ответ (${encoding || 'без сжатия'}): ${err.message}`));
            return;
          }
          const text = buf.toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Таймаут запроса к Яндексу (15с)'));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

module.exports = { yandexFetch, serializeBody };
