-- Lending and borrowing tracker. One row per loan you've extended to or taken
-- from someone. Partial repayments live in the `payments` jsonb array so we
-- don't need a join table; outstanding is computed in app code as
-- principal - sum(payments).

create extension if not exists "uuid-ossp";

create table if not exists life_finance_loans (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references life_users(id) on delete cascade,
  workspace_id    uuid references life_workspaces(id) on delete set null,
  counterparty    text not null,
  direction       text not null check (direction in ('lent','borrowed')),
  principal_cents integer not null check (principal_cents >= 0),
  currency        text not null default 'INR',
  interest_pct    numeric(6,3) not null default 0,
  payment_method  text,
  note            text,
  tags            jsonb not null default '[]',
  payments        jsonb not null default '[]', -- [{amount_cents, paid_at, note}]
  started_at      timestamptz not null,
  due_at          timestamptz,
  closed_at       timestamptz,
  status          text not null default 'open' check (status in ('open','closed','written_off')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists life_finance_loans_user_status_idx
  on life_finance_loans (user_id, status);

create index if not exists life_finance_loans_user_started_idx
  on life_finance_loans (user_id, started_at desc);

create index if not exists life_finance_loans_user_counterparty_idx
  on life_finance_loans (user_id, counterparty);
