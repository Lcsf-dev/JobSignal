export type TipoVaga = 'estagio' | 'trainee' | 'junior' | 'analista_junior';
export type Classificacao = 'elegivel' | 'pendente' | 'descartada';

export interface VagaColetada {
  idExterno: string;
  titulo: string;
  empresa: string;
  url: string;
  localidade: string;
  descricao: string;
}

export interface ResultadoClassificacao {
  classificacao: Classificacao;
  tipo: TipoVaga | null;
  motivo: string;
}

export function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const areaTi = /\b(ti|tecnologia|software|desenvolv\w*|programa\w*|frontend|front.end|backend|back.end|fullstack|full.stack|dados|data|bi|qa|testes?|suporte tecnico|infraestrutura|redes|seguranca da informacao|cyber|cloud|devops|sistemas|informatica|engenharia de software)\b/;
const remoto = /\b(remot[oa]|remote|home office|work from home|teletrabalho|100% remoto)\b/;
const brasil = /\b(brasil|brazil|br|latam|america latina)\b/;
const restricaoExterior = /\b(only in|only for|residents? of|somente residentes?|apenas residentes?)\b.{0,50}\b(portugal|usa|united states|europe|europa|canada|uk|reino unido)\b/;

export function classificar(vaga: VagaColetada, tiposAtivos: TipoVaga[]): ResultadoClassificacao {
  const titulo = normalizar(vaga.titulo);
  const texto = normalizar(`${vaga.titulo} ${vaga.localidade} ${vaga.descricao.slice(0, 3000)}`);
  const motivosPendentes: string[] = [];

  if (/\b(exclusiv[oa]s? para pcd|exclusivamente para pcd|vaga exclusiva pcd|pcd somente)\b/.test(texto)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Vaga exclusiva para PCD.' };
  }
  if (/\b(presencial|hibrid[oa])\b/.test(titulo + ' ' + normalizar(vaga.localidade)) && !remoto.test(titulo + ' ' + normalizar(vaga.localidade))) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Modalidade presencial ou híbrida.' };
  }
  if (restricaoExterior.test(texto)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Restrita a residentes de outro país.' };
  }
  if (/\b(rh|recursos humanos|comercial|vendas|marketing|administrativ\w*|financeir\w*|estoque)\b/.test(titulo) && !areaTi.test(titulo)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Atividade fora da área de TI.' };
  }
  if (/\b(pleno|senior|sr\.?|specialist|especialista|lead|lideranca)\b/.test(titulo) && !/\b(junior|jr\.?|trainee|estagi)/.test(titulo)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Nível acima do perfil inicial.' };
  }

  let tipo: TipoVaga | null = null;
  if (/\b(estagio|estagiari[oa]s?)\b/.test(titulo)) tipo = 'estagio';
  else if (/\btrainee\b/.test(titulo)) tipo = 'trainee';
  else if (/\b(analista|analyst)\b.{0,35}\b(junior|jr\.?)\b|\b(junior|jr\.?)\b.{0,35}\b(analista|analyst)\b/.test(titulo)) tipo = 'analista_junior';
  else if (/\b(junior|jr\.?)\b/.test(titulo)) tipo = 'junior';

  if (!tipo) motivosPendentes.push('Nível inicial não confirmado no título.');
  else if (!tiposAtivos.includes(tipo)) return { classificacao: 'descartada', tipo, motivo: 'Tipo de vaga desativado nos filtros.' };

  if (!areaTi.test(texto)) motivosPendentes.push('Área de TI não confirmada.');
  if (!remoto.test(texto)) motivosPendentes.push('Trabalho remoto não confirmado.');
  if (!brasil.test(texto) || (/\b(latam|america latina)\b/.test(texto) && !/\b(brasil|brazil|br)\b/.test(texto))) {
    motivosPendentes.push('Permissão para trabalhar residindo no Brasil não confirmada.');
  }

  if (motivosPendentes.length) return { classificacao: 'pendente', tipo, motivo: motivosPendentes.join(' ') };
  return { classificacao: 'elegivel', tipo, motivo: 'TI, nível inicial, remoto e Brasil confirmados no anúncio.' };
}
