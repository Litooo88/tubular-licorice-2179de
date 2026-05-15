CREATE TABLE IF NOT EXISTS call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  callid TEXT NOT NULL,
  caller_e164 TEXT NOT NULL,
  duration_s INTEGER,
  answered_by TEXT,
  status TEXT NOT NULL,
  ivr_choice TEXT,
  recording_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_callid ON call_log(callid);
CREATE INDEX IF NOT EXISTS idx_timestamp ON call_log(timestamp);
