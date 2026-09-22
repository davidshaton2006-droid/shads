// Парсер объявлений Авито для лидгена: ищет объявления по нише+городу в категории "Бизнес/Услуги"
// (или профильной категории ниши) и вытаскивает из описания контакт (см. extractContacts.js).
//
// ЧЕСТНО ПРО ОГРАНИЧЕНИЯ (важно не переоценивать этот модуль):
// 1. Авито прячет номер телефона за отдельным защищённым эндпоинтом (капча/подпись запроса) —
//    простым HTML-скрейпингом номер не достать. Работает только если продавец сам указал
//    Telegram/WhatsApp/почту в тексте объявления — так делает заметная часть частных мастеров
//    и малого бизнеса, но не все.
// 2. Авито меняет вёрстку страниц без предупреждения — селекторы ниже нужно будет поправлять,
//    когда парсинг перестанет находить объявления (проверяйте raw HTML в логе при 0 результатах).
// 3. Массовый скрейпинг с одного IP Авито банит по rate-limit/капче — здесь намеренно стоит
//    задержка между запросами и низкий лимит объявлений за один запуск. Не увеличивайте
//    агрессивно, иначе IP уйдёт в бан и парсинг перестанет работать вообще.
// 4. Это скрейпинг публичных страниц, а не официальный Avito API — используйте на свой риск и
//    не для целей, которые сам Авито явно запрещает в пользовательском соглашении.

const { extractBestContact } = require('../extractContacts');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Avito ответил ${res.status} для ${url}`);
  return res.text();
}

// Достаточно грубый парсинг ссылок на карточки объявлений из результатов поиска — Авито отдаёт
// серверный HTML с data-атрибутами на карточках. Селектор ниже — рабочий на момент написания,
// но именно он первым ломается при обновлении вёрстки Авито (см. п.2 выше).
function extractListingLinks(html, limit) {
  const links = new Set();
  const re = /href="(\/[a-z0-9_-]+\/[a-z0-9_-]+\/[a-z0-9_-]+_\d+)"/gi;
  let m;
  while ((m = re.exec(html)) && links.size < limit) {
    links.add(`https://www.avito.ru${m[1]}`);
  }
  return [...links];
}

function extractTitle(html) {
  const m = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  return m ? m[1].trim() : null;
}

function extractDescription(html) {
  // Описание объявления обычно в <div data-marker="item-view/item-description">...</div>
  const m = html.match(/data-marker="item-view\/item-description"[^>]*>([\s\S]{0,4000}?)<\/div>/i);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ищет объявления Авито по нише+городу и возвращает лиды с найденным (если повезло) контактом.
 * @param {string} niche - например "ремонт квартир", "стоматология", "юридические услуги"
 * @param {string} city - например "Краснодар"
 * @param {number} limit - сколько объявлений максимум обработать за один запуск (держите 10-20)
 */
// Авито использует латинские слаги городов в пути URL (/moskva?q=...), кириллица даёт 404.
// Слаги крупных городов заданы явно (у части есть дефисы/подчёркивания, транслитерацией их не
// угадать); для остальных используется приблизительная транслитерация — если город не находится
// (404), добавьте его сюда.
const AVITO_CITY_SLUGS = {
  москва: 'moskva',
  'санкт-петербург': 'sankt-peterburg',
  петербург: 'sankt-peterburg',
  краснодар: 'krasnodar',
  екатеринбург: 'ekaterinburg',
  новосибирск: 'novosibirsk',
  казань: 'kazan',
  'нижний новгород': 'nizhniy_novgorod',
  самара: 'samara',
  уфа: 'ufa',
  челябинск: 'chelyabinsk',
  'ростов-на-дону': 'rostov-na-donu',
  воронеж: 'voronezh',
  пермь: 'perm',
  волгоград: 'volgograd',
  красноярск: 'krasnoyarsk',
  омск: 'omsk',
  сочи: 'sochi',
  тюмень: 'tyumen',
  саратов: 'saratov',
};

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function cityToAvitoSlug(city) {
  const key = city.trim().toLowerCase();
  if (AVITO_CITY_SLUGS[key]) return AVITO_CITY_SLUGS[key];
  return key
    .split('')
    .map((ch) => (TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/\s+/g, '_');
}

async function searchAvito(niche, city, limit = 15) {
  const query = encodeURIComponent(niche);
  const searchUrl = `https://www.avito.ru/${encodeURIComponent(cityToAvitoSlug(city))}?q=${query}`;

  const searchHtml = await fetchHtml(searchUrl);
  const listingUrls = extractListingLinks(searchHtml, limit);

  const leads = [];
  for (const url of listingUrls) {
    try {
      const html = await fetchHtml(url);
      const title = extractTitle(html);
      const description = extractDescription(html);
      const contact = extractBestContact(description);

      leads.push({
        source: 'avito',
        source_url: url,
        company_name: title || 'Без названия',
        contact_channel: contact?.channel ?? 'unknown',
        contact_value: contact?.value ?? null,
        raw_snippet: description.slice(0, 500),
      });
    } catch (err) {
      console.warn(`[LEADGEN] Пропуск объявления ${url}: ${err.message}`);
    }
    await sleep(1500 + Math.random() * 1500); // держим темп «человеческого» листания, не долбим сайт
  }

  return leads;
}

module.exports = { searchAvito, cityToAvitoSlug };
