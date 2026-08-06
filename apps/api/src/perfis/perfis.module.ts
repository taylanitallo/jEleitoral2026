import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, EscopoPermissao, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaPerfil = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do perfil.').max(60),
  descricao: z.string().trim().max(200).optional(),
});

const AlteracaoPerfil = z.object({
  nome: z.string().trim().min(2).max(60).optional(),
  descricao: z.string().trim().max(200).nullable().optional(),
});

const EntradaPermissoesPerfil = z.array(
  z.object({ chave: z.string(), escopo: EscopoPermissao.nullable() }),
);

interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
  sistema_padrao: boolean;
  total_usuarios: number;
}

/**
 * Perfis de acesso — a aba "Perfis de acesso" de Configurações.
 *
 * A permissão `perfis.gerenciar` está semeada desde a 0012 (`0012_semente_
 * permissoes.sql`) e nunca teve tela: perfis só existiam por SQL, criados uma
 * vez por `semear_perfis_organizacao` e editados manualmente por quem tivesse
 * acesso ao banco. Esta é a tela que fecha essa lacuna.
 */
@Injectable()
export class PerfisService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(claims: ClaimsUsuario): Promise<Perfil[]> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Perfil>(
        `select p.id, p.nome, p.descricao, p.sistema_padrao,
                (select count(*)::int from public.usuarios u where u.id_perfil = p.id)
                  as total_usuarios
           from public.perfis_acesso p
          where p.id_organizacao = $1
          order by p.nome`,
        [claims.idOrganizacao],
      );
      return rows;
    });
  }

  async criar(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaPerfil>,
  ): Promise<{ id: string }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.perfis_acesso (id_organizacao, nome, descricao)
         values ($1, $2, $3) returning id`,
        [claims.idOrganizacao, entrada.nome, entrada.descricao ?? null],
      );
      const criado = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'perfis_acesso',
        idEntidade: criado.id,
        dadosDepois: entrada,
      });

      return criado;
    });
  }

  async alterar(
    claims: ClaimsUsuario,
    id: string,
    entrada: z.infer<typeof AlteracaoPerfil>,
  ): Promise<Perfil> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query<Perfil>(
        `select id, nome, descricao, sistema_padrao,
                (select count(*)::int from public.usuarios u where u.id_perfil = p.id)
                  as total_usuarios
           from public.perfis_acesso p where p.id = $1`,
        [id],
      );
      if (!antes[0]) throw new BadRequestException('Perfil não encontrado.');

      const { rows } = await conexao.query<Perfil>(
        `update public.perfis_acesso
            set nome = coalesce($2, nome),
                descricao = case when $3::boolean then $4 else descricao end,
                atualizado_em = now()
          where id = $1
        returning id, nome, descricao, sistema_padrao,
                  (select count(*)::int from public.usuarios u where u.id_perfil = public.perfis_acesso.id)
                    as total_usuarios`,
        [id, entrada.nome ?? null, entrada.descricao !== undefined, entrada.descricao ?? null],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'perfis_acesso',
        idEntidade: id,
        dadosAntes: antes[0],
        dadosDepois: rows[0],
      });

      return rows[0]!;
    });
  }

  async excluir(claims: ClaimsUsuario, id: string): Promise<{ excluido: boolean }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        sistema_padrao: boolean;
        total_usuarios: number;
      }>(
        `select p.sistema_padrao,
                (select count(*)::int from public.usuarios u where u.id_perfil = p.id)
                  as total_usuarios
           from public.perfis_acesso p where p.id = $1`,
        [id],
      );
      const perfil = rows[0];
      if (!perfil) throw new BadRequestException('Perfil não encontrado.');
      if (perfil.sistema_padrao) {
        throw new BadRequestException('Perfis criados pelo sistema não podem ser excluídos.');
      }
      if (perfil.total_usuarios > 0) {
        throw new BadRequestException(
          `Este perfil está em uso por ${perfil.total_usuarios} usuário(s) — mova-os para outro perfil antes de excluir.`,
        );
      }

      await conexao.query('delete from public.perfis_acesso where id = $1', [id]);

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'EXCLUIR',
        entidade: 'perfis_acesso',
        idEntidade: id,
      });

      return { excluido: true };
    });
  }

  /**
   * Mapa completo cruzando TODO o catálogo — não só o que já foi concedido —
   * porque a tela precisa saber que linhas desenhar mesmo para permissões que
   * o perfil ainda não tem.
   */
  async permissoes(
    claims: ClaimsUsuario,
    idPerfil: string,
  ): Promise<Array<{ chave: string; modulo: string; descricao: string; escopo: string | null }>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        chave: string;
        modulo: string;
        descricao: string;
        escopo: string | null;
      }>(
        `select pe.chave, pe.modulo, pe.descricao, pp.escopo
           from public.permissoes pe
           left join public.perfil_permissoes pp
             on pp.id_permissao = pe.id and pp.id_perfil = $1
          order by pe.modulo, pe.chave`,
        [idPerfil],
      );
      return rows;
    });
  }

  async definirPermissoes(
    claims: ClaimsUsuario,
    idPerfil: string,
    entrada: z.infer<typeof EntradaPermissoesPerfil>,
  ): Promise<{ total: number }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const concedidas = entrada.filter(
        (item): item is { chave: string; escopo: NonNullable<typeof item.escopo> } =>
          item.escopo !== null,
      );
      const chavesRevogadas = entrada.filter((item) => item.escopo === null).map((i) => i.chave);

      if (chavesRevogadas.length > 0) {
        await conexao.query(
          `delete from public.perfil_permissoes
            where id_perfil = $1
              and id_permissao in (select id from public.permissoes where chave = any($2))`,
          [idPerfil, chavesRevogadas],
        );
      }

      for (const item of concedidas) {
        await conexao.query(
          `insert into public.perfil_permissoes (id_perfil, id_permissao, escopo)
           select $1, id, $3 from public.permissoes where chave = $2
           on conflict (id_perfil, id_permissao) do update set escopo = excluded.escopo`,
          [idPerfil, item.chave, item.escopo],
        );
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'perfil_permissoes',
        idEntidade: idPerfil,
        dadosDepois: { permissoes: entrada },
      });

      return { total: concedidas.length };
    });
  }

  async catalogo(
    claims: ClaimsUsuario,
  ): Promise<Array<{ chave: string; modulo: string; descricao: string }>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        'select chave, modulo, descricao from public.permissoes order by modulo, chave',
      );
      return rows;
    });
  }
}

@Controller('perfis')
class PerfisController {
  constructor(private readonly perfis: PerfisService) {}

  @Get()
  @ExigePermissao('perfis.gerenciar')
  async listar(@Claims() claims: ClaimsUsuario): Promise<Perfil[]> {
    return this.perfis.listar(claims);
  }

  @Post()
  @ExigePermissao('perfis.gerenciar', 'CAMPANHA')
  async criar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<{ id: string }> {
    return this.perfis.criar(claims, EntradaPerfil.parse(corpo));
  }

  @Patch(':id')
  @ExigePermissao('perfis.gerenciar', 'CAMPANHA')
  async alterar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<Perfil> {
    return this.perfis.alterar(claims, Uuid.parse(id), AlteracaoPerfil.parse(corpo));
  }

  @Delete(':id')
  @ExigePermissao('perfis.gerenciar', 'CAMPANHA')
  async excluir(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<{ excluido: boolean }> {
    return this.perfis.excluir(claims, Uuid.parse(id));
  }

  @Get(':id/permissoes')
  @ExigePermissao('perfis.gerenciar')
  async permissoes(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<Array<{ chave: string; modulo: string; descricao: string; escopo: string | null }>> {
    return this.perfis.permissoes(claims, Uuid.parse(id));
  }

  @Put(':id/permissoes')
  @ExigePermissao('perfis.gerenciar', 'CAMPANHA')
  async definirPermissoes(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ total: number }> {
    return this.perfis.definirPermissoes(
      claims,
      Uuid.parse(id),
      EntradaPermissoesPerfil.parse(corpo),
    );
  }
}

@Controller('permissoes')
class CatalogoPermissoesController {
  constructor(private readonly perfis: PerfisService) {}

  @Get('catalogo')
  @ExigePermissao('perfis.gerenciar')
  async catalogo(
    @Claims() claims: ClaimsUsuario,
  ): Promise<Array<{ chave: string; modulo: string; descricao: string }>> {
    return this.perfis.catalogo(claims);
  }
}

@Module({
  controllers: [PerfisController, CatalogoPermissoesController],
  providers: [BancoService, AuditoriaService, PerfisService],
})
export class PerfisModule {}
