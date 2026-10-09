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
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
}

export function gmailConfigurado(segredos: SegredosGmail): boolean {
  return Boolean(segredos.GMAIL_CLIENT_ID && segredos.GMAIL_CLIENT_SECRET && segredos.GMAIL_REFRESH_TOKEN);
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
    btoa([...new TextEncoder().encode(corpo)].map((byte) => String.fromCharCode(byte)).join(''))
  ].join('\r\n');
}

export async function enviarPeloGmail(segredos: SegredosGmail, preferencias: PreferenciasEmail, vagas: VagaParaEmail[], teste = false): Promise<string> {
  if (!gmailConfigurado(segredos)) throw new Error('Integração com Gmail ainda não configurada.');
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
  const respostaEnvio = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: base64url(mensagem) }), signal: AbortSignal.timeout(15000)
  });
  if (!respostaEnvio.ok) throw new Error(`Gmail recusou o envio (HTTP ${respostaEnvio.status}). Confira o remetente autorizado e a integração.`);
  const resultado = await respostaEnvio.json() as { id?: string };
  if (!resultado.id) throw new Error('O Gmail não confirmou o identificador da mensagem.');
  return resultado.id;
}
