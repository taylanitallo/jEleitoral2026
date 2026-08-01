import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AbrangenciaCampanha,
  ClaimsUsuario,
  ParametrosPaginacao,
  SiglaUf,
  Uuid,
  montarPagina,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaCampanha = z.object({
  nome: z.string().trim().min(3, 'Informe o nome da campanha.').max(120),
  abrangencia: AbrangenciaCampanha,
  uf: SiglaUf.optional(),
  idMunicipioBase: z.coerce.number().int().optional(),
  anoPleito: z.coerce.number().int().min(2024).max(2100),
});

interface Campanha {
  id: string;
  nome: string;
  abrangencia: string;
  uf: string | null;
  ano_pleito: number;
  ativa: boolean;
}

/**
 * CRUD de campanhas — serve de modelo para os demais módulos.
 *
 * Repare no que **não** aparece aqui: nenhum `where id_organizacao = ...`. O
 * filtro é do banco, via RLS. Escrever o filtro no service seria redundância
 * inofensiva; confiar nele seria o erro. Um `WHERE` esquecido em qualquer um
 * dos futuros trinta endpoints não vaza nada, porque a política já negou.
 */
@Controller('campanhas')
export class CampanhasController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  @ExigePermissao('campanhas.gerenciar')
  async listar(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<Campanha>> {
    const parametros = ParametrosPaginacao.parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Campanha & { total: string }>(
        `select id, nome, abrangencia, uf, ano_pleito, ativa,
                count(*) over () as total
         from public.campanhas
         order by ano_pleito desc, nome
         limit $1 offset $2`,
        [parametros.limite, (parametros.pagina - 1) * parametros.limite],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...campanha }) => campanha),
        total,
        parametros,
      );
    });
  }

  @Post()
  @ExigePermissao('campanhas.gerenciar', 'CAMPANHA')
  async criar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<Campanha> {
    const entrada = EntradaCampanha.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Campanha>(
        `insert into public.campanhas
           (id_organizacao, nome, abrangencia, uf, id_municipio_base, ano_pleito)
         values ($1, $2, $3, $4, $5, $6)
         returning id, nome, abrangencia, uf, ano_pleito, ativa`,
        [
          // Vem do token, sempre. Não há parâmetro de entrada para isto.
          claims.idOrganizacao,
          entrada.nome,
          entrada.abrangencia,
          entrada.uf ?? null,
          entrada.idMunicipioBase ?? null,
          entrada.anoPleito,
        ],
      );
      const criada = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'campanhas',
        idEntidade: criada.id,
        idCampanha: criada.id,
        dadosDepois: criada,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criada;
    });
  }

  @Put(':id')
  @ExigePermissao('campanhas.gerenciar', 'CAMPANHA')
  async alterar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<Campanha> {
    const idCampanha = Uuid.parse(id);
    const entrada = EntradaCampanha.partial().parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query<Campanha>(
        'select id, nome, abrangencia, uf, ano_pleito, ativa from public.campanhas where id = $1',
        [idCampanha],
      );
      if (!antes[0]) {
        // Pode ser inexistente ou de outra organização. A mensagem é a mesma
        // nos dois casos, de propósito.
        throw Object.assign(new Error('Campanha não encontrada.'), { code: '42501' });
      }

      const { rows } = await conexao.query<Campanha>(
        `update public.campanhas
            set nome = coalesce($2, nome),
                abrangencia = coalesce($3, abrangencia),
                uf = coalesce($4, uf),
                ano_pleito = coalesce($5, ano_pleito)
          where id = $1
        returning id, nome, abrangencia, uf, ano_pleito, ativa`,
        [
          idCampanha,
          entrada.nome ?? null,
          entrada.abrangencia ?? null,
          entrada.uf ?? null,
          entrada.anoPleito ?? null,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'campanhas',
        idEntidade: idCampanha,
        idCampanha,
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
   * Encerra a campanha. Não apaga: desativa.
   *
   * Excluir de verdade levaria junto entrevistas, consentimentos e a trilha que
   * comprova o consentimento — que é justamente o que precisa sobreviver ao fim
   * da campanha. O expurgo definitivo é papel da rotina de retenção.
   */
  @Delete(':id')
  @ExigePermissao('campanhas.gerenciar', 'CAMPANHA')
  async encerrar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<{ encerrada: boolean }> {
    const idCampanha = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        'update public.campanhas set ativa = false where id = $1',
        [idCampanha],
      );
      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'campanhas',
        idEntidade: idCampanha,
        idCampanha,
        dadosDepois: { ativa: false },
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });
      return { encerrada: (resultado.rowCount ?? 0) > 0 };
    });
  }
}
