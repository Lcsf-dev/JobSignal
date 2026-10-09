import assert from 'node:assert/strict';
import test from 'node:test';
import { emailValido, montarMensagem } from './email.ts';

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
