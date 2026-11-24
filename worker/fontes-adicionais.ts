import type { VagaColetada } from './classificador';
import { textoDaPagina } from './fontes-html.ts';

export type PlataformaAdicional = 'inhire' | 'compleo' | 'capgemini' | 'ibm' | 'foursys';
type Registro = Record<string, unknown>;
const limitePaginas = 25;
const inicioDeCarreira = /\b(j[uú]nior|jr\b|trainee|est[aá]gi)/i;

function registro(valor: unknown): Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Anúncio em formato inesperado.');
  return valor as Registro;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? textoDaPagina(valor) : '';
}

function modalidadeInformada(valor: unknown): string {
  const informada = texto(valor);
  return ({ remote: 'Remoto', hybrid: 'Híbrido', 'on-site': 'Presencial', onsite: 'Presencial', 'on site': 'Presencial' } as Record<string, string>)[informada.toLowerCase()] ?? informada;
}

function linkOficial(valor: unknown, hosts: string[]): string {
  const endereco = new URL(typeof valor === 'string' ? valor : '');
  if (endereco.protocol !== 'https:' || endereco.username || endereco.password || endereco.port
    || !hosts.includes(endereco.hostname)) throw new Error('Link de candidatura fora do domínio esperado.');
  return endereco.toString();
}

async function obter(url: string, opcoes: RequestInit = {}): Promise<string> {
  const resposta = await fetch(url, { ...opcoes, redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { Accept: 'application/json, text/html', 'User-Agent': 'JobSignal/1.0 (monitor pessoal de vagas)', ...opcoes.headers } });
  if (!resposta.ok || resposta.status === 202) throw new Error(`Fonte respondeu HTTP ${resposta.status}.`);
  if (Number(resposta.headers.get('content-length') || 0) > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
  const corpo = await resposta.text();
  if (corpo.length > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
  return corpo;
}

async function obterJson(url: string, opcoes?: RequestInit): Promise<Registro> {
  return registro(JSON.parse(await obter(url, opcoes)));
}

function guardar(vagas: Map<string, VagaColetada>, vaga: VagaColetada): void {
  if (!vaga.idExterno || !vaga.titulo) throw new Error('Anúncio sem identificador ou título.');
  if (vagas.has(vaga.idExterno)) throw new Error('A fonte repetiu anúncios durante a paginação.');
  vagas.set(vaga.idExterno, vaga);
}

export function montarLinkInhire(id: string, titulo: string, identificador = 'mjv'): string {
  const trecho = titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  if (!['mjv', 'dataside'].includes(identificador) || !/^[a-z0-9-]{1,80}$/i.test(id) || !trecho) throw new Error('Identificador ou título InHire inválido para o link.');
  return `https://${identificador}.inhire.app/vagas/${id}/${trecho}`;
}

export async function coletarInhire(empresa: string, identificador = 'mjv'): Promise<VagaColetada[]> {
  if (!['mjv', 'dataside'].includes(identificador)) throw new Error('Empresa InHire não reconhecida.');
  const base = 'https://api.inhire.app/job-posts/public/pages';
  const opcoes = { headers: { 'X-Tenant': identificador } };
  const dados = await obterJson(base, opcoes);
  if (!Array.isArray(dados['jobsPage'])) throw new Error('Listagem InHire em formato inesperado.');
  if (dados['jobsPage'].length > 500) throw new Error('A InHire excedeu 500 anúncios.');
  const vagas = new Map<string, VagaColetada>();
  let detalhes = 0;
  for (const valor of dados['jobsPage']) {
    let item = registro(valor);
    if (item['status'] !== 'published') continue;
    const id = texto(item['jobId']);
    if (!/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error('Identificador InHire inválido.');
    if (inicioDeCarreira.test(texto(item['displayName']))) {
      if (++detalhes > 30) throw new Error('A InHire excedeu 30 consultas de detalhes; divida a coleta em etapas.');
      item = await obterJson(`${base}/${id}`, opcoes);
      if (item['jobId'] !== id || item['status'] !== 'published') throw new Error('A vaga InHire mudou durante a consulta.');
    }
    const modalidade = modalidadeInformada(item['workplaceType']);
    const publicada = texto(item['publishedAt']);
    guardar(vagas, { idExterno: id, titulo: texto(item['displayName']), empresa,
      url: montarLinkInhire(id, texto(item['displayName']), identificador),
      localidade: [modalidade, texto(item['location']), texto(item['locationComplement'])].filter(Boolean).join(' · '),
      descricao: texto(item['description']).slice(0, 3000),
      ...(Number.isFinite(Date.parse(publicada)) ? { publicadaEm: new Date(publicada).toISOString() } : {}) });
  }
  return [...vagas.values()];
}

export async function coletarCapgemini(empresa: string): Promise<VagaColetada[]> {
  const vagas = new Map<string, VagaColetada>();
  for (let pagina = 1; pagina <= limitePaginas; pagina++) {
    const dados = await obterJson(`https://cg-jobstream-api.azurewebsites.net/api/job-search?country_code=br-pt&size=20&page=${pagina}`);
    const total = dados['count'];
    if (!Array.isArray(dados['data']) || !Number.isSafeInteger(total) || Number(total) < 0) throw new Error('Listagem Capgemini em formato inesperado.');
    if (Number(total) > 500) throw new Error('A Capgemini excedeu 500 anúncios.');
    const itens = dados['data'];
    if (!itens.length && vagas.size < Number(total)) throw new Error('A Capgemini retornou página vazia antes do fim.');
    for (const valor of itens) {
      const item = registro(valor);
      if (!/^(?:pt-br|br-pt)$/i.test(texto(item['country_code']))) throw new Error('A Capgemini retornou vaga fora do filtro brasileiro.');
      guardar(vagas, { idExterno: texto(item['id']), titulo: texto(item['title']), empresa,
        url: linkOficial(item['apply_job_url'], ['careers.capgemini.com', 'www.capgemini.com']),
        localidade: [texto(item['location']), 'Brasil'].filter(Boolean).join(' · '),
        descricao: texto(item['description_stripped'] || item['description']).slice(0, 3000) });
    }
    if (vagas.size >= Number(total)) return [...vagas.values()];
  }
  throw new Error('A Capgemini excedeu o limite de paginação.');
}

export async function coletarIbm(empresa: string): Promise<VagaColetada[]> {
  const vagas = new Map<string, VagaColetada>();
  for (let pagina = 0; pagina <= limitePaginas; pagina++) {
    const dados = await obterJson('https://www-api.ibm.com/search/api/v2', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        appId: 'careers', scopes: ['careers2'], query: { bool: { must: [] } },
        post_filter: { bool: { must: [{ term: { field_keyword_05: 'Brazil' } }] } },
        size: 20, from: pagina * 20, sort: [{ _score: 'desc' }, { pageviews: 'desc' }],
        lang: 'zz', localeSelector: {}, sm: { query: '', lang: 'zz' },
        _source: ['title', 'url', 'description', 'field_keyword_05', 'field_keyword_17', 'field_keyword_19']
      })
    });
    const itens = registro(dados['hits'])['hits'];
    if (dados['timed_out'] === true || Number(registro(dados['_shards'])['failed']) > 0) throw new Error('A IBM retornou uma busca incompleta.');
    if (!Array.isArray(itens)) throw new Error('Listagem IBM em formato inesperado.');
    if (pagina === limitePaginas && itens.length) throw new Error('A IBM excedeu 500 anúncios.');
    for (const valor of itens) {
      const item = registro(registro(valor)['_source']);
      if (item['field_keyword_05'] !== 'Brazil') throw new Error('A IBM retornou vaga fora do Brasil.');
      const url = linkOficial(item['url'], ['careers.ibm.com']);
      const id = new URL(url).searchParams.get('jobId');
      if (!id || !/^\d+$/.test(id)) throw new Error('Identificador IBM não encontrado no link.');
      guardar(vagas, { idExterno: id, titulo: texto(item['title']), empresa, url,
        localidade: [modalidadeInformada(item['field_keyword_17']), texto(item['field_keyword_19']), 'Brasil'].filter(Boolean).join(' · '),
        descricao: texto(item['description']).slice(0, 3000) });
    }
    if (itens.length < 20) return [...vagas.values()];
  }
  throw new Error('A IBM excedeu o limite de paginação.');
}

export function extrairPaginaCompleo(html: string, empresa: string, base: string): { vagas: VagaColetada[]; paginas: number[] } {
  const itens = [...html.matchAll(/<h5\b[^>]*class=["'][^"']*\btitulo-vaga\b[^"']*["'][^>]*>([\s\S]*?)<\/h5>([\s\S]*?)<a\b[^>]*href=["'](\/Visualizar\/(\d+))["']/gi)];
  if (!itens.length && !/Esta pesquisa não retornou resultados\./i.test(textoDaPagina(html))) throw new Error('Listagem Compleo em formato inesperado.');
  if (itens.length > 100) throw new Error('A página Compleo excedeu 100 anúncios.');
  return { vagas: itens.map(item => ({ idExterno: item[4], titulo: textoDaPagina(item[1]), empresa,
    url: new URL(item[3], base).toString(), localidade: textoDaPagina(item[2]).replace(/Publicada em:.*$/i, '').trim(),
    descricao: '' })), paginas: [...html.matchAll(/\bdata-pagina=["'](\d+)["']/gi)].map(item => Number(item[1])) };
}

export async function coletarCompleo(empresa: string): Promise<VagaColetada[]> {
  const base = 'https://ebix.compleo.com.br';
  const vagas = new Map<string, VagaColetada>();
  for (let pagina = 1; pagina <= limitePaginas; pagina++) {
    const dados = await obterJson(`${base}/Pesquisar?page=${pagina}&pesquisa=`);
    if (dados['sucesso'] !== true || typeof dados['viewLista'] !== 'string') throw new Error('Consulta Compleo em formato inesperado.');
    const resultado = extrairPaginaCompleo(dados['viewLista'], empresa, base);
    if (!resultado.vagas.length && pagina > 1) throw new Error('O Compleo retornou página vazia durante a paginação.');
    for (const vaga of resultado.vagas) guardar(vagas, vaga);
    if (!resultado.paginas.some(numero => numero > pagina)) {
      const iniciais = [...vagas.values()].filter(vaga => inicioDeCarreira.test(vaga.titulo));
      if (iniciais.length > 30) throw new Error('O Compleo excedeu 30 consultas de detalhes; divida a coleta em etapas.');
      for (const vaga of iniciais) {
        const html = await obter(vaga.url);
        const inicio = html.search(/<div\b[^>]*class=["']visualizar-vaga["']/i);
        if (inicio < 0) throw new Error('Detalhe Compleo em formato inesperado.');
        vaga.descricao = textoDaPagina(html.slice(inicio).split(/<script\b|<footer\b/i)[0]).slice(0, 3000);
      }
      return [...vagas.values()];
    }
  }
  throw new Error('O Compleo excedeu o limite de paginação.');
}

function campoFoursys(html: string, campo: string): string {
  return textoDaPagina(html.match(new RegExp(`<[^>]+class=["']cr-vagas-card__${campo}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1] ?? '');
}

export function extrairFoursys(html: string, empresa: string): VagaColetada[] {
  const itens = [...html.matchAll(/<article\b[^>]*class=["']cr-vagas-card["'][^>]*>([\s\S]*?)<\/article>/gi)];
  if (!itens.length) throw new Error('Cartões Foursys não encontrados; consulte a página oficial.');
  if (itens.length > 100) throw new Error('A Foursys excedeu 100 cartões.');
  const vagas = new Map<string, VagaColetada>();
  for (const item of itens) {
    const href = item[1].match(/<a\b[^>]*href=["'](https:\/\/www\.linkedin\.com\/jobs\/view\/\d+\/?)["']/i)?.[1];
    const id = href?.match(/\/view\/(\d+)/)?.[1];
    if (!href || !id) throw new Error('Link Foursys em formato inesperado.');
    const localidade = item[1].match(/<p\b[^>]*class=["']cr-vagas-card__location["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
    const modalidades = [...item[1].matchAll(/<span\b[^>]*class=["'][^"']*cr-vagas-card__tag\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map(item => textoDaPagina(item[1]));
    guardar(vagas, { idExterno: id, titulo: campoFoursys(item[1], 'title'), empresa, url: href,
      localidade: [textoDaPagina(localidade), ...modalidades].filter(Boolean).join(' · '),
      descricao: campoFoursys(item[1], 'level') });
  }
  return [...vagas.values()];
}

export async function coletarFonteAdicional(plataforma: PlataformaAdicional, empresa: string, identificador: string | null = null): Promise<VagaColetada[]> {
  switch (plataforma) {
    case 'inhire': return coletarInhire(empresa, identificador ?? 'mjv');
    case 'compleo': return coletarCompleo(empresa);
    case 'capgemini': return coletarCapgemini(empresa);
    case 'ibm': return coletarIbm(empresa);
    case 'foursys': return extrairFoursys(await obter('https://foursys.com.br/carreiras'), empresa);
  }
}
