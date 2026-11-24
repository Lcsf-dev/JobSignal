import type { VagaColetada } from './classificador';
import { textoDaPagina } from './fontes-html.ts';

interface AnuncioCatho {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  description?: unknown;
  jobLocation?: unknown;
  hiringOrganization?: unknown;
  datePublished?: unknown;
  active?: unknown;
}

interface RespostaCatho {
  notFound?: boolean;
  data?: {
    items?: AnuncioCatho[];
    nextPage?: number | null;
    query?: { workModel?: string[] };
  };
}

const endpointGecko = 'https://api.geckoapi.com.br/v1/extract';
const maximoPaginas = 5;
const ufsBrasileiras = /\b(?:AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i;

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function interpretarAnuncio(item: AnuncioCatho, empresa: string, remotoConfirmado: boolean, brasilNaBusca: boolean): VagaColetada | null {
  if (item.active === false || !Number.isSafeInteger(item.id) || Number(item.id) <= 0) return null;
  const id = String(item.id);
  const titulo = textoDaPagina(texto(item.title));
  if (!titulo) return null;

  let endereco: URL;
  try { endereco = new URL(texto(item.url)); }
  catch { return null; }
  if (endereco.protocol !== 'https:' || !['catho.com.br', 'www.catho.com.br'].includes(endereco.hostname)
    || (!endereco.pathname.endsWith(`/${id}`) && !endereco.pathname.endsWith(`/${id}/`))) return null;

  const localInformado = textoDaPagina(texto(item.jobLocation));
  const brasilConfirmado = brasilNaBusca || ufsBrasileiras.test(localInformado) || /\b(?:brasil|brazil)\b/i.test(localInformado);
  const data = texto(item.datePublished);
  return {
    idExterno: id,
    titulo,
    empresa: textoDaPagina(texto(item.hiringOrganization)) || empresa,
    url: endereco.toString(),
    localidade: [remotoConfirmado ? 'Remoto' : '', localInformado, brasilConfirmado ? 'Brasil' : ''].filter(Boolean).join(' · '),
    descricao: textoDaPagina(texto(item.description)).slice(0, 3000),
    ...(Number.isFinite(Date.parse(data)) ? { publicadaEm: new Date(data).toISOString() } : {})
  };
}

export async function coletarVagasCathoGecko(urlBusca: string, empresa: string, chave: string): Promise<VagaColetada[]> {
  const endereco = new URL(urlBusca);
  if (endereco.protocol !== 'https:' || !['catho.com.br', 'www.catho.com.br'].includes(endereco.hostname)
    || !endereco.pathname.startsWith('/vagas/')) throw new Error('URL da Catho inválida para a GeckoAPI.');
  const ufDaBusca = endereco.pathname.match(/-([a-z]{2})\/?$/i)?.[1]?.toUpperCase();
  const brasilNaBusca = !!ufDaBusca && ufsBrasileiras.test(ufDaBusca);
  const vagas = new Map<string, VagaColetada>();

  for (let pagina = 1; pagina <= maximoPaginas; pagina++) {
    const resposta = await fetch(endpointGecko, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url: urlBusca, target: 'catho.com.br', type: 'plp', workModel: ['remote'], page: pagina }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resposta.ok) {
      const motivo = resposta.status === 401 ? 'chave inválida'
        : resposta.status === 402 ? 'créditos insuficientes'
          : resposta.status === 429 ? 'limite de chamadas' : `HTTP ${resposta.status}`;
      throw new Error(`GeckoAPI Catho: ${motivo}.`);
    }
    const corpo = await resposta.text();
    if (corpo.length > 1_000_000) throw new Error('Resposta da GeckoAPI Catho maior que 1 MB.');
    let dados: RespostaCatho;
    try { dados = JSON.parse(corpo) as RespostaCatho; }
    catch { throw new Error('GeckoAPI Catho retornou JSON inválido.'); }
    if (dados.notFound || !Array.isArray(dados.data?.items)) {
      throw new Error('GeckoAPI Catho não retornou a listagem no formato esperado.');
    }
    if (!dados.data.items.length && pagina === 1) throw new Error('GeckoAPI Catho retornou a primeira página vazia.');

    const remotoConfirmado = dados.data.query?.workModel?.includes('remote') === true;
    for (const item of dados.data.items) {
      const vaga = interpretarAnuncio(item, empresa, remotoConfirmado, brasilNaBusca);
      if (vaga) vagas.set(vaga.idExterno, vaga);
    }
    const proximaPagina = dados.data.nextPage;
    if (proximaPagina == null) break;
    if (proximaPagina !== pagina + 1) throw new Error('GeckoAPI Catho retornou paginação inesperada.');
  }
  if (!vagas.size) throw new Error('GeckoAPI Catho não retornou anúncios válidos.');
  return [...vagas.values()];
}
