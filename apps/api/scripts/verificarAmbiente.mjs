/**
 * Verifica a configuração que as migrations NÃO fazem sozinhas.
 *
 * O runbook lista duas coisas obrigatórias depois do primeiro `db push`: o
 * Custom Access Token Hook e o `app.segredo_hmac`. As duas têm a mesma
 * característica cruel — o sistema sobe normalmente sem elas. A API responde, o
 * login funciona, e só na primeira consulta a dado de campo é que tudo volta
 * vazio, porque a política RLS negou. O sintoma parece "o banco está sem dados",
 * e nada nos logs liga uma coisa à outra.
 *
 * Este script existe para transformar esse silêncio em erro explícito.
 *
 * Uso:
 *   pnpm --filter @jeleitoral/api verificar:ambiente
 *
 * Para incluir a checagem de ponta a ponta dos claims do JWT — a única que prova
 * que o hook está de fato registrado no painel do Supabase, e não apenas
 * declarado no `config.toml`:
 *   EMAIL_VERIFICACAO=... SENHA_VERIFICACAO=... pnpm --filter @jeleitoral/api verificar:ambiente
 */
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

// `fileURLToPath` e não `.pathname`: o caminho deste projeto tem espaço, que na
// URL vira `%20` e chega ao leitor como arquivo inexistente.
config({
  path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env'),
  quiet: true,
});

const CLAIMS_EXIGIDOS = ['id_organizacao', 'campanhas', 'equipes', 'territorios', 'permissoes'];

const resultados = [];
const registrar = (nome, ok, detalhe) => {
  resultados.push({ nome, ok, detalhe });
  process.stdout.write(`${ok ? '  ok  ' : ' FALHA'}  ${nome}\n`);
  if (detalhe) process.stdout.write(`         ${detalhe}\n`);
};

async function verificarBanco() {
  const urlBanco = process.env.BANCO_URL;
  if (!urlBanco) {
    registrar('BANCO_URL definida', false, 'Sem ela não dá para verificar nada do banco.');
    return;
  }

  const cliente = new pg.Client({
    connectionString: urlBanco,
    // O pooler do Supabase usa certificado próprio; a conexão continua cifrada.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await cliente.connect();
  } catch (erro) {
    registrar('Conexão com o banco', false, erro.message);
    return;
  }

  try {
    const { rows: identificacao } = await cliente.query(
      'select current_database() as banco, version() as versao',
    );
    registrar(
      'Conexão com o banco',
      true,
      `${identificacao[0].banco} — ${identificacao[0].versao.split(' ').slice(0, 2).join(' ')}`,
    );

    // --- Hook de token -------------------------------------------------------
    const { rows: funcao } = await cliente.query(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'hook_token_acesso'`,
    );
    registrar(
      'Função public.hook_token_acesso existe',
      funcao.length > 0,
      funcao.length > 0 ? null : 'Migration 0014 não foi aplicada neste banco.',
    );

    // Declarada no config.toml é diferente de concedida no banco: sem este
    // grant o Auth chama o hook e recebe permission denied, o que se manifesta
    // como falha de login e não como falta de claim.
    const { rows: permissao } = await cliente.query(
      `select has_function_privilege(
                'supabase_auth_admin',
                'public.hook_token_acesso(jsonb)',
                'execute'
              ) as pode`,
    );
    registrar(
      'supabase_auth_admin pode executar o hook',
      permissao[0]?.pode === true,
      permissao[0]?.pode === true ? null : 'Reaplique a migration 0014.',
    );

    // --- Índice de busca sobre documento -------------------------------------
    //
    // Não se verifica `app.segredo_hmac` no nível do banco: desde o PostgreSQL
    // 15, definir parâmetro personalizado com `alter database/role ... set`
    // exige superusuário, e o Supabase não concede isso ao papel `postgres`.
    // Tentar retorna `permission denied to set parameter`. O runbook chegou a
    // pedir esse comando; ele nunca teve como funcionar aqui.
    //
    // O desenho real é outro e é o correto: `BancoService.executarComoUsuario`
    // injeta o segredo por transação com `set_config(..., true)`, a partir da
    // variável de ambiente da API. O que precisa ser provado, então, é o
    // acoplamento que de fato pode quebrar — a gravação calcula o HMAC em
    // TypeScript e a busca calcula no banco. Se as duas contas divergirem, o
    // cadastro funciona, a busca por CPF não acha nada, e nada no log liga uma
    // coisa à outra.
    const segredoDaApi = process.env.SEGREDO_HMAC_INDICE ?? '';
    if (!segredoDaApi) {
      registrar('SEGREDO_HMAC_INDICE definido', false, 'Sem ele a API não grava índice de busca.');
    } else {
      const documentoComMascara = '123.456.789-09';
      const esperado = createHmac('sha256', segredoDaApi)
        .update(documentoComMascara.replace(/\D+/g, ''))
        .digest('hex');

      await cliente.query('begin');
      try {
        await cliente.query('select set_config($1, $2, true)', [
          'app.segredo_hmac',
          segredoDaApi,
        ]);
        const { rows } = await cliente.query('select public.hmac_indice($1) as indice', [
          documentoComMascara,
        ]);
        registrar(
          'public.hmac_indice concorda com o cálculo da API',
          rows[0].indice === esperado,
          rows[0].indice === esperado
            ? null
            : 'Divergem: o entrevistado seria gravado com um índice e procurado com outro.',
        );
      } finally {
        await cliente.query('rollback');
      }

      // A proteção acrescentada pela 0017: sem o segredo, a função tem de
      // falhar. Antes ela calculava com chave vazia e devolvia "não encontrado"
      // em silêncio — um falso negativo que faz o operador cadastrar duplicata.
      await cliente.query('begin');
      try {
        await cliente.query(`select public.hmac_indice('12345678909')`);
        registrar(
          'public.hmac_indice recusa calcular sem segredo',
          false,
          'Respondeu sem o segredo definido: voltou a calcular com chave vazia.',
        );
      } catch {
        registrar('public.hmac_indice recusa calcular sem segredo', true, null);
      } finally {
        await cliente.query('rollback');
      }
    }

    // --- Migrations ----------------------------------------------------------
    try {
      const { rows: migrations } = await cliente.query(
        'select count(*)::int as total from manutencao.migrations_aplicadas',
      );
      registrar('Migrations aplicadas', migrations[0].total > 0, `${migrations[0].total} registradas`);
    } catch {
      registrar(
        'Migrations aplicadas',
        false,
        'manutencao.migrations_aplicadas não existe — banco sem linha de base.',
      );
    }
  } finally {
    await cliente.end();
  }
}

/**
 * A única verificação que prova o hook ativo.
 *
 * A função pode existir, ter o grant certo e ainda assim não ser chamada: o
 * registro fica no serviço de Auth, fora do banco. Emitir um token de verdade e
 * olhar os claims é o que não deixa dúvida.
 */
async function verificarClaimsDoToken() {
  const email = process.env.EMAIL_VERIFICACAO;
  const senha = process.env.SENHA_VERIFICACAO;

  if (!email || !senha) {
    process.stdout.write(
      '\n  (pulado) Claims do JWT — defina EMAIL_VERIFICACAO e SENHA_VERIFICACAO\n' +
        '           para provar que o hook está registrado no Auth, e não só no config.toml.\n',
    );
    return;
  }

  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_CHAVE_ANONIMA;
  if (!url || !chave) {
    registrar('Claims do JWT', false, 'SUPABASE_URL e SUPABASE_CHAVE_ANONIMA são necessárias.');
    return;
  }

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    registrar('Autenticação do usuário de verificação', false, error.message);
    return;
  }
  registrar('Autenticação do usuário de verificação', true, email);

  // Só a carga útil; a assinatura já foi validada pelo próprio Auth ao emitir.
  const partes = data.session.access_token.split('.');
  const claims = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));

  const ausentes = CLAIMS_EXIGIDOS.filter((chaveClaim) => claims[chaveClaim] === undefined);
  registrar(
    'Custom Access Token Hook injeta os claims',
    ausentes.length === 0,
    ausentes.length === 0
      ? `id_organizacao=${claims.id_organizacao} perfil=${claims.perfil}`
      : `Ausentes: ${ausentes.join(', ')} — registre o hook em Authentication → Hooks.`,
  );

  await supabase.auth.signOut();
}

process.stdout.write('\nVerificando o ambiente do jEleitoral\n\n');
await verificarBanco();
await verificarClaimsDoToken();

const falhas = resultados.filter((r) => !r.ok);
process.stdout.write(
  `\n${resultados.length - falhas.length}/${resultados.length} verificações passaram.\n`,
);

if (falhas.length > 0) {
  process.stdout.write('\nO sistema NÃO está pronto para receber uso real.\n');
  process.exit(1);
}
