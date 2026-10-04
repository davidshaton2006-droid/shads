const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { yandexFetch, serializeBody } = require('../src/lib/network');

// Подменяем только https.request, а сам yandexFetch гоняем настоящий — раньше тесты мокали весь
// network.js, поэтому баг "тело URLSearchParams не принимается" (OAuth Яндекса) прошёл незамеченным.
function stubHttps({ status = 200, body = '{"ok":true}', headers = {} } = {}) {
  const original = https.request;
  const captured = { options: null, written: [] };
  https.request = (options, onResponse) => {
    captured.options = options;
    const req = new EventEmitter();
    req.write = (chunk) => {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
        throw new TypeError('The "chunk" argument must be of type string or an instance of Buffer or Uint8Array');
      }
      captured.written.push(String(chunk));
    };
    req.destroy = () => {};
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = headers;
      onResponse(res);
      res.emit('data', Buffer.isBuffer(body) ? body : Buffer.from(body));
      res.emit('end');
    };
    return req;
  };
  return { captured, restore: () => { https.request = original; } };
}

test('yandexFetch — функция, не трогает глобальный fetch (изолирован от Supabase/Telegram/VK)', () => {
  const original = global.fetch;
  assert.equal(typeof yandexFetch, 'function');
  assert.notEqual(yandexFetch, original);
  assert.equal(global.fetch, original);
});

test('serializeBody: строка, Buffer и URLSearchParams принимаются, мусор — нет', () => {
  assert.equal(serializeBody('a=1'), 'a=1');
  assert.equal(serializeBody(new URLSearchParams({ a: '1', b: 'x y' })), 'a=1&b=x+y');
  assert.equal(serializeBody(undefined), undefined);
  assert.throws(() => serializeBody({ a: 1 }), /неподдерживаемый тип тела/);
});

test('yandexFetch принимает тело URLSearchParams (OAuth Яндекса) и ставит Content-Type/Content-Length', async () => {
  const { captured, restore } = stubHttps({ body: '{"access_token":"t"}' });
  try {
    const res = await yandexFetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: 'abc' }),
    });
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { access_token: 't' });
    assert.deepEqual(captured.written, ['grant_type=authorization_code&code=abc']);
    assert.equal(captured.options.family, 4);
    assert.equal(captured.options.hostname, 'oauth.yandex.ru');
    assert.equal(captured.options.headers['Content-Length'], Buffer.byteLength('grant_type=authorization_code&code=abc'));
  } finally {
    restore();
  }
});

test('yandexFetch: URLSearchParams без явного Content-Type получает form-urlencoded', async () => {
  const { captured, restore } = stubHttps();
  try {
    await yandexFetch('https://oauth.yandex.ru/token', { method: 'POST', body: new URLSearchParams({ a: '1' }) });
    assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  } finally {
    restore();
  }
});

test('yandexFetch: JSON-строка и URL-объект с query (Метрика) работают, ответ gzip распаковывается', async () => {
  const gz = zlib.gzipSync(Buffer.from('{"result":42}'));
  const { captured, restore } = stubHttps({ body: gz, headers: { 'content-encoding': 'gzip' } });
  try {
    const url = new URL('/stat/v1/data', 'https://api-metrika.yandex.net');
    url.searchParams.set('ids', '123');
    const res = await yandexFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(await res.json(), { result: 42 });
    assert.equal(captured.options.path, '/stat/v1/data?ids=123');
    assert.deepEqual(captured.written, ['{"a":1}']);
  } finally {
    restore();
  }
});

test('yandexFetch: GET без тела ничего не пишет, статус >=400 даёт ok=false', async () => {
  const { captured, restore } = stubHttps({ status: 403, body: 'denied' });
  try {
    const res = await yandexFetch('https://api-metrika.yandex.net/x');
    assert.equal(res.ok, false);
    assert.equal(res.status, 403);
    assert.equal(await res.text(), 'denied');
    assert.deepEqual(captured.written, []);
  } finally {
    restore();
  }
});
