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

function decodificarAtributo(valor: string): string {
  return textoDaPagina(valor.replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'"));
}

function normalizarLink(href: string, base: string): string | null {
  try {
    const link = new URL(decodificarAtributo(href), base);
    return link.protocol === 'https:' ? link.toString() : null;
  } catch { return null; }
}

function valoresAtributo(html: string, nome: string): string | null {
  const escapar = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`\\b${escapar}=["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

function valorDaClasse(html: string, classe: string): string {
  const escapar = classe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return textoDaPagina(html.match(new RegExp(`<[^>]+class=["'][^"']*\\b${escapar}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1] ?? '');
}

export function reconstruirHtmlRaspado(
  plataforma: 'catho' | 'apinfo',
  elementos: Array<{ html?: string; attributes?: Array<{ name?: string; value?: string }> }>
): string {
  return elementos.map((elemento) => {
    const html = elemento.html ?? '';
    if (!html) return '';
    if (plataforma === 'apinfo') return '<div class="box-vagas linha pd">' + html + '</div>';
    const identificador = elemento.attributes?.find((atributo) => atributo.name === 'data-offer-item')?.value;
    return identificador && /^\d{1,20}$/.test(identificador)
      ? '<li data-offer-item="' + identificador + '">' + html + '</li>' : '';
  }).join('');
}

function vagasDoJsonGupy(html: string): Record<string, unknown>[] {
  const script = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) return [];
  const pagina = JSON.parse(script[1]) as { props?: { pageProps?: { initialJobList?: { data?: unknown; jobs?: unknown } } } };
  const lista = pagina.props?.pageProps?.initialJobList;
  const vagas = lista?.data ?? lista?.jobs;
  return Array.isArray(vagas) ? vagas.filter((vaga): vaga is Record<string, unknown> => !!vaga && typeof vaga === 'object') : [];
}

export function extrairVagasGupy(html: string, empresa: string, base: string): VagaColetada[] {
  const vagas = vagasDoJsonGupy(html);
  if (!vagas.length && !/nenhuma vaga encontrada|nenhuma vaga disponível/i.test(textoDaPagina(html))) {
    throw new Error('Listagem pública da Gupy sem dados no formato esperado.');
  }
  return vagas.slice(0, 100).flatMap((item) => {
    const id = String(item['id'] ?? '');
    const titulo = String(item['name'] ?? '').trim();
    const url = normalizarLink(String(item['jobUrl'] ?? ''), base);
    if (!id || !titulo || !url) return [];
    const cidade = String(item['city'] ?? '');
    const estado = String(item['state'] ?? '');
    const pais = String(item['country'] ?? item['countryName'] ?? '');
    const remoto = String(item['workplaceType'] ?? '').toLowerCase() === 'remote';
    const brasil = /^(br|brasil|brazil)$/i.test(pais) || /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/i.test(estado);
    const modalidade = remoto ? 'Remoto' : String(item['workplaceType'] ?? '');
    const localidade = [modalidade, cidade, estado, brasil ? 'Brasil' : pais].filter(Boolean).join(' · ');
    const publicada = String(item['publishedDate'] ?? '');
    return [{ idExterno: id, titulo, empresa: String(item['careerPageName'] ?? empresa), url,
      localidade, descricao: textoDaPagina(String(item['description'] ?? '')),
      ...(Number.isFinite(Date.parse(publicada)) ? { publicadaEm: new Date(publicada).toISOString() } : {}) }];
  });
}

export function extrairVagasInfojobs(html: string, empresa: string, base: string): VagaColetada[] {
  const marcadores = [...html.matchAll(/<div\b(?=[^>]*\bdata-id=["'](\d+)["'])(?=[^>]*\bjs_vacancyLoad\b)[^>]*>/gi)];
  if (!marcadores.length) throw new Error('Listagem do InfoJobs não encontrada no formato esperado.');
  if (marcadores.length > 100) throw new Error('Listagem do InfoJobs excedeu 100 anúncios.');
  return marcadores.flatMap((marcador, indice) => {
    const trecho = html.slice(marcador.index, marcadores[indice + 1]?.index ?? marcador.index + 12000);
    const id = marcador[1];
    const href = valoresAtributo(trecho, 'data-href') ?? trecho.match(/<a\b[^>]*href=["']([^"']*__\d+\.aspx[^"']*)["']/i)?.[1];
    const url = href ? normalizarLink(href, base) : null;
    const titulo = valorDaClasse(trecho, 'js_vacancyTitle') || textoDaPagina(trecho.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ?? '');
    if (!id || !url || !titulo) return [];
    const texto = textoDaPagina(trecho).slice(0, 3000);
    const empresaAnuncio = textoDaPagina(trecho.match(/<a\b[^>]*class=["'][^"']*company[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '') || empresa;
    return [{ idExterno: id, titulo, empresa: empresaAnuncio, url,
      localidade: `${texto} · Brasil`, descricao: texto }];
  });
}

export function extrairVagasCatho(html: string, empresa: string, base: string): VagaColetada[] {
  const itens = [...html.matchAll(/<li\b(?=[^>]*\bdata-offer-item=["'](\d+)["'])[^>]*>([\s\S]*?)(?=<li\b(?=[^>]*\bdata-offer-item=)|$)/gi)];
  if (!itens.length) throw new Error('Listagem da Catho não encontrada no formato esperado.');
  if (itens.length > 100) throw new Error('Listagem da Catho excedeu 100 anúncios.');
  return itens.flatMap((item) => {
    const trecho = item[2];
    const link = trecho.match(/<h2\b[^>]*class=["'][^"']*title_offer[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = link ? normalizarLink(link[1], base) : null;
    const titulo = link ? textoDaPagina(link[2]) : '';
    if (!url || !titulo) return [];
    const texto = textoDaPagina(trecho).slice(0, 3000);
    return [{ idExterno: item[1], titulo, empresa: valorDaClasse(trecho, 'company') || empresa,
      url, localidade: `${texto} · Brasil`, descricao: texto }];
  });
}

export function extrairVagasApinfo(html: string, empresa: string, base: string): VagaColetada[] {
  const blocos = html.split(/<div\b[^>]*class=["'][^"']*box-vagas\s+linha\s+pd[^"']*["'][^>]*>/i).slice(1);
  if (!blocos.length) throw new Error('Listagem da APInfo não encontrada no formato esperado.');
  if (blocos.length > 100) throw new Error('Listagem da APInfo excedeu 100 anúncios.');
  return blocos.flatMap((bloco) => {
    const href = bloco.match(/<a\b[^>]*href=["']([^"']*enviecv\.cfm\?[^"']*codvaga=(\d+)[^"']*)["']/i);
    const url = href ? normalizarLink(href[1], base) : null;
    if (!href || !url) return [];
    const cargo = bloco.match(/<div\b(?=[^>]*class=["'][^"']*\bcargo\b)[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
    const cargoSemMarcadores = cargo
      .replace(/<span\b(?=[^>]*class=["'][^"']*\bhighlight\b)[^>]*>\s*<\/span>/gi, '')
      .replace(/<[^>]*>/g, '');
    const titulo = textoDaPagina(cargoSemMarcadores)
      || valorDaClasse(bloco, 'cargo')
      || textoDaPagina(bloco.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1] ?? '');
    const texto = textoDaPagina(bloco).slice(0, 3000);
    if (!titulo) return [];
    return [{ idExterno: href[2], titulo, empresa, url, localidade: `${texto} · Brasil`, descricao: texto }];
  });
}

export function extrairVagasNerdin(html: string, empresa: string, base: string): VagaColetada[] {
  const inicios = [...html.matchAll(/<div\b(?=[^>]*class=["'][^"']*\bvaga-card\b)(?=[^>]*data-href=)[^>]*>/gi)];
  if (!inicios.length) throw new Error('Listagem da Nerdin não encontrada no formato esperado.');
  if (inicios.length > 100) throw new Error('Listagem da Nerdin excedeu 100 anúncios.');
  return inicios.flatMap((inicio, indice) => {
    const limite = inicios[indice + 1]?.index ?? inicio.index! + 12000;
    const bloco = html.slice(inicio.index! + inicio[0].length, limite);
    const href = valoresAtributo(inicio[0], 'data-href');
    const url = href ? normalizarLink(href, base) : null;
    const titulo = valorDaClasse(bloco, 'vaga-titulo');
    if (!href || !url || !titulo) return [];
    const id = href.match(/(\d+)(?:\.php)?(?:[?#]|$)/)?.[1] ?? url;
    const texto = textoDaPagina(bloco).slice(0, 3000);
    return [{ idExterno: id, titulo, empresa: valorDaClasse(bloco, 'vaga-empresa-nome') || empresa,
      url, localidade: `${texto} · Brasil`, descricao: texto }];
  });
}

export function extrairVagasGeekHunter(html: string, empresa: string, base: string): VagaColetada[] {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const vagas = new Map<string, VagaColetada>();
  for (const script of scripts) {
    let json: unknown;
    try { json = JSON.parse(script[1]); } catch { continue; }
    const listas: unknown[] = Array.isArray(json) ? json : [json];
    for (const lista of listas) {
      if (!lista || typeof lista !== 'object') continue;
      const item = lista as { '@type'?: unknown; itemListElement?: unknown };
      if (item['@type'] !== 'ItemList' || !Array.isArray(item.itemListElement)) continue;
      for (const entrada of item.itemListElement.slice(0, 100)) {
        if (!entrada || typeof entrada !== 'object') continue;
        const elemento = entrada as { url?: unknown; name?: unknown; item?: { url?: unknown; name?: unknown } };
        const linkBruto = String(elemento.url ?? elemento.item?.url ?? '');
        const url = normalizarLink(linkBruto, base);
        const titulo = String(elemento.name ?? elemento.item?.name ?? '').trim();
        if (!url || !titulo) continue;
        const chave = new URL(url).pathname;
        const posicao = html.indexOf(linkBruto);
        const texto = posicao >= 0 ? textoDaPagina(html.slice(Math.max(0, posicao - 1800), posicao + 2400)).slice(0, 3000) : titulo;
        vagas.set(chave, { idExterno: chave, titulo, empresa, url, localidade: texto, descricao: texto });
      }
    }
  }
  if (!vagas.size) throw new Error('Listagem GeekHunter não encontrada no formato esperado.');
  return [...vagas.values()];
}

export function extrairVagasVagasCom(html: string, empresa: string, base: string): VagaColetada[] {
  const blocos = html.split(/<li\b[^>]*class=["'][^"']*\bvaga\b[^"']*["'][^>]*>/i).slice(1);
  if (!blocos.length) throw new Error('Listagem do Vagas.com não encontrada no formato esperado.');
  if (blocos.length > 100) throw new Error('Listagem do Vagas.com excedeu 100 anúncios.');
  return blocos.flatMap((bloco) => {
    const link = bloco.match(/<a\b[^>]*class=["'][^"']*link-detalhes-vaga[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = link ? normalizarLink(link[1], base) : null;
    const titulo = link ? textoDaPagina(link[2]) || decodificarAtributo(valoresAtributo(link[0], 'title') ?? '') : '';
    const id = valoresAtributo(link?.[0] ?? '', 'data-id-vaga') ?? url?.match(/v(\d+)/)?.[1] ?? '';
    if (!url || !titulo || !id) return [];
    const texto = textoDaPagina(bloco).slice(0, 3000);
    return [{ idExterno: id, titulo, empresa: valorDaClasse(bloco, 'emprVaga') || empresa,
      url, localidade: `${texto} · Brasil`, descricao: texto }];
  });
}

export function extrairPaginaNttData(html: string, empresa: string): { total: number; quantidade: number; vagas: VagaColetada[] } {
  const conteudo = html.match(/phApp\.ddo\s*=\s*(\{[\s\S]*?\});\s*phApp\.experimentData/)?.[1];
  if (!conteudo) throw new Error('Dados de vagas da NTT DATA não encontrados na página oficial.');
  let dados: unknown;
  try { dados = JSON.parse(conteudo); }
  catch { throw new Error('Dados de vagas da NTT DATA estão em formato inválido.'); }
  const busca = (dados as { eagerLoadRefineSearch?: { totalHits?: unknown; data?: { jobs?: unknown } } })?.eagerLoadRefineSearch;
  if (!Number.isInteger(busca?.totalHits) || Number(busca?.totalHits) < 0 || !Array.isArray(busca?.data?.jobs)) {
    throw new Error('Listagem da NTT DATA não encontrada no formato esperado.');
  }
  const itens = busca.data.jobs as Array<Record<string, unknown>>;
  const vagas = itens.map((item) => {
    const id = item?.jobId;
    const titulo = item?.title;
    if (item?.country !== 'Brazil' || typeof id !== 'string' || !/^[a-z\d-]{4,80}$/i.test(id)
      || typeof titulo !== 'string' || !titulo.trim()) {
      throw new Error('A NTT DATA retornou uma vaga fora do Brasil ou com dados incompletos.');
    }
    const publicadaEm = typeof item.postedDate === 'string' && Number.isFinite(Date.parse(item.postedDate))
      ? new Date(item.postedDate).toISOString() : undefined;
    const localidades = Array.isArray(item.multi_location) ? item.multi_location.filter((local): local is string => typeof local === 'string') : [];
    const localidade = [...new Set([item.remoteType, item.location, ...localidades]
      .filter((local): local is string => typeof local === 'string' && !!local.trim()))].join(' · ').slice(0, 1000);
    const descricao = [item.descriptionTeaser, item.category]
      .filter((parte): parte is string => typeof parte === 'string' && !!parte.trim()).join(' · ').slice(0, 3000);
    return { idExterno: id, titulo: titulo.trim(), empresa,
      url: `https://careers.nttdata.com/br/pt/job/${encodeURIComponent(id)}`,
      localidade, descricao, publicadaEm };
  });
  return { total: Number(busca.totalHits), quantidade: itens.length, vagas };
}

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
