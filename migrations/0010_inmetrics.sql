-- Reaproveita o cadastro existente e habilita a coleta específica da empresa.
UPDATE fontes
SET plataforma = 'gupy', identificador = 'inmetrics', ativa = 1, estado = 'ativa', ultimo_erro = NULL
WHERE url IN ('https://inmetrics.gupy.io', 'https://inmetrics.gupy.io/');

INSERT INTO fontes (nome, url, plataforma, identificador, ativa, estado)
SELECT 'Inmetrics', 'https://inmetrics.gupy.io/', 'gupy', 'inmetrics', 1, 'ativa'
WHERE NOT EXISTS (
  SELECT 1 FROM fontes WHERE url IN ('https://inmetrics.gupy.io', 'https://inmetrics.gupy.io/')
);
