CREATE TABLE IF NOT EXISTS daily_snapshots (
  platform_key TEXT NOT NULL,
  chart_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform_key, date_key)
);
CREATE TABLE IF NOT EXISTS current_trend_snapshots (
  platform_key TEXT NOT NULL,
  day_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform_key, day_key)
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
