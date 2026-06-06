CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  survival_time INTEGER NOT NULL,
  max_combo INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scores_user_created_at ON scores(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores(score DESC, survival_time DESC, created_at ASC);
