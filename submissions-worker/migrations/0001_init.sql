-- File des soumissions de marques (aucune donnée personnelle).
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,            -- code de suivi de 8 caractères (aléatoire)
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  reason TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,      -- SHA-256 du jeton d'appareil (anti-spam uniquement)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | published | rejected
  review_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_submissions_code ON submissions(code);

-- Signalements / suggestions de mise à jour (même file de revue)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,                   -- brand-report | brand-update
  brand_slug TEXT,
  message TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',  -- open | done
  created_at TEXT NOT NULL
);
