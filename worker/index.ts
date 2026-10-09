import { classificar, type TipoVaga } from './classificador';
import { coletarVagas, identificarOrigem } from './fontes';
import { emailValido, enviarPeloGmail, gmailConfigurado, type VagaParaEmail } from './email';

interface Ambiente {
  DB: D1Database;
  FILA: Queue<{ tarefaId: number }>;
  ASSETS: Fetcher;
  ACESSO_TOKEN?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
}

interface Configuracao {
  horario_manha: string;
  horario_noite: string;
  tipos: string;
  pausado: number;
  incluir_pcd: number;
  incluir_mulheres: number;
  email_remetente: string;
  email_destinatario: string;
  email_ativo: number;
  atualizado_em: string;
}

interface Fonte {
  id: number;
  nome: string;
  url: string;
  plataforma: string;
  identificador: string | null;
  ativa: number;
  ultima_consulta: string | null;
}

const tiposPermitidos: TipoVaga[] = ['estagio', 'trainee', 'junior', 'analista_junior'];
const cabecalhos = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

function resposta(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), { status, headers: cabecalhos });
}

function compararToken(recebido: string, esperado: string): boolean {
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(esperado);
  let diferenca = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diferenca |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diferenca === 0;
}

async function corpoJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > 10000) throw new Error('Corpo da requisição muito grande.');
  const corpo = await request.text();
  if (corpo.length > 10000) throw new Error('Corpo da requisição muito grande.');
  const valor: unknown = JSON.parse(corpo);
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Envie um objeto JSON.');
  return valor as Record<string, unknown>;
}

function horaValida(valor: unknown): valor is string {
  return typeof valor === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(valor);
}

function agoraBrasilia(data = new Date()): { dia: string; hora: string; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(data);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '00';
  const hora = `${valor('hour')}:${valor('minute')}`;
  return { dia: `${valor('year')}-${valor('month')}-${valor('day')}`, hora, minutos: Number(valor('hour')) * 60 + Number(valor('minute')) };
}

function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

function proximaBusca(configuracao: Configuracao): string | null {
  if (configuracao.pausado) return null;
  const agora = agoraBrasilia();
  for (const hora of [configuracao.horario_manha, configuracao.horario_noite].sort()) {
    if (minutos(hora) > agora.minutos) return `${agora.dia} ${hora}`;
  }
  const amanha = new Date(`${agora.dia}T12:00:00Z`);
  amanha.setUTCDate(amanha.getUTCDate() + 1);
  return `${amanha.toISOString().slice(0, 10)} ${[configuracao.horario_manha, configuracao.horario_noite].sort()[0]}`;
}

async function configuracaoAtual(db: D1Database): Promise<Configuracao> {
  const item = await db.prepare('SELECT horario_manha, horario_noite, tipos, pausado, incluir_pcd, incluir_mulheres, email_remetente, email_destinatario, email_ativo, atualizado_em FROM configuracao WHERE id = 1').first<Configuracao>();
  if (!item) throw new Error('Banco sem migração inicial.');
  return item;
}

async function sincronizarFontes(env: Ambiente): Promise<void> {
  const pendentes = await env.DB.prepare("SELECT id, url FROM fontes WHERE plataforma = 'pendente' AND estado = 'integracao_pendente'").all<{ id: number; url: string }>();
  for (const fonte of pendentes.results) {
    try {
      const origem = identificarOrigem(fonte.url);
      if (origem.plataforma !== 'pendente') {
        await env.DB.prepare("UPDATE fontes SET plataforma = ?, identificador = ?, ativa = 1, estado = 'ativa' WHERE id = ? AND plataforma = 'pendente'")
          .bind(origem.plataforma, origem.identificador, fonte.id).run();
      }
    } catch (erro) { console.error('Fonte cadastrada com URL inválida', fonte.id, erro); }
  }
}

async function criarExecucao(env: Ambiente, chave: string, previstaEm: string): Promise<{ id: number; total: number }> {
  await sincronizarFontes(env);
  await env.DB.prepare('INSERT OR IGNORE INTO execucoes (chave, prevista_em) VALUES (?, ?)').bind(chave, previstaEm).run();
  const execucao = await env.DB.prepare('SELECT id FROM execucoes WHERE chave = ?').bind(chave).first<{ id: number }>();
  if (!execucao) throw new Error('Não foi possível criar a execução.');
  await env.DB.prepare(`INSERT OR IGNORE INTO tarefas (execucao_id, fonte_id)
    SELECT ?, id FROM fontes WHERE ativa = 1 AND plataforma != 'pendente'`).bind(execucao.id).run();
  await env.DB.prepare(`UPDATE execucoes SET total_fontes = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ?) WHERE id = ?`)
    .bind(execucao.id, execucao.id).run();
  const contagem = await env.DB.prepare('SELECT total_fontes AS total FROM execucoes WHERE id = ?').bind(execucao.id).first<{ total: number }>();
  const total = contagem?.total ?? 0;
  if (total === 0) {
    await env.DB.prepare("UPDATE execucoes SET estado = 'sem_fontes', concluida_em = CURRENT_TIMESTAMP, email_estado = 'sem_vagas' WHERE id = ?")
      .bind(execucao.id).run();
    return { id: execucao.id, total };
  }
  await distribuirPendencias(env);
  return { id: execucao.id, total };
}

async function distribuirPendencias(env: Ambiente): Promise<void> {
  await env.DB.prepare(`UPDATE tarefas SET estado = 'pendente' WHERE estado = 'em_execucao' AND tentativas < 3 AND iniciada_em < datetime('now', '-5 minutes')`).run();
  await env.DB.prepare(`UPDATE tarefas SET estado = 'erro', erro = 'Tempo de execução excedido.' WHERE estado = 'em_execucao' AND tentativas >= 3 AND iniciada_em < datetime('now', '-5 minutes')`).run();
  const tarefas = await env.DB.prepare(`SELECT id FROM tarefas WHERE estado = 'pendente' ORDER BY id LIMIT 25`).all<{ id: number }>();
  if (!tarefas.results.length) return;
  try {
    await env.FILA.sendBatch(tarefas.results.map((tarefa) => ({ body: { tarefaId: tarefa.id } })));
    await env.DB.batch(tarefas.results.map((tarefa) => env.DB.prepare(
      `UPDATE tarefas SET estado = 'enfileirada' WHERE id = ? AND estado = 'pendente'`
    ).bind(tarefa.id)));
  } catch (erro) { console.error('Falha ao enfileirar tarefas', erro); }
}

async function agendar(env: Ambiente, instante = new Date()): Promise<void> {
  const configuracao = await configuracaoAtual(env.DB);
  await sincronizarFontes(env);
  if (!configuracao.pausado) {
    const atual = agoraBrasilia(instante);
    const alteracao = agoraBrasilia(new Date(`${configuracao.atualizado_em.replace(' ', 'T')}Z`));
    for (const [indice, hora] of [configuracao.horario_manha, configuracao.horario_noite].entries()) {
      const atraso = atual.minutos - minutos(hora);
      const horarioJaPassouAoEditar = alteracao.dia === atual.dia && alteracao.minutos > minutos(hora);
      if (atraso >= 0 && atraso < 10 && !horarioJaPassouAoEditar) await criarExecucao(env, `${atual.dia}:${indice + 1}:${hora}`, `${atual.dia} ${hora}`);
    }
  }
  await distribuirPendencias(env);
  await revisarExecucoes(env);
  await notificarPendentes(env);
}

async function revisarExecucoes(env: Ambiente): Promise<void> {
  await env.DB.prepare(`UPDATE execucoes SET
    concluida_fontes = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = execucoes.id AND estado IN ('concluida','ignorada','erro') AND (estado != 'erro' OR tentativas >= 3)),
    erros = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = execucoes.id AND estado = 'erro'),
    estado = CASE WHEN NOT EXISTS (SELECT 1 FROM tarefas WHERE execucao_id = execucoes.id AND estado NOT IN ('concluida','ignorada') AND NOT (estado = 'erro' AND tentativas >= 3)) THEN 'concluida' ELSE 'em_andamento' END,
    concluida_em = CASE WHEN NOT EXISTS (SELECT 1 FROM tarefas WHERE execucao_id = execucoes.id AND estado NOT IN ('concluida','ignorada') AND NOT (estado = 'erro' AND tentativas >= 3)) THEN COALESCE(concluida_em, CURRENT_TIMESTAMP) ELSE NULL END
    WHERE estado IN ('pendente','em_andamento') AND total_fontes > 0`).run();
}

async function notificarExecucao(env: Ambiente, execucaoId: number): Promise<void> {
  const configuracao = await configuracaoAtual(env.DB);
  if (!configuracao.email_ativo) {
    await env.DB.prepare("UPDATE execucoes SET email_estado = 'desativado' WHERE id = ? AND email_estado != 'enviado'").bind(execucaoId).run();
    return;
  }
  if (!gmailConfigurado(env)) {
    await env.DB.prepare("UPDATE execucoes SET email_estado = 'configuracao_pendente', email_erro = 'Conecte a conta do Gmail para enviar alertas.' WHERE id = ? AND email_estado NOT IN ('enviado','sem_vagas')")
      .bind(execucaoId).run();
    return;
  }
  const reserva = await env.DB.prepare(`UPDATE execucoes SET email_estado = 'enviando', email_tentativas = email_tentativas + 1,
    email_tentado_em = CURRENT_TIMESTAMP, email_erro = NULL WHERE id = ? AND estado = 'concluida' AND
    (email_estado IN ('pendente','configuracao_pendente','desativado') OR
      (email_estado = 'erro' AND email_tentativas < 3 AND email_tentado_em < datetime('now', '-5 minutes')) OR
      (email_estado = 'enviando' AND email_tentado_em < datetime('now', '-15 minutes')))`).bind(execucaoId).run();
  if (!reserva.meta.changes) return;
  try {
    const vagas = await env.DB.prepare(`SELECT id, titulo, empresa, url, tipo FROM vagas
      WHERE classificacao = 'elegivel' AND notificada_em IS NULL ORDER BY primeira_deteccao, id LIMIT 50`).all<VagaParaEmail>();
    if (!vagas.results.length) {
      await env.DB.prepare("UPDATE execucoes SET email_estado = 'sem_vagas', email_total_vagas = 0 WHERE id = ?").bind(execucaoId).run();
      return;
    }
    await enviarPeloGmail(env, { remetente: configuracao.email_remetente, destinatario: configuracao.email_destinatario }, vagas.results);
    const marcadores = vagas.results.map(() => '?').join(',');
    await env.DB.prepare(`UPDATE vagas SET notificada_em = CURRENT_TIMESTAMP WHERE id IN (${marcadores}) AND notificada_em IS NULL`)
      .bind(...vagas.results.map((vaga) => vaga.id)).run();
    await env.DB.prepare("UPDATE execucoes SET email_estado = 'enviado', email_enviado_em = CURRENT_TIMESTAMP, email_total_vagas = ? WHERE id = ?")
      .bind(vagas.results.length, execucaoId).run();
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message.slice(0, 250) : 'Falha desconhecida no envio.';
    await env.DB.prepare("UPDATE execucoes SET email_estado = 'erro', email_erro = ? WHERE id = ?").bind(mensagem, execucaoId).run();
    console.error('Falha ao enviar alerta do JobSignal', execucaoId, mensagem);
  }
}

async function notificarPendentes(env: Ambiente): Promise<void> {
  const execucoes = await env.DB.prepare(`SELECT id FROM execucoes WHERE estado = 'concluida' AND
    (email_estado IN ('pendente','configuracao_pendente','desativado') OR
      (email_estado = 'erro' AND email_tentativas < 3 AND email_tentado_em < datetime('now', '-5 minutes')) OR
      (email_estado = 'enviando' AND email_tentado_em < datetime('now', '-15 minutes')))
    ORDER BY id DESC LIMIT 5`).all<{ id: number }>();
  for (const execucao of execucoes.results) await notificarExecucao(env, execucao.id);
}

async function concluirTarefa(env: Ambiente, tarefaId: number, execucaoId: number, estado: string, erro: string | null, lidas: number, novas: number): Promise<void> {
  await env.DB.prepare(`UPDATE tarefas SET estado = ?, erro = ?, vagas_lidas = ?, vagas_novas = ?, concluida_em = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(estado, erro, lidas, novas, tarefaId).run();
  await env.DB.prepare(`UPDATE execucoes SET
    concluida_fontes = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ? AND (estado IN ('concluida','ignorada') OR (estado = 'erro' AND tentativas >= 3))),
    erros = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ? AND estado = 'erro'),
    estado = CASE WHEN (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ? AND estado NOT IN ('concluida','ignorada') AND NOT (estado = 'erro' AND tentativas >= 3)) = 0 THEN 'concluida' ELSE 'em_andamento' END,
    concluida_em = CASE WHEN (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ? AND estado NOT IN ('concluida','ignorada') AND NOT (estado = 'erro' AND tentativas >= 3)) = 0 THEN CURRENT_TIMESTAMP ELSE NULL END
    WHERE id = ?`).bind(execucaoId, execucaoId, execucaoId, execucaoId, execucaoId).run();
  const execucao = await env.DB.prepare('SELECT estado FROM execucoes WHERE id = ?').bind(execucaoId).first<{ estado: string }>();
  if (execucao?.estado === 'concluida') await notificarExecucao(env, execucaoId);
}

async function processarTarefa(env: Ambiente, tarefaId: number): Promise<void> {
  const tarefa = await env.DB.prepare(`SELECT t.id, t.execucao_id, t.estado, t.tentativas, f.id AS fonte_id, f.nome, f.url, f.plataforma, f.identificador, f.ativa, f.ultima_consulta
    FROM tarefas t JOIN fontes f ON f.id = t.fonte_id WHERE t.id = ?`).bind(tarefaId).first<(Fonte & { execucao_id: number; estado: string; tentativas: number; fonte_id: number })>();
  if (!tarefa || ['concluida', 'ignorada'].includes(tarefa.estado) || tarefa.tentativas >= 3) return;
  const reservado = await env.DB.prepare(`UPDATE tarefas SET estado = 'em_execucao', tentativas = tentativas + 1, iniciada_em = CURRENT_TIMESTAMP
    WHERE id = ? AND estado IN ('pendente','enfileirada','erro') AND tentativas < 3`).bind(tarefaId).run();
  if (!reservado.meta.changes) return;
  if (!tarefa.ativa || tarefa.plataforma === 'pendente') {
    await concluirTarefa(env, tarefaId, tarefa.execucao_id, 'ignorada', 'Fonte pausada ou sem integração.', 0, 0);
    return;
  }
  let lidas = 0;
  let novas = 0;
  try {
    const origem = identificarOrigem(tarefa.url);
    const vagas = await coletarVagas(origem, tarefa.nome);
    const configuracao = await configuracaoAtual(env.DB);
    const tipos = JSON.parse(configuracao.tipos) as TipoVaga[];
    for (const vaga of vagas) {
      lidas++;
      const classificacao = classificar(vaga, tipos, {
        incluirPcd: Boolean(configuracao.incluir_pcd),
        incluirMulheres: Boolean(configuracao.incluir_mulheres)
      });
      const existente = await env.DB.prepare('SELECT id, classificacao, tipo, motivo FROM vagas WHERE fonte_id = ? AND id_externo = ?')
        .bind(tarefa.fonte_id, vaga.idExterno).first<{ id: number; classificacao: string; tipo: string | null; motivo: string }>();
      if (!existente) {
        const insercao = await env.DB.prepare(`INSERT OR IGNORE INTO vagas
          (fonte_id, id_externo, titulo, empresa, url, localidade, tipo, classificacao, motivo, notificada_em, publicada_em, marcadores)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(tarefa.fonte_id, vaga.idExterno, vaga.titulo, vaga.empresa, vaga.url,
          vaga.localidade, classificacao.tipo, classificacao.classificacao, classificacao.motivo, null, vaga.publicadaEm ?? null, classificacao.marcadores.join(',')).run();
        if (insercao.meta.changes) novas++;
      } else {
        await env.DB.prepare(`UPDATE vagas SET titulo = ?, url = ?, localidade = ?, publicada_em = COALESCE(?, publicada_em),
          tipo = ?, classificacao = ?, motivo = ?, marcadores = ?, ultima_confirmacao = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(vaga.titulo, vaga.url, vaga.localidade, vaga.publicadaEm ?? null, classificacao.tipo, classificacao.classificacao,
            classificacao.motivo, classificacao.marcadores.join(','), existente.id).run();
      }
    }
    await env.DB.prepare(`UPDATE fontes SET estado = 'ativa', ultima_tentativa = CURRENT_TIMESTAMP, ultima_consulta = CURRENT_TIMESTAMP,
      ultimo_erro = NULL, total_vagas = ? WHERE id = ?`).bind(lidas, tarefa.fonte_id).run();
    await concluirTarefa(env, tarefaId, tarefa.execucao_id, 'concluida', null, lidas, novas);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message.slice(0, 250) : 'Erro desconhecido.';
    await env.DB.prepare(`UPDATE fontes SET estado = 'erro', ultima_tentativa = CURRENT_TIMESTAMP, ultimo_erro = ? WHERE id = ?`)
      .bind(mensagem, tarefa.fonte_id).run();
    await concluirTarefa(env, tarefaId, tarefa.execucao_id, 'erro', mensagem, lidas, novas);
    if (tarefa.tentativas < 2) throw new Error(mensagem);
  }
}

async function api(request: Request, env: Ambiente): Promise<Response> {
  if (!env.ACESSO_TOKEN || env.ACESSO_TOKEN.length < 24) return resposta({ erro: 'Configure o segredo ACESSO_TOKEN antes de usar a API.' }, 503);
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!compararToken(token, env.ACESSO_TOKEN)) return resposta({ erro: 'Acesso não autorizado.' }, 401);
  const caminho = new URL(request.url).pathname;
  const metodo = request.method;
  if (caminho === '/api/estado' && metodo === 'GET') {
    const configuracao = await configuracaoAtual(env.DB);
    const [fontes, vagas, pendentes, ultima] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS cadastradas,
        SUM(CASE WHEN ativa = 1 AND plataforma != 'pendente' THEN 1 ELSE 0 END) AS ativas,
        SUM(CASE WHEN plataforma = 'pendente' THEN 1 ELSE 0 END) AS sem_integracao,
        SUM(CASE WHEN ativa = 0 AND plataforma != 'pendente' THEN 1 ELSE 0 END) AS pausadas
        FROM fontes WHERE estado != 'excluida'`).first<{ cadastradas: number; ativas: number; sem_integracao: number; pausadas: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM vagas WHERE classificacao = 'elegivel'").first<{ total: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM vagas WHERE classificacao = 'pendente'").first<{ total: number }>(),
      env.DB.prepare('SELECT * FROM execucoes ORDER BY id DESC LIMIT 1').first()
    ]);
    return resposta({ configuracao: { ...configuracao, tipos: JSON.parse(configuracao.tipos) }, emailConfigurado: gmailConfigurado(env), proximaBusca: proximaBusca(configuracao),
      fontesCadastradas: fontes?.cadastradas ?? 0, fontesAtivas: fontes?.ativas ?? 0,
      fontesSemIntegracao: fontes?.sem_integracao ?? 0, fontesPausadas: fontes?.pausadas ?? 0,
      vagasElegiveis: vagas?.total ?? 0, vagasPendentes: pendentes?.total ?? 0, ultimaExecucao: ultima });
  }
  if (caminho === '/api/configuracao' && metodo === 'PUT') {
    const dados = await corpoJson(request);
    const tipos = dados['tipos'];
    if (!horaValida(dados['horario_manha']) || !horaValida(dados['horario_noite']) || dados['horario_manha'] === dados['horario_noite'] ||
      !Array.isArray(tipos) || !tipos.length || tipos.some((tipo) => !tiposPermitidos.includes(tipo as TipoVaga)) || typeof dados['pausado'] !== 'boolean' ||
      typeof dados['incluir_pcd'] !== 'boolean' || typeof dados['incluir_mulheres'] !== 'boolean' ||
      typeof dados['email_remetente'] !== 'string' || !emailValido(dados['email_remetente']) ||
      typeof dados['email_destinatario'] !== 'string' || !emailValido(dados['email_destinatario']) || typeof dados['email_ativo'] !== 'boolean') {
      return resposta({ erro: 'Informe horários, tipos de vaga e endereços de e-mail válidos.' }, 400);
    }
    await env.DB.prepare(`UPDATE configuracao SET horario_manha = ?, horario_noite = ?, tipos = ?, pausado = ?, incluir_pcd = ?, incluir_mulheres = ?,
      email_remetente = ?, email_destinatario = ?, email_ativo = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = 1`)
      .bind(dados['horario_manha'], dados['horario_noite'], JSON.stringify([...new Set(tipos)]), dados['pausado'] ? 1 : 0,
        dados['incluir_pcd'] ? 1 : 0, dados['incluir_mulheres'] ? 1 : 0,
        dados['email_remetente'].trim(), dados['email_destinatario'].trim(), dados['email_ativo'] ? 1 : 0).run();
    return resposta({ ok: true });
  }
  if (caminho === '/api/email/testar' && metodo === 'POST') {
    const configuracao = await configuracaoAtual(env.DB);
    if (!gmailConfigurado(env)) return resposta({ erro: 'A conta do Gmail ainda não foi conectada.' }, 409);
    try {
      await enviarPeloGmail(env, { remetente: configuracao.email_remetente, destinatario: configuracao.email_destinatario }, [], true);
      return resposta({ ok: true, mensagem: `E-mail de teste enviado para ${configuracao.email_destinatario}.` });
    } catch (erro) {
      return resposta({ erro: erro instanceof Error ? erro.message : 'Falha no envio do teste.' }, 502);
    }
  }
  if (caminho === '/api/fontes' && metodo === 'GET') {
    await sincronizarFontes(env);
    return resposta((await env.DB.prepare('SELECT * FROM fontes ORDER BY criada_em DESC, id DESC LIMIT 100').all()).results);
  }
  if (caminho === '/api/fontes' && metodo === 'POST') {
    const dados = await corpoJson(request);
    const nome = String(dados['nome'] ?? '').trim().slice(0, 100);
    if (!nome || typeof dados['url'] !== 'string') return resposta({ erro: 'Informe nome e URL da página de vagas.' }, 400);
    const origem = identificarOrigem(dados['url']);
    await env.DB.prepare(`INSERT INTO fontes (nome, url, plataforma, identificador, ativa, estado) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(nome, origem.url, origem.plataforma, origem.identificador, origem.plataforma === 'pendente' ? 0 : 1,
        origem.plataforma === 'pendente' ? 'integracao_pendente' : 'ativa').run();
    return resposta({ ok: true, plataforma: origem.plataforma }, 201);
  }
  const fonteId = /^\/api\/fontes\/(\d+)$/.exec(caminho);
  if (fonteId && metodo === 'PATCH') {
    const dados = await corpoJson(request);
    const atual = await env.DB.prepare('SELECT * FROM fontes WHERE id = ?').bind(Number(fonteId[1])).first<Fonte>();
    if (!atual) return resposta({ erro: 'Fonte não encontrada.' }, 404);
    const nome = typeof dados['nome'] === 'string' ? dados['nome'].trim().slice(0, 100) : atual.nome;
    const origem = typeof dados['url'] === 'string' ? identificarOrigem(dados['url']) : identificarOrigem(atual.url);
    const ativa = typeof dados['ativa'] === 'boolean' ? dados['ativa'] : Boolean(atual.ativa);
    if (!nome || (ativa && origem.plataforma === 'pendente')) return resposta({ erro: 'Fonte sem integração não pode ser ativada.' }, 400);
    await env.DB.prepare('UPDATE fontes SET nome = ?, url = ?, plataforma = ?, identificador = ?, ativa = ?, estado = ? WHERE id = ?')
      .bind(nome, origem.url, origem.plataforma, origem.identificador, ativa ? 1 : 0,
        origem.plataforma === 'pendente' ? 'integracao_pendente' : ativa ? 'ativa' : 'pausada', atual.id).run();
    return resposta({ ok: true });
  }
  if (fonteId && metodo === 'DELETE') {
    await env.DB.prepare(`UPDATE fontes SET ativa = 0, estado = 'excluida' WHERE id = ?`).bind(Number(fonteId[1])).run();
    return resposta({ ok: true });
  }
  if (caminho === '/api/vagas' && metodo === 'GET') {
    const url = new URL(request.url);
    const filtro = url.searchParams.get('classificacao') ?? 'elegivel';
    if (!['elegivel', 'pendente', 'descartada'].includes(filtro)) return resposta({ erro: 'Filtro inválido.' }, 400);
    return resposta((await env.DB.prepare(`SELECT v.*, f.nome AS fonte_nome FROM vagas v JOIN fontes f ON f.id = v.fonte_id
      WHERE v.classificacao = ? ORDER BY v.primeira_deteccao DESC, v.id DESC LIMIT 100`).bind(filtro).all()).results);
  }
  const vagaId = /^\/api\/vagas\/(\d+)$/.exec(caminho);
  if (vagaId && metodo === 'PATCH') {
    const dados = await corpoJson(request);
    if (!['novo', 'interesse', 'candidatura', 'descartado'].includes(String(dados['acompanhamento']))) return resposta({ erro: 'Estado inválido.' }, 400);
    await env.DB.prepare('UPDATE vagas SET acompanhamento = ? WHERE id = ?').bind(dados['acompanhamento'], Number(vagaId[1])).run();
    return resposta({ ok: true });
  }
  if (caminho === '/api/execucoes' && metodo === 'GET') {
    return resposta((await env.DB.prepare('SELECT * FROM execucoes ORDER BY id DESC LIMIT 30').all()).results);
  }
  const tarefasExecucao = /^\/api\/execucoes\/(\d+)\/tarefas$/.exec(caminho);
  if (tarefasExecucao && metodo === 'GET') {
    return resposta((await env.DB.prepare(`SELECT t.id, f.nome AS fonte, t.estado, t.tentativas, t.vagas_lidas, t.vagas_novas, t.erro
      FROM tarefas t JOIN fontes f ON f.id = t.fonte_id WHERE t.execucao_id = ? ORDER BY f.nome`)
      .bind(Number(tarefasExecucao[1])).all()).results);
  }
  if (caminho === '/api/executar' && metodo === 'POST') {
    await revisarExecucoes(env);
    const fontes = await env.DB.prepare("SELECT COUNT(*) AS total FROM fontes WHERE ativa = 1 AND plataforma != 'pendente'").first<{ total: number }>();
    if (!fontes?.total) return resposta({ erro: 'Nenhum site com integração ativa. Confira a situação em Sites monitorados.' }, 409);
    const ativa = await env.DB.prepare("SELECT id FROM execucoes WHERE estado IN ('pendente','em_andamento') AND total_fontes > 0 LIMIT 1").first();
    if (ativa) return resposta({ erro: 'Uma busca já está em andamento. Acompanhe o histórico antes de iniciar outra.' }, 409);
    const execucao = await criarExecucao(env, `manual:${Date.now()}`, new Date().toISOString());
    return resposta({ ok: true, execucaoId: execucao.id, totalFontes: execucao.total }, 202);
  }
  return resposta({ erro: 'Rota não encontrada.' }, 404);
}

export default {
  async fetch(request: Request, env: Ambiente): Promise<Response> {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : 'Erro inesperado.';
      if (erro instanceof SyntaxError || mensagem.includes('URL') || mensagem.includes('Corpo')) return resposta({ erro: mensagem }, 400);
      if (mensagem.includes('UNIQUE constraint')) return resposta({ erro: 'Esta URL já foi cadastrada.' }, 409);
      console.error('Erro da API JobSignal', erro);
      return resposta({ erro: 'Não foi possível concluir a operação.' }, 500);
    }
  },
  async scheduled(controller: ScheduledController, env: Ambiente): Promise<void> {
    await agendar(env, new Date(controller.scheduledTime));
  },
  async queue(lote: MessageBatch, env: Ambiente): Promise<void> {
    for (const mensagem of lote.messages) {
      try {
        const corpo = mensagem.body as { tarefaId?: unknown };
        if (!Number.isInteger(corpo?.tarefaId)) throw new Error('Mensagem sem identificador de tarefa válido.');
        await processarTarefa(env, corpo.tarefaId as number);
        mensagem.ack();
      } catch (erro) {
        console.error('Falha da tarefa', erro);
        mensagem.retry({ delaySeconds: 60 });
      }
    }
  }
} satisfies ExportedHandler<Ambiente>;
