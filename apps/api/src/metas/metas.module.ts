import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, NivelTerritorial, TipoMeta, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { avaliarMeta, distribuirMeta, type AvaliacaoMeta } from './calculoMetas.js';

const EntradaMeta = z.object({
  idCampanha: Uuid,
  idCandidato: Uuid,
  idCargo: Uuid,
  tipo: TipoMeta,
  valor: z.number().positive(),
  nivel: NivelTerritorial,
  idReferencia: z.string().min(1),
  prazo: z.coerce.date().optional(),
  idResponsavel: Uuid.optional(),
});

const EntradaDistribuicao = z.object({
  idMeta: Uuid,
  nivelDestino: NivelTerritorial,
});

export interface MetaComAvaliacao extends AvaliacaoMeta {
  id: string;
  nivel: string;
  idReferencia: string;
  tipo: string;
  valor: number;
}

@Injectable()
export class MetasService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Lista as metas com a avaliação já calculada.
   *
   * O realizado vem dos apoiadores mapeados no recorte; o projetado, da tabela
   * `projecoes`. Quando ainda não há projeção calculada, o projetado cai para o
   * realizado — o que faz a meta aparecer como "em risco" em vez de otimista.
   * Errar para o lado do alerta é a escolha certa aqui: uma meta que parece
   * segura e não está custa a eleição.
   */
  async listar(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; idCandidato?: string },
  ): Promise<MetaComAvaliacao[]> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        id: string;
        tipo: string;
        valor: string;
        nivel: string;
        id_referencia: string;
        prazo: Date | null;
        criado_em: Date;
        realizado: string;
        projetado: string | null;
        eleitorado_base: string | null;
      }>(
        `select m.id, m.tipo, m.valor, m.nivel, m.id_referencia, m.prazo, m.criado_em,
                coalesce((
                  select count(*) from public.entrevistados e
                   where e.id_campanha = m.id_campanha
                     and e.classificacao = 'APOIADOR'
                     and e.anonimizado_em is null
                     and (m.nivel <> 'SECAO' or e.id_secao::text = m.id_referencia)
                ), 0) as realizado,
                p.votos_projetados as projetado,
                p.eleitorado_base
           from public.metas m
           left join public.projecoes p
             on p.id_campanha = m.id_campanha
            and p.id_candidato = m.id_candidato
            and p.nivel = m.nivel
            and p.id_referencia = m.id_referencia
          where m.id_campanha = $1
            and ($2::uuid is null or m.id_candidato = $2::uuid)
          order by m.prazo nulls last, m.nivel`,
        [parametros.idCampanha, parametros.idCandidato ?? null],
      );

      const hoje = new Date();
      return rows.map((linha) => {
        const realizado = Number(linha.realizado);
        return {
          id: linha.id,
          nivel: linha.nivel,
          idReferencia: linha.id_referencia,
          tipo: linha.tipo,
          valor: Number(linha.valor),
          ...avaliarMeta({
            tipo: linha.tipo as 'VOTOS_ABSOLUTOS' | 'PERCENTUAL',
            valor: Number(linha.valor),
            eleitoradoBase: Number(linha.eleitorado_base ?? 0),
            realizado,
            // Sem projeção calculada, assume o realizado — pessimista de propósito.
            projetado: linha.projetado === null ? realizado : Number(linha.projetado),
            inicioEm: linha.criado_em,
            prazo: linha.prazo,
            hoje,
          }),
        };
      });
    });
  }

  /**
   * Quebra uma meta em metas-filhas proporcionais ao eleitorado.
   *
   * É como "40 mil votos no município" vira meta por seção sem conta à mão. O
   * sistema propõe; o coordenador ajusta onde o histórico contradiz a
   * proporcionalidade.
   */
  async distribuir(
    claims: ClaimsUsuario,
    entrada: { idMeta: string; nivelDestino: NivelTerritorial },
  ): Promise<{ criadas: number }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: metas } = await conexao.query<{
        id_campanha: string;
        id_candidato: string;
        id_cargo: string;
        tipo: string;
        valor: string;
        nivel: string;
        id_referencia: string;
        prazo: Date | null;
      }>('select * from public.metas where id = $1', [entrada.idMeta]);
      const meta = metas[0];
      if (!meta) return { criadas: 0 };

      if (entrada.nivelDestino !== 'SECAO' || meta.nivel === 'SECAO') {
        // Só a quebra até seção está implementada: é a que a operação usa. Os
        // demais níveis existem no modelo mas não têm consumidor ainda.
        return { criadas: 0 };
      }

      const { rows: secoes } = await conexao.query<{ id: string; total_eleitores: number }>(
        `select s.id, coalesce(el.total_eleitores, 0) as total_eleitores
           from public.secoes_eleitorais s
           left join public.eleitorado_secao el
             on el.id_secao = s.id and el.ano_referencia = 2026
          where s.id_municipio::text = $1 or s.id_zona::text = $1`,
        [meta.id_referencia],
      );

      const partes = distribuirMeta(
        Number(meta.valor),
        secoes.map((secao) => ({ id: secao.id, eleitorado: Number(secao.total_eleitores) })),
      );

      let criadas = 0;
      for (const parte of partes.filter((p) => p.valor > 0)) {
        await conexao.query(
          `insert into public.metas
             (id_organizacao, id_campanha, id_candidato, id_cargo, tipo, valor,
              nivel, id_referencia, prazo)
           values ($1, $2, $3, $4, 'VOTOS_ABSOLUTOS', $5, 'SECAO', $6, $7)
           on conflict (id_campanha, id_candidato, nivel, id_referencia) do update
             set valor = excluded.valor`,
          [
            claims.idOrganizacao,
            meta.id_campanha,
            meta.id_candidato,
            meta.id_cargo,
            parte.valor,
            parte.id,
            meta.prazo,
          ],
        );
        criadas += 1;
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'metas',
        idCampanha: meta.id_campanha,
        quantidadeRegistros: criadas,
        dadosDepois: { origem: entrada.idMeta, nivelDestino: 'SECAO' },
      });

      return { criadas };
    });
  }
}

@Controller('metas')
class MetasController {
  constructor(
    private readonly banco: BancoService,
    private readonly metas: MetasService,
  ) {}

  @Get()
  @ExigePermissao('metas.ler')
  async listar(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<MetaComAvaliacao[]> {
    const parametros = z
      .object({ idCampanha: Uuid, idCandidato: Uuid.optional() })
      .parse(consulta);
    return this.metas.listar(claims, parametros);
  }

  @Post()
  @ExigePermissao('metas.gerenciar')
  async criar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<{ id: string }> {
    const entrada = EntradaMeta.parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.metas
           (id_organizacao, id_campanha, id_candidato, id_cargo, tipo, valor,
            nivel, id_referencia, prazo, id_responsavel)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (id_campanha, id_candidato, nivel, id_referencia) do update
           set valor = excluded.valor, prazo = excluded.prazo
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.idCandidato,
          entrada.idCargo,
          entrada.tipo,
          entrada.valor,
          entrada.nivel,
          entrada.idReferencia,
          entrada.prazo ?? null,
          entrada.idResponsavel ?? null,
        ],
      );
      return rows[0]!;
    });
  }

  @Post('distribuir')
  @ExigePermissao('metas.gerenciar')
  async distribuir(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ criadas: number }> {
    return this.metas.distribuir(claims, EntradaDistribuicao.parse(corpo));
  }
}

@Module({
  controllers: [MetasController],
  providers: [BancoService, AuditoriaService, MetasService],
  exports: [MetasService],
})
export class MetasModule {}
