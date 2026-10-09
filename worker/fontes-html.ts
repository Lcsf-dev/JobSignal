import type { VagaColetada } from './classificador';

export function textoDaPagina(valor: string): string {
  return valor.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, numero: string) => String.fromCodePoint(Number(numero)))
    .replace(/&#x([\da-f]+);/gi, (_, numero: string) => String.fromCodePoint(parseInt(numero, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos|aacute|atilde|agrave|acirc|eacute|ecirc|iacute|oacute|otilde|ocirc|uacute|ccedil);/gi,
      (_, nome: string) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', atilde: 'ã', agrave: 'à', acirc: 'â', eacute: 'é', ecirc: 'ê', iacute: 'í', oacute: 'ó', otilde: 'õ', ocirc: 'ô', uacute: 'ú', ccedil: 'ç' })[nome.toLowerCase() as 'nbsp'] ?? ' ')
    .replace(/\s+/g, ' ').trim();
}

export interface ResumoVaga { id: string; titulo: string; url: string }

export function extrairListagemRecrut(html: string, base: string): ResumoVaga[] {
  const vagas = new Map<string, ResumoVaga>();
  const padrao = /<a\b[^>]*href=["']([^"']*?job\/([A-Z0-9]{4,20}))["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const item of html.matchAll(padrao)) {
    const id = item[2];
    let titulo = textoDaPagina(item[3]);
    if (/^(ver oportunidade|saiba mais|candidatar|ver vaga)$/i.test(titulo)) {
      const anterior = html.slice(Math.max(0, item.index - 1800), item.index);
      const titulos = [...anterior.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)];
      titulo = textoDaPagina(titulos.at(-1)?.[1] ?? '').replace(new RegExp(`^${id}\\s*`, 'i'), '').trim();
    }
    if (!titulo) continue;
    const url = new URL(item[1], base).toString();
    if (new URL(url).origin !== new URL(base).origin) continue;
    vagas.set(id, { id, titulo, url });
  }
  return [...vagas.values()];
}

export function extrairDetalheRecrut(html: string, resumo: ResumoVaga, empresa: string): VagaColetada {
  const inicio = html.indexOf('Descrição da Vaga');
  if (inicio < 0) throw new Error('Detalhes da vaga não encontrados na Recrut.ai.');
  const conteudo = textoDaPagina(html.slice(inicio, inicio + 18000)).slice(0, 3000);
  const modalidade = conteudo.match(/\b(Remoto|Remota|Home Office|Híbrido|Híbrida|Presencial)\b/i)?.[0] ?? '';
  const local = conteudo.match(/\b(?:Brasil|Brazil|BR|[A-ZÀ-Ú][a-zà-ú]+\s*[-/]\s*[A-Z]{2})\b/)?.[0] ?? '';
  return { idExterno: resumo.id, titulo: resumo.titulo, empresa, url: resumo.url,
    localidade: [modalidade, local].filter(Boolean).join(' · '), descricao: conteudo };
}

export function extrairVagasCiandt(html: string, empresa: string, base: string): VagaColetada[] {
  const blocos = html.split(/<div class="opprtunity-item"/i).slice(1);
  if (!blocos.length) throw new Error('Listagem de oportunidades da CI&T não encontrada.');
  if (blocos.length > 500) throw new Error('Listagem da CI&T excedeu o tamanho esperado.');
  return blocos.flatMap((bloco) => {
    const titulo = textoDaPagina(bloco.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '');
    const href = bloco.match(/<a\b[^>]*href="([^"]*candidate-se\?opportunity=([a-z\d-]+))"/i);
    if (!titulo || !href) return [];
    const filtros = textoDaPagina(bloco.match(/class="sr-only filters-item"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '').replace(/_/g, ' ');
    const url = new URL(href[1], base).toString();
    return [{ idExterno: href[2], titulo, empresa, url, localidade: filtros,
      descricao: filtros + (/Development|IT|Data|Infrastructure|Software|Quality|Support/i.test(filtros) ? ' tecnologia da informação' : '') }];
  });
}

export function extrairLinksCwi(html: string): ResumoVaga[] {
  const caminhos = new Map<string, ResumoVaga>();
  for (const item of html.matchAll(/href="(https:\/\/cwi\.com\.br\/talentos\/oportunidade\/([a-z\d-]+))"/gi)) {
    caminhos.set(item[2], { id: item[2], titulo: '', url: item[1] });
  }
  if (!caminhos.size) throw new Error('Listagem de oportunidades da CWI não encontrada.');
  if (caminhos.size > 40) throw new Error('Listagem da CWI excedeu o tamanho esperado.');
  return [...caminhos.values()];
}

export function extrairDetalheCwi(html: string, resumo: ResumoVaga, empresa: string): VagaColetada {
  const inicio = html.indexOf('<main id="content"');
  if (inicio < 0) throw new Error('Detalhes da vaga não encontrados na CWI.');
  const trecho = html.slice(inicio, inicio + 18000);
  const titulo = textoDaPagina(trecho.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').replace(/^Oportunidade:\s*/i, '');
  if (!titulo) throw new Error('Título da vaga não encontrado na CWI.');
  const modalidade = textoDaPagina(trecho.match(/class="pills__pill"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
  const descricao = textoDaPagina(trecho).slice(0, 3000);
  return { idExterno: resumo.id, titulo, empresa, url: resumo.url,
    localidade: `${modalidade} · Brasil`, descricao };
}

export function extrairLinksRemotar(html: string, base: string): ResumoVaga[] {
  if (/Não há vagas abertas no momento/i.test(textoDaPagina(html))) return [];
  const vagas = new Map<string, ResumoVaga>();
  for (const item of html.matchAll(/href="(\/job\/(\d+)\/[^"?#]+)"/gi)) {
    vagas.set(item[2], { id: item[2], titulo: '', url: new URL(item[1], base).toString() });
  }
  if (!vagas.size) throw new Error('Vagas da Remotar não encontradas no formato esperado.');
  if (vagas.size > 100) throw new Error('Listagem da Remotar excedeu o tamanho esperado.');
  return [...vagas.values()];
}

export function extrairDetalheRemotar(html: string, resumo: ResumoVaga, empresa: string): VagaColetada {
  const dados = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!dados) throw new Error('Detalhes da vaga não encontrados na Remotar.');
  const pagina = JSON.parse(dados[1]) as { props?: { pageProps?: { job?: Record<string, unknown> } } };
  const vaga = pagina.props?.pageProps?.job;
  if (!vaga) throw new Error('Dados da vaga não encontrados na Remotar.');
  const titulo = String(vaga['title'] ?? '');
  if (!titulo) throw new Error('Título da vaga não encontrado na Remotar.');
  return { idExterno: resumo.id, titulo, empresa, url: resumo.url, localidade: 'Remoto · Brasil',
    descricao: textoDaPagina(String(vaga['description'] ?? '')).slice(0, 3000) };
}
