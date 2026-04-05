-- PaperMind Supabase Schema
-- Run this in the Supabase SQL editor to set up your database

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Users table (basic auth, passwords stored as plain text for now)
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  username text not null,
  password text not null,
  is_admin boolean not null default false,
  display_name text,
  created_at timestamptz not null default now(),
  constraint users_username_key unique (username)
);

-- Seed admin user (username: admin, password: admin)
insert into users (username, password, is_admin, display_name) values
  ('admin', 'admin', true, 'Admin')
on conflict (username) do nothing;

-- RSS Feeds (must be created before papers due to foreign key)
create table if not exists rss_feeds (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  url text not null,
  topic text not null default 'AI',
  color text not null default '#6c63ff',
  active boolean not null default true,
  approved boolean not null default false,
  added_by uuid references users(id) on delete set null,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  constraint rss_feeds_url_key unique (url)
);

-- Papers table (global, visible to all)
create table if not exists papers (
  id uuid primary key default uuid_generate_v4(),
  external_id text not null,
  title text not null,
  authors text,
  year integer,
  source text not null default 'arXiv',
  category text,
  topic text not null default 'AI',
  abstract text,
  problem text,
  method text,
  finding text,
  tags jsonb not null default '[]'::jsonb,
  url text,
  feed_id uuid references rss_feeds(id) on delete set null,
  added_by uuid references users(id) on delete set null,
  approved boolean not null default true,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint papers_external_id_key unique (external_id)
);

create index if not exists idx_papers_topic on papers(topic);
create index if not exists idx_papers_fetched_at on papers(fetched_at desc);
create index if not exists idx_papers_source on papers(source);

-- Saved papers (per-user reading list)
create table if not exists saved_papers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  read_status text not null default 'unread' check (read_status in ('unread', 'reading', 'done')),
  saved_at timestamptz not null default now(),
  constraint saved_papers_user_paper_key unique (user_id, paper_id)
);

create index if not exists idx_saved_papers_user on saved_papers(user_id);
create index if not exists idx_saved_papers_paper on saved_papers(paper_id);

-- Notes (per-user)
create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  content text not null,
  highlight text,
  note_type text not null default 'note' check (note_type in ('note', 'insight', 'question', 'highlight')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notes_user on notes(user_id);
create index if not exists idx_notes_paper_id on notes(paper_id);
create index if not exists idx_notes_type on notes(note_type);

-- Q&A history (per-user)
create table if not exists qa_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  paper_id uuid not null references papers(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_qa_history_user on qa_history(user_id);
create index if not exists idx_qa_history_paper_id on qa_history(paper_id);

-- Fetch log
create table if not exists fetch_log (
  id uuid primary key default uuid_generate_v4(),
  source text not null,
  topic text,
  papers_count integer not null default 0,
  errors text,
  fetched_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_fetch_log_created on fetch_log(created_at desc);

-- Seed default arXiv RSS feeds (approved by default)
insert into rss_feeds (name, url, topic, color, approved) values
  ('arXiv cs.AI', 'https://rss.arxiv.org/rss/cs.AI', 'AI', '#6366f1', true),
  ('arXiv cs.LG', 'https://rss.arxiv.org/rss/cs.LG', 'Machine Learning', '#10b981', true),
  ('arXiv cs.CL', 'https://rss.arxiv.org/rss/cs.CL', 'NLP', '#f59e0b', true),
  ('arXiv cs.CV', 'https://rss.arxiv.org/rss/cs.CV', 'Computer Vision', '#ef4444', true),
  ('arXiv stat.ML', 'https://rss.arxiv.org/rss/stat.ML', 'Statistics', '#14b8a6', true)
on conflict (url) do nothing;
