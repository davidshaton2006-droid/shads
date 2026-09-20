const { getSupabase } = require('./supabase');

let cachedOwnerId = null;

/**
 * Возвращает id владельца системы из таблицы owners по OWNER_EMAIL, создавая запись при первом
 * обращении. Система однопользовательская: проекты (projects.owner_id NOT NULL) и лиды
 * привязываются к этому владельцу автоматически, дашборду не нужно знать его uuid.
 */
async function getOwnerId() {
  if (cachedOwnerId) return cachedOwnerId;

  const email = process.env.OWNER_EMAIL;
  if (!email) throw new Error('OWNER_EMAIL не задан в .env');

  const supabase = getSupabase();

  const { data: existing, error: selectError } = await supabase.from('owners').select('id').eq('email', email).maybeSingle();
  if (selectError) throw new Error(`Не удалось прочитать owners: ${selectError.message}`);
  if (existing) {
    cachedOwnerId = existing.id;
    return cachedOwnerId;
  }

  const { data: created, error: insertError } = await supabase.from('owners').insert({ email }).select('id').single();
  if (insertError) throw new Error(`Не удалось создать владельца: ${insertError.message}`);
  cachedOwnerId = created.id;
  return cachedOwnerId;
}

function resetOwnerCache() {
  cachedOwnerId = null;
}

module.exports = { getOwnerId, resetOwnerCache };
