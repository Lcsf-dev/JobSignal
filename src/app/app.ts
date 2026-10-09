import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Aba = 'painel' | 'fontes' | 'vagas' | 'pendentes' | 'historico' | 'ajustes';
type Tipo = 'estagio' | 'trainee' | 'junior' | 'analista_junior';

interface Configuracao { horario_manha: string; horario_noite: string; tipos: Tipo[]; pausado: boolean | number; email_remetente: string; email_destinatario: string; email_ativo: boolean | number }
interface Execucao { id: number; prevista_em: string; iniciada_em: string; concluida_em: string | null; estado: string; total_fontes: number; concluida_fontes: number; erros: number; email_estado?: string; email_erro?: string | null; email_total_vagas?: number }
interface TarefaExecucao { id: number; fonte: string; estado: string; tentativas: number; vagas_lidas: number; vagas_novas: number; erro: string | null }
interface Estado { configuracao: Configuracao; emailConfigurado: boolean; proximaBusca: string | null; fontesAtivas: number; vagasElegiveis: number; vagasPendentes: number; ultimaExecucao: Execucao | null }
interface Fonte { id: number; nome: string; url: string; plataforma: string; ativa: number; estado: string; ultima_consulta: string | null; ultimo_erro: string | null; total_vagas: number }
interface Vaga { id: number; titulo: string; empresa: string; url: string; localidade: string; tipo: string | null; classificacao: string; motivo: string; acompanhamento: string; primeira_deteccao: string; publicada_em: string | null; notificada_em: string | null; fonte_nome: string }

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.css' })
export class App {
  readonly menu: { id: Aba; icone: string; nome: string }[] = [
    { id: 'painel', icone: '◈', nome: 'Painel' }, { id: 'fontes', icone: '⌁', nome: 'Sites' },
    { id: 'vagas', icone: '▣', nome: 'Vagas' }, { id: 'pendentes', icone: '◇', nome: 'Pendentes' },
    { id: 'historico', icone: '◷', nome: 'Histórico' }, { id: 'ajustes', icone: '⚙', nome: 'Ajustes' }
  ];
  readonly tipos: { id: Tipo; nome: string; exemplos: string }[] = [
    { id: 'estagio', nome: 'Estágio', exemplos: 'Estágio, estagiário(a)' },
    { id: 'trainee', nome: 'Trainee', exemplos: 'Programa trainee de TI' },
    { id: 'junior', nome: 'Júnior', exemplos: 'Júnior, Junior, Jr.' },
    { id: 'analista_junior', nome: 'Analista júnior', exemplos: 'Analista Jr., Analista Junior' }
  ];
  readonly aba = signal<Aba>('painel');
  readonly conectado = signal(false);
  readonly restaurandoSessao = signal(true);
  readonly carregando = signal(false);
  readonly erro = signal('');
  readonly aviso = signal('');
  readonly estado = signal<Estado | null>(null);
  readonly fontes = signal<Fonte[]>([]);
  readonly vagas = signal<Vaga[]>([]);
  readonly pendentes = signal<Vaga[]>([]);
  readonly historico = signal<Execucao[]>([]);
  readonly detalhesExecucao = signal<Record<number, TarefaExecucao[]>>({});
  readonly execucaoAberta = signal<number | null>(null);
  readonly execucaoCarregando = signal<number | null>(null);
  token = '';
  nomeFonte = '';
  urlFonte = '';
  fonteEmEdicao: number | null = null;
  configuracao: Configuracao = { horario_manha: '10:00', horario_noite: '22:00', tipos: ['estagio', 'trainee', 'junior', 'analista_junior'], pausado: false, email_remetente: 'yugi.lucas@gmail.com', email_destinatario: 'lucas.lcsf.dev@gmail.com', email_ativo: true };

  constructor() {
    this.token = sessionStorage.getItem('jobsignal_token') ?? '';
    if (this.token) void this.carregar();
    else this.restaurandoSessao.set(false);
  }

  private async api<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
    const resposta = await fetch(`/api${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, ...opcoes.headers } });
    const dados = await resposta.json() as T & { erro?: string };
    if (!resposta.ok) {
      if (resposta.status === 401) { this.conectado.set(false); sessionStorage.removeItem('jobsignal_token'); }
      throw new Error(dados.erro ?? `Erro HTTP ${resposta.status}`);
    }
    return dados;
  }

  private falha(erro: unknown): void { this.erro.set(erro instanceof Error ? erro.message : 'Não foi possível concluir a operação.'); this.aviso.set(''); }

  async entrar(): Promise<void> {
    this.token = this.token.trim();
    if (!this.token) return;
    sessionStorage.setItem('jobsignal_token', this.token);
    await this.carregar();
  }

  sair(): void { this.token = ''; sessionStorage.removeItem('jobsignal_token'); this.conectado.set(false); this.estado.set(null); }

  async carregar(): Promise<void> {
    this.carregando.set(true); this.erro.set('');
    try {
      const [estado, fontes, vagas, pendentes, historico] = await Promise.all([
        this.api<Estado>('/estado'), this.api<Fonte[]>('/fontes'), this.api<Vaga[]>('/vagas?classificacao=elegivel'),
        this.api<Vaga[]>('/vagas?classificacao=pendente'), this.api<Execucao[]>('/execucoes')
      ]);
      this.estado.set(estado);
      this.configuracao = { ...estado.configuracao, pausado: Boolean(estado.configuracao.pausado), email_ativo: Boolean(estado.configuracao.email_ativo), tipos: [...estado.configuracao.tipos] };
      this.fontes.set(fontes.filter((fonte) => fonte.estado !== 'excluida'));
      this.vagas.set(vagas); this.pendentes.set(pendentes); this.historico.set(historico); this.conectado.set(true);
    } catch (erro) { this.falha(erro); } finally { this.carregando.set(false); this.restaurandoSessao.set(false); }
  }

  async atualizarDados(): Promise<void> {
    if (this.carregando()) return;
    await this.carregar();
    if (this.conectado()) this.aviso.set('Dados atualizados.');
  }

  async alternarDetalhes(execucaoId: number): Promise<void> {
    if (this.execucaoAberta() === execucaoId) { this.execucaoAberta.set(null); return; }
    this.execucaoAberta.set(execucaoId);
    if (this.detalhesExecucao()[execucaoId]) return;
    this.execucaoCarregando.set(execucaoId);
    try {
      const tarefas = await this.api<TarefaExecucao[]>(`/execucoes/${execucaoId}/tarefas`);
      this.detalhesExecucao.set({ ...this.detalhesExecucao(), [execucaoId]: tarefas });
    } catch (erro) { this.falha(erro); }
    finally { this.execucaoCarregando.set(null); }
  }

  mudarAba(aba: Aba): void { this.aba.set(aba); this.erro.set(''); this.aviso.set(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  editarFonte(fonte: Fonte): void { this.fonteEmEdicao = fonte.id; this.nomeFonte = fonte.nome; this.urlFonte = fonte.url; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  cancelarEdicao(): void { this.fonteEmEdicao = null; this.nomeFonte = ''; this.urlFonte = ''; }

  async salvarFonte(): Promise<void> {
    try {
      const edicao = this.fonteEmEdicao !== null;
      await this.api(edicao ? `/fontes/${this.fonteEmEdicao}` : '/fontes', {
        method: edicao ? 'PATCH' : 'POST', body: JSON.stringify({ nome: this.nomeFonte.trim(), url: this.urlFonte.trim() })
      });
      this.cancelarEdicao(); await this.carregar(); this.aviso.set(edicao ? 'Site atualizado.' : 'Site cadastrado.');
    } catch (erro) { this.falha(erro); }
  }

  async alternarFonte(fonte: Fonte): Promise<void> {
    try { await this.api(`/fontes/${fonte.id}`, { method: 'PATCH', body: JSON.stringify({ ativa: !fonte.ativa }) }); await this.carregar(); this.aviso.set(fonte.ativa ? 'Site pausado.' : 'Site ativado.'); }
    catch (erro) { this.falha(erro); }
  }

  async excluirFonte(fonte: Fonte): Promise<void> {
    if (!confirm(`Excluir ${fonte.nome} do monitoramento? O histórico será preservado.`)) return;
    try { await this.api(`/fontes/${fonte.id}`, { method: 'DELETE' }); await this.carregar(); this.aviso.set('Site removido.'); }
    catch (erro) { this.falha(erro); }
  }

  tipoMarcado(tipo: Tipo): boolean { return this.configuracao.tipos.includes(tipo); }
  alternarTipo(tipo: Tipo, marcado: boolean): void {
    this.configuracao.tipos = marcado ? [...new Set([...this.configuracao.tipos, tipo])] : this.configuracao.tipos.filter((item) => item !== tipo);
  }

  async salvarConfiguracao(): Promise<void> {
    try { await this.api('/configuracao', { method: 'PUT', body: JSON.stringify(this.configuracao) }); await this.carregar(); this.aviso.set('Preferências salvas.'); }
    catch (erro) { this.falha(erro); }
  }

  buscaEmAndamento(): boolean { return ['pendente', 'em_andamento'].includes(this.estado()?.ultimaExecucao?.estado ?? ''); }

  async executarAgora(): Promise<void> {
    try { await this.api('/executar', { method: 'POST' }); await this.carregar(); this.aviso.set('Busca manual iniciada. O painel atualizará o andamento automaticamente.'); void this.atualizarBusca(); }
    catch (erro) { this.falha(erro); }
  }

  private async atualizarBusca(): Promise<void> {
    for (let tentativa = 0; tentativa < 90; tentativa++) {
      await new Promise((resolver) => setTimeout(resolver, 4000));
      await this.carregar();
      if (!this.buscaEmAndamento()) return;
    }
  }

  async testarEmail(): Promise<void> {
    try { await this.api('/email/testar', { method: 'POST' }); this.aviso.set(`E-mail de teste enviado para ${this.configuracao.email_destinatario}.`); }
    catch (erro) { this.falha(erro); }
  }

  async acompanhar(vaga: Vaga, acompanhamento: string): Promise<void> {
    try { await this.api(`/vagas/${vaga.id}`, { method: 'PATCH', body: JSON.stringify({ acompanhamento }) }); await this.carregar(); this.aviso.set('Acompanhamento atualizado.'); }
    catch (erro) { this.falha(erro); }
  }

  data(valor: string | null | undefined): string {
    if (!valor) return 'Ainda não';
    const data = new Date(valor.includes('T') ? valor : `${valor.replace(' ', 'T')}Z`);
    return Number.isNaN(data.getTime()) ? valor : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(data);
  }
}
