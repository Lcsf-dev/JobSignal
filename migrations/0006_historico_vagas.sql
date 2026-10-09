ALTER TABLE vagas ADD COLUMN arquivada_em TEXT;

CREATE INDEX IF NOT EXISTS idx_vagas_arquivadas
  ON vagas(arquivada_em, primeira_deteccao DESC, id DESC);
