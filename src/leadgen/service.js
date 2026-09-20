const { getSupabase } = require('../lib/supabase');
const { searchAvito } = require('./parsers/avito');
const { searchTwoGis } = require('./parsers/twogis');
const { generateDraft } = require('./draftGenerator');

const SOURCES = { avito: searchAvito, twogis: searchTwoGis };

/**
 * Ищет лиды в указанном источнике по нише+городу, сохраняет новые (пропуская дубли по source_url),
 * сразу генерирует черновик для каждого нового лида. Возвращает только реально новые записи —
 * если источник вернул объявление, которое уже есть в базе (unique index на source_url), оно
 * тихо пропускается, чтобы не заваливать дашборд повторами при повторном запуске поиска.
 */
async function findLeads({ ownerId, niche, city, source, limit }) {
  const searchFn = SOURCES[source];
  if (!searchFn) throw new Error(`Неизвестный источник лидов: ${source}`);

  const found = await searchFn(niche, city, limit ?? 15);
  const supabase = getSupabase();
  const saved = [];

  for (const raw of found) {
    const draft = await generateDraft({ ...raw, niche, city });

    const { data, error } = await supabase
      .from('leads')
      .insert({
        owner_id: ownerId,
        niche,
        city,
        source: raw.source,
        source_url: raw.source_url,
        company_name: raw.company_name,
        contact_channel: raw.contact_channel,
        contact_value: raw.contact_value,
        raw_snippet: raw.raw_snippet,
        draft_message: draft,
        status: 'drafted',
      })
      .select()
      .maybeSingle();

    if (error) {
      // Конфликт unique-индекса по source_url — значит лид уже есть, это не ошибка, а ожидаемый дубль
      if (error.code === '23505') continue;
      console.warn('[LEADGEN] Не удалось сохранить лид:', error.message);
      continue;
    }
    if (data) saved.push(data);
  }

  return saved;
}

async function listLeads({ ownerId, status, niche, city }) {
  const supabase = getSupabase();
  let query = supabase.from('leads').select('*').order('found_at', { ascending: false });
  if (ownerId) query = query.eq('owner_id', ownerId);
  if (status) query = query.eq('status', status);
  if (niche) query = query.eq('niche', niche);
  if (city) query = query.eq('city', city);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function updateLead(id, patch) {
  const supabase = getSupabase();
  const allowed = ['status', 'notes', 'draft_message', 'contacted_at'];
  const update = { updated_at: new Date().toISOString() };
  for (const key of allowed) if (patch[key] !== undefined) update[key] = patch[key];

  const { data, error } = await supabase.from('leads').update(update).eq('id', id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function regenerateDraft(id) {
  const supabase = getSupabase();
  const { data: lead, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead) throw new Error('Лид не найден');

  const draft = await generateDraft(lead);
  return updateLead(id, { draft_message: draft });
}

module.exports = { findLeads, listLeads, updateLead, regenerateDraft };
