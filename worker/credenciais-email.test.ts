import assert from 'node:assert/strict';
import test from 'node:test';
import { criptografarSenhaDeApp, descriptografarSenhaDeApp } from './credenciais-email.ts';

test('protege a senha de app e exige a chave correta para recuperá-la', async () => {
  const chave = btoa('01234567890123456789012345678901');
  const outraChave = btoa('98765432109876543210987654321098');
  const protegida = await criptografarSenhaDeApp('abcdefghijklmnop', chave);
  assert.ok(!protegida.cifra.includes('abcdefghijklmnop'));
  assert.equal(await descriptografarSenhaDeApp(protegida.cifra, protegida.vetor, chave), 'abcdefghijklmnop');
  await assert.rejects(() => descriptografarSenhaDeApp(protegida.cifra, protegida.vetor, outraChave));
});
