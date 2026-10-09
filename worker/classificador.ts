export type TipoVaga = 'estagio' | 'trainee' | 'junior' | 'analista_junior';
export type Classificacao = 'elegivel' | 'pendente' | 'descartada';
export type MarcadorAfirmativo = 'pcd' | 'mulheres';

export interface FiltrosAfirmativos {
  incluirPcd: boolean;
  incluirMulheres: boolean;
}

export interface VagaColetada {
  idExterno: string;
  titulo: string;
  empresa: string;
  url: string;
  localidade: string;
  descricao: string;
  publicadaEm?: string;
}

export interface ResultadoClassificacao {
  classificacao: Classificacao;
  tipo: TipoVaga | null;
  motivo: string;
  marcadores: MarcadorAfirmativo[];
}

export function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const areaTi = /\b(ti|tecnologia|software|desenvolv\w*|programa\w*|frontend|front.end|backend|back.end|fullstack|full.stack|dados|data|bi|qa|testes?|suporte tecnico|infraestrutura|redes|seguranca da informacao|cyber|cloud|devops|sistemas|informatica|engenharia de software)\b/;
const remoto = /\b(remot[oa]|remote|home office|work from home|teletrabalho|100% remoto)\b/;
const brasil = /\b(brasil|brazil|br|latam|america latina)\b/;
const restricaoExterior = /\b(only in|only for|residents? of|somente residentes?|apenas residentes?)\b.{0,50}\b(portugal|usa|united states|europe|europa|canada|uk|reino unido)\b/;

export function classificar(
  vaga: VagaColetada,
  tiposAtivos: TipoVaga[],
  filtrosAfirmativos: FiltrosAfirmativos = { incluirPcd: false, incluirMulheres: true }
): ResultadoClassificacao {
  const titulo = normalizar(vaga.titulo);
  const texto = normalizar(`${vaga.titulo} ${vaga.localidade} ${vaga.descricao.slice(0, 3000)}`);
  const motivosPendentes: string[] = [];
  const marcadores: MarcadorAfirmativo[] = [];

  const padraoAfirmativoPcd = /\b(exclusiv[oa]s?|afirmativ[oa]s?|reservad[oa]s?)\b.{0,55}\b(pcd|pessoas? com deficiencia|pessoas? deficientes?)\b|\b(pcd|pessoas? com deficiencia|pessoas? deficientes?)\b.{0,55}\b(exclusiv[oa]s?|afirmativ[oa]s?|reservad[oa]s?)\b/;
  const padraoAfirmativoMulheres = /\b(vaga|oportunidade)\b.{0,35}\b(afirmativ[oa]|exclusiv[oa]|reservad[oa])\b.{0,35}\b(mulheres?|women)\b|\b(mulheres?|women)\b.{0,35}\b(vaga|oportunidade)\b.{0,35}\b(afirmativ[oa]|exclusiv[oa]|reservad[oa])\b/;
  if (padraoAfirmativoPcd.test(texto)) marcadores.push('pcd');
  if (padraoAfirmativoMulheres.test(texto)) marcadores.push('mulheres');
  if (marcadores.includes('pcd') && !filtrosAfirmativos.incluirPcd) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Vaga afirmativa para PcD; desativada nos filtros.', marcadores };
  }
  if (marcadores.includes('mulheres') && !filtrosAfirmativos.incluirMulheres) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Vaga afirmativa para mulheres; desativada nos filtros.', marcadores };
  }
  const evidenciasModalidade = `${vaga.titulo} ${vaga.localidade}`;
  const modalidadeNaoRemota = evidenciasModalidade.match(/\b(presencial|híbrido|híbrida|hibrido|hibrida|on-site|onsite)\b/i);
  if (modalidadeNaoRemota) {
    const localidade = vaga.localidade ? ` Localidade informada: ${vaga.localidade}.` : '';
    return { classificacao: 'descartada', tipo: null,
      motivo: `Modalidade ${modalidadeNaoRemota[0]} identificada no anúncio.${localidade} O JobSignal exibe somente vagas 100% remotas no Brasil.`, marcadores };
  }
  if (restricaoExterior.test(texto)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Restrita a residentes de outro país.', marcadores };
  }
  if (/\b(rh|recursos humanos|comercial|vendas|marketing|administrativ\w*|financeir\w*|estoque)\b/.test(titulo) && !areaTi.test(titulo)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Atividade fora da área de TI.', marcadores };
  }
  if (/\b(pleno|senior|sr\.?|specialist|especialista|lead|lideranca)\b/.test(titulo) && !/\b(junior|jr\.?|trainee|estagi)/.test(titulo)) {
    return { classificacao: 'descartada', tipo: null, motivo: 'Nível acima do perfil inicial.', marcadores };
  }

  let tipo: TipoVaga | null = null;
  if (/\b(estagio|estagiari[oa]s?)\b/.test(titulo)) tipo = 'estagio';
  else if (/\btrainee\b/.test(titulo)) tipo = 'trainee';
  else if (/\b(analista|analyst)\b.{0,35}\b(junior|jr\.?)\b|\b(junior|jr\.?)\b.{0,35}\b(analista|analyst)\b/.test(titulo)) tipo = 'analista_junior';
  else if (/\b(junior|jr\.?)\b/.test(titulo)) tipo = 'junior';

  if (!tipo) motivosPendentes.push('Nível inicial não confirmado no título.');
  else if (!tiposAtivos.includes(tipo)) return { classificacao: 'descartada', tipo, motivo: 'Tipo de vaga desativado nos filtros.', marcadores };

  if (!areaTi.test(texto)) motivosPendentes.push('Área de TI não confirmada.');
  if (!remoto.test(texto)) motivosPendentes.push('Trabalho remoto não confirmado.');
  if (!brasil.test(texto) || (/\b(latam|america latina)\b/.test(texto) && !/\b(brasil|brazil|br)\b/.test(texto))) {
    motivosPendentes.push('Permissão para trabalhar residindo no Brasil não confirmada.');
  }

  if (motivosPendentes.length) return { classificacao: 'pendente', tipo, motivo: motivosPendentes.join(' '), marcadores };
  return { classificacao: 'elegivel', tipo, motivo: 'TI, nível inicial, remoto e Brasil confirmados no anúncio.', marcadores };
}
