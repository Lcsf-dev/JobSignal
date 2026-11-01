import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { classificar } from './classificador.ts';
import { coletarVagas, identificarOrigem } from './fontes.ts';
import { extrairListagemInmetrics } from './inmetrics.ts';

function pagina(dados: Record<string, unknown>, conteudo = ''): string {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: {
    pageProps: { subdomain: 'inmetrics', ...dados }
  } })}</script>${conteudo}`;
}

function anuncio(id: number, titulo = 'Desenvolvedor Pleno', modalidade = 'remote', pais = 'Brasil') {
  return { id, title: titulo, department: 'Engenharia de software', workplace: {
    workplaceType: modalidade, address: { country: pais, state: '', city: '' }
  } };
}

test('reconhece somente a listagem oficial da Inmetrics e preserva a busca geral da Gupy', () => {
  assert.deepEqual(identificarOrigem('https://inmetrics.gupy.io/?origem=carreiras#vagas'), {
    plataforma: 'gupy', identificador: 'inmetrics', url: 'https://inmetrics.gupy.io/'
  });
  assert.equal(identificarOrigem('https://inmetrics.gupy.io/jobs/123').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://inmetrics.gupy.io.exemplo.com/').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://outra.gupy.io/').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://portal.gupy.io/job-search/term=TI').identificador, null);
});

test('coleta a lista completa da Inmetrics além dos dez cartões visíveis na primeira página', async () => {
  const anterior = globalThis.fetch;
  const chamadas: string[] = [];
  globalThis.fetch = (async (entrada) => {
    chamadas.push(String(entrada));
    return new Response(pagina({ jobs: Array.from({ length: 27 }, (_, indice) => anuncio(indice + 1)) },
      '<p>27 vagas encontradas para 0 filtros aplicados</p><p>Itens por página 10</p>'));
  }) as typeof fetch;
  try {
    const vagas = await coletarVagas(identificarOrigem('https://inmetrics.gupy.io/'), 'Inmetrics');
    assert.equal(vagas.length, 27);
    assert.equal(vagas[26]?.url, 'https://inmetrics.gupy.io/jobs/27');
    assert.deepEqual(chamadas, ['https://inmetrics.gupy.io/']);
    assert.equal(vagas[0]?.empresa, 'Inmetrics');
  } finally { globalThis.fetch = anterior; }
});

test('consulta detalhes dos títulos iniciais e mantém a classificação de remoto, híbrido e país desconhecido', async () => {
  const anterior = globalThis.fetch;
  const chamadas: string[] = [];
  const anuncios = [anuncio(1, 'Analista de Sistemas Júnior'), anuncio(2, 'Desenvolvedor Júnior', 'hybrid'),
    anuncio(3, 'Estágio em Desenvolvimento', 'remote', ''), anuncio(4)];
  globalThis.fetch = (async (entrada) => {
    const url = String(entrada);
    chamadas.push(url);
    if (url === 'https://inmetrics.gupy.io/') return new Response(pagina({ jobs: anuncios }, '4 vagas encontradas'));
    const id = Number(new URL(url).pathname.split('/').at(-1));
    const resumo = anuncios[id - 1]!;
    return new Response(pagina({ job: { id, name: resumo.title, status: 'published',
      company: { subdomain: 'inmetrics' }, workplaceType: resumo.workplace.workplaceType,
      addressCountry: resumo.workplace.address.country, addressState: '', addressCity: '',
      description: '<p>Empresa de tecnologia.</p>', responsibilities: '<p>Desenvolver software.</p>',
      prerequisites: '<p>Vaga afirmativa para mulheres.</p>', publishedAt: '2026-10-30T12:00:00Z' } }));
  }) as typeof fetch;
  try {
    const vagas = await coletarVagas(identificarOrigem('https://inmetrics.gupy.io/'), 'Inmetrics');
    const tipos = ['estagio', 'trainee', 'junior', 'analista_junior'] as const;
    assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'elegivel');
    assert.deepEqual(classificar(vagas[0]!, [...tipos]).marcadores, ['mulheres']);
    assert.equal(classificar(vagas[1]!, [...tipos]).classificacao, 'descartada');
    assert.equal(classificar(vagas[2]!, [...tipos]).classificacao, 'pendente');
    assert.equal(vagas[0]?.publicadaEm, '2026-10-30T12:00:00.000Z');
    assert.match(vagas[0]?.descricao ?? '', /Desenvolver software/);
    assert.deepEqual(chamadas, ['https://inmetrics.gupy.io/', ...[1, 2, 3].map(id => `https://inmetrics.gupy.io/jobs/${id}`)]);
  } finally { globalThis.fetch = anterior; }
});

test('não trata bloqueio HTTP nem dados ausentes como uma busca sem vagas', async () => {
  const anterior = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response('Bloqueado', { status: 403 })) as typeof fetch;
    await assert.rejects(coletarVagas(identificarOrigem('https://inmetrics.gupy.io/'), 'Inmetrics'), /HTTP 403/);
    assert.throws(() => extrairListagemInmetrics('<p>Indisponível</p>', 'Inmetrics'), /não encontrados/);
    assert.throws(() => extrairListagemInmetrics(pagina({ jobs: [] }), 'Inmetrics'), /incompleta/);
    assert.deepEqual(extrairListagemInmetrics(pagina({ jobs: [] }, 'Não há vagas'), 'Inmetrics'), []);
  } finally { globalThis.fetch = anterior; }
});

test('recusa lista parcial, anúncios repetidos e dados de outra empresa', () => {
  assert.throws(() => extrairListagemInmetrics(pagina({ jobs: [anuncio(1)] }, '27 vagas encontradas'), 'Inmetrics'), /incompleta/);
  assert.throws(() => extrairListagemInmetrics(pagina({ jobs: [anuncio(1), anuncio(1)] }, '2 vagas encontradas'), 'Inmetrics'), /repetido/);
  assert.throws(() => extrairListagemInmetrics(pagina({ subdomain: 'outra', jobs: [] }, 'Não há vagas'), 'Inmetrics'), /não pertence/);
});

test('recusa detalhes de anúncio encerrado ou de outra empresa', async () => {
  const anterior = globalThis.fetch;
  try {
    for (const detalhe of [
      { id: 1, status: 'closed', company: { subdomain: 'inmetrics' } },
      { id: 1, status: 'published', company: { subdomain: 'outra' } },
      { id: 2, status: 'published', company: { subdomain: 'inmetrics' } }
    ]) {
      globalThis.fetch = (async (entrada) => new Response(String(entrada) === 'https://inmetrics.gupy.io/'
        ? pagina({ jobs: [anuncio(1, 'Desenvolvedor Júnior')] }, '1 vaga encontrada')
        : pagina({ job: { name: 'Desenvolvedor Júnior', ...detalhe } }))) as typeof fetch;
      await assert.rejects(coletarVagas(identificarOrigem('https://inmetrics.gupy.io/'), 'Inmetrics'), /mudou ou foi encerrada/);
    }
  } finally { globalThis.fetch = anterior; }
});

test('migração cadastra ou reativa Inmetrics sem duplicar nem alterar outras fontes', () => {
  const migracao = readFileSync(new URL('../migrations/0010_inmetrics.sql', import.meta.url), 'utf8');
  for (const existente of [false, true]) {
    const banco = new DatabaseSync(':memory:');
    try {
      banco.exec(readFileSync(new URL('../migrations/0001_inicial.sql', import.meta.url), 'utf8'));
      banco.exec("INSERT INTO fontes (nome, url, plataforma, ativa, estado) VALUES ('Outra empresa', 'https://outra.gupy.io/', 'pendente', 0, 'integracao_pendente')");
      if (existente) banco.exec("INSERT INTO fontes (nome, url, plataforma, ativa, estado) VALUES ('Inmetrics', 'https://inmetrics.gupy.io/', 'pendente', 0, 'integracao_pendente')");
      banco.exec(migracao);
      banco.exec(migracao);
      const fonte = banco.prepare("SELECT * FROM fontes WHERE nome = 'Inmetrics'").get()!;
      assert.equal(fonte['id'], 2);
      assert.equal(fonte['ativa'], 1);
      assert.equal(fonte['plataforma'], 'gupy');
      assert.equal(fonte['identificador'], 'inmetrics');
      assert.equal(fonte['estado'], 'ativa');
      assert.equal(banco.prepare('SELECT COUNT(*) AS total FROM fontes').get()!['total'], 2);
      assert.equal(banco.prepare("SELECT ativa FROM fontes WHERE nome = 'Outra empresa'").get()!['ativa'], 0);
    } finally { banco.close(); }
  }
});
