import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  ParametrosPaginacao,
  Uuid,
  montarPagina,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { gerarSenhaInicial } from '../comum/gerarSenhaInicial.js';

const EntradaUsuario = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo.').max(120),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  telefone: z.string().trim().max(20).optional(),
  idPerfil: Uuid,
  /** Campanhas a que o usuário passa a ter acesso. Sem elas ele entra e não vê nada. */
  campanhas: z.array(Uuid).default([]),
});

const AlteracaoUsuario = z.object({
  nome: z.string().trim().min(3).max(120).optional(),
  telefone: z.string().trim().max(20).nullable().optional(),
  idPerfil: Uuid.optional(),
  ativo: z.boolean().optional(),
  campanhas: z.array(Uuid).optional(),
});

interface UsuarioListado {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  perfil: string;
  id_perfil: string;
  ativo: boolean;
  ultimo_acesso: Date | null;
}

/**
 * Usuários da organização.
 *
 * Quem administra é o perfil **ADMINISTRADOR**: `usuarios.gerenciar` só existe
 * nele, e o COORDENADOR tem apenas `usuarios.ler` com escopo `EQUIPE` — vê os
 * colegas da própria equipe e não cadastra ninguém. É decisão do modelo de
 * permissões, não limitação desta tela.
 *
 * **Por que a senha volta na resposta em vez de ir por e-mail.**
 *
 * O desenho original previa convite por link: existe `public.convites`, com
 * hash de token e expiração, esperando exatamente isso. **Essa tabela continua
 * sem uso**, e é bom que fique dito, para ninguém supor que o fluxo de convite
 * está ligado.
 *
 * O convite por link depende de entregar e-mail, e não há servidor SMTP
 * configurado no projeto. Pior: o limite padrão do Supabase é de **2 e-mails
 * por hora** — cadastrar os vinte entrevistadores de uma campanha levaria dez
 * horas. Para um pleito em outubro, isso não é uma opção.
 *
 * Então o administrador cadastra e recebe a senha uma vez, na tela, para
 * repassar à pessoa. É o mesmo modelo do script de bootstrap, que já era o que
 * acontecia na prática. Quando houver serviço de envio, o convite por token
 * entra como caminho preferencial, `public.convites` passa a ser usada, e este
 * caminho vira alternativa para quem não tem e-mail — que em equipe de campo é
 * mais comum do que parece.
 *
 * **Onde a chave de serviço aparece — e onde não aparece.** Ela é usada só para
 * criar a conta em `auth.users`, que é tabela do Supabase e não tem
 * `id_organizacao`. A linha em `public.usuarios` é inserida pelo caminho normal,
 * com os claims de quem convidou, sob RLS. Usar a chave de serviço numa tabela
 * multi-inquilino furaria o isolamento que sustenta o produto inteiro.
 */
@Controller('usuarios')
export class UsuariosController {
  private readonly configuracao = carregarConfiguracao();

  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private clienteAdministrativo() {
    return createClient(this.configuracao.SUPABASE_URL, this.configuracao.SUPABASE_CHAVE_SERVICO, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  @Get()
  @ExigePermissao('usuarios.ler')
  async listar(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<UsuarioListado>> {
    const parametros = ParametrosPaginacao.parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<UsuarioListado & { total: string }>(
        `select u.id, u.nome, u.email::text as email, u.telefone,
                p.nome as perfil, u.id_perfil, u.ativo, u.ultimo_acesso,
                count(*) over () as total
           from public.usuarios u
           join public.perfis_acesso p on p.id = u.id_perfil
          order by u.ativo desc, u.nome
          limit $1 offset $2`,
        [parametros.limite, (parametros.pagina - 1) * parametros.limite],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...usuario }) => usuario),
        total,
        parametros,
      );
    });
  }

  /** Perfis disponíveis, para montar o seletor da tela de cadastro. */
  @Get('perfis')
  @ExigePermissao('usuarios.ler')
  async perfis(
    @Claims() claims: ClaimsUsuario,
  ): Promise<Array<{ id: string; nome: string; descricao: string | null }>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; nome: string; descricao: string | null }>(
        'select id, nome, descricao from public.perfis_acesso order by nome',
      );
      return rows;
    });
  }

  /**
   * Equipes da campanha, para o filtro global e para o cadastro de usuário.
   *
   * `equipes.ler`, não `usuarios.ler`: é a permissão que a RLS de
   * `public.equipes` de fato verifica (`0003_politicas_rls_nucleo.sql`).
   * Guardar com outra permissão abriria a possibilidade de um perfil passar
   * no guard e receber lista vazia da RLS sem entender por quê — ou pior,
   * um perfil futuro com `equipes.ler` mas sem `usuarios.ler` ficar barrado
   * aqui sem necessidade.
   */
  @Get('equipes')
  @ExigePermissao('equipes.ler')
  async equipes(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<Array<{ id: string; nome: string }>> {
    const parametros = z.object({ idCampanha: Uuid }).parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; nome: string }>(
        `select id, nome from public.equipes
          where id_campanha = $1 and ativa = true
          order by nome`,
        [parametros.idCampanha],
      );
      return rows;
    });
  }

  @Post()
  @ExigePermissao('usuarios.gerenciar', 'CAMPANHA')
  async criar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; nome: string; email: string; senhaInicial: string }> {
    const entrada = EntradaUsuario.parse(corpo);
    const senhaInicial = gerarSenhaInicial();
    const administrativo = this.clienteAdministrativo();

    // `email_confirm: true` porque não há e-mail de confirmação a enviar — sem
    // isso a conta nasce pendente e o login recusa com uma mensagem que fala de
    // confirmação que nunca vai chegar.
    const { data, error } = await administrativo.auth.admin.createUser({
      email: entrada.email,
      password: senhaInicial,
      email_confirm: true,
    });

    if (error || !data.user) {
      // O Supabase responde algo como "email address already registered". Isso
      // é informação legítima para quem administra a própria organização — mas
      // a conta pode pertencer a OUTRA organização, e confirmar isso vazaria a
      // base de clientes. Daí a mensagem única.
      throw new BadRequestException(
        'Não foi possível criar o acesso. Verifique se este e-mail já está em uso.',
      );
    }

    try {
      return await this.banco.executarComoUsuario(claims, async (conexao) => {
        const { rows } = await conexao.query<{ id: string; nome: string; email: string }>(
          `insert into public.usuarios (id, id_organizacao, nome, email, telefone, id_perfil)
           values ($1, $2, $3, $4, $5, $6)
           returning id, nome, email::text as email`,
          [
            data.user.id,
            // Do token, nunca do corpo: é o que impede convidar para outra organização.
            claims.idOrganizacao,
            entrada.nome,
            entrada.email,
            entrada.telefone ?? null,
            entrada.idPerfil,
          ],
        );
        const criado = rows[0]!;

        for (const idCampanha of entrada.campanhas) {
          await conexao.query(
            `insert into public.usuario_campanhas (id_organizacao, id_usuario, id_campanha)
             values ($1, $2, $3) on conflict do nothing`,
            [claims.idOrganizacao, criado.id, idCampanha],
          );
        }

        await this.auditoria.registrarNaTransacao(conexao, claims, {
          acao: 'CRIAR',
          entidade: 'usuarios',
          idEntidade: criado.id,
          // A senha NÃO entra na auditoria. `logs_auditoria` é imutável por
          // política: o que entrar aqui não sai nunca mais.
          dadosDepois: { nome: criado.nome, email: criado.email, idPerfil: entrada.idPerfil },
          ip: requisicao.ip ?? null,
          userAgent: requisicao.headers['user-agent'] ?? null,
          idCorrelacao: requisicao.idCorrelacao ?? null,
        });

        return { ...criado, senhaInicial };
      });
    } catch (erro) {
      // A conta de autenticação já existe, mas a linha da organização falhou —
      // tipicamente perfil inexistente ou RLS. Deixar assim criaria um usuário
      // capaz de autenticar e invisível para todo mundo, que ninguém consegue
      // corrigir pela interface. Desfazer é o certo.
      await administrativo.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw erro;
    }
  }

  @Put(':id')
  @ExigePermissao('usuarios.gerenciar', 'CAMPANHA')
  async alterar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<UsuarioListado> {
    const idUsuario = Uuid.parse(id);
    const entrada = AlteracaoUsuario.parse(corpo);

    if (idUsuario === claims.sub && entrada.ativo === false) {
      // Desativar a si mesmo tranca o último administrador do lado de fora, e
      // não há caminho na interface para desfazer.
      throw new BadRequestException('Você não pode desativar o próprio acesso.');
    }

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query<UsuarioListado>(
        `select u.id, u.nome, u.email::text as email, u.telefone, p.nome as perfil,
                u.id_perfil, u.ativo, u.ultimo_acesso
           from public.usuarios u
           join public.perfis_acesso p on p.id = u.id_perfil
          where u.id = $1`,
        [idUsuario],
      );
      if (!antes[0]) {
        throw Object.assign(new Error('Usuário não encontrado.'), { code: '42501' });
      }

      const { rows } = await conexao.query<UsuarioListado>(
        `update public.usuarios
            set nome = coalesce($2, nome),
                telefone = case when $3::boolean then $4 else telefone end,
                id_perfil = coalesce($5, id_perfil),
                ativo = coalesce($6, ativo),
                atualizado_em = now()
          where id = $1
        returning id, nome, email::text as email, telefone, id_perfil, ativo, ultimo_acesso,
                  (select nome from public.perfis_acesso where id = public.usuarios.id_perfil) as perfil`,
        [
          idUsuario,
          entrada.nome ?? null,
          entrada.telefone !== undefined,
          entrada.telefone ?? null,
          entrada.idPerfil ?? null,
          entrada.ativo ?? null,
        ],
      );

      if (entrada.campanhas) {
        await conexao.query('delete from public.usuario_campanhas where id_usuario = $1', [
          idUsuario,
        ]);
        for (const idCampanha of entrada.campanhas) {
          await conexao.query(
            `insert into public.usuario_campanhas (id_organizacao, id_usuario, id_campanha)
             values ($1, $2, $3) on conflict do nothing`,
            [claims.idOrganizacao, idUsuario, idCampanha],
          );
        }
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'usuarios',
        idEntidade: idUsuario,
        dadosAntes: antes[0],
        dadosDepois: rows[0],
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return rows[0]!;
    });
  }

  /**
   * Gera nova senha para quem perdeu a sua.
   *
   * Confere antes que o usuário pertence à organização de quem pede — a
   * checagem passa por RLS, então um identificador de outro inquilino não
   * encontra linha nenhuma e a operação para aqui, sem tocar no Auth (que é
   * global e não sabe de organizações).
   */
  @Post(':id/redefinir-senha')
  @ExigePermissao('usuarios.gerenciar', 'CAMPANHA')
  async redefinirSenha(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<{ senhaInicial: string }> {
    const idUsuario = Uuid.parse(id);
    const senhaInicial = gerarSenhaInicial();

    await this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query('select 1 from public.usuarios where id = $1', [
        idUsuario,
      ]);
      if (!rows[0]) {
        throw Object.assign(new Error('Usuário não encontrado.'), { code: '42501' });
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'usuarios',
        idEntidade: idUsuario,
        dadosDepois: { senhaRedefinida: true },
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });
    });

    const { error } = await this.clienteAdministrativo().auth.admin.updateUserById(idUsuario, {
      password: senhaInicial,
    });
    if (error) {
      throw new BadRequestException('Não foi possível redefinir a senha.');
    }

    return { senhaInicial };
  }
}
