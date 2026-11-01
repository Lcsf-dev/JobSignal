import type { VagaColetada } from './classificador';
import { textoDaPagina } from './fontes-html.ts';

const base = 'https://inmetrics.gupy.io/';
type Registro = Record<string, unknown>;

function registro(valor: unknown): Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error('Dados da Inmetrics em formato inesperado.');
  }
  return valor as Registro;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? textoDaPagina(valor) : '';
}

function dadosDaPagina(html: string): Registro {
  const script = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Dados públicos da Inmetrics não encontrados.');
  const dados = registro(registro(registro(JSON.parse(script[1]))['props'])['pageProps']);
  if (dados['subdomain'] !== 'inmetrics') throw new Error('A página não pertence à Inmetrics.');
  return dados;
}

async function obterPagina(url: string): Promise<string> {
  const resposta = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': 'JobSignal/1.0 (monitor pessoal de vagas)' },
    redirect: 'error', signal: AbortSignal.timeout(25000)
  });
  if (!resposta.ok) throw new Error(`Inmetrics respondeu HTTP ${resposta.status}.`);
  if (Number(resposta.headers.get('content-length') || 0) > 1_000_000) {
    throw new Error('Resposta da Inmetrics maior que 1 MB.');
  }
  const html = await resposta.text();
  if (html.length > 1_000_000) throw new Error('Resposta da Inmetrics maior que 1 MB.');
  return html;
}

function localidade(modalidade: unknown, endereco: Registro): string {
  const valor = texto(modalidade);
  const traduzida = ({ remote: 'Remoto', hybrid: 'Híbrido', 'on-site': 'Presencial', onsite: 'Presencial' } as Record<string, string>)[valor] ?? valor;
  return [traduzida, texto(endereco['city']), texto(endereco['state']), texto(endereco['country'])]
    .filter(Boolean).join(' · ');
}

export function extrairListagemInmetrics(html: string, empresa: string): VagaColetada[] {
  const dados = dadosDaPagina(html);
  if (!Array.isArray(dados['jobs'])) throw new Error('Listagem da Inmetrics em formato inesperado.');
  const itens = dados['jobs'];
  if (itens.length > 500) throw new Error('A Inmetrics excedeu 500 anúncios.');
  // A paginação visual é feita no navegador; o HTML contém a lista completa.
  const pagina = textoDaPagina(html);
  const total = pagina.match(/\b(\d+)\s+(?:vagas? encontradas?|jobs? found)\b/i);
  if (total ? Number(total[1]) !== itens.length : itens.length > 0 || !/não há vagas|nenhuma vaga|no jobs/i.test(pagina)) {
    throw new Error('A listagem da Inmetrics está incompleta ou sem confirmação do total.');
  }
  const identificadores = new Set<string>();
  return itens.map((valor) => {
    const item = registro(valor);
    const id = item['id'];
    const titulo = texto(item['title']);
    if (!Number.isSafeInteger(id) || Number(id) <= 0 || !titulo || identificadores.has(String(id))) {
      throw new Error('Anúncio da Inmetrics inválido ou repetido.');
    }
    identificadores.add(String(id));
    const trabalho = registro(item['workplace']);
    return { idExterno: String(id), titulo, empresa, url: `${base}jobs/${id}`,
      localidade: localidade(trabalho['workplaceType'], registro(trabalho['address'])),
      descricao: texto(item['department']) };
  });
}

export async function coletarInmetrics(empresa: string): Promise<VagaColetada[]> {
  const vagas = extrairListagemInmetrics(await obterPagina(base), empresa);
  const iniciais = vagas.filter((vaga) => /\b(j[uú]nior|jr\b|trainee|est[aá]gi)/i.test(vaga.titulo));
  if (iniciais.length > 30) throw new Error('A Inmetrics excedeu 30 consultas de detalhes; divida a coleta em etapas.');
  for (const vaga of iniciais) {
    const item = registro(dadosDaPagina(await obterPagina(vaga.url))['job']);
    if (String(item['id']) !== vaga.idExterno || item['status'] !== 'published'
      || registro(item['company'])['subdomain'] !== 'inmetrics' || !texto(item['name'])) {
      throw new Error('A vaga da Inmetrics mudou ou foi encerrada durante a consulta.');
    }
    vaga.titulo = texto(item['name']);
    vaga.localidade = localidade(item['workplaceType'], {
      city: item['addressCity'], state: item['addressState'], country: item['addressCountry']
    });
    vaga.descricao = [item['responsibilities'], item['prerequisites'], item['relevantExperiences'], item['description']]
      .map(texto).filter(Boolean).join(' · ').slice(0, 3000);
    const publicada = texto(item['publishedAt']);
    if (Number.isFinite(Date.parse(publicada))) vaga.publicadaEm = new Date(publicada).toISOString();
  }
  return vagas;
}
