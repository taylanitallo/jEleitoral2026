import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  ClaimsUsuario,
  FormaPagamento,
  NivelTerritorial,
  StatusLancamento,
  TipoLancamento,
  Uuid,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { Criptografia } from '../comum/criptografia.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import {
  calcularCustoPorTerritorio,
  compararOrcamento,
  resumirFinanceiro,
  type CustoPorTerritorio,
  type ResumoFinanceiro,
} from './indicadoresFinanceiros.js';

const EntradaLancamento = z.object({
  idCampanha: Uuid,
  tipo: TipoLancamento,
  idCategoria: Uuid.optional(),
  idCentroCusto: Uuid.optional(),
  idFornecedor: Uuid.optional(),
  descricao: z.string().trim().min(3).max(300),
  valor: z.number().positive(),
  dataCompetencia: z.coerce.date(),
  dataPagamento: z.coerce.date().optional(),
  formaPagamento: FormaPagamento.optional(),
  nivelTerritorio: NivelTerritorial.optional(),
  idTerritorio: z.string().optional(),
  status: StatusLancamento.default('PREVISTO'),
});

@Injectable()
export class FinanceiroService {
  private readonly criptografia: Criptografia;

  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {
    const configuracao = carregarConfiguracao();
    this.criptografia = new Criptografia(
      configuracao.CHAVE_CRIPTOGRAFIA_AES,
      configuracao.SEGREDO_HMAC_INDICE,
    );
  }

  /**
   * Painel financeiro: quanto entrou, quanto saiu, e — o que interessa — se o
   * caixa chega ao dia da eleição.
   */
  async resumir(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; dataPleito: Date },
  ): Promise<ResumoFinanceiro> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        receita: string;
        despesa: string;
        primeiro: Date | null;
      }>(
        `select
           coalesce(sum(valor) filter (where tipo = 'RECEITA' and status <> 'CANCELADO'), 0) as receita,
           coalesce(sum(valor) filter (where tipo = 'DESPESA' and status <> 'CANCELADO'), 0) as despesa,
           min(data_competencia) as primeiro
         from public.lancamentos where id_campanha = $1`,
        [parametros.idCampanha],
      );

      const linha = rows[0];
      const hoje = new Date();
      const primeiro = linha?.primeiro ? new Date(linha.primeiro) : hoje;
      const diasDecorridos = Math.max(
        0,
        Math.floor((hoje.getTime() - primeiro.getTime()) / (24 * 60 * 60 * 1000)),
      );

      return resumirFinanceiro({
        totalReceita: Number(linha?.receita ?? 0),
        totalDespesa: Number(linha?.despesa ?? 0),
        diasDecorridos,
        dataPleito: parametros.dataPleito,
        hoje,
      });
    });
  }

  /**
   * Cruza investimento com resultado por bairro.
   *
   * É o indicador que responde "onde o dinheiro está rendendo?". Note que o
   * custo por voto **projetado** é uma razão entre uma medida dura (o gasto) e
   * uma estimativa (a projeção) — a interface precisa exibi-lo com a mesma
   * ressalva de cobertura que acompanha a projeção, ou o número vira certeza
   * onde não há.
   */
  async custoPorTerritorio(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; idCandidato?: string },
  ): Promise<CustoPorTerritorio[]> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: lancamentos } = await conexao.query<{
        id_territorio: string | null;
        despesa: string;
      }>(
        `select id_territorio, coalesce(sum(valor), 0) as despesa
           from public.lancamentos
          where id_campanha = $1 and tipo = 'DESPESA' and status <> 'CANCELADO'
            and nivel_territorio = 'BAIRRO'
          group by id_territorio`,
        [parametros.idCampanha],
      );

      const { rows: desempenho } = await conexao.query<{
        id_territorio: string;
        mapeados: string;
        projetados: string;
      }>(
        `select b.id::text as id_territorio,
                count(distinct e.id) as mapeados,
                coalesce(max(p.votos_projetados), 0) as projetados
           from public.bairros b
           left join public.domicilios d on d.id_bairro = b.id
           left join public.entrevistados e
             on e.id_domicilio = d.id and e.anonimizado_em is null
           left join public.projecoes p
             on p.nivel = 'BAIRRO' and p.id_referencia = b.id::text
            and p.id_campanha = $1
            and ($2::uuid is null or p.id_candidato = $2::uuid)
          where b.id_campanha = $1
          group by b.id`,
        [parametros.idCampanha, parametros.idCandidato ?? null],
      );

      return calcularCustoPorTerritorio(
        lancamentos.map((l) => ({
          idTerritorio: l.id_territorio,
          totalDespesa: Number(l.despesa),
          totalReceita: 0,
        })),
        desempenho.map((d) => ({
          idTerritorio: d.id_territorio,
          eleitoresMapeados: Number(d.mapeados),
          votosProjetados: Number(d.projetados),
        })),
      );
    });
  }

  async previstoRealizado(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; mesReferencia: Date },
  ): Promise<ReturnType<typeof compararOrcamento>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: previsto } = await conexao.query<{ id: string; valor: string }>(
        `select id_centro_custo as id, coalesce(sum(valor_previsto), 0) as valor
           from public.orcamentos
          where id_campanha = $1 and date_trunc('month', mes_referencia) = date_trunc('month', $2::date)
          group by id_centro_custo`,
        [parametros.idCampanha, parametros.mesReferencia],
      );

      const { rows: realizado } = await conexao.query<{ id: string; valor: string }>(
        `select id_centro_custo as id, coalesce(sum(valor), 0) as valor
           from public.lancamentos
          where id_campanha = $1 and tipo = 'DESPESA' and status <> 'CANCELADO'
            and date_trunc('month', data_competencia) = date_trunc('month', $2::date)
            and id_centro_custo is not null
          group by id_centro_custo`,
        [parametros.idCampanha, parametros.mesReferencia],
      );

      return compararOrcamento(
        previsto.map((p) => ({ idCentroCusto: p.id, valor: Number(p.valor) })),
        realizado.map((r) => ({ idCentroCusto: r.id, valor: Number(r.valor) })),
      );
    });
  }
}

@Controller('financeiro')
class FinanceiroController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
    private readonly financeiro: FinanceiroService,
  ) {}

  @Get('resumo')
  @ExigePermissao('financeiro.ler')
  async resumo(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<ResumoFinanceiro> {
    const parametros = z
      .object({
        idCampanha: Uuid,
        dataPleito: z.coerce.date().default(() => new Date('2026-10-04')),
      })
      .parse(consulta);
    return this.financeiro.resumir(claims, parametros);
  }

  @Get('custo-por-territorio')
  @ExigePermissao('financeiro.ler')
  async custo(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<CustoPorTerritorio[]> {
    const parametros = z
      .object({ idCampanha: Uuid, idCandidato: Uuid.optional() })
      .parse(consulta);
    return this.financeiro.custoPorTerritorio(claims, parametros);
  }

  @Get('previsto-realizado')
  @ExigePermissao('financeiro.ler')
  async orcamento(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown[]> {
    const parametros = z
      .object({ idCampanha: Uuid, mesReferencia: z.coerce.date().default(() => new Date()) })
      .parse(consulta);
    return this.financeiro.previstoRealizado(claims, parametros);
  }

  @Post('lancamentos')
  @ExigePermissao('financeiro.gerenciar')
  async lancar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<{ id: string }> {
    const entrada = EntradaLancamento.parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.lancamentos
           (id_organizacao, id_campanha, tipo, id_categoria, id_centro_custo, id_fornecedor,
            descricao, valor, data_competencia, data_pagamento, forma_pagamento,
            nivel_territorio, id_territorio, status, id_usuario_cadastro)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.tipo,
          entrada.idCategoria ?? null,
          entrada.idCentroCusto ?? null,
          entrada.idFornecedor ?? null,
          entrada.descricao,
          entrada.valor,
          entrada.dataCompetencia,
          entrada.dataPagamento ?? null,
          entrada.formaPagamento ?? null,
          entrada.nivelTerritorio ?? null,
          entrada.idTerritorio ?? null,
          entrada.status,
          claims.sub,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'lancamentos',
        idEntidade: rows[0]!.id,
        idCampanha: entrada.idCampanha,
        // O valor entra na trilha; o documento do fornecedor, não.
        dadosDepois: { descricao: entrada.descricao, valor: entrada.valor, tipo: entrada.tipo },
      });

      return rows[0]!;
    });
  }
}

@Module({
  controllers: [FinanceiroController],
  providers: [BancoService, AuditoriaService, FinanceiroService],
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
