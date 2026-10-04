const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase } = require('./helpers/fakeSupabase');

let currentFake;
const supabasePath = require.resolve('../src/lib/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { getSupabase: () => currentFake } };

const { bindCampaign, assertCampaignInProject, bindCreatedYandexCampaign, getBoundCampaignIds } = require('../src/lib/campaignBinding');

test('bindCampaign привязывает свободную кампанию (id приводится к строке)', async () => {
  const inserted = [];
  currentFake = createFakeSupabase({
    project_campaigns: (state) => {
      if (state.op === 'insert') {
        inserted.push(state.payload);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  });
  await bindCampaign('p1', 'yandex_direct', 714687203);
  assert.deepEqual(inserted, [{ project_id: 'p1', provider: 'yandex_direct', external_campaign_id: '714687203' }]);
});

test('bindCampaign идемпотентен для того же проекта и отказывает, если кампания у другого проекта', async () => {
  let inserts = 0;
  currentFake = createFakeSupabase({
    project_campaigns: (state) => {
      if (state.op === 'insert') {
        inserts += 1;
        return { data: null, error: null };
      }
      return { data: { project_id: 'p1' }, error: null };
    },
  });
  await bindCampaign('p1', 'yandex_direct', 1); // уже у p1 — ничего не делаем
  assert.equal(inserts, 0);
  await assert.rejects(() => bindCampaign('p2', 'yandex_direct', 1), /уже привязана к другому проекту/);
});

test('assertCampaignInProject пропускает свою кампанию и отклоняет чужую', async () => {
  currentFake = createFakeSupabase({
    project_campaigns: () => ({ data: [{ external_campaign_id: '10' }], error: null }),
  });
  await assert.doesNotReject(() => assertCampaignInProject('p1', 'yandex_direct', 10));
  await assert.rejects(() => assertCampaignInProject('p1', 'yandex_direct', 11), /не привязана к этому проекту/);
  assert.deepEqual(await getBoundCampaignIds('p1', 'yandex_direct'), ['10']);
});

test('bindCreatedYandexCampaign берёт Id из AddResults и падает, если Директ его не вернул', async () => {
  const inserted = [];
  currentFake = createFakeSupabase({
    project_campaigns: (state) => {
      if (state.op === 'insert') inserted.push(state.payload);
      return { data: null, error: null };
    },
  });
  await bindCreatedYandexCampaign('p1', { AddResults: [{ Id: 555, Errors: [] }] });
  assert.equal(inserted[0].external_campaign_id, '555');
  await assert.rejects(() => bindCreatedYandexCampaign('p1', { AddResults: [{ Errors: [{ Code: 1 }] }] }), /не вернул Id/);
});
