const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в .env');
    // service_role ключ используется только на бэкенде (никогда не отдаётся в дашборд/браузер) —
    // весь доступ клиента идёт через наши же express-роуты.
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getSupabase };
