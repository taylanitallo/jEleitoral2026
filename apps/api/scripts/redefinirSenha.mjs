/**
 * `pnpm usuario:senha <email> [senha]`
 *
 * Redefine a senha de um usuário no ambiente apontado pelo `.env`. Sem a senha
 * no argumento, gera uma.
 *
 * A senha gerada usa só letras e dígitos de propósito. Senha com `!`, `$` ou
 * `&` é mangada ao ser copiada por terminal ou colada em campo com
 * autocompletar, e o resultado é "e-mail ou senha incorretos" contra uma
 * credencial que está certa — meia hora perdida procurando defeito onde não há.
 *
 * Usa a chave de serviço, que só existe fora do navegador. Não há caminho para
 * um usuário trocar a senha de outro pela API.
 */
import { resolve as resolverCaminho } from 'node:path';
import { fileURLToPath as paraCaminho } from 'node:url';
import { config as carregarEnv } from 'dotenv';

// `.env` da RAIZ do monorepo: `dotenv/config` procura em process.cwd(),
// que com `pnpm --filter` e `apps/api`, e o arquivo mora na raiz.
carregarEnv({ path: resolverCaminho(paraCaminho(new URL('.', import.meta.url)), '../../../.env') });
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Defina ${nome} no .env.`);
  return valor;
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function gerarSenha(tamanho = 20) {
  // Sem `I`, `l`, `O`, `0` e `1`: a senha vai ser lida em voz alta e digitada.
  const bytes = randomBytes(tamanho);
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
}

async function principal() {
  const email = process.argv[2];
  if (!email) throw new Error('Uso: pnpm usuario:senha <email> [senha]');
  const senha = process.argv[3] ?? gerarSenha();

  const supabase = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_CHAVE_SERVICO'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lista, error: erroLista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (erroLista) throw erroLista;

  const usuario = lista.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!usuario) throw new Error(`Usuário ${email} não existe neste ambiente.`);

  const { error } = await supabase.auth.admin.updateUserById(usuario.id, { password: senha });
  if (error) throw error;

  console.log(`Senha redefinida em ${new URL(exigir('SUPABASE_URL')).hostname}`);
  console.log(`  ${email}`);
  console.log(`  ${senha}`);
}

principal().catch((erro) => {
  console.error('Falha:', erro.message ?? String(erro));
  process.exitCode = 1;
});
