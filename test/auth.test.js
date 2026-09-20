const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAuth } = require('../src/middleware/auth');

function run({ ip = '203.0.113.5', authorization } = {}) {
  const res = { statusCode: null, headers: {}, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.send = (b) => { res.body = b; return res; };
  let nextCalled = false;
  requireAuth({ socket: { remoteAddress: ip }, headers: authorization ? { authorization } : {} }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const basic = (u, p) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

test('без DASHBOARD_PASSWORD пускает только localhost', () => {
  delete process.env.DASHBOARD_PASSWORD;
  assert.equal(run({ ip: '127.0.0.1' }).nextCalled, true);
  assert.equal(run({ ip: '::1' }).nextCalled, true);
  const remote = run({ ip: '203.0.113.5' });
  assert.equal(remote.nextCalled, false);
  assert.equal(remote.res.statusCode, 403);
});

test('с паролем: без заголовка 401 и WWW-Authenticate, с неверным паролем 401', () => {
  process.env.DASHBOARD_PASSWORD = 's3cret';
  delete process.env.DASHBOARD_USER;
  const none = run();
  assert.equal(none.res.statusCode, 401);
  assert.match(none.res.headers['WWW-Authenticate'], /Basic/);
  assert.equal(run({ authorization: basic('admin', 'wrong') }).res.statusCode, 401);
  assert.equal(run({ authorization: basic('other', 's3cret') }).res.statusCode, 401);
});

test('с верными кредами пропускает даже удалённый запрос; пароль с двоеточием работает', () => {
  process.env.DASHBOARD_PASSWORD = 'pa:ss';
  assert.equal(run({ authorization: basic('admin', 'pa:ss') }).nextCalled, true);
  process.env.DASHBOARD_USER = 'david';
  assert.equal(run({ authorization: basic('david', 'pa:ss') }).nextCalled, true);
  assert.equal(run({ authorization: basic('admin', 'pa:ss') }).nextCalled, false);
  delete process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_USER;
});
