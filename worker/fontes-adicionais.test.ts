import assert from 'node:assert/strict';
import test from 'node:test';
import { coletarVagas, identificarOrigem } from './fontes.ts';
import { extrairFoursys, extrairPaginaCompleo, montarLinkInhire } from './fontes-adicionais.ts';
import { classificar } from './classificador.ts';

const tipos = ['estagio', 'trainee', 'junior', 'analista_junior'] as const;
const enderecos = {
  inhire: 'https://mjv.inhire.app/vagas?utm_source=exemplo',
  compleo: 'https://ebix.compleo.com.br/?utm_source=exemplo',
  capgemini: 'https://www.capgemini.com/br-pt/carreira/busca-de-vagas?page=1&size=11&country_code=br-pt',
  ibm: 'https://www.ibm.com/br-pt/careers/search?utm_source=exemplo',
  foursys: 'https://foursys.com.br/carreiras?app=preferencias&tipo_1=sim'
};

async function simular<T>(responder: typeof fetch, executar: () => Promise<T>): Promise<T> {
  const anterior = globalThis.fetch;
  globalThis.fetch = (entrada, opcoes) => {
    assert.equal(opcoes?.redirect, 'manual', 'Use o modo suportado pelo Cloudflare Workers.');
    return responder(entrada, opcoes);
  };
  try { return await executar(); }
  finally { globalThis.fetch = anterior; }
}

function endereco(entrada: RequestInfo | URL): URL {
  return new URL(entrada instanceof Request ? entrada.url : String(entrada));
}

test('reconhece os cinco cadastros pendentes e remove parâmetros de rastreamento', () => {
  for (const [plataforma, url] of Object.entries(enderecos)) {
    const origem = identificarOrigem(url);
    assert.equal(origem.plataforma, plataforma);
    assert.equal(new URL(origem.url).search, '');
  }
  assert.equal(identificarOrigem('https://outra.inhire.app/vagas').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://mjv.inhire.app/vagas/identificador').plataforma, 'pendente');
  assert.equal(identificarOrigem('https://www.ibm.com/br-pt/contato').plataforma, 'pendente');
});

test('InHire lê a listagem completa e busca detalhes apenas para títulos iniciais', async () => {
  const chamadas: string[] = [];
  const vagas = await simular(async (entrada, opcoes) => {
    const url = endereco(entrada);
    chamadas.push(url.pathname);
    assert.equal(new Headers(opcoes?.headers).get('X-Tenant'), 'mjv');
    if (url.pathname.endsWith('/pages')) return Response.json({ jobsPage: [
      { jobId: 'vaga-1', displayName: 'Estágio em Desenvolvimento', status: 'published', workplaceType: 'Remote', location: 'BR' },
      { jobId: 'vaga-2', displayName: 'Pessoa Desenvolvedora Sênior', status: 'published', workplaceType: 'Hybrid', location: 'São Paulo, BR' }
    ] });
    return Response.json({ jobId: 'vaga-1', displayName: 'Estágio em Desenvolvimento', status: 'published',
      workplaceType: 'Remote', location: 'BR', description: 'Desenvolvimento de software.', publishedAt: '2026-10-01T12:00:00Z' });
  }, () => coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'));
  assert.equal(vagas.length, 2);
  assert.equal(chamadas.length, 2);
  assert.equal(vagas[0]?.publicadaEm, '2026-10-01T12:00:00.000Z');
  assert.equal(vagas[0]?.url, 'https://mjv.inhire.app/vagas/vaga-1/estagio-em-desenvolvimento');
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'elegivel');
  assert.equal(classificar(vagas[1]!, [...tipos]).classificacao, 'descartada');
});

test('InHire reconhece a Dataside e usa sua empresa na listagem, nos detalhes e nos links', async () => {
  const origem = identificarOrigem('https://dataside.inhire.app/vagas/?utm_source=exemplo');
  assert.deepEqual(origem, { plataforma: 'inhire', identificador: 'dataside', url: 'https://dataside.inhire.app/vagas' });
  assert.equal(identificarOrigem('https://dataside.inhire.app/vagas/identificador').plataforma, 'pendente');
  const chamadas: string[] = [];
  const anuncio = { jobId: 'vaga-dataside', displayName: 'Engenheiro de Dados Júnior', status: 'published',
    workplaceType: 'Hybrid', location: 'São Paulo, SP, BR' };
  const vagas = await simular(async (entrada, opcoes) => {
    const url = endereco(entrada);
    chamadas.push(url.pathname);
    assert.equal(url.hostname, 'api.inhire.app');
    assert.equal(new Headers(opcoes?.headers).get('X-Tenant'), 'dataside');
    return Response.json(url.pathname.endsWith('/pages') ? { jobsPage: [anuncio] }
      : { ...anuncio, description: 'Engenharia de dados.' });
  }, () => coletarVagas(origem, 'Dataside'));
  assert.deepEqual(chamadas, ['/job-posts/public/pages', '/job-posts/public/pages/vaga-dataside']);
  assert.equal(vagas.length, 1);
  assert.equal(vagas[0]?.empresa, 'Dataside');
  assert.equal(vagas[0]?.idExterno, 'vaga-dataside');
  assert.equal(vagas[0]?.url, 'https://dataside.inhire.app/vagas/vaga-dataside/engenheiro-de-dados-junior');
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'descartada');
});

test('link InHire inclui o título na rota da vaga e mantém o identificador original', () => {
  assert.equal(montarLinkInhire('90be4a6d-f198-49bc-a836-8e723c7c4c76', 'Estágio em Inovação'),
    'https://mjv.inhire.app/vagas/90be4a6d-f198-49bc-a836-8e723c7c4c76/estagio-em-inovacao');
  assert.equal(montarLinkInhire('vaga-2', '  Analista Júnior (Java/SQL)  '),
    'https://mjv.inhire.app/vagas/vaga-2/analista-junior-javasql');
  assert.throws(() => montarLinkInhire('vaga-2', ''), /inválido/);
  assert.throws(() => montarLinkInhire('../outra', 'Estágio em TI'), /inválido/);
});

test('InHire distingue listagem vazia de mudança de formato e de vaga encerrada', async () => {
  await simular(async () => Response.json({ jobsPage: [] }), async () => {
    assert.deepEqual(await coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'), []);
  });
  await simular(async () => Response.json({ jobs: [] }), async () => {
    await assert.rejects(coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'), /formato inesperado/);
  });
  await simular(async entrada => endereco(entrada).pathname.endsWith('/pages')
    ? Response.json({ jobsPage: [{ jobId: 'vaga-1', displayName: 'Analista Júnior', status: 'published' }] })
    : Response.json({ jobId: 'vaga-1', status: 'closed' }), async () => {
    await assert.rejects(coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'), /mudou durante/);
  });
});

function anuncioCapgemini(id: number, pais = 'pt-br') {
  return { id: `vaga-${id}`, title: 'Analista de Sistemas Júnior', country_code: pais, location: 'São Paulo',
    apply_job_url: `https://careers.capgemini.com/job/vaga/${id}/`, description_stripped: 'Desenvolvimento de software.' };
}

test('Capgemini percorre páginas, preserva IDs e não presume modalidade remota', async () => {
  const chamadas: string[] = [];
  const vagas = await simular(async entrada => {
    const url = endereco(entrada);
    assert.equal(url.searchParams.get('country_code'), 'br-pt');
    chamadas.push(url.searchParams.get('page')!);
    return Response.json({ count: 3, data: url.searchParams.get('page') === '1'
      ? [anuncioCapgemini(1), anuncioCapgemini(2)] : [anuncioCapgemini(3)] });
  }, () => coletarVagas(identificarOrigem(enderecos.capgemini), 'CAP'));
  assert.deepEqual(chamadas, ['1', '2']);
  assert.deepEqual(vagas.map(vaga => vaga.idExterno), ['vaga-1', 'vaga-2', 'vaga-3']);
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'pendente');
  assert.equal(vagas[0]?.publicadaEm, undefined);
});

test('Capgemini rejeita país incorreto, página repetida, resposta incompleta e link externo', async () => {
  for (const [dados, mensagem] of [
    [{ count: 1, data: [anuncioCapgemini(1, 'en-us')] }, /fora do filtro brasileiro/],
    [{ count: 2, data: [anuncioCapgemini(1)] }, /repetiu anúncios/],
    [{ count: 1, data: [] }, /página vazia/],
    [{ count: 1, data: [{ ...anuncioCapgemini(1), apply_job_url: 'https://exemplo.com/vaga' }] }, /fora do domínio/]
  ] as const) {
    await simular(async () => Response.json(dados), async () => {
      await assert.rejects(coletarVagas(identificarOrigem(enderecos.capgemini), 'CAP'), mensagem);
    });
  }
});

function respostaIbm(inicio: number, quantidade: number, pais = 'Brazil') {
  return { timed_out: false, _shards: { failed: 0 }, hits: { total: { value: 20 }, hits: Array.from({ length: quantidade }, (_, indice) => ({
    _id: `hash-${inicio + indice}`, _source: { title: 'Estágio em Desenvolvimento',
      url: `https://careers.ibm.com/careers/JobDetail?jobId=${inicio + indice + 1}`,
      description: 'Desenvolvimento de software.', field_keyword_05: pais, field_keyword_17: '', field_keyword_19: 'RIO DE JANEIRO, BR' }
  })) } };
}

test('IBM pagina mesmo com total limitado e confirma país em cada anúncio', async () => {
  const deslocamentos: number[] = [];
  const vagas = await simular(async (_entrada, opcoes) => {
    const pedido = JSON.parse(String(opcoes?.body));
    assert.equal(pedido.post_filter.bool.must[0].term.field_keyword_05, 'Brazil');
    assert.equal(opcoes?.method, 'POST');
    deslocamentos.push(pedido.from);
    return Response.json(respostaIbm(pedido.from, pedido.from ? 1 : 20));
  }, () => coletarVagas(identificarOrigem(enderecos.ibm), 'IBM'));
  assert.deepEqual(deslocamentos, [0, 20]);
  assert.equal(vagas.length, 21);
  assert.equal(vagas[0]?.idExterno, '1');
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'pendente');
});

test('IBM não registra busca incompleta ou país incorreto como sucesso', async () => {
  for (const [dados, mensagem] of [
    [respostaIbm(0, 1, 'Germany'), /fora do Brasil/],
    [{ ...respostaIbm(0, 1), timed_out: true }, /busca incompleta/],
    [{ ...respostaIbm(0, 1), _shards: { failed: 1 } }, /busca incompleta/],
    [{ hits: { hits: 'formato alterado' }, _shards: { failed: 0 } }, /formato inesperado/]
  ] as const) {
    await simular(async () => Response.json(dados), async () => {
      await assert.rejects(coletarVagas(identificarOrigem(enderecos.ibm), 'IBM'), mensagem);
    });
  }
});

test('IBM preserva a modalidade híbrida mesmo se a descrição mencionar trabalho remoto', async () => {
  const dados = respostaIbm(0, 1);
  dados.hits.hits[0]!._source.field_keyword_17 = 'Hybrid';
  dados.hits.hits[0]!._source.description = 'Desenvolvimento com equipes de trabalho remoto.';
  await simular(async () => Response.json(dados), async () => {
    const vagas = await coletarVagas(identificarOrigem(enderecos.ibm), 'IBM');
    assert.match(vagas[0]!.localidade, /Híbrido/);
    assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'descartada');
  });
});

function cartaoCompleo(id: number, titulo: string): string {
  return `<h5 class="titulo-vaga">${titulo}</h5><h5 class="local-vaga">Local: Brasil</h5><a href="/Visualizar/${id}">Visualizar Vaga</a>`;
}

test('Compleo reconhece anúncios, entidades e paginação do portal', () => {
  const pagina = extrairPaginaCompleo(cartaoCompleo(12, 'Est&aacute;gio em TI') + '<a data-pagina="2">Próxima</a>', 'EBIX', 'https://ebix.compleo.com.br');
  assert.equal(pagina.vagas[0]?.titulo, 'Estágio em TI');
  assert.equal(pagina.vagas[0]?.url, 'https://ebix.compleo.com.br/Visualizar/12');
  assert.deepEqual(pagina.paginas, [2]);
  assert.throws(() => extrairPaginaCompleo('<p>Formato alterado</p>', 'EBIX', enderecos.compleo), /formato inesperado/);
});

test('Compleo percorre páginas e busca detalhes dos títulos iniciais', async () => {
  const chamadas: string[] = [];
  const vagas = await simular(async entrada => {
    const url = endereco(entrada);
    chamadas.push(url.pathname + url.search);
    if (url.pathname.startsWith('/Visualizar/')) return new Response('<div class="visualizar-vaga"><h3>Estágio em TI</h3><p>Remoto Brasil Desenvolvimento de software</p></div><script>rodape</script>');
    return Response.json({ sucesso: true, viewLista: url.searchParams.get('page') === '1'
      ? cartaoCompleo(12, 'Estágio em TI') + '<a data-pagina="2">Próxima</a>' : cartaoCompleo(13, 'Desenvolvedor Sênior') });
  }, () => coletarVagas(identificarOrigem(enderecos.compleo), 'EBIX'));
  assert.equal(vagas.length, 2);
  assert.equal(chamadas.length, 3);
  assert.match(chamadas[2]!, /Visualizar\/12/);
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'elegivel');
});

test('Compleo aceita somente vazio confirmado pelo portal e rejeita repetição', async () => {
  await simular(async () => Response.json({ sucesso: true, viewLista: '<p>Esta pesquisa não retornou resultados.</p>' }), async () => {
    assert.deepEqual(await coletarVagas(identificarOrigem(enderecos.compleo), 'EBIX'), []);
  });
  await simular(async () => Response.json({ sucesso: true, viewLista: cartaoCompleo(12, 'Desenvolvedor Pleno') + '<a data-pagina="2">Próxima</a>' }), async () => {
    await assert.rejects(coletarVagas(identificarOrigem(enderecos.compleo), 'EBIX'), /repetiu anúncios/);
  });
});

function cartaoFoursys(id: number, titulo: string, modalidade: string): string {
  return `<article class="cr-vagas-card"><span class="cr-vagas-card__level">Júnior</span><h3 class="cr-vagas-card__title">${titulo}</h3><p class="cr-vagas-card__location"><svg><path /></svg>São Paulo - Brasil</p><span class="cr-vagas-card__tag cr-vagas-card__tag--blue">${modalidade}</span><a class="cr-vagas-card__link" href="https://www.linkedin.com/jobs/view/${id}">Ver vaga</a></article>`;
}

test('Foursys mantém modalidade de cada cartão e usa ID do anúncio original', () => {
  const vagas = extrairFoursys(cartaoFoursys(123, 'Desenvolvedor Júnior', 'Remoto') + cartaoFoursys(124, 'Analista Júnior', 'Híbrido'), 'FOURSYS');
  assert.equal(vagas.length, 2);
  assert.equal(vagas[0]?.idExterno, '123');
  assert.equal(classificar(vagas[0]!, [...tipos]).classificacao, 'elegivel');
  assert.equal(classificar(vagas[1]!, [...tipos]).classificacao, 'descartada');
  assert.throws(() => extrairFoursys('<p>Portal alterado</p>', 'FOURSYS'), /não encontrados/);
});

test('Foursys é consultada sem abrir LinkedIn e sem usar navegador pago', async () => {
  await simular(async entrada => {
    assert.equal(String(entrada), 'https://foursys.com.br/carreiras');
    return new Response(cartaoFoursys(123, 'Desenvolvedor Júnior', 'Remoto'));
  }, async () => {
    assert.equal((await coletarVagas(identificarOrigem(enderecos.foursys), 'FOURSYS')).length, 1);
  });
});

test('resposta de desafio HTTP 202 e falha HTTP não viram listagem vazia', async () => {
  for (const status of [202, 403, 429]) {
    await simular(async () => new Response('', { status }), async () => {
      await assert.rejects(coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'), new RegExp(`HTTP ${status}`));
    });
  }
});

test('redirecionamento não é seguido nem tratado como sucesso', async () => {
  let chamadas = 0;
  await simular(async () => {
    chamadas++;
    return new Response('', { status: 302, headers: { Location: 'https://exemplo.com/fora-da-fonte' } });
  }, async () => {
    await assert.rejects(coletarVagas(identificarOrigem(enderecos.inhire), 'MJV'), /HTTP 302/);
    assert.equal(chamadas, 1);
  });
});

test('DATUM sem títulos iniciais retorna zero sem consultar anúncios plenos ou seniores', async () => {
  let chamadas = 0;
  await simular(async () => {
    chamadas++;
    return Response.json({ html: '<h5><span>ABC123</span><br />Pessoa Desenvolvedora Front-end Pleno/Senior</h5><a href="/job/ABC123">VER OPORTUNIDADE</a>' });
  }, async () => {
    assert.deepEqual(await coletarVagas(identificarOrigem('https://datum.jobs.recrut.ai/'), 'DATUM'), []);
    assert.equal(chamadas, 1);
  });
});
