CREATE TABLE IF NOT EXISTS configuracao (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  horario_manha TEXT NOT NULL DEFAULT '10:00',
  horario_noite TEXT NOT NULL DEFAULT '22:00',
  tipos TEXT NOT NULL DEFAULT '["estagio","trainee","junior","analista_junior"]',
  pausado INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO configuracao (id) VALUES (1);

CREATE TABLE IF NOT EXISTS fontes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  plataforma TEXT NOT NULL,
  identificador TEXT,
  ativa INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'pendente',
  ultima_tentativa TEXT,
  ultima_consulta TEXT,
  ultimo_erro TEXT,
  total_vagas INTEGER NOT NULL DEFAULT 0,
  criada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS execucoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT NOT NULL UNIQUE,
  prevista_em TEXT NOT NULL,
  iniciada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concluida_em TEXT,
  estado TEXT NOT NULL DEFAULT 'pendente',
  total_fontes INTEGER NOT NULL DEFAULT 0,
  concluida_fontes INTEGER NOT NULL DEFAULT 0,
  erros INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execucao_id INTEGER NOT NULL REFERENCES execucoes(id),
  fonte_id INTEGER NOT NULL REFERENCES fontes(id),
  estado TEXT NOT NULL DEFAULT 'pendente',
  tentativas INTEGER NOT NULL DEFAULT 0,
  iniciada_em TEXT,
  concluida_em TEXT,
  vagas_lidas INTEGER NOT NULL DEFAULT 0,
  vagas_novas INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  UNIQUE (execucao_id, fonte_id)
);

CREATE TABLE IF NOT EXISTS vagas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte_id INTEGER NOT NULL REFERENCES fontes(id),
  id_externo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  empresa TEXT NOT NULL,
  url TEXT NOT NULL,
  localidade TEXT NOT NULL DEFAULT '',
  tipo TEXT,
  classificacao TEXT NOT NULL,
  motivo TEXT NOT NULL,
  acompanhamento TEXT NOT NULL DEFAULT 'novo',
  primeira_deteccao TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultima_confirmacao TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notificada_em TEXT,
  UNIQUE (fonte_id, id_externo)
);

CREATE INDEX IF NOT EXISTS idx_fontes_ativas ON fontes(ativa, plataforma);
CREATE INDEX IF NOT EXISTS idx_tarefas_estado ON tarefas(estado, execucao_id);
CREATE INDEX IF NOT EXISTS idx_vagas_lista ON vagas(classificacao, primeira_deteccao DESC);
CREATE INDEX IF NOT EXISTS idx_vagas_fonte ON vagas(fonte_id, id_externo);
