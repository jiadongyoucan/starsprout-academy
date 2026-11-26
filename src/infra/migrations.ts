export type Migration = { version: number; sql: string };

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'parent' CHECK (role IN ('parent','teacher','admin')),
  avatar TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE households (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'parent', created_at TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
CREATE TABLE children (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, class_code TEXT NOT NULL, birth_year INTEGER, avatar TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_children_household ON children(household_id);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE subjects (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL,
  summary TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE class_levels (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, age_min INTEGER NOT NULL, age_max INTEGER NOT NULL, sort INTEGER NOT NULL
);
CREATE TABLE public_sources (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, license TEXT NOT NULL,
  description TEXT NOT NULL, homepage TEXT, last_synced_at TEXT, version TEXT
);
CREATE TABLE frameworks (
  id TEXT PRIMARY KEY, subject_code TEXT NOT NULL REFERENCES subjects(code), class_code TEXT NOT NULL REFERENCES class_levels(code),
  term TEXT NOT NULL, title TEXT NOT NULL, objectives TEXT NOT NULL, source_code TEXT,
  version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
  UNIQUE(subject_code, class_code, term)
);
CREATE TABLE units (
  id TEXT PRIMARY KEY, framework_id TEXT NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  code TEXT NOT NULL, title TEXT NOT NULL, seq INTEGER NOT NULL, objective TEXT NOT NULL, source_code TEXT,
  UNIQUE(framework_id, code)
);
CREATE TABLE lessons (
  id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  code TEXT NOT NULL, title TEXT NOT NULL, seq INTEGER NOT NULL, minutes INTEGER NOT NULL,
  objective TEXT NOT NULL, blocks TEXT NOT NULL, tags TEXT NOT NULL, source_code TEXT,
  version INTEGER NOT NULL DEFAULT 1, is_published INTEGER NOT NULL DEFAULT 1,
  UNIQUE(unit_id, code)
);
CREATE INDEX idx_lessons_unit ON lessons(unit_id);
CREATE TABLE course_packs (
  id TEXT PRIMARY KEY, source_code TEXT NOT NULL REFERENCES public_sources(code),
  code TEXT NOT NULL, subject_code TEXT NOT NULL, class_code TEXT NOT NULL, term TEXT NOT NULL,
  version TEXT NOT NULL, checksum TEXT NOT NULL, lessons_imported INTEGER NOT NULL,
  imported_at TEXT NOT NULL, UNIQUE(source_code, code, version)
);
CREATE TABLE progress (
  id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('not_started','in_progress','completed')),
  score INTEGER, seconds INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL, UNIQUE(child_id, lesson_id)
);
CREATE INDEX idx_progress_child ON progress(child_id);

CREATE TABLE plans (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title TEXT NOT NULL, goal TEXT NOT NULL, created_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','ai')), status TEXT NOT NULL CHECK (status IN ('draft','active','archived')),
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, days_per_week INTEGER NOT NULL, minutes_per_day INTEGER NOT NULL,
  ai_rationale TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_plans_child ON plans(child_id);
CREATE TABLE plan_items (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL, child_id TEXT NOT NULL, date TEXT NOT NULL, seq INTEGER NOT NULL,
  lesson_id TEXT REFERENCES lessons(id), subject_code TEXT NOT NULL, title TEXT NOT NULL,
  minutes INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','done','skipped','missed','moved')),
  completed_at TEXT, note TEXT
);
CREATE INDEX idx_plan_items_plan ON plan_items(plan_id, date, seq);
CREATE TABLE reminders (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL, child_id TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'inapp', status TEXT NOT NULL CHECK (status IN ('scheduled','sent','cancelled')),
  created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX idx_reminders_due ON reminders(status, at);
CREATE TABLE plan_adjustments (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL,
  action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, title TEXT NOT NULL,
  agent_kind TEXT NOT NULL CHECK (agent_kind IN ('planner','tutor','expert')),
  expert_id TEXT, model TEXT NOT NULL, system_extra TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_agent_sessions_household ON agent_sessions(household_id);
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL, tool_calls TEXT, tool_results TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_messages_session ON agent_messages(session_id, created_at);
CREATE TABLE agent_memory (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  session_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(household_id, key)
);
CREATE TABLE agent_workspace_files (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  path TEXT NOT NULL, content TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
  UNIQUE(session_id, path)
);
CREATE TABLE model_configs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT NOT NULL,
  model TEXT NOT NULL, api_key_enc TEXT, is_default INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  model TEXT NOT NULL, status TEXT NOT NULL, latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL
);
CREATE TABLE sandbox_executions (
  id TEXT PRIMARY KEY, session_id TEXT, household_id TEXT NOT NULL,
  code TEXT NOT NULL, output TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE experts (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, household_id TEXT NOT NULL, name TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, system_prompt TEXT NOT NULL,
  subjects TEXT NOT NULL DEFAULT '[]', class_codes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft', visibility TEXT NOT NULL DEFAULT 'public',
  installs INTEGER NOT NULL DEFAULT 0, rating REAL NOT NULL DEFAULT 0,
  reviewed_by TEXT, review_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_experts_status ON experts(status, visibility);
CREATE TABLE skills (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, household_id TEXT NOT NULL,
  code TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, kind TEXT NOT NULL,
  definition TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', visibility TEXT NOT NULL DEFAULT 'public',
  installs INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(household_id, code)
);
CREATE TABLE expert_skills (
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, PRIMARY KEY (expert_id, skill_id)
);
CREATE TABLE connectors (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, household_id TEXT NOT NULL, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('builtin','http')), base_url TEXT, auth_type TEXT NOT NULL DEFAULT 'none',
  secret_enc TEXT, tools TEXT NOT NULL, description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', visibility TEXT NOT NULL DEFAULT 'household',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE installations (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, item_type TEXT NOT NULL CHECK (item_type IN ('expert','skill','connector')),
  item_id TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  UNIQUE(household_id, item_type, item_id)
);
CREATE TABLE connector_invocations (
  id TEXT PRIMARY KEY, connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  tool TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER NOT NULL, user_id TEXT NOT NULL,
  request TEXT NOT NULL, response TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE community_posts (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, author_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('insight','course','question')),
  title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', course_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','pending','approved','rejected','hidden')),
  moderation_score INTEGER NOT NULL DEFAULT 0, moderation_reasons TEXT NOT NULL DEFAULT '[]',
  like_count INTEGER NOT NULL DEFAULT 0, view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
);
CREATE INDEX idx_posts_status ON community_posts(status, published_at);
CREATE TABLE post_reviews (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE post_likes (
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, user_id)
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved', created_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL, pairing_code TEXT, code_expires_at TEXT, token_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','paired','revoked')), last_seen_at TEXT,
  created_at TEXT NOT NULL, paired_at TEXT
);
CREATE INDEX idx_devices_household ON devices(household_id);
CREATE INDEX idx_devices_code ON devices(pairing_code, status);
CREATE TABLE device_pushes (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL, child_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  message TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL, delivered_at TEXT, opened_at TEXT
);
CREATE INDEX idx_pushes_device ON device_pushes(device_id, status);
CREATE TABLE learning_sessions (
  id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL, child_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
  plan_item_id TEXT, status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL, ended_at TEXT
);
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL, device_id TEXT NOT NULL, learning_session_id TEXT,
  file TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_snapshots_child ON snapshots(child_id, created_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, child_id TEXT NOT NULL,
  period TEXT NOT NULL, period_key TEXT NOT NULL, summary TEXT NOT NULL,
  highlights TEXT NOT NULL, suggestions TEXT NOT NULL, metrics TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(child_id, period, period_key)
);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, household_id TEXT, actor_id TEXT, action TEXT NOT NULL,
  entity TEXT NOT NULL, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  {
    version: 2,
    sql: `
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE course_packs ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE course_packs ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE devices ADD COLUMN code_attempts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE guardian_consents (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, child_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('camera','ai_processing','analytics')),
  granted INTEGER NOT NULL, granted_by TEXT NOT NULL, policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(child_id, kind)
);
CREATE TABLE post_reports (
  id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_status ON post_reports(status);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_household ON ai_usage(household_id, created_at);
CREATE INDEX idx_posts_pending ON community_posts(status, created_at);
CREATE INDEX idx_plan_items_child ON plan_items(child_id, date);
`,
  },
  {
    version: 4,
    sql: `
CREATE TABLE wallets (
  child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0, total_earned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE pets (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL UNIQUE REFERENCES children(id) ON DELETE CASCADE,
  species TEXT NOT NULL CHECK (species IN ('bunny','fox','dragon')),
  name TEXT NOT NULL, level INTEGER NOT NULL DEFAULT 1, exp INTEGER NOT NULL DEFAULT 0,
  hunger INTEGER NOT NULL DEFAULT 80, happiness INTEGER NOT NULL DEFAULT 80, energy INTEGER NOT NULL DEFAULT 80,
  bond INTEGER NOT NULL DEFAULT 0, mood TEXT NOT NULL DEFAULT 'happy', equipped TEXT NOT NULL DEFAULT '[]',
  last_decay_at TEXT NOT NULL, adopted_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE shop_items (
  code TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('food','clothing','toy','decor')),
  name TEXT NOT NULL, emoji TEXT NOT NULL, price INTEGER NOT NULL, description TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pet_inventory (
  id TEXT PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL REFERENCES shop_items(code), qty INTEGER NOT NULL DEFAULT 1,
  equipped INTEGER NOT NULL DEFAULT 0, acquired_at TEXT NOT NULL, UNIQUE(pet_id, item_code)
);
CREATE TABLE reward_events (
  id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0, stars INTEGER NOT NULL DEFAULT 0, meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, UNIQUE(child_id, source_type, source_id)
);
CREATE INDEX idx_rewards_child ON reward_events(child_id, created_at);
CREATE TABLE pet_interactions (
  id TEXT PRIMARY KEY, pet_id TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  action TEXT NOT NULL, item_code TEXT, coins_spent INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_pet_interactions ON pet_interactions(pet_id, created_at);
`,
  },
  {
    version: 5,
    sql: `ALTER TABLE plan_items ADD COLUMN completed_via TEXT;`,
  },
  {
    version: 6,
    sql: `
ALTER TABLE lessons ADD COLUMN key_points TEXT;
ALTER TABLE lessons ADD COLUMN hard_points TEXT;
ALTER TABLE lessons ADD COLUMN home_extension TEXT;
ALTER TABLE lessons ADD COLUMN prereq_lesson_id TEXT;
ALTER TABLE comments ADD COLUMN moderation_reasons TEXT NOT NULL DEFAULT '[]';
ALTER TABLE comments ADD COLUMN reviewed_at TEXT;
ALTER TABLE comments ADD COLUMN reviewed_by TEXT;
ALTER TABLE plans ADD COLUMN engine TEXT;
ALTER TABLE shop_items ADD COLUMN available INTEGER NOT NULL DEFAULT 1;
CREATE TABLE lesson_versions (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, pack_id TEXT, version INTEGER NOT NULL, blocks TEXT NOT NULL,
  checksum TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(lesson_id, version)
);
UPDATE shop_items SET available = 0 WHERE code = 'star-cape';
CREATE TABLE product_events (
  id TEXT PRIMARY KEY, household_id TEXT, child_id TEXT, user_id TEXT,
  type TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_product_events_type_date ON product_events(type, created_at);
CREATE INDEX idx_product_events_household ON product_events(household_id, created_at);
`,
  },
];
