-- Reader Feed + user preferences migration.
-- Adds the "Choose for reading" flag on papers + articles, plus a jsonb
-- preferences blob on users (used for nav visibility and future settings).
-- Run in the Supabase SQL editor. Safe to re-run.

alter table papers
  add column if not exists marked_for_reading boolean not null default false;

alter table articles
  add column if not exists marked_for_reading boolean not null default false;

create index if not exists papers_marked_for_reading_idx
  on papers (marked_for_reading) where marked_for_reading = true;

create index if not exists articles_marked_for_reading_idx
  on articles (marked_for_reading) where marked_for_reading = true;

-- User preferences (nav visibility, future settings). Stored as a single
-- jsonb blob so we can add new preference keys without further migrations.
alter table users
  add column if not exists preferences jsonb not null default '{}'::jsonb;

-- Archive flag for articles — hides them from the default feed without
-- losing the row. Archived rows are still reachable by direct URL.
alter table articles
  add column if not exists archived boolean not null default false;

create index if not exists articles_archived_idx
  on articles (archived) where archived = false;
