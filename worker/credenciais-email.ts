import { gmailConfigurado, type SegredosGmail } from './email.ts';

interface AmbienteCredenciais extends SegredosGmail {
  DB: D1Database;
  EMAIL_ENCRYPTION_KEY?: string;
}

function bytesEmBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function base64EmBytes(texto: string): Uint8Array<ArrayBuffer> {
  const conteudo = atob(texto);
  const bytes = new Uint8Array(new ArrayBuffer(conteudo.length));
  for (let indice = 0; indice < conteudo.length; indice++) bytes[indice] = conteudo.charCodeAt(indice);
  return bytes;
}

async function chaveDeCriptografia(segredo?: string): Promise<CryptoKey> {
  if (!segredo) throw new Error('Chave de proteção do e-mail não configurada no Worker.');
  const bytes = base64EmBytes(segredo);
  if (bytes.length !== 32) throw new Error('Chave de proteção do e-mail inválida.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function criptografarSenhaDeApp(senha: string, segredo: string): Promise<{ cifra: string; vetor: string }> {
  const vetor = crypto.getRandomValues(new Uint8Array(12));
  const cifra = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: vetor }, await chaveDeCriptografia(segredo),
    new TextEncoder().encode(senha));
  return { cifra: bytesEmBase64(new Uint8Array(cifra)), vetor: bytesEmBase64(vetor) };
}

export async function descriptografarSenhaDeApp(cifra: string, vetor: string, segredo: string): Promise<string> {
  const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64EmBytes(vetor) },
    await chaveDeCriptografia(segredo), base64EmBytes(cifra));
  return new TextDecoder().decode(bytes);
}

export async function salvarSenhaDeApp(env: AmbienteCredenciais, entrada: string): Promise<void> {
  const senha = entrada.replace(/\s/g, '');
  if (!/^[a-z\d]{16}$/i.test(senha)) throw new Error('A senha de app deve ter 16 caracteres.');
  const protegida = await criptografarSenhaDeApp(senha, env.EMAIL_ENCRYPTION_KEY ?? '');
  await env.DB.prepare(`INSERT INTO credencial_email (id, senha_cifrada, vetor_inicializacao)
    VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET senha_cifrada = excluded.senha_cifrada,
    vetor_inicializacao = excluded.vetor_inicializacao, atualizada_em = CURRENT_TIMESTAMP`)
    .bind(protegida.cifra, protegida.vetor).run();
}

export async function credenciaisGmail(env: AmbienteCredenciais): Promise<SegredosGmail> {
  const segredos = { GMAIL_APP_PASSWORD: env.GMAIL_APP_PASSWORD, GMAIL_CLIENT_ID: env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN: env.GMAIL_REFRESH_TOKEN };
  if (gmailConfigurado(segredos) || !env.EMAIL_ENCRYPTION_KEY) return segredos;
  const registro = await env.DB.prepare('SELECT senha_cifrada, vetor_inicializacao FROM credencial_email WHERE id = 1')
    .first<{ senha_cifrada: string; vetor_inicializacao: string }>();
  if (!registro) return segredos;
  return { ...segredos, GMAIL_APP_PASSWORD: await descriptografarSenhaDeApp(
    registro.senha_cifrada, registro.vetor_inicializacao, env.EMAIL_ENCRYPTION_KEY) };
}

export async function emailConfigurado(env: AmbienteCredenciais): Promise<boolean> {
  if (gmailConfigurado(env)) return true;
  if (!env.EMAIL_ENCRYPTION_KEY) return false;
  const registro = await env.DB.prepare('SELECT 1 AS presente FROM credencial_email WHERE id = 1').first();
  return Boolean(registro);
}
