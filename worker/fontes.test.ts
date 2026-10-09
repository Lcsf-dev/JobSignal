import assert from 'node:assert/strict';
import test from 'node:test';
import { coletarVagas, identificarOrigem, interpretarVagaRemotar } from './fontes.ts';
import {
  extrairDetalheCwi, extrairDetalheRecrut, extrairListagemRecrut, extrairVagasApinfo,
  extrairVagasCatho, extrairVagasCiandt, extrairVagasGeekHunter, extrairVagasGupy,
  extrairPaginaNttData, extrairVagasInfojobs, extrairVagasNerdin, extrairVagasVagasCom, reconstruirHtmlRaspado,
  textoDaPagina
} from './fontes-html.ts';

test('identifica as fontes cadastradas do JobSignal', () => {
  assert.equal(identificarOrigem('https://datum.jobs.recrut.ai/').plataforma, 'recrutai');
  assert.equal(identificarOrigem('https://datum.jobs.recrut.ai/mginfo#openings').identificador, 'mginfo');
  assert.equal(identificarOrigem('https://insi.jobs.recrut.ai/vagas#openings').identificador, 'vagas');
  assert.equal(identificarOrigem('https://ciandt.com/br/pt-br/carreiras/oportunidades').plataforma, 'ciandt');
  assert.equal(identificarOrigem('https://cwi.com.br/talentos/oportunidades/').plataforma, 'cwi');
  assert.equal(identificarOrigem('https://remotar.com.br/company/303/confitec').identificador, '303');
  assert.equal(identificarOrigem('https://careers.emeal.nttdata.com/s/jobs?language=pt_BR').plataforma, 'nttdata');
  assert.equal(identificarOrigem('https://careers.nttdata.com/br/pt/search-results').plataforma, 'nttdata');
  assert.equal(identificarOrigem('https://careers.emeal.nttdata.com/s/jobs').url,
    'https://careers.nttdata.com/br/pt/search-results?qcountry=Brazil');
  assert.equal(identificarOrigem('https://portal.gupy.io/job-search/term=TI').plataforma, 'gupy');
  assert.equal(identificarOrigem('https://www.infojobs.com.br/vagas-de-ti.aspx').plataforma, 'infojobs');
  assert.equal(identificarOrigem('https://www.catho.com.br/vagas/ti/rio-de-janeiro-rj/').plataforma, 'catho');
  assert.equal(identificarOrigem('https://www.apinfo.com/apinfo/inc/list4.cfm').plataforma, 'apinfo');
  assert.equal(identificarOrigem('https://www.nerdin.com.br/vagas.php').plataforma, 'nerdin');
  assert.equal(identificarOrigem('https://www.geekhunter.com/pt/vagas').plataforma, 'geekhunter');
  assert.equal(identificarOrigem('https://www.vagas.com.br/vagas-de-ti-em-rio-de-janeiro').plataforma, 'vagas');
});

test('usa a API Lever paginada para consultar as vagas públicas da CI&T', async () => {
  const chamadas: string[] = [];
  const vagaLever = (id: number) => ({ id: `id-${id}`, text: `Vaga ${id}`, hostedUrl: `https://jobs.lever.co/ciandt/id-${id}`,
    workplaceType: 'remote', categories: { location: 'Brazil', allLocations: ['Brazil'] }, descriptionPlain: 'Engenharia de software.' });
  const respostaAnterior = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL) => {
    const endereco = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    chamadas.push(endereco.searchParams.get('skip') ?? '');
    const registros = endereco.searchParams.get('skip') === '0'
      ? Array.from({ length: 20 }, (_, indice) => vagaLever(indice))
      : [vagaLever(20), vagaLever(21)];
    return new Response(JSON.stringify(registros), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const vagas = await coletarVagas(identificarOrigem('https://ciandt.com/br/pt-br/carreiras/oportunidades'), 'CI&T');
    assert.equal(vagas.length, 22);
    assert.deepEqual(chamadas, ['0', '20']);
    assert.match(vagas[0]?.localidade ?? '', /Remoto/);
    assert.match(vagas[0]?.localidade ?? '', /Brazil/);
  } finally { globalThis.fetch = respostaAnterior; }
});

test('guarda a data publicada pela Remotar e ignora vagas inativas', () => {
  const vaga = interpretarVagaRemotar({ id: 303, active: true, expired: false, title: 'Analista Júnior',
    createdAt: '2026-09-15T08:47:22.387-03:00', externalLink: 'https://confitec.gupy.io/job/303' }, 'Confitec');
  assert.equal(vaga?.publicadaEm, '2026-09-15T11:47:22.387Z');
  assert.equal(interpretarVagaRemotar({ id: 304, active: false, title: 'Vaga encerrada' }, 'Confitec'), null);
});

test('extrai vagas e detalhes da listagem Recrut.ai sem executar HTML', () => {
  const html = '<div><h5><span>AB1234</span><br />Analista de Sistemas Júnior</h5><a href="/mginfo/job/AB1234">VER OPORTUNIDADE</a></div>';
  const [resumo] = extrairListagemRecrut(html, 'https://datum.jobs.recrut.ai');
  assert.equal(resumo?.titulo, 'Analista de Sistemas Júnior');
  const vaga = extrairDetalheRecrut('<h1>Descrição da Vaga</h1><b>Analista de Sistemas Júnior</b> Remoto Brasil TI', resumo!, 'MG Info');
  assert.equal(vaga.idExterno, 'AB1234');
  assert.equal(vaga.empresa, 'MG Info');
  assert.match(vaga.localidade, /Remoto/);
});

test('extrai metadados de elegibilidade e links da CI&T', () => {
  const html = '<div class="opprtunity-item"><span class="sr-only filters-item">País_Brazil Workplace_type_Remote Área_Development___Quality_Assurance</span><h2>Junior Java Developer</h2><a href="/br/pt-br/carreiras/oportunidades/candidate-se?opportunity=893e578b-5f6b-4ebd-9420-e6e866a5dcf1">Candidate-se</a></div>';
  const [vaga] = extrairVagasCiandt(html, 'CI&T', 'https://ciandt.com');
  assert.equal(vaga?.titulo, 'Junior Java Developer');
  assert.match(vaga?.descricao ?? '', /tecnologia da informação/);
  assert.match(vaga?.localidade ?? '', /Remote/);
});

test('normaliza HTML de detalhe da CWI e entidades comuns', () => {
  const pagina = '<main id="content"><h1>Oportunidade: Desenvolvedor(a) Java</h1><span class="pills__pill">Remoto</span><p>Trabalhe no Brasil &amp; evolua.</p></main>';
  const resumo = { id: 'vaga-java-1', titulo: '', url: 'https://cwi.com.br/talentos/oportunidade/vaga-java-1' };
  const vaga = extrairDetalheCwi(pagina, resumo, 'CWI');
  assert.equal(vaga.titulo, 'Desenvolvedor(a) Java');
  assert.match(vaga.localidade, /Remoto/);
  assert.match(textoDaPagina('Brasil &amp; vagas'), /Brasil & vagas/);
});

test('lê os dados públicos embutidos da Gupy e preserva modalidade e localidade', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"initialJobList":{"data":[{"id":123,"name":"Estágio em Desenvolvimento","jobUrl":"/job/123","workplaceType":"remote","city":"São Paulo","state":"SP","country":"Brazil","description":"TI"}]}}}}</script>';
  const [vaga] = extrairVagasGupy(html, 'Empresa', 'https://portal.gupy.io/job-search/term=TI');
  assert.equal(vaga?.idExterno, '123');
  assert.match(vaga?.localidade ?? '', /Remoto/);
  assert.match(vaga?.localidade ?? '', /Brasil/);
});

test('extrai anúncios das listagens públicas dos sete portais estáticos restantes', () => {
  const infojobs = '<div id="vacancy123456" data-id="123456" class="js_vacancyLoad"><a data-href="/vaga-de-estagio-ti__123456.aspx"></a><h2 class="js_vacancyTitle">Estágio em TI</h2></div>';
  const catho = '<li data-offer-item="38669900"><article><h2 class="title_offer"><a href="/vagas/estagio-ti/38669900">Estágio em TI</a></h2><p>Remoto</p></article></li>';
  const apinfo = '<div class="box-vagas linha pd"><span class="cargo">Estágio Desenvolvedor</span><a href="/apinfo/enviecv.cfm?codvaga=85383&amp;pkey=abc">Candidatar</a><p>Home Office</p></div>';
  const nerdin = '<div class="vaga-card" data-href="vaga_emprego/vaga-estagio-ti-99636.php"><span class="vaga-titulo">Estágio TI</span><span class="vaga-empresa-nome">Empresa X</span><p>Remoto</p></div>';
  const geekhunter = '<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"name":"Estágio Desenvolvedor","url":"https://www.geekhunter.com/pt/vagas/estagio-dev"}]}</script><a href="https://www.geekhunter.com/pt/vagas/estagio-dev">Estágio Desenvolvedor</a><p>Remoto Brasil</p>';
  const vagasCom = '<li class="vaga odd"><a class="link-detalhes-vaga" data-id-vaga="2835175" title="Estagiário(a) - Infraestrutura TI" href="/vagas/v2835175/estagio-ti"></a><span class="emprVaga">Empresa Y</span><span class="vaga-local">Remoto</span></li>';
  assert.equal(extrairVagasInfojobs(infojobs, 'InfoJobs', 'https://www.infojobs.com.br/vagas-de-ti.aspx').length, 1);
  assert.equal(extrairVagasCatho(catho, 'Catho', 'https://www.catho.com.br/vagas/ti/')[0]?.titulo, 'Estágio em TI');
  assert.match(extrairVagasApinfo(apinfo, 'APInfo', 'https://www.apinfo.com/apinfo/inc/list4.cfm')[0]?.url ?? '', /codvaga=85383/);
  assert.equal(extrairVagasNerdin(nerdin, 'Nerdin', 'https://www.nerdin.com.br/vagas.php')[0]?.idExterno, '99636');
  assert.equal(extrairVagasGeekHunter(geekhunter, 'GeekHunter', 'https://www.geekhunter.com/pt/vagas')[0]?.titulo, 'Estágio Desenvolvedor');
  assert.equal(extrairVagasVagasCom(vagasCom, 'Vagas.com', 'https://www.vagas.com.br/vagas-de-ti')[0]?.idExterno, '2835175');
});

test('reconstrói os cartões internos do Browser Run para Catho e APInfo', () => {
  const cathoHtml = reconstruirHtmlRaspado('catho', [{
    html: '<article><h2 class=\"title_offer\"><a href=\"/vagas/estagio-ti/38669900\">Estágio em TI</a></h2><p>Remoto</p></article>',
    attributes: [{ name: 'data-offer-item', value: '38669900' }]
  }]);
  const vagaCatho = extrairVagasCatho(cathoHtml, 'Catho', 'https://www.catho.com.br/vagas/ti/');
  assert.equal(vagaCatho[0]?.idExterno, '38669900');
  assert.equal(vagaCatho[0]?.titulo, 'Estágio em TI');

  const apinfoHtml = reconstruirHtmlRaspado('apinfo', [{
    html: '<div class=\"cargo m-tb\">Anal<span class=\"highlight\"></span>ista Júnior</div><div>Home Office</div><a href=\"https://www.apinfo.com/apinfo/inc/enviecv.cfm?codvaga=85904&amp;pkey=teste\">Candidatar</a>'
  }]);
  const vagaApinfo = extrairVagasApinfo(apinfoHtml, 'APInfo', 'https://www.apinfo.com/apinfo/inc/list4.cfm');
  assert.equal(vagaApinfo[0]?.idExterno, '85904');
  assert.equal(vagaApinfo[0]?.titulo, 'Analista Júnior');
  assert.match(vagaApinfo[0]?.localidade ?? '', /Home Office/);
});

test('consulta Catho com agente identificado e lê vagas sem usar Browser Run', async () => {
  const url = 'https://www.catho.com.br/vagas/ti/rio-de-janeiro-rj/';
  const html = '<li data-offer-item=\"38669900\"><article><h2 class=\"title_offer\"><a href=\"/vagas/estagio-ti/38669900\">Estágio em TI</a></h2><p>Remoto</p></article></li>';
  const fetchAnterior = globalThis.fetch;
  let agenteRecebido = '';
  globalThis.fetch = (async (_entrada: RequestInfo | URL, opcoes?: RequestInit) => {
    agenteRecebido = new Headers(opcoes?.headers).get('User-Agent') ?? '';
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch;
  try {
    const vagas = await coletarVagas(identificarOrigem(url), 'Catho');
    assert.ok(agenteRecebido.startsWith('Mozilla/5.0 (compatible; JobSignal/1.0'));
    assert.equal(vagas[0]?.titulo, 'Estágio em TI');
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

function paginaNttData(total: number, vagas: Array<Record<string, unknown>>): string {
  return `<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { totalHits: total, data: { jobs: vagas } } })};phApp.experimentData = {};</script>`;
}

test('lê os dados públicos da NTT DATA e usa o link oficial da vaga', () => {
  const pagina = paginaNttData(1, [{ jobId: 'abc12345', title: 'Pessoa Analista Júnior', country: 'Brazil',
    location: 'São Paulo, Brazil', remoteType: 'Remote', descriptionTeaser: 'Início de carreira em tecnologia.',
    postedDate: '2026-10-08T12:00:00-03:00' }]);
  const resultado = extrairPaginaNttData(pagina, 'NTT DATA');
  assert.equal(resultado.total, 1);
  assert.equal(resultado.vagas[0]?.url, 'https://careers.nttdata.com/br/pt/job/abc12345');
  assert.match(resultado.vagas[0]?.localidade ?? '', /Remote/);
  assert.equal(resultado.vagas[0]?.publicadaEm, '2026-10-08T15:00:00.000Z');
});

test('consulta todas as páginas brasileiras da NTT DATA sem Browser Run', async () => {
  const enderecos: string[] = [];
  const fetchAnterior = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL) => {
    const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
    enderecos.push(url.toString());
    const deslocamento = Number(url.searchParams.get('from') ?? 0);
    const vagas = Array.from({ length: deslocamento ? 2 : 10 }, (_, indice) => ({
      jobId: `vaga${deslocamento + indice}`, title: 'Analista Júnior', country: 'Brazil', location: 'Brazil'
    }));
    return new Response(paginaNttData(12, vagas), { headers: { 'Content-Type': 'text/html' } });
  }) as typeof fetch;
  try {
    const vagas = await coletarVagas(identificarOrigem('https://careers.emeal.nttdata.com/s/jobs'), 'NTT DATA');
    assert.equal(vagas.length, 12);
    assert.deepEqual(enderecos.map((endereco) => new URL(endereco).searchParams.get('from')), [null, '10']);
    assert.ok(enderecos.every((endereco) => new URL(endereco).searchParams.get('qcountry') === 'Brazil'));
  } finally { globalThis.fetch = fetchAnterior; }
});

test('interrompe a coleta da NTT DATA se o filtro brasileiro não for respeitado', () => {
  const pagina = paginaNttData(1, [{ jobId: 'abc12345', title: 'Vaga', country: 'Germany' }]);
  assert.throws(() => extrairPaginaNttData(pagina, 'NTT DATA'), /fora do Brasil/);
});

