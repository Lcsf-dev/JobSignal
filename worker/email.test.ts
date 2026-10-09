import assert from 'node:assert/strict';
import test from 'node:test';
import { conduzirSessaoSmtp, emailValido, gmailConfigurado, montarMensagem } from './email.ts';

test('valida e-mail e monta aviso UTF-8 com link original da vaga', () => {
  assert.equal(emailValido('yugi.lucas@gmail.com'), true);
  assert.equal(emailValido('endereço inválido'), false);
  const mensagem = montarMensagem({ remetente: 'yugi.lucas@gmail.com', destinatario: 'lucas.lcsf.dev@gmail.com' }, [
    { id: 1, titulo: 'Analista Júnior', empresa: 'Exemplo', url: 'https://exemplo.com/vaga/1', tipo: 'analista_junior' }
  ]);
  const corpoCodificado = mensagem.split('\r\n\r\n').at(-1)!;
  const corpo = new TextDecoder().decode(Uint8Array.from(atob(corpoCodificado), (letra) => letra.charCodeAt(0)));
  assert.match(corpo, /Analista Júnior/);
  assert.match(corpo, /https:\/\/exemplo.com\/vaga\/1/);
  assert.match(mensagem, /From: yugi\.lucas@gmail\.com/);
});

test('aceita senha de app e reúne todas as vagas em uma mensagem SMTP', async () => {
  assert.equal(gmailConfigurado({ GMAIL_APP_PASSWORD: 'senha-de-app' }), true);
  const comandos: string[] = [];
  const codificador = new TextEncoder();
  const respostas = ['220 Gmail pronto', '250-Gmail', '250 AUTH LOGIN', '334 Usuario', '334 Senha',
    '235 Autenticado', '250 Remetente aceito', '250 Destinatario aceito', '354 Envie o corpo',
    '250 2.0.0 Mensagem aceita', '221 Ate logo'].join('\r\n') + '\r\n';
  const conexao = {
    opened: Promise.resolve({}),
    readable: new ReadableStream<Uint8Array>({ start(controlador) { controlador.enqueue(codificador.encode(respostas)); controlador.close(); } }),
    writable: new WritableStream<Uint8Array>({ write(parte) { comandos.push(new TextDecoder().decode(parte)); } })
  } as Pick<Socket, 'opened' | 'readable' | 'writable'>;
  const preferencias = { remetente: 'yugi.lucas@gmail.com', destinatario: 'lucas.lcsf.dev@gmail.com' };
  const vagas = Array.from({ length: 3 }, (_, indice) => ({ id: indice + 1, titulo: `Vaga ${indice + 1}`,
    empresa: 'Empresa Exemplo', url: `https://exemplo.com/vaga/${indice + 1}`, tipo: 'junior' }));
  let registroAntesDoEnvio = 0;
  await conduzirSessaoSmtp(conexao, preferencias, 'senha de app', montarMensagem(preferencias, vagas), async () => {
    registroAntesDoEnvio++;
    assert.equal(comandos.at(-1), 'DATA\r\n');
  });
  assert.equal(registroAntesDoEnvio, 1);
  assert.equal(comandos.filter((comando) => comando === 'DATA\r\n').length, 1);
  assert.equal(comandos[0], 'EHLO jobsignal\r\n');
  assert.equal(comandos[3], `${btoa('senhadeapp')}\r\n`);
  const corpoCodificado = comandos.at(-2)?.split('\r\n\r\n')[1]?.split('\r\n.\r\n')[0] ?? '';
  const corpo = new TextDecoder().decode(Uint8Array.from(atob(corpoCodificado), (letra) => letra.charCodeAt(0)));
  for (const vaga of vagas) assert.match(corpo, new RegExp(vaga.url.replaceAll('/', '\\/')));
});
