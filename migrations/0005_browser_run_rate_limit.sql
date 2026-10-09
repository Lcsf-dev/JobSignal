CREATE TABLE browser_run_rate_limit (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  proxima_chamada_em INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO browser_run_rate_limit (id, proxima_chamada_em) VALUES (1, 0);
