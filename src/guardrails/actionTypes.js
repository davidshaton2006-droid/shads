// Каталог write-действий, которые агент может предлагать/выполнять.
// Это runtime-зеркало таблицы action_types (supabase/migrations/0001_init.sql) — используется как
// fallback и для валидации на границе MCP-инструментов, чтобы неизвестный action_key не мог
// проскочить preflight. Источник правды по факту — таблица project_action_settings в Supabase.

const ACTION_TYPES = {
  'negative_keyword.add': { label: 'Добавление минус-слова/фразы', riskLevel: 'low', defaultRequiresConfirmation: true },
  'bid.update': { label: 'Изменение ставки', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'budget.update': { label: 'Изменение дневного/недельного бюджета', riskLevel: 'high', defaultRequiresConfirmation: true },
  'campaign.pause': { label: 'Остановка кампании', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'campaign.resume': { label: 'Запуск/возобновление кампании', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'strategy.change': { label: 'Смена стратегии ставок', riskLevel: 'high', defaultRequiresConfirmation: true },
  // ad.create поднят до 'high': создание объявления теперь включает и создание с нуля через
  // yandex_create_ads/vk_create_ad (не только правку существующего) — по требованию задачи
  // все create-инструменты first-version high-risk без исключений.
  'ad.create': { label: 'Создание объявления', riskLevel: 'high', defaultRequiresConfirmation: true },
  'ad.pause': { label: 'Остановка объявления', riskLevel: 'low', defaultRequiresConfirmation: true },
  'audience.update': { label: 'Изменение аудитории/таргетинга', riskLevel: 'medium', defaultRequiresConfirmation: true },
  'placement.exclude': { label: 'Исключение площадки (РСЯ/VK)', riskLevel: 'low', defaultRequiresConfirmation: true },
  'campaign.create': { label: 'Создание кампании', riskLevel: 'high', defaultRequiresConfirmation: true },
  'ad_group.create': { label: 'Создание группы объявлений (ключевые фразы/минус-слова/аудитории)', riskLevel: 'high', defaultRequiresConfirmation: true },
};

function isKnownActionType(key) {
  return Object.prototype.hasOwnProperty.call(ACTION_TYPES, key);
}

module.exports = { ACTION_TYPES, isKnownActionType };
