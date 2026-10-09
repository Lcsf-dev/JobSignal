import type { VagaColetada } from './classificador';

export interface OrigemIdentificada {
  plataforma: 'greenhouse' | 'lever' | 'pendente';
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
  return { plataforma: 'pendente', identificador: null, url: url.toString() };
}

async function obterJson(url: string): Promise<unknown> {
  const resposta = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (!resposta.ok) throw new Error(`Fonte respondeu HTTP ${resposta.status}.`);
  const tamanho = Number(resposta.headers.get('content-length') || 0);
  if (tamanho > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
  const texto = await resposta.text();
  if (texto.length > 1_000_000) throw new Error('Resposta maior que 1 MB; fonte precisa de paginação.');
  return JSON.parse(texto);
}

function textoPlano(valor: unknown): string {
  return String(valor ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim().slice(0, 3000);
}

export async function coletarVagas(origem: OrigemIdentificada, empresa: string): Promise<VagaColetada[]> {
  if (!origem.identificador) throw new Error('Integração pendente para esta fonte.');
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
    const [regiao, nome] = origem.identificador.startsWith('eu:') ? ['eu', origem.identificador.slice(3)] : ['', origem.identificador];
    const host = regiao === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const dados = await obterJson(`https://${host}/v0/postings/${nome}?mode=json&limit=100`) as Array<Record<string, unknown>>;
    if (!Array.isArray(dados)) throw new Error('Formato inesperado da API Lever.');
    if (dados.length >= 100) throw new Error('Fonte com 100 ou mais vagas; paginação ainda não suportada.');
    return dados.map((item) => ({
      idExterno: String(item.id), titulo: String(item.text ?? ''), empresa,
      url: String(item.hostedUrl ?? item.applyUrl ?? ''),
      localidade: String((item.categories as { location?: string } | undefined)?.location ?? ''),
      descricao: textoPlano(item.descriptionPlain ?? item.description ?? '')
    })).filter((vaga) => vaga.idExterno && vaga.titulo && vaga.url.startsWith('https://'));
  }
  throw new Error('Integração pendente para esta fonte.');
}
