// Извлечение контактов из свободного текста (описание объявления/карточки компании).
// Работает эвристически по регуляркам — часть продавцов на Авито/в карточках 2ГИС сами
// пишут Telegram/WhatsApp в описании (в обход комиссии площадки за звонок), это самый
// надёжный источник живого контакта, надёжнее скрытого номера телефона.

const RE_TELEGRAM = /(?:^|[\s,;:()])@([a-zA-Z0-9_]{5,32})\b|t\.me\/([a-zA-Z0-9_]{5,32})/g;
const RE_WHATSAPP = /(?:wa\.me\/|whatsapp[^\d]{0,10})(\+?\d[\d\s\-()]{8,14}\d)/gi;
const RE_PHONE_RU = /(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g;
const RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normalizePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) return '+7' + digits;
  return raw.trim();
}

/**
 * Возвращает лучший найденный контакт в тексте: { channel, value } либо null, если ничего не нашли.
 * Приоритет: telegram > whatsapp > phone > email — потому что для холодного предложения
 * мессенджер конвертит лучше звонка/почты (см. обсуждение с владельцем).
 */
function extractBestContact(text) {
  if (!text) return null;

  const tgMatch = [...text.matchAll(RE_TELEGRAM)][0];
  if (tgMatch) {
    const handle = tgMatch[1] || tgMatch[2];
    if (handle) return { channel: 'telegram', value: `@${handle}` };
  }

  const waMatch = [...text.matchAll(RE_WHATSAPP)][0];
  if (waMatch) return { channel: 'whatsapp', value: normalizePhone(waMatch[1]) };

  const phoneMatch = [...text.matchAll(RE_PHONE_RU)][0];
  if (phoneMatch) return { channel: 'whatsapp', value: normalizePhone(phoneMatch[0]) };
  // Телефон кладём как whatsapp-канал по умолчанию: звонить холодно хуже, чем написать в WhatsApp
  // на тот же номер. Если нужен именно голосовой звонок — поменяйте канал вручную в дашборде.

  const emailMatch = [...text.matchAll(RE_EMAIL)][0];
  if (emailMatch) return { channel: 'email', value: emailMatch[0] };

  return null;
}

module.exports = { extractBestContact, normalizePhone };
