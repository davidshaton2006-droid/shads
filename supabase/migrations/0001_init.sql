-- SHADS initial schema
-- Приватная система управления рекламой (Яндекс.Директ / VK Ads) на собственных OAuth-доступах.
-- Все write-действия агента логируются в action_log; лимиты и стоп-краны хранятся отдельно от кода агента,
-- потому что жёсткий лимит бюджета должен быть продублирован на стороне площадки (см. guardrails в README).

create extension if not exists "pgcrypto";

-- Пользователь системы (в MVP — один владелец, но таблица оставлена для будущей многопользовательности)
create table if not exists owners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

-- Проект/клиент, на который ведётся реклама
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references owners(id) on delete cascade,
  name text not null,
  goal_type text not null check (goal_type in ('cpa', 'roas', 'leads')),
  goal_value numeric,                       -- целевой CPA / ROAS / кол-во лидов
  daily_budget_limit numeric not null,      -- дублируется в настройках площадки, это не единственная защита
  currency text not null default 'RUB',
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- OAuth-подключения к рекламным площадкам (per project или per owner)
create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  provider text not null check (provider in ('yandex_direct', 'yandex_metrika', 'vk_ads')),
  external_account_id text,                 -- client_login / account_id на стороне площадки
  access_token_encrypted text not null,     -- зашифровано на уровне приложения (см. src/lib/encryption.js)
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

-- Цели Яндекс.Метрики / событий VK пикселя, привязанные к проекту
create table if not exists conversion_goals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  provider text not null check (provider in ('yandex_metrika', 'vk_ads')),
  external_goal_id text not null,
  name text not null,
  is_primary boolean not null default false, -- основная цель для расчёта CPA / стоп-крана
  created_at timestamptz not null default now()
);

-- Каталог типов write-действий и их автономности (staged autonomy).
-- По умолчанию всё requires_confirmation = true. Владелец переключает конкретный тип на автономный
-- явно, через дашборд — агент не может сам себе выдать автономию.
create table if not exists action_types (
  key text primary key,               -- например 'bid.update', 'budget.update', 'campaign.pause'
  label text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  default_requires_confirmation boolean not null default true
);

insert into action_types (key, label, risk_level, default_requires_confirmation) values
  ('negative_keyword.add', 'Добавление минус-слова / минус-фразы', 'low', true),
  ('bid.update', 'Изменение ставки', 'medium', true),
  ('budget.update', 'Изменение дневного/недельного бюджета', 'high', true),
  ('campaign.pause', 'Остановка кампании', 'medium', true),
  ('campaign.resume', 'Запуск/возобновление кампании', 'medium', true),
  ('strategy.change', 'Смена стратегии ставок', 'high', true),
  ('ad.create', 'Создание объявления', 'medium', true),
  ('ad.pause', 'Остановка объявления', 'low', true),
  ('audience.update', 'Изменение аудитории/таргетинга', 'medium', true),
  ('placement.exclude', 'Исключение площадки (РСЯ/VK)', 'low', true)
on conflict (key) do nothing;

-- Настройка автономии конкретного типа действия для конкретного проекта.
-- Отсутствие строки == используется default_requires_confirmation из action_types (то есть true).
create table if not exists project_action_settings (
  project_id uuid not null references projects(id) on delete cascade,
  action_key text not null references action_types(key),
  requires_confirmation boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (project_id, action_key)
);

-- Стоп-краны: правила автоматической паузы, независимые от решений агента
create table if not exists stop_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  rule_type text not null check (rule_type in ('cpa_ceiling', 'spend_no_conversions_pct')),
  threshold numeric not null,           -- для cpa_ceiling: макс. CPA в валюте; для spend_no_conversions_pct: % дневного бюджета
  window_hours integer not null default 24,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Очередь действий, ожидающих/прошедших preflight-подтверждение
create table if not exists pending_actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  action_key text not null references action_types(key),
  provider text not null check (provider in ('yandex_direct', 'vk_ads')),
  payload jsonb not null,               -- параметры вызова (campaign_id, new_bid, и т.д.)
  reasoning text,                       -- объяснение агента, почему предлагается это действие
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,                      -- 'owner' или 'auto' (для автономных типов)
  executed_at timestamptz,
  error text
);

-- Лог всех фактических write-действий (после выполнения), с возможностью просмотра/отката
create table if not exists action_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  pending_action_id uuid references pending_actions(id),
  action_key text not null,
  provider text not null,
  payload jsonb not null,
  previous_state jsonb,                 -- значение до изменения, для отката
  result jsonb,
  status text not null check (status in ('success', 'failed', 'rolled_back')),
  executed_at timestamptz not null default now()
);

-- Срабатывания стоп-крана
create table if not exists stop_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  stop_rule_id uuid not null references stop_rules(id),
  triggered_at timestamptz not null default now(),
  metric_value numeric not null,
  action_taken text not null default 'campaign_paused',
  acknowledged boolean not null default false
);

create index if not exists idx_pending_actions_project_status on pending_actions(project_id, status);
create index if not exists idx_action_log_project on action_log(project_id, executed_at desc);
create index if not exists idx_stop_events_project on stop_events(project_id, triggered_at desc);
