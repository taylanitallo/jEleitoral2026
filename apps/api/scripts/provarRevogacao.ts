/**
 * Prova, contra o banco de homologação, que os gatilhos de revogação disparam
 * quando devem — e que NÃO disparam quando não devem.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

// O .env mora na RAIZ do monorepo, nao neste diretorio.
config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env') });

const pool = new Pool({ connectionString: process.env.BANCO_URL });

async function marca(id: string): Promise<number> {
  const { rows } = await pool.query<{ m: Date }>(
    'select claims_invalidos_apos as m from public.usuarios where id = $1',
    [id],
  );
  return rows[0]!.m.getTime();
}

async function main(): Promise<void> {
  /*
   * Este script ESCREVE: ele desativa e reativa um usuário para provar que o
   * gatilho dispara. Num banco de produção isso derrubaria a sessão de alguém
   * no meio do expediente, e o desligamento momentâneo apareceria na auditoria
   * sem que ninguém o tivesse pedido. Por isso o consentimento explícito.
   */
  if (process.env.PERMITIR_ESCRITA_DE_TESTE !== '1') {
    console.error(
      'Este script escreve no banco (desativa e reativa um usuário).\n' +
        'Rode com PERMITIR_ESCRITA_DE_TESTE=1 e NUNCA contra produção.',
    );
    process.exitCode = 1;
    return;
  }

  const { rows } = await pool.query<{ id: string; id_perfil: string; telefone: string | null }>(
    'select id, id_perfil, telefone from public.usuarios limit 1',
  );
  if (rows.length === 0) {
    console.log('Sem usuários no banco — nada a provar.');
    return;
  }
  const usuario = rows[0]!;
  let falhas = 0;

  const antesDoRuido = await marca(usuario.id);
  await pool.query('update public.usuarios set telefone = $2 where id = $1', [
    usuario.id,
    usuario.telefone ?? '85999990000',
  ]);
  const depoisDoRuido = await marca(usuario.id);
  if (depoisDoRuido !== antesDoRuido) {
    console.log('  FALHA  editar o telefone invalidou a sessão (não deveria)');
    falhas += 1;
  } else {
    console.log('  ok     editar campo irrelevante NÃO invalida a sessão');
  }

  await pool.query('update public.usuarios set ativo = not ativo where id = $1', [usuario.id]);
  const depoisDeDesativar = await marca(usuario.id);
  await pool.query('update public.usuarios set ativo = not ativo where id = $1', [usuario.id]);

  if (depoisDeDesativar <= antesDoRuido) {
    console.log('  FALHA  desativar o usuário NÃO invalidou a sessão');
    falhas += 1;
  } else {
    console.log('  ok     desativar o usuário invalida a sessão');
  }

  // Permissão de perfil: atinge todo mundo que usa o perfil.
  const antesDaPermissao = await marca(usuario.id);
  await pool.query(
    `update public.perfil_permissoes set escopo = escopo
      where id_perfil = $1 and id_permissao = (
        select id_permissao from public.perfil_permissoes where id_perfil = $1 limit 1)`,
    [usuario.id_perfil],
  );
  const depoisDaPermissao = await marca(usuario.id);
  if (depoisDaPermissao <= antesDaPermissao) {
    console.log('  FALHA  mexer na permissão do perfil NÃO invalidou a sessão');
    falhas += 1;
  } else {
    console.log('  ok     mexer na permissão do perfil invalida a sessão');
  }

  console.log(falhas === 0 ? '\n3/3 verificações passaram.' : `\n${falhas} falha(s).`);
  process.exitCode = falhas === 0 ? 0 : 1;
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
