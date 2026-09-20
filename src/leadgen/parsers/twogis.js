// Поиск компаний через официальный 2ГИС Catalog API (не HTML-скрейпинг — 2ГИС жёстче Авито
// блокирует скрейпинг и явно запрещает его в правилах использования сайта). Нужен API-ключ:
// https://dev.2gis.ru — бесплатный тестовый ключ даёт ограниченное число запросов в день,
// этого достаточно для точечного поиска 10-20 компаний по нише+городу за раз, не для
// промышленного парсинга всей ниши сразу.
//
// Плюс этого источника перед Авито: 2ГИС в самой карточке компании часто отдаёт телефон и сайт
// открыто (это официально публичные бизнес-данные компании, а не приватные объявления), поэтому
// контакт находится чаще, чем в объявлениях Авито.

const API_BASE = 'https://catalog.api.2gis.com/3.0';

function getApiKey() {
  const key = process.env.TWOGIS_API_KEY;
  if (!key) {
    throw new Error(
      'TWOGIS_API_KEY не задан в .env — получите бесплатный ключ на https://dev.2gis.ru и добавьте в .env'
    );
  }
  return key;
}

async function searchTwoGis(niche, city, limit = 15) {
  const key = getApiKey();
  const url =
    `${API_BASE}/items?q=${encodeURIComponent(niche)}` +
    `&region_id=&city=${encodeURIComponent(city)}` +
    `&fields=items.contact_groups,items.point,items.address_name` +
    `&page_size=${Math.min(limit, 50)}&key=${key}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`2ГИС API ответил ${res.status}`);
  const data = await res.json();

  const items = data?.result?.items ?? [];
  const leads = [];

  for (const item of items) {
    const contactGroup = (item.contact_groups ?? [])[0];
    const phones = (contactGroup?.contacts ?? []).filter((c) => c.type === 'phone');
    const websites = (contactGroup?.contacts ?? []).filter((c) => c.type === 'website');

    let contact_channel = 'unknown';
    let contact_value = null;
    if (phones[0]) {
      contact_channel = 'whatsapp'; // см. extractContacts.js — телефон по умолчанию трактуем как WhatsApp-канал
      contact_value = phones[0].value;
    } else if (websites[0]) {
      contact_channel = 'unknown';
      contact_value = websites[0].value;
    }

    leads.push({
      source: 'twogis',
      source_url: `https://2gis.ru/firm/${item.id}`,
      company_name: item.name || 'Без названия',
      contact_channel,
      contact_value,
      raw_snippet: item.address_name || '',
    });
  }

  return leads;
}

module.exports = { searchTwoGis };
