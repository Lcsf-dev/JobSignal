CREATE TABLE IF NOT EXISTS credencial_email (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  senha_cifrada TEXT NOT NULL,
  vetor_inicializacao TEXT NOT NULL,
  atualizada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
