const { findLeads, listLeads, updateLead, regenerateDraft } = require('../../leadgen/service');

// Лидген-инструменты для агента. ВАЖНО: здесь нет write-инструмента "отправить сообщение" —
// это осознанно (см. README, раздел "Лидген"): агент готовит контакт+черновик, отправляет
// человек. Не добавляйте send-инструмент без обсуждения с владельцем — это меняет модель рисков
// всего модуля (спам/бан аккаунтов, см. обсуждение в чате).

const tools = [
  {
    name: 'leadgen_find',
    description:
      'Ищет потенциальных клиентов (компании) в открытых источниках (Авито, 2ГИС) по нише и городу, ' +
      'сохраняет новых (без дублей) и сразу готовит черновик сообщения для каждого. Не отправляет ничего — ' +
      'только находит и готовит черновики для ручной отправки владельцем.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_id: { type: 'string' },
        niche: { type: 'string', description: 'Например: "ремонт квартир", "стоматология", "юридические услуги"' },
        city: { type: 'string' },
        source: { type: 'string', enum: ['avito', 'twogis'] },
        limit: { type: 'number', description: 'Максимум объявлений/карточек за один запуск, по умолчанию 15' },
      },
      required: ['owner_id', 'niche', 'city', 'source'],
    },
    riskLevel: 'read', // сам по себе поиск ничего не меняет вовне, только пишет в свою БД
    handler: async ({ owner_id, niche, city, source, limit }) => {
      const leads = await findLeads({ ownerId: owner_id, niche, city, source, limit });
      return {
        content: [
          {
            type: 'text',
            text: `Найдено и сохранено новых лидов: ${leads.length}. Черновики сообщений готовы, отправка — вручную из дашборда.`,
          },
        ],
      };
    },
  },
  {
    name: 'leadgen_list',
    description: 'Показывает сохранённые лиды с фильтрами по статусу/нише/городу.',
    inputSchema: {
      type: 'object',
      properties: {
        owner_id: { type: 'string' },
        status: { type: 'string', enum: ['new', 'drafted', 'contacted', 'replied', 'client', 'rejected', 'duplicate'] },
        niche: { type: 'string' },
        city: { type: 'string' },
      },
      required: [],
    },
    riskLevel: 'read',
    handler: async (args) => ({ content: [{ type: 'text', text: JSON.stringify(await listLeads(args), null, 2) }] }),
  },
  {
    name: 'leadgen_update_status',
    description: 'Обновляет статус лида (например, contacted после ручной отправки, replied, client, rejected).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['new', 'drafted', 'contacted', 'replied', 'client', 'rejected', 'duplicate'] },
        notes: { type: 'string' },
      },
      required: ['id', 'status'],
    },
    riskLevel: 'write',
    handler: async ({ id, status, notes }) => {
      const patch = { status, notes };
      if (status === 'contacted') patch.contacted_at = new Date().toISOString();
      const lead = await updateLead(id, patch);
      return { content: [{ type: 'text', text: JSON.stringify(lead, null, 2) }] };
    },
  },
  {
    name: 'leadgen_regenerate_draft',
    description: 'Перегенерирует черновик сообщения для лида (если старый не понравился).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    riskLevel: 'write',
    handler: async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await regenerateDraft(id), null, 2) }] }),
  },
];

module.exports = { tools };
