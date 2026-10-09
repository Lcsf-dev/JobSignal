import { classificar, type TipoVaga } from './classificador';
import { coletarVagas, identificarOrigem } from './fontes';

interface Ambiente {
  DB: D1Database;
  FILA: Queue<{ tarefaId: number }>;
  ASSETS: Fetcher;
  ACESSO_TOKEN?: string;
}

interface Configuracao {
  horario_manha: string;
  horario_noite: string;
  tipos: string;
  pausado: number;
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
  const item = await db.prepare('SELECT horario_manha, horario_noite, tipos, pausado, atualizado_em FROM configuracao WHERE id = 1').first<Configuracao>();
  if (!item) throw new Error('Banco sem migração inicial.');
  return item;
}

async function criarExecucao(env: Ambiente, chave: string, previstaEm: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO execucoes (chave, prevista_em) VALUES (?, ?)').bind(chave, previstaEm).run();
  const execucao = await env.DB.prepare('SELECT id FROM execucoes WHERE chave = ?').bind(chave).first<{ id: number }>();
  if (!execucao) throw new Error('Não foi possível criar a execução.');
  await env.DB.prepare(`INSERT OR IGNORE INTO tarefas (execucao_id, fonte_id)
    SELECT ?, id FROM fontes WHERE ativa = 1 AND plataforma != 'pendente'`).bind(execucao.id).run();
  await env.DB.prepare(`UPDATE execucoes SET total_fontes = (SELECT COUNT(*) FROM tarefas WHERE execucao_id = ?) WHERE id = ?`)
    .bind(execucao.id, execucao.id).run();
  await distribuirPendencias(env);
}

async function distribuirPendencias(env: Ambiente): Promise<void> {
  await env.DB.prepare(`UPDATE tarefas SET estado = 'pendente' WHERE estado = 'em_execucao' AND tentativas < 3 AND iniciada_em < datetime('now', '-5 minutes')`).run();
  await env.DB.prepare(`UPDATE tarefas SET estado = 'erro', erro = 'Tempo de execução excedido.' WHERE estado = 'em_execucao' AND tentativas >= 3 AND iniciada_em < datetime('now', '-5 minutes')`).run();
  const tarefas = await env.DB.prepare(`SELECT id FROM tarefas WHERE estado = 'pendente' ORDER BY id LIMIT 25`).all<{ id: number }>();
  for (const tarefa of tarefas.results) {
    try {
      await env.FILA.send({ tarefaId: tarefa.id });
      await env.DB.prepare(`UPDATE tarefas SET estado = 'enfileirada' WHERE id = ? AND estado = 'pendente'`).bind(tarefa.id).run();
    } catch (erro) {
      console.error('Falha ao enfileirar tarefa', tarefa.id, erro);
      break;
    }
  }
}

async function agendar(env: Ambiente, instante = new Date()): Promise<void> {
  const configuracao = await configuracaoAtual(env.DB);
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
    const primeiraConsulta = !tarefa.ultima_consulta;
    for (const vaga of vagas) {
      lidas++;
      const classificacao = classificar(vaga, tipos);
      const existente = await env.DB.prepare('SELECT id, classificacao, tipo, motivo FROM vagas WHERE fonte_id = ? AND id_externo = ?')
        .bind(tarefa.fonte_id, vaga.idExterno).first<{ id: number; classificacao: string; tipo: string | null; motivo: string }>();
      if (!existente) {
        const notificada = !primeiraConsulta && classificacao.classificacao === 'elegivel' ? new Date().toISOString() : null;
        const insercao = await env.DB.prepare(`INSERT OR IGNORE INTO vagas
          (fonte_id, id_externo, titulo, empresa, url, localidade, tipo, classificacao, motivo, notificada_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(tarefa.fonte_id, vaga.idExterno, vaga.titulo, vaga.empresa, vaga.url,
          vaga.localidade, classificacao.tipo, classificacao.classificacao, classificacao.motivo, notificada).run();
        if (insercao.meta.changes) novas++;
      } else if (existente.classificacao !== classificacao.classificacao || existente.tipo !== classificacao.tipo || existente.motivo !== classificacao.motivo) {
        await env.DB.prepare(`UPDATE vagas SET titulo = ?, url = ?, localidade = ?, tipo = ?, classificacao = ?, motivo = ?, ultima_confirmacao = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(vaga.titulo, vaga.url, vaga.localidade, classificacao.tipo, classificacao.classificacao, classificacao.motivo, existente.id).run();
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
      env.DB.prepare('SELECT COUNT(*) AS total FROM fontes WHERE ativa = 1').first<{ total: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM vagas WHERE classificacao = 'elegivel'").first<{ total: number }>(),
      env.DB.prepare("SELECT COUNT(*) AS total FROM vagas WHERE classificacao = 'pendente'").first<{ total: number }>(),
      env.DB.prepare('SELECT * FROM execucoes ORDER BY id DESC LIMIT 1').first()
    ]);
    return resposta({ configuracao: { ...configuracao, tipos: JSON.parse(configuracao.tipos) }, proximaBusca: proximaBusca(configuracao),
      fontesAtivas: fontes?.total ?? 0, vagasElegiveis: vagas?.total ?? 0, vagasPendentes: pendentes?.total ?? 0, ultimaExecucao: ultima });
  }
  if (caminho === '/api/configuracao' && metodo === 'PUT') {
    const dados = await corpoJson(request);
    const tipos = dados['tipos'];
    if (!horaValida(dados['horario_manha']) || !horaValida(dados['horario_noite']) || dados['horario_manha'] === dados['horario_noite'] ||
      !Array.isArray(tipos) || !tipos.length || tipos.some((tipo) => !tiposPermitidos.includes(tipo as TipoVaga)) || typeof dados['pausado'] !== 'boolean') {
      return resposta({ erro: 'Informe dois horários diferentes, ao menos um tipo de vaga e o estado do monitoramento.' }, 400);
    }
    await env.DB.prepare(`UPDATE configuracao SET horario_manha = ?, horario_noite = ?, tipos = ?, pausado = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = 1`)
      .bind(dados['horario_manha'], dados['horario_noite'], JSON.stringify([...new Set(tipos)]), dados['pausado'] ? 1 : 0).run();
    return resposta({ ok: true });
  }
  if (caminho === '/api/fontes' && metodo === 'GET') {
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
  if (caminho === '/api/executar' && metodo === 'POST') {
    const configuracao = await configuracaoAtual(env.DB);
    if (configuracao.pausado) return resposta({ erro: 'Monitoramento está pausado.' }, 409);
    const ultima = await env.DB.prepare(`SELECT iniciada_em FROM execucoes WHERE chave LIKE 'manual:%' ORDER BY id DESC LIMIT 1`).first<{ iniciada_em: string }>();
    if (ultima && Date.now() - new Date(`${ultima.iniciada_em.replace(' ', 'T')}Z`).getTime() < 15 * 60_000) {
      return resposta({ erro: 'Aguarde 15 minutos entre buscas manuais.' }, 429);
    }
    await criarExecucao(env, `manual:${Date.now()}`, new Date().toISOString());
    return resposta({ ok: true }, 202);
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
