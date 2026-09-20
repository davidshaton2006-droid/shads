const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

let currentFake;
const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabase: () => currentFake } };

const { getOwnerId, resetOwnerCache } = require('../src/lib/owner');

test('getOwnerId возвращает существующего владельца по OWNER_EMAIL и кэширует', async () => {
  resetOwnerCache();
  process.env.OWNER_EMAIL = 'owner@example.com';
  let selects = 0;
  currentFake = createFakeSupabase({
    owners: (state) => {
      assert.equal(state.op, 'select');
      assert.equal(state.filters.email, 'owner@example.com');
      selects += 1;
      return { data: { id: 'owner-1' }, error: null };
    },
  });

  assert.equal(await getOwnerId(), 'owner-1');
  assert.equal(await getOwnerId(), 'owner-1');
  assert.equal(selects, 1);
});

test('getOwnerId создаёт владельца, если его ещё нет', async () => {
  resetOwnerCache();
  process.env.OWNER_EMAIL = 'new@example.com';
  const inserted = [];
  currentFake = createFakeSupabase({
    owners: (state) => {
      if (state.op === 'insert') {
        inserted.push(state.payload);
        return { data: { id: 'owner-new' }, error: null };
      }
      return { data: null, error: null };
    },
  });

  assert.equal(await getOwnerId(), 'owner-new');
  assert.deepEqual(inserted, [{ email: 'new@example.com' }]);
});

test('getOwnerId бросает понятную ошибку без OWNER_EMAIL', async () => {
  resetOwnerCache();
  delete process.env.OWNER_EMAIL;
  await assert.rejects(() => getOwnerId(), /OWNER_EMAIL не задан/);
});
