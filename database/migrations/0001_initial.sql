-- SQLite 初始结构：业务模型与原 PostgreSQL 版本保持一致。
-- 时间字段统一保存 JS `toISOString()` 格式的 UTC 文本，便于直接按字符串排序与比较。
-- id 由 gen_random_uuid()、当前时间由 now() 产生，两者在打开数据库连接时注册为 SQLite 自定义函数。

create table if not exists departments (
  id text primary key default (gen_random_uuid()),
  name text not null,
  parent_id text references departments(id) on delete restrict,
  sort_order integer not null default 0,
  created_at text not null default (now()),
  updated_at text not null default (now())
);

create unique index if not exists departments_parent_name_unique
  on departments (coalesce(parent_id, ''), name);

create table if not exists users (
  id text primary key default (gen_random_uuid()),
  account text not null unique collate nocase,
  password_hash text not null,
  name text not null,
  department_id text not null references departments(id) on delete restrict,
  role text not null default 'user' check (role in ('user', 'admin', 'super_admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  must_change_password integer not null default 0 check (must_change_password in (0, 1)),
  temp_password_expires_at text,
  session_version integer not null default 1 check (session_version > 0),
  storage_quota_bytes integer not null default 524288000 check (storage_quota_bytes >= 5242880),
  created_at text not null default (now()),
  updated_at text not null default (now())
);

create table if not exists admin_department_scopes (
  admin_id text not null references users(id) on delete cascade,
  department_id text not null references departments(id) on delete cascade,
  created_at text not null default (now()),
  primary key (admin_id, department_id)
);

create table if not exists invitation_codes (
  id text primary key default (gen_random_uuid()),
  code text not null unique collate nocase,
  expires_at text not null,
  used_at text,
  used_by text references users(id) on delete set null,
  used_by_name text,
  created_by text references users(id) on delete set null,
  created_by_name text not null,
  created_at text not null default (now()),
  check (
    (used_at is null and used_by is null and used_by_name is null)
    or (used_at is not null and used_by_name is not null)
  )
);

create table if not exists prototype_groups (
  id text primary key default (gen_random_uuid()),
  owner_id text not null references users(id) on delete cascade,
  parent_id text references prototype_groups(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at text not null default (now()),
  updated_at text not null default (now())
);

create unique index if not exists prototype_groups_owner_parent_name_unique
  on prototype_groups (owner_id, coalesce(parent_id, ''), name);

create table if not exists business_categories (
  id text primary key default (gen_random_uuid()),
  name text not null unique,
  sort_order integer not null default 0,
  enabled integer not null default 1 check (enabled in (0, 1)),
  created_at text not null default (now()),
  updated_at text not null default (now())
);

create table if not exists projects (
  id text primary key default (gen_random_uuid()),
  public_code text not null unique,
  share_code text not null unique,
  name text not null,
  owner_id text not null references users(id) on delete cascade,
  department_id text not null references departments(id) on delete restrict,
  group_id text references prototype_groups(id) on delete set null,
  category_id text references business_categories(id) on delete set null,
  html_path text not null,
  preview_path text,
  preview_status text not null default 'pending' check (preview_status in ('pending', 'ready', 'failed')),
  preview_error text,
  preview_size integer not null default 0 check (preview_size >= 0),
  file_size integer not null check (file_size > 0),
  is_public integer not null default 0 check (is_public in (0, 1)),
  share_enabled integer not null default 0 check (share_enabled in (0, 1)),
  share_expires_at text,
  share_password_hash text,
  share_password_encrypted text,
  share_version integer not null default 1 check (share_version > 0),
  visit_count integer not null default 0,
  source_kind text not null check (source_kind in ('html', 'zip', 'rar', 'folder')),
  source_name text not null,
  created_at text not null default (now()),
  updated_at text not null default (now())
);

create table if not exists project_visits (
  id integer primary key autoincrement,
  project_id text not null references projects(id) on delete cascade,
  user_id text references users(id) on delete set null,
  visitor_key text,
  access_type text not null check (access_type in ('public', 'share', 'owner', 'admin')),
  visited_at text not null default (now()),
  check (user_id is not null or visitor_key is not null)
);

create table if not exists share_password_attempts (
  id integer primary key autoincrement,
  project_id text not null references projects(id) on delete cascade,
  ip_address text,
  success integer not null check (success in (0, 1)),
  created_at text not null default (now())
);

create table if not exists login_logs (
  id integer primary key autoincrement,
  user_id text references users(id) on delete set null,
  account text not null,
  success integer not null check (success in (0, 1)),
  ip_address text,
  user_agent text,
  created_at text not null default (now())
);

create table if not exists platform_events (
  id integer primary key autoincrement,
  event_type text not null check (event_type in ('upload', 'update')),
  project_id text references projects(id) on delete set null,
  user_id text references users(id) on delete set null,
  created_at text not null default (now())
);

create index if not exists projects_owner_idx on projects(owner_id, updated_at desc);
create index if not exists projects_department_idx on projects(department_id, updated_at desc);
create index if not exists projects_public_idx on projects(is_public, updated_at desc);
create index if not exists project_visits_project_idx on project_visits(project_id, visited_at desc);
create index if not exists project_visits_user_idx on project_visits(user_id, visited_at desc);
create index if not exists share_password_attempts_lookup_idx on share_password_attempts(project_id, ip_address, created_at desc);
create index if not exists login_logs_created_idx on login_logs(created_at desc);
create index if not exists platform_events_created_idx on platform_events(created_at desc);

create trigger if not exists project_visit_count_trigger
after insert on project_visits
begin
  update projects set visit_count = visit_count + 1 where id = new.project_id;
end;
