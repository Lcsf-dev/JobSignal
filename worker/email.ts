export interface PreferenciasEmail {
  remetente: string;
  destinatario: string;
}

export interface VagaParaEmail {
  id: number;
  titulo: string;
  empresa: string;
  url: string;
  tipo: string | null;
}

export interface SegredosGmail {
  GMAIL_APP_PASSWORD?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
}

export function gmailConfigurado(segredos: SegredosGmail): boolean {
  return Boolean(segredos.GMAIL_APP_PASSWORD?.trim()
    || (segredos.GMAIL_CLIENT_ID && segredos.GMAIL_CLIENT_SECRET && segredos.GMAIL_REFRESH_TOKEN));
}

export function emailValido(endereco: string): boolean {
  return /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(endereco) && endereco.length <= 254;
}

function base64url(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function montarMensagem(preferencias: PreferenciasEmail, vagas: VagaParaEmail[], teste = false): string {
  if (!emailValido(preferencias.remetente) || !emailValido(preferencias.destinatario)) throw new Error('Configure endereços de e-mail válidos.');
  const assunto = teste ? 'JobSignal: teste de notificação' : `JobSignal: ${vagas.length} vaga(s) encontrada(s)`;
  const linhas = teste
    ? ['Este é um teste de envio do JobSignal.', 'As notificações de vagas usarão estes endereços.']
    : ['O JobSignal encontrou oportunidades que atendem aos filtros configurados.', '',
      ...vagas.flatMap((vaga, indice) => [
        `${indice + 1}. ${vaga.titulo} — ${vaga.empresa}`,
        `Tipo: ${vaga.tipo ?? 'a verificar'}`,
        `Vaga original: ${vaga.url}`,
        ''
      ]), 'Confira os detalhes e candidate-se manualmente no site da vaga.'];
  const corpo = linhas.join('\r\n');
  const assuntoCodificado = `=?UTF-8?B?${btoa([...new TextEncoder().encode(assunto)].map((byte) => String.fromCharCode(byte)).join(''))}?=`;
  return [
    `From: ${preferencias.remetente}`,
    `To: ${preferencias.destinatario}`,
    `Subject: ${assuntoCodificado}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    (btoa([...new TextEncoder().encode(corpo)].map((byte) => String.fromCharCode(byte)).join('')).match(/.{1,76}/g) ?? []).join('\r\n')
  ].join('\r\n');
}

export async function conduzirSessaoSmtp(
  conexao: Pick<Socket, 'opened' | 'readable' | 'writable'>,
  preferencias: PreferenciasEmail,
  senhaDeApp: string,
  mensagem: string,
  antesDeEnviar?: () => Promise<void>
): Promise<string> {
  await conexao.opened;
  const leitor = conexao.readable.getReader();
  const escritor = conexao.writable.getWriter();
  const decodificador = new TextDecoder();
  const codificador = new TextEncoder();
  let pendente = '';
  async function lerLinha(): Promise<string> {
    for (;;) {
      const fim = pendente.indexOf('\n');
      if (fim >= 0) {
        const linha = pendente.slice(0, fim).replace(/\r$/, '');
        pendente = pendente.slice(fim + 1);
        return linha;
      }
      const parte = await leitor.read();
      if (parte.done) throw new Error('O Gmail encerrou a conexão SMTP antes de confirmar o envio.');
      pendente += decodificador.decode(parte.value, { stream: true });
      if (pendente.length > 20_000) throw new Error('Resposta SMTP do Gmail maior que o esperado.');
    }
  }
  async function aguardarResposta(esperados: number[]): Promise<string> {
    let linha: string;
    do {
      linha = await lerLinha();
      if (!/^\d{3}[- ]/.test(linha)) throw new Error('Resposta SMTP do Gmail em formato inesperado.');
    } while (linha[3] === '-');
    const codigo = Number(linha.slice(0, 3));
    if (!esperados.includes(codigo)) throw new Error(`Gmail recusou a operação SMTP (código ${codigo}).`);
    return linha;
  }
  async function comando(valor: string, esperados: number[]): Promise<string> {
    await escritor.write(codificador.encode(`${valor}\r\n`));
    return aguardarResposta(esperados);
  }
  try {
    await aguardarResposta([220]);
    await comando('EHLO jobsignal', [250]);
    await comando('AUTH LOGIN', [334]);
    await comando(btoa(preferencias.remetente), [334]);
    await comando(btoa(senhaDeApp.replace(/\s/g, '')), [235]);
    await comando(`MAIL FROM:<${preferencias.remetente}>`, [250]);
    await comando(`RCPT TO:<${preferencias.destinatario}>`, [250, 251]);
    await comando('DATA', [354]);
    await antesDeEnviar?.();
    const conteudo = mensagem.replace(/(^|\r\n)\./g, '$1..');
    await escritor.write(codificador.encode(`${conteudo}\r\n.\r\n`));
    const confirmacao = await aguardarResposta([250]);
    try { await comando('QUIT', [221]); } catch { /* A entrega já foi aceita pelo Gmail. */ }
    return confirmacao.slice(4);
  } finally {
    escritor.releaseLock();
    leitor.releaseLock();
  }
}

async function enviarPeloSmtp(
  senhaDeApp: string, preferencias: PreferenciasEmail, vagas: VagaParaEmail[], teste: boolean,
  antesDeEnviar?: () => Promise<void>
): Promise<string> {
  const { connect } = await import('cloudflare:sockets');
  const conexao = connect({ hostname: 'smtp.gmail.com', port: 465 }, { secureTransport: 'on', allowHalfOpen: false });
  const limite = setTimeout(() => { void conexao.close().catch(() => {}); }, 30_000);
  try {
    return await conduzirSessaoSmtp(conexao, preferencias, senhaDeApp,
      montarMensagem(preferencias, vagas, teste), antesDeEnviar);
  } finally {
    clearTimeout(limite);
    try { await conexao.close(); } catch { /* A conexão pode já ter sido encerrada pelo Gmail. */ }
  }
}

export async function enviarPeloGmail(
  segredos: SegredosGmail, preferencias: PreferenciasEmail, vagas: VagaParaEmail[], teste = false,
  antesDeEnviar?: () => Promise<void>
): Promise<string> {
  if (!gmailConfigurado(segredos)) throw new Error('Integração com Gmail ainda não configurada.');
  if (segredos.GMAIL_APP_PASSWORD?.trim()) {
    return enviarPeloSmtp(segredos.GMAIL_APP_PASSWORD, preferencias, vagas, teste, antesDeEnviar);
  }
  const credenciais = new URLSearchParams({
    client_id: segredos.GMAIL_CLIENT_ID!, client_secret: segredos.GMAIL_CLIENT_SECRET!,
    refresh_token: segredos.GMAIL_REFRESH_TOKEN!, grant_type: 'refresh_token'
  });
  const respostaToken = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: credenciais, signal: AbortSignal.timeout(12000)
  });
  if (!respostaToken.ok) throw new Error(`Autorização do Gmail falhou (HTTP ${respostaToken.status}). Reconecte a conta remetente.`);
  const token = await respostaToken.json() as { access_token?: string };
  if (!token.access_token) throw new Error('O Gmail não retornou autorização para envio.');
  const mensagem = montarMensagem(preferencias, vagas, teste);
  await antesDeEnviar?.();
  const respostaEnvio = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64url(mensagem) }), signal: AbortSignal.timeout(15000)
  });
  if (!respostaEnvio.ok) throw new Error(`Gmail recusou o envio (HTTP ${respostaEnvio.status}). Confira o remetente autorizado e a integração.`);
  const resultado = await respostaEnvio.json() as { id?: string };
  if (!resultado.id) throw new Error('O Gmail não confirmou o identificador da mensagem.');
  return resultado.id;
}
