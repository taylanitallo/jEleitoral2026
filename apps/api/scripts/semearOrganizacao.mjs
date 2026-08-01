/**
 * Semeia a primeira organização e seus usuários.
 *
 * Bootstrap deliberadamente manual: não há autocadastro no sistema, e a
 * primeira organização não tem quem a convide. Este script existe para esse
 * momento e não deve virar rotina — depois dele, usuários entram por convite.
 *
 * Uso:
 *   BANCO_URL=... SUPABASE_URL=... SUPABASE_CHAVE_SERVICO=... \
 *   node scripts/semearOrganizacao.mjs
 */
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Client } = pg;

const exigir = (nome) => {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Defina ${nome}.`);
  return valor;
};

/**
 * Senha legível de digitar e forte o bastante para um primeiro acesso — quem
 * recebe é orientado a trocar. Evita caracteres que se confundem em fonte
 * monoespaçada (l/1/I, O/0).
 */
function gerarSenha() {
  const alfabeto = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const simbolos = '!@#$%&*';
  const bytes = randomBytes(20);
  let senha = '';
  for (let i = 0; i < 16; i += 1) senha += alfabeto[bytes[i] % alfabeto.length];
  senha += simbolos[bytes[16] % simbolos.length];
  senha += String(bytes[17] % 10);
  return senha;
}

const USUARIOS = [
  { nome: 'Administrador Jeos', email: 'admin@jeos.com.br', perfil: 'ADMINISTRADOR' },
  // O segundo é COORDENADOR de propósito: o perfil ADMINISTRADOR exige MFA, e
  // um usuário sem essa exigência garante que alguém consiga entrar e trabalhar
  // enquanto o segundo fator do administrador não estiver inscrito.
  { nome: 'Coordenador de Campanha', email: 'coordenador@jeos.com.br', perfil: 'COORDENADOR' },
];

async function principal() {
  const supabase = createClient(exigir('SUPABASE_URL'), exigir('SUPABASE_CHAVE_SERVICO'), {
    auth: { persistSession: false },
  });
  const banco = new Client({ connectionString: exigir('BANCO_URL') });
  await banco.connect();

  try {
    await banco.query('begin');

    const { rows: planos } = await banco.query(
      'select id from public.planos order by valor_mensal desc limit 1',
    );
    const idPlano = planos[0]?.id;
    if (!idPlano) throw new Error('Nenhum plano cadastrado — rode as migrations.');

    const { rows: orgs } = await banco.query(
      `insert into public.organizacoes (nome, razao_social, id_plano, cor_acento)
       values ($1, $2, $3, $4)
       returning id`,
      ['Jeos Sistemas — Campanha Demonstração', 'Jeos Sistemas Ltda', idPlano, '221 83% 45%'],
    );
    const idOrganizacao = orgs[0].id;

    await banco.query('select public.semear_perfis_organizacao($1)', [idOrganizacao]);

    const { rows: campanhas } = await banco.query(
      `insert into public.campanhas (id_organizacao, nome, abrangencia, uf, ano_pleito)
       values ($1, 'Deputado Federal 2026', 'ESTADUAL', 'SP', 2026)
       returning id`,
      [idOrganizacao],
    );
    const idCampanha = campanhas[0].id;

    const credenciais = [];

    for (const definicao of USUARIOS) {
      const senha = gerarSenha();

      const { data, error } = await supabase.auth.admin.createUser({
        email: definicao.email,
        password: senha,
        email_confirm: true,
      });
      if (error) throw new Error(`Falha ao criar ${definicao.email}: ${error.message}`);

      const { rows: perfis } = await banco.query(
        'select id from public.perfis_acesso where id_organizacao = $1 and nome = $2',
        [idOrganizacao, definicao.perfil],
      );

      await banco.query(
        `insert into public.usuarios (id, id_organizacao, nome, email, id_perfil, ativo)
         values ($1, $2, $3, $4, $5, true)`,
        [data.user.id, idOrganizacao, definicao.nome, definicao.email, perfis[0].id],
      );

      await banco.query(
        `insert into public.usuario_campanhas (id_usuario, id_campanha, id_organizacao, id_perfil)
         values ($1, $2, $3, $4)`,
        [data.user.id, idCampanha, idOrganizacao, perfis[0].id],
      );

      credenciais.push({ ...definicao, senha });
    }

    // Termo de consentimento vigente: sem ele nenhuma entrevista pode ser
    // concluída, e o gatilho do banco recusaria a primeira coleta.
    await banco.query(
      `insert into public.versoes_consentimento
         (id_organizacao, versao, texto, finalidade)
       values ($1, '1.0', $2, 'Planejamento de campanha eleitoral')`,
      [
        idOrganizacao,
        'Autorizo o registro das informações que forneci, incluindo minha preferência ' +
          'eleitoral, para uso exclusivo no planejamento desta campanha. Fui informado de que ' +
          'posso consultar, corrigir ou pedir a exclusão dos meus dados a qualquer momento, e ' +
          'de que eles não serão compartilhados com terceiros nem divulgados publicamente.',
      ],
    );

    await banco.query('commit');

    process.stdout.write('\nOrganização e usuários criados.\n\n');
    process.stdout.write(`  organização: ${idOrganizacao}\n`);
    process.stdout.write(`  campanha:    ${idCampanha}\n\n`);
    for (const credencial of credenciais) {
      process.stdout.write(`  ${credencial.perfil}\n`);
      process.stdout.write(`    e-mail: ${credencial.email}\n`);
      process.stdout.write(`    senha:  ${credencial.senha}\n\n`);
    }
  } catch (erro) {
    await banco.query('rollback').catch(() => undefined);
    throw erro;
  } finally {
    await banco.end();
  }
}

principal().catch((erro) => {
  process.stderr.write(`Falhou: ${String(erro)}\n`);
  process.exitCode = 1;
});
