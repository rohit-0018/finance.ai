-- ────────────────────────────────────────────────────────────────────────────
-- Life Phase 0 migration — workspaces, timestamps on tasks, discipline tables
-- Run this on the Life Supabase DB BEFORE `npm run life:db:push`.
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────
begin;

create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add active_workspace_id to life_users
-- ────────────────────────────────────────────────────────────────────────────
alter table life_users
  add column if not exists active_workspace_id uuid;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. life_workspaces — one per (user, kind). Seed "personal" + "work" for
--    every existing user so legacy data has a home.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists life_workspaces (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  kind          text not null,
  name          text not null,
  accent_color  text not null default '#6c63ff',
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint life_workspaces_user_kind_uk unique (user_id, kind)
);
create index if not exists life_workspaces_user_idx on life_workspaces(user_id);

insert into life_workspaces (user_id, kind, name, accent_color)
select u.id, 'personal', 'Personal', '#6c63ff'
from life_users u
on conflict (user_id, kind) do nothing;

insert into life_workspaces (user_id, kind, name, accent_color)
select u.id, 'work', 'Work', '#0ea5e9'
from life_users u
on conflict (user_id, kind) do nothing;

update life_users u
set active_workspace_id = w.id
from life_workspaces w
where w.user_id = u.id
  and w.kind = 'personal'
  and u.active_workspace_id is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Scope existing tables by workspace_id. Add nullable → backfill → NOT NULL.
--    Backfill rule: map by life_projects.category — 'office' → work, else personal.
--    For rows without a project link, default to 'personal'.
-- ────────────────────────────────────────────────────────────────────────────

-- goals
alter table life_goals        add column if not exists workspace_id uuid;
alter table life_goals        add column if not exists horizon_id   uuid;
update life_goals g
set workspace_id = (
  select w.id from life_workspaces w
  where w.user_id = g.user_id
    and w.kind = case when g.category = 'office' then 'work' else 'personal' end
)
where g.workspace_id is null;
alter table life_goals        alter column workspace_id set not null;
create index if not exists life_goals_workspace_status_idx on life_goals(workspace_id, status);

-- projects
alter table life_projects     add column if not exists workspace_id uuid;
alter table life_projects     add column if not exists definition_of_done text;
alter table life_projects     add column if not exists contract_mode boolean not null default false;
alter table life_projects     add column if not exists brainstorm_id uuid;
update life_projects p
set workspace_id = (
  select w.id from life_workspaces w
  where w.user_id = p.user_id
    and w.kind = case when p.category = 'office' then 'work' else 'personal' end
)
where p.workspace_id is null;
alter table life_projects     alter column workspace_id set not null;
create index if not exists life_projects_workspace_status_idx on life_projects(workspace_id, status);

-- tasks
alter table life_tasks add column if not exists workspace_id      uuid;
alter table life_tasks add column if not exists start_at          timestamptz;
alter table life_tasks add column if not exists actual_min        integer;
alter table life_tasks add column if not exists when_where        text;
alter table life_tasks add column if not exists first_action      text;
alter table life_tasks add column if not exists hard_start        boolean not null default false;
alter table life_tasks add column if not exists depends_on        uuid[] not null default '{}';
alter table life_tasks add column if not exists automation        jsonb not null default '{}'::jsonb;
alter table life_tasks add column if not exists origin_message_id uuid;
alter table life_tasks add column if not exists plan_id           uuid;
alter table life_tasks add column if not exists google_event_id   text;
update life_tasks t
set workspace_id = coalesce(
  (select p.workspace_id from life_projects p where p.id = t.project_id),
  (select w.id from life_workspaces w where w.user_id = t.user_id and w.kind = 'personal')
)
where t.workspace_id is null;
alter table life_tasks alter column workspace_id set not null;
create index if not exists life_tasks_workspace_status_idx on life_tasks(workspace_id, status);
create index if not exists life_tasks_user_start_idx on life_tasks(user_id, start_at);
create index if not exists life_tasks_user_due_idx on life_tasks(user_id, due_at);

-- notifications
alter table life_notifications add column if not exists workspace_id uuid;
update life_notifications n
set workspace_id = (
  select w.id from life_workspaces w where w.user_id = n.user_id and w.kind = 'personal'
)
where n.workspace_id is null;
alter table life_notifications alter column workspace_id set not null;
create index if not exists life_notifications_workspace_read_idx on life_notifications(workspace_id, read, created_at);

-- agent messages
alter table life_agent_messages add column if not exists workspace_id  uuid;
alter table life_agent_messages add column if not exists brainstorm_id uuid;
update life_agent_messages m
set workspace_id = coalesce(
  (select p.workspace_id from life_projects p where p.id = m.project_id),
  (select w.id from life_workspaces w where w.user_id = m.user_id and w.kind = 'personal')
)
where m.workspace_id is null;
alter table life_agent_messages alter column workspace_id set not null;
create index if not exists life_agent_messages_workspace_idx on life_agent_messages(workspace_id, created_at);
create index if not exists life_agent_messages_brainstorm_idx on life_agent_messages(brainstorm_id, created_at);

-- time blocks
alter table life_time_blocks add column if not exists workspace_id uuid;
alter table life_time_blocks add column if not exists google_event_id text;
update life_time_blocks b
set workspace_id = (
  select w.id from life_workspaces w where w.user_id = b.user_id and w.kind = 'personal'
)
where b.workspace_id is null;
alter table life_time_blocks alter column workspace_id set not null;
create index if not exists life_time_blocks_workspace_date_idx on life_time_blocks(workspace_id, date);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. New tables: brainstorms, plans, values, horizons, waiting_on, learnings,
--    stakes, drops, estimates, capacity, memory, integrations.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists life_brainstorms (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  workspace_id  uuid not null references life_workspaces(id) on delete cascade,
  title         text not null,
  phase         text not null default 'goal',
  status        text not null default 'open',
  summary       text,
  context       jsonb not null default '{}'::jsonb,
  project_id    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  committed_at  timestamptz
);
create index if not exists life_brainstorms_user_status_idx on life_brainstorms(user_id, status);
create index if not exists life_brainstorms_workspace_status_idx on life_brainstorms(workspace_id, status);

create table if not exists life_plans (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  brainstorm_id uuid not null references life_brainstorms(id) on delete cascade,
  project_id    uuid references life_projects(id) on delete set null,
  version       integer not null default 1,
  status        text not null default 'draft',
  snapshot      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz
);
create index if not exists life_plans_brainstorm_version_idx on life_plans(brainstorm_id, version);
create index if not exists life_plans_user_status_idx on life_plans(user_id, status);

-- late-bind the FK on life_tasks.plan_id and life_projects.brainstorm_id
do $$ begin
  alter table life_tasks
    add constraint life_tasks_plan_fk foreign key (plan_id)
    references life_plans(id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table life_projects
    add constraint life_projects_brainstorm_fk foreign key (brainstorm_id)
    references life_brainstorms(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists life_values (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references life_users(id) on delete cascade,
  title       text not null,
  description text,
  weight      integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists life_values_user_idx on life_values(user_id);

create table if not exists life_horizons (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references life_users(id) on delete cascade,
  kind        text not null,
  title       text not null,
  why         text,
  target_date timestamptz,
  parent_id   uuid references life_horizons(id) on delete set null,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists life_horizons_user_kind_status_idx on life_horizons(user_id, kind, status);

do $$ begin
  alter table life_goals
    add constraint life_goals_horizon_fk foreign key (horizon_id)
    references life_horizons(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists life_waiting_on (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  workspace_id  uuid not null references life_workspaces(id) on delete cascade,
  task_id       uuid references life_tasks(id) on delete set null,
  title         text not null,
  who           text not null,
  asked_at      timestamptz not null default now(),
  sla_days      integer not null default 2,
  follow_up_at  timestamptz not null,
  status        text not null default 'waiting',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists life_waiting_on_user_status_idx on life_waiting_on(user_id, status, follow_up_at);
create index if not exists life_waiting_on_workspace_idx on life_waiting_on(workspace_id, status);

create table if not exists life_learnings (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references life_users(id) on delete cascade,
  workspace_id    uuid not null references life_workspaces(id) on delete cascade,
  content         text not null,
  source_url      text,
  source_type     text not null default 'manual',
  source_ref      text,
  interval_days   integer not null default 3,
  next_review_at  timestamptz not null,
  review_count    integer not null default 0,
  ease            double precision not null default 2.5,
  archived        boolean not null default false,
  action_deadline timestamptz,
  became_task_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists life_learnings_user_review_idx on life_learnings(user_id, archived, next_review_at);
create index if not exists life_learnings_workspace_idx on life_learnings(workspace_id, archived);

create table if not exists life_stakes (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references life_users(id) on delete cascade,
  task_id      uuid references life_tasks(id) on delete set null,
  project_id   uuid references life_projects(id) on delete set null,
  kind         text not null,
  amount_cents integer,
  description  text not null,
  partner      text,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists life_stakes_user_status_idx on life_stakes(user_id, status);

create table if not exists life_drops (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references life_users(id) on delete cascade,
  kind       text not null,
  ref_id     uuid not null,
  title      text not null,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index if not exists life_drops_user_kind_idx on life_drops(user_id, kind, created_at);

create table if not exists life_estimates (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  task_id       uuid not null references life_tasks(id) on delete cascade,
  estimated_min integer not null,
  actual_min    integer not null,
  created_at    timestamptz not null default now()
);
create index if not exists life_estimates_user_created_idx on life_estimates(user_id, created_at);

create table if not exists life_capacity (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  date          text not null,
  ceiling_min   integer not null,
  committed_min integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint life_capacity_user_date_uk unique (user_id, date)
);

create table if not exists life_memory (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references life_users(id) on delete cascade,
  workspace_id uuid references life_workspaces(id) on delete cascade,
  key          text not null,
  value        text not null,
  source       text not null default 'user',
  confidence   double precision not null default 1.0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint life_memory_user_workspace_key_uk unique (user_id, workspace_id, key)
);
create index if not exists life_memory_user_idx on life_memory(user_id);

create table if not exists life_integrations (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references life_users(id) on delete cascade,
  provider      text not null,
  access_token  text not null,
  refresh_token text,
  scope         text,
  expires_at    timestamptz,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint life_integrations_user_provider_uk unique (user_id, provider)
);

-- Late FKs for workspace_id columns we added to legacy tables
do $$ begin
  alter table life_goals          add constraint life_goals_workspace_fk          foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_projects       add constraint life_projects_workspace_fk       foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_tasks          add constraint life_tasks_workspace_fk          foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_notifications  add constraint life_notifications_workspace_fk  foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_agent_messages add constraint life_agent_messages_workspace_fk foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_agent_messages add constraint life_agent_messages_brainstorm_fk foreign key (brainstorm_id) references life_brainstorms(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table life_time_blocks    add constraint life_time_blocks_workspace_fk    foreign key (workspace_id) references life_workspaces(id) on delete cascade;
exception when duplicate_object then null; end $$;

commit;
