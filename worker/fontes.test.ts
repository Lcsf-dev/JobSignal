import assert from 'node:assert/strict';
import test from 'node:test';
import { coletarVagas, identificarOrigem, interpretarVagaRemotar } from './fontes.ts';
import { extrairDetalheCwi, extrairDetalheRecrut, extrairListagemRecrut, extrairVagasCiandt, textoDaPagina } from './fontes-html.ts';

test('identifica as fontes cadastradas do JobSignal', () => {
  assert.equal(identificarOrigem('https://datum.jobs.recrut.ai/').plataforma, 'recrutai');
  assert.equal(identificarOrigem('https://datum.jobs.recrut.ai/mginfo#openings').identificador, 'mginfo');
  assert.equal(identificarOrigem('https://insi.jobs.recrut.ai/vagas#openings').identificador, 'vagas');
  assert.equal(identificarOrigem('https://ciandt.com/br/pt-br/carreiras/oportunidades').plataforma, 'ciandt');
  assert.equal(identificarOrigem('https://cwi.com.br/talentos/oportunidades/').plataforma, 'cwi');
  assert.equal(identificarOrigem('https://remotar.com.br/company/303/confitec').identificador, '303');
  assert.equal(identificarOrigem('https://careers.emeal.nttdata.com/s/jobs?language=pt_BR').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://careers.nttdata.com/br/pt/search-results').plataforma, 'pendente');
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

