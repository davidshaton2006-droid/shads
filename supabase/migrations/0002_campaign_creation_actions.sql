-- Новые типы действий: создание кампаний/групп объявлений (см. src/mcp/tools/yandex.js,
-- src/mcp/tools/vk.js — yandex_create_campaign, yandex_create_ad_group_with_keywords,
-- vk_create_campaign, vk_create_ad_group). Все — high-risk, requires_confirmation по умолчанию
-- true без исключений в первой версии (project_action_settings может это переопределить только
-- вручную из дашборда).

insert into action_types (key, label, risk_level, default_requires_confirmation) values
  ('campaign.create', 'Создание кампании', 'high', true),
  ('ad_group.create', 'Создание группы объявлений (ключевые фразы/минус-слова/аудитории)', 'high', true)
on conflict (key) do nothing;

-- ad.create теперь покрывает и создание объявлений с нуля (не только правку) — поднимаем риск.
update action_types set risk_level = 'high' where key = 'ad.create';
