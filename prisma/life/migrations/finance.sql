-- Finance tables for the Life app. Apply with `npm run life:db:push` (Prisma)
-- or paste into the Supabase SQL editor for the Life project.

create extension if not exists "uuid-ossp";

create table if not exists life_finance_categories (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid not null references life_users(id) on delete cascade,
  name                  text not null,
  slug                  text not null,
  kind                  text not null check (kind in ('expense','income')),
  color                 text not null default '#6c63ff',
  icon                  text not null default '💸',
  monthly_budget_cents  integer not null default 0,
  sort_order            integer not null default 0,
  archived              boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists life_finance_categories_user_kind_idx
  on life_finance_categories (user_id, kind);

create table if not exists life_finance_transactions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references life_users(id) on delete cascade,
  workspace_id    uuid references life_workspaces(id) on delete set null,
  category_id     uuid references life_finance_categories(id) on delete set null,
  amount_cents    integer not null,
  currency        text not null default 'INR',
  kind            text not null check (kind in ('expense','income')),
  note            text,
  payment_method  text,
  occurred_at     timestamptz not null,
  tags            jsonb not null default '[]',
  recurring       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists life_finance_transactions_user_occurred_idx
  on life_finance_transactions (user_id, occurred_at desc);

create index if not exists life_finance_transactions_user_category_idx
  on life_finance_transactions (user_id, category_id);
