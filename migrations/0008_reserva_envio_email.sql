ALTER TABLE vagas ADD COLUMN email_execucao_id INTEGER REFERENCES execucoes(id);

CREATE INDEX IF NOT EXISTS idx_vagas_email_pendente
ON vagas(classificacao, arquivada_em, notificada_em, email_execucao_id);
