import assert from 'node:assert/strict';
import test from 'node:test';
import { classificar, type TipoVaga, type VagaColetada } from './classificador.ts';

const tipos: TipoVaga[] = ['estagio', 'trainee', 'junior', 'analista_junior'];
function vaga(titulo: string, localidade = 'Remoto - Brasil', descricao = 'Desenvolvimento de software remoto para pessoas residentes no Brasil'): VagaColetada {
  return { idExterno: '1', titulo, empresa: 'Empresa Exemplo', url: 'https://example.com/vaga', localidade, descricao };
}

test('reconhece variações de júnior e analista júnior', () => {
  assert.equal(classificar(vaga('Desenvolvedor Jr.'), tipos).tipo, 'junior');
  assert.equal(classificar(vaga('Analista de Dados Júnior'), tipos).tipo, 'analista_junior');
  assert.equal(classificar(vaga('Analista Junior de Sistemas'), tipos).tipo, 'analista_junior');
});

test('estágio e trainee são opções independentes', () => {
  assert.equal(classificar(vaga('Estágio em QA'), tipos).tipo, 'estagio');
  assert.equal(classificar(vaga('Trainee de Infraestrutura'), tipos).tipo, 'trainee');
  assert.equal(classificar(vaga('Estágio em QA'), ['junior']).classificacao, 'descartada');
});

test('não aprova vaga sem confirmação de remoto e Brasil', () => {
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'São Paulo', 'Desenvolvimento de software'), tipos).classificacao, 'pendente');
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'Remoto - Portugal', 'Desenvolvimento de software'), tipos).classificacao, 'pendente');
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'Híbrido - Brasil'), tipos).classificacao, 'descartada');
});

test('explica a modalidade presencial ou híbrida identificada', () => {
  const resultado = classificar(vaga('Analista de Testes Júnior (Híbrido)', 'São Bernardo do Campo - SP'), tipos);
  assert.equal(resultado.classificacao, 'descartada');
  assert.match(resultado.motivo, /Híbrido/);
  assert.match(resultado.motivo, /São Bernardo do Campo/);
  assert.match(resultado.motivo, /100% remotas no Brasil/);
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'Remoto · híbrido dois dias por semana'), tipos).classificacao, 'descartada');
});

test('não confunde menção inclusiva com vaga exclusiva para PCD', () => {
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'Remoto - Brasil', 'Desenvolvimento de software. Pessoas PCD também são bem-vindas.'), tipos).classificacao, 'elegivel');
  assert.equal(classificar(vaga('Desenvolvedor Júnior', 'Remoto - Brasil', 'Desenvolvimento de software. Vaga exclusiva para PCD.'), tipos).classificacao, 'descartada');
});

test('não aceita estágio de RH de uma empresa de software', () => {
  assert.equal(classificar(vaga('Estágio em RH'), tipos).classificacao, 'descartada');
});
