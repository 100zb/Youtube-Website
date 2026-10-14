CREATE TABLE channels (
  handle TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_id TEXT,
  import_page_token TEXT,
  import_done INTEGER NOT NULL DEFAULT 0,
  not_found INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT
);

CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  views INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  thumbnail TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- nombre aléatoire indexé : permet un tirage au sort sans lire toute la table
  rnd REAL NOT NULL DEFAULT (abs(random()) / 9223372036854775807.0)
);

CREATE INDEX idx_videos_rnd ON videos (rnd);
CREATE INDEX idx_videos_updated ON videos (updated_at);
