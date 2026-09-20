// Генератор черновика предложения о сотрудничестве под конкретный лид.
// Черновик — ТОЛЬКО текст для ручного просмотра/правки/отправки владельцем (см. README,
// раздел "Лидген"): система не отправляет ничего сама.
//
// Если задан ANTHROPIC_API_KEY — черновик пишет модель (более живой, учитывает raw_snippet
// лида). Без ключа — используется набор ручных шаблонов с ротацией и подстановкой, этого
// достаточно для старта и не требует лишних затрат на API.

const TEMPLATES = [
  ({ companyName, niche, city }) =>
    `Здравствуйте! Увидел вашу компанию (${companyName}) в нише «${niche}» в ${city}. ` +
    `Работаю с похожими проектами по настройке рекламы (Авито, Яндекс.Директ, VK Ads) — ` +
    `могу коротко показать, что можно улучшить в текущем продвижении именно у вас. Интересно?`,
  ({ companyName, niche, city }) =>
    `Добрый день! Подскажите, вы сами занимаетесь рекламой (${companyName}) или отдаёте на аутсорс? ` +
    `Смотрю на ниши вроде «${niche}» в ${city} — часто вижу, что бюджет расходуется не туда. ` +
    `Готов бесплатно разобрать вашу текущую рекламу за 10 минут, без обязательств.`,
  ({ companyName, niche, city }) =>
    `Здравствуйте! Меня зовут Давид, занимаюсь комплексным маркетингом (Авито + Яндекс.Директ + VK Ads) ` +
    `для бизнеса в ${city}. Заметил ${companyName} — если сейчас ведёте рекламу сами, могу показать ` +
    `пару быстрых точек роста по нише «${niche}» без давления и звонков, только по делу.`,
];

function templateDraft(lead) {
  const fn = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  return fn({ companyName: lead.company_name, niche: lead.niche, city: lead.city });
}

async function llmDraft(lead) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const prompt =
    `Напиши короткое (3-4 предложения), живое, не спамное холодное сообщение для владельца бизнеса ` +
    `"${lead.company_name}" в нише "${lead.niche}" (город ${lead.city}). ` +
    `Контекст, который известен про компанию: ${lead.raw_snippet || 'нет доп. контекста'}. ` +
    `Отправитель — маркетолог, предлагает настройку/ведение рекламы на Авито, Яндекс.Директ и VK Ads. ` +
    `Тон: уважительный, без "уникального предложения" и канцелярита, без эмодзи через одно слово, ` +
    `как будто пишет живой человек, а не рассылка. Не используй фразы "не упустите шанс", ` +
    `"специально для вас", восклицательные знаки через предложение. Ответь только текстом сообщения.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ответил ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text?.trim() ?? templateDraft(lead);
}

/**
 * @param {object} lead - { company_name, niche, city, raw_snippet }
 * @returns {Promise<string>} черновик сообщения
 */
async function generateDraft(lead) {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await llmDraft(lead);
    } catch (err) {
      console.warn('[LEADGEN] LLM-черновик не удался, использую шаблон:', err.message);
    }
  }
  return templateDraft(lead);
}

module.exports = { generateDraft };
