-- Привязка кампаний площадок к проектам SHADS.
--
-- Проблема, которую это закрывает: когда несколько клиентов ведутся в одном рекламном аккаунте
-- (один OAuth-токен), SHADS читал ВСЕ кампании аккаунта для каждого проекта — стоп-кран одного
-- клиента ставил на паузу кампании другого, а расход/CPA считались суммарно. Теперь каждая
-- кампания принадлежит ровно одному проекту, и чтение, отчёты, пауза и запись идут только по своим.

create table if not exists project_campaigns (
  project_id uuid not null references projects(id) on delete cascade,
  provider text not null check (provider in ('yandex_direct', 'vk_ads')),
  external_campaign_id text not null,
  created_at timestamptz not null default now(),
  -- кампания в рамках площадки принадлежит только одному проекту
  primary key (provider, external_campaign_id)
);

create index if not exists idx_project_campaigns_project on project_campaigns(project_id, provider);

alter table project_campaigns enable row level security;
