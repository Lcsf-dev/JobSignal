ALTER TABLE configuracao ADD COLUMN email_remetente TEXT NOT NULL DEFAULT 'yugi.lucas@gmail.com';
ALTER TABLE configuracao ADD COLUMN email_destinatario TEXT NOT NULL DEFAULT 'lucas.lcsf.dev@gmail.com';
ALTER TABLE configuracao ADD COLUMN email_ativo INTEGER NOT NULL DEFAULT 1;

ALTER TABLE execucoes ADD COLUMN email_estado TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE execucoes ADD COLUMN email_erro TEXT;
ALTER TABLE execucoes ADD COLUMN email_enviado_em TEXT;
ALTER TABLE execucoes ADD COLUMN email_total_vagas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE execucoes ADD COLUMN email_tentado_em TEXT;
ALTER TABLE execucoes ADD COLUMN email_tentativas INTEGER NOT NULL DEFAULT 0;

-- A versão anterior marcou vagas como notificadas sem enviar mensagens.
UPDATE vagas SET notificada_em = NULL;

-- Rodadas sem tarefas nunca poderiam chegar ao processamento da fila.
UPDATE execucoes SET estado = 'sem_fontes', concluida_em = COALESCE(concluida_em, CURRENT_TIMESTAMP), email_estado = 'sem_vagas'
WHERE total_fontes = 0 AND estado = 'pendente';
