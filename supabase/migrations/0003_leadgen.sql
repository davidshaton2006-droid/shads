-- Модуль поиска клиентов (лидген): сбор компаний из открытых источников (Авито, 2ГИС/Яндекс.Карты,
-- сайты) по нише/городу, генерация персонализированного черновика предложения о сотрудничестве.
--
-- ВАЖНО (см. README раздел "Лидген"): отправка сообщений остаётся ручной — владелец сам открывает
-- канал (Telegram/WhatsApp/почта) у себя и копирует готовый черновик. Система не рассылает
-- автоматически и не имитирует живого человека программно — это осознанное ограничение, а не
-- недоработка, см. обоснование в README.

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references owners(id) on delete cascade,
  niche text not null,                  -- ниша, например 'недвижимость', 'ремонт и строительство'
  city text not null,
  source text not null check (source in ('avito', 'twogis', 'yandex_maps', 'manual')),
  source_url text,                      -- ссылка на объявление/карточку компании, откуда взяли лид
  company_name text not null,
  contact_channel text check (contact_channel in ('telegram', 'whatsapp', 'email', 'phone', 'unknown')),
  contact_value text,                   -- @username / номер / email — то, что реально нашли
  raw_snippet text,                     -- кусок исходного текста (описание/шапка объявления), даёт контекст для черновика
  draft_message text,                   -- сгенерированный черновик предложения (редактируется владельцем перед отправкой)
  status text not null default 'new' check (
    status in ('new', 'drafted', 'contacted', 'replied', 'client', 'rejected', 'duplicate')
  ),
  notes text,                           -- заметки владельца (например, почему rejected)
  found_at timestamptz not null default now(),
  contacted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_owner_status on leads(owner_id, status);
create index if not exists idx_leads_niche_city on leads(niche, city);

-- Защита от повторной обработки одного и того же объявления/карточки при повторном поиске
create unique index if not exists idx_leads_source_url_unique on leads(source_url) where source_url is not null;
