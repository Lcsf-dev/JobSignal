import type { VagaColetada } from './classificador';
import { extrairDetalheCwi, extrairDetalheRecrut, extrairLinksCwi, extrairListagemRecrut, textoDaPagina } from './fontes-html.ts';

export interface OrigemIdentificada {
  plataforma: 'greenhouse' | 'lever' | 'recrutai' | 'ciandt' | 'cwi' | 'remotar' | 'pendente';
  identificador: string | null;
  url: string;
}

export function identificarOrigem(entrada: string): OrigemIdentificada {
  const url = new URL(entrada);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use uma URL HTTPS pública, sem credenciais ou porta.');
  const host = url.hostname.toLowerCase();
  const partes = url.pathname.split('/').filter(Boolean);
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards-api.greenhouse.io'].includes(host)) {
    const identificador = host === 'boards-api.greenhouse.io' ? partes[2] : partes[0];
    if (identificador && /^[a-z0-9_-]{2,80}$/i.test(identificador)) return { plataforma: 'greenhouse', identificador, url: url.toString() };
  }
  if (['jobs.lever.co', 'api.lever.co', 'jobs.eu.lever.co', 'api.eu.lever.co'].includes(host)) {
    const identificador = host.startsWith('api.') ? partes[2] : partes[0];
    if (identificador && /^[a-z0-9_-]{2,80}$/i.test(identificador)) return { plataforma: 'lever', identificador: `${host.endsWith('eu.lever.co') ? 'eu:' : ''}${identificador}`, url: url.toString() };
  }
  if (/^[a-z0-9-]+\.jobs\.recrut\.ai$/.test(host) && partes.length <= 1 && (!partes[0] || /^[a-z0-9_-]{1,80}$/i.test(partes[0]))) {
    return { plataforma: 'recrutai', identificador: partes[0] ?? '*', url: url.toString() };
  }
  if (['ciandt.com', 'www.ciandt.com'].includes(host) && url.pathname.replace(/\/$/, '') === '/br/pt-br/carreiras/oportunidades') {
    return { plataforma: 'ciandt', identificador: 'oportunidades', url: url.toString() };
  }
  if (['cwi.com.br', 'www.cwi.com.br'].includes(host) && url.pathname.replace(/\/$/, '') === '/talentos/oportunidades') {
    return { plataforma: 'cwi', identificador: 'oportunidades', url: url.toString() };
  }
  if (['remotar.com.br', 'www.remotar.com.br'].includes(host) && partes[0] === 'company' && /^\d+$/.test(partes[1] ?? '')) {
    return { plataforma: 'remotar', identificador: partes[1], url: url.toString() };
  }
  return { plataforma: 'pendente', identificador: null, url: url.toString() };
}

async function obterTexto(url: string, tipo: 'json' | 'html' = 'json'): Promise<string> {
  let endereco = new URL(url);
  const hostOriginal = endereco.hostname;
  const hostsPermitidos = new Set([hostOriginal, hostOriginal.startsWith('www.') ? hostOriginal.slice(4) : `www.${hostOriginal}`]);
  for (let redirecionamentos = 0; redirecionamentos <= 3; redirecionamentos++) {
    const resposta = await fetch(endereco, { headers: { Accept: tipo === 'json' ? 'application/json' : 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (resposta.status >= 300 && resposta.status < 400) {
      const destino = resposta.headers.get('location');
      if (!destino || redirecionamentos === 3) throw new Error(`Fonte respondeu HTTP ${resposta.status} sem redirecionamento seguro.`);
      const proximoEndereco = new URL(destino, endereco);
      if (proximoEndereco.protocol !== 'https:' || !hostsPermitidos.has(proximoEndereco.hostname)) {
        throw new Error('A fonte tentou redirecionar para outro domínio; consulta interrompida por segurança.');
      }
      endereco = proximoEndereco;
      continue;
    }
    if (!resposta.ok) throw new Error(`Fonte respondeu HTTP ${resposta.status}.`);
    const tamanho = Number(resposta.headers.get('content-length') || 0);
    if (tamanho > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
    const texto = await resposta.text();
    if (texto.length > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
    return texto;
  }
  throw new Error('A fonte excedeu o limite de redirecionamentos.');
}

async function obterJson(url: string): Promise<unknown> {
  return JSON.parse(await obterTexto(url));
}

function textoPlano(valor: unknown): string {
  return String(valor ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 3000);
}

export function interpretarVagaRemotar(item: Record<string, unknown>, empresa: string): VagaColetada | null {
  if (item['active'] !== true || item['expired'] === true || typeof item['title'] !== 'string' || !Number.isInteger(item['id'])) return null;
  const id = String(item['id']);
  const link = String(item['externalLink'] ?? '');
  const publicadaEm = typeof item['createdAt'] === 'string' && Number.isFinite(Date.parse(item['createdAt']))
    ? new Date(item['createdAt']).toISOString() : undefined;
  return { idExterno: id, titulo: item['title'], empresa,
    url: link.startsWith('https://') ? link : `https://remotar.com.br/job/${id}`,
    localidade: [item['city'], item['state'], 'Remoto'].filter(Boolean).join(' · '),
    descricao: textoPlano(`${item['subtitle'] ?? ''} ${item['description'] ?? ''} ${item['moreInfos'] ?? ''}`), publicadaEm };
}

function interpretarVagaLever(item: Record<string, unknown>, empresa: string): VagaColetada | null {
  if (typeof item['id'] !== 'string' || typeof item['text'] !== 'string') return null;
  const url = String(item['hostedUrl'] ?? item['applyUrl'] ?? '');
  if (!url.startsWith('https://')) return null;
  const categorias = item['categories'] && typeof item['categories'] === 'object'
    ? item['categories'] as Record<string, unknown> : {};
  const modalidade = String(item['workplaceType'] ?? '').toLowerCase();
  const modalidadeExibida = modalidade === 'remote' ? 'Remoto'
    : modalidade === 'hybrid' ? 'Híbrido'
      : modalidade === 'onsite' || modalidade === 'on-site' ? 'Presencial' : '';
  const locais = Array.isArray(categorias['allLocations'])
    ? categorias['allLocations'].filter((local): local is string => typeof local === 'string') : [];
  const localPrincipal = String(categorias['location'] ?? '');
  const localidade = [...new Set([modalidadeExibida, localPrincipal, ...locais].filter(Boolean))].join(' · ');
  return {
    idExterno: item['id'], titulo: item['text'], empresa, url, localidade,
    descricao: textoPlano(item['descriptionPlain'] ?? item['description'] ?? '')
  };
}

async function coletarVagasLever(identificador: string, empresa: string): Promise<VagaColetada[]> {
  const [regiao, nome] = identificador.startsWith('eu:') ? ['eu', identificador.slice(3)] : ['', identificador];
  const host = regiao === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
  const vagas: VagaColetada[] = [];
  const limitePagina = 20;
  const maximoPaginas = 15;
  for (let pagina = 0; pagina < maximoPaginas; pagina++) {
    const url = new URL(`https://${host}/v0/postings/${nome}`);
    url.searchParams.set('mode', 'json');
    url.searchParams.set('limit', String(limitePagina));
    url.searchParams.set('skip', String(pagina * limitePagina));
    const dados = await obterJson(url.toString());
    if (!Array.isArray(dados)) throw new Error('Formato inesperado da API Lever.');
    vagas.push(...dados.map((item) => interpretarVagaLever(item as Record<string, unknown>, empresa))
      .filter((vaga): vaga is VagaColetada => vaga !== null));
    if (dados.length < limitePagina) return vagas;
  }
  const ultimaPagina = new URL(`https://${host}/v0/postings/${nome}`);
  ultimaPagina.searchParams.set('mode', 'json');
  ultimaPagina.searchParams.set('limit', '1');
  ultimaPagina.searchParams.set('skip', String(maximoPaginas * limitePagina));
  const restante = await obterJson(ultimaPagina.toString());
  if (Array.isArray(restante) && restante.length === 0) return vagas;
  throw new Error('A listagem Lever excedeu 300 vagas; a consulta foi interrompida com segurança.');
}

export async function coletarVagas(origem: OrigemIdentificada, empresa: string): Promise<VagaColetada[]> {
  if (!origem.identificador) throw new Error('Integração pendente para esta fonte.');
  if (origem.plataforma === 'recrutai') {
    const pagina = new URL(origem.url);
    const trecho = origem.identificador;
    const dados = await obterJson(`${pagina.origin}/company/public-jobs/${trecho}/*/*/*/?search=`) as { html?: string };
    if (typeof dados.html !== 'string') throw new Error('Listagem da Recrut.ai em formato inesperado.');
    const resumos = extrairListagemRecrut(dados.html, pagina.origin);
    if (!resumos.length && !/Nossas vagas\s*\(0\)/i.test(textoDaPagina(dados.html))) throw new Error('Vagas da Recrut.ai não encontradas no formato esperado.');
    const candidatas = resumos.filter((vaga) => /\b(j[uú]nior|jr\.?|trainee|est[aá]gi[oa])/i.test(vaga.titulo));
    if (candidatas.length > 30) throw new Error('Muitas vagas iniciais na Recrut.ai; consulta precisa de divisão em etapas.');
    const vagas: VagaColetada[] = [];
    for (const resumo of candidatas) vagas.push(extrairDetalheRecrut(await obterTexto(resumo.url, 'html'), resumo, empresa));
    return vagas;
  }
  if (origem.plataforma === 'ciandt') {
    return coletarVagasLever('ciandt', empresa);
  }
  if (origem.plataforma === 'cwi') {
    const resumos = extrairLinksCwi(await obterTexto(origem.url, 'html'));
    const vagas: VagaColetada[] = [];
    for (const resumo of resumos) vagas.push(extrairDetalheCwi(await obterTexto(resumo.url, 'html'), resumo, empresa));
    return vagas;
  }
  if (origem.plataforma === 'remotar') {
    const vagas: VagaColetada[] = [];
    for (let pagina = 1; pagina <= 5; pagina++) {
      const dados = await obterJson(`https://api.remotar.com.br/jobs?companyId=${origem.identificador}&page=${pagina}&active=true`) as {
        data?: Array<Record<string, unknown>>; meta?: { last_page?: number }
      };
      const ultimaPagina = dados.meta?.last_page;
      if (!Array.isArray(dados.data) || typeof ultimaPagina !== 'number' || !Number.isInteger(ultimaPagina)) throw new Error('Listagem da Remotar em formato inesperado.');
      for (const item of dados.data) {
        const vaga = interpretarVagaRemotar(item, empresa);
        if (vaga) vagas.push(vaga);
      }
      if (pagina >= ultimaPagina) return vagas;
    }
    throw new Error('Remotar possui mais de cinco páginas; paginação precisa ser ampliada.');
  }
  if (origem.plataforma === 'greenhouse') {
    const identificador = origem.identificador;
    const dados = await obterJson(`https://boards-api.greenhouse.io/v1/boards/${identificador}/jobs?content=true`) as { jobs?: Array<Record<string, unknown>> };
    if (!Array.isArray(dados.jobs)) throw new Error('Formato inesperado da API Greenhouse.');
    if (dados.jobs.length > 100) throw new Error('Fonte com mais de 100 vagas; paginação ainda não suportada.');
    return dados.jobs.map((item) => ({
      idExterno: String(item.id), titulo: String(item.title ?? ''), empresa,
      url: String(item.absolute_url ?? ''), localidade: String((item.location as { name?: string } | undefined)?.name ?? ''),
      descricao: textoPlano(item.content)
    })).filter((vaga) => vaga.idExterno && vaga.titulo && vaga.url.startsWith('https://'));
  }
  if (origem.plataforma === 'lever') {
    return coletarVagasLever(origem.identificador, empresa);
  }
  throw new Error('Integração pendente para esta fonte.');
}
