import { Body, Controller, Get, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ClaimsUsuario, RedeSocial, StatusPublicacao, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaPublicacao = z.object({
  idCampanha: Uuid,
  rede: RedeSocial,
  titulo: z.string().trim().min(3, 'Informe um título.').max(160),
  texto: z.string().trim().max(4000).optional(),
  idEixo: Uuid.optional(),
  idMaterial: Uuid.optional(),
  idAcao: Uuid.optional(),
  agendadaPara: z.string().datetime({ offset: true }).optional(),
  geradoPorIa: z.boolean().default(false),
});

const EntradaMetrica = z.object({
  alcance: z.coerce.number().int().min(0).optional(),
  impressoes: z.coerce.number().int().min(0).optional(),
  curtidas: z.coerce.number().int().min(0).optional(),
  comentarios: z.coerce.number().int().min(0).optional(),
  compartilhamentos: z.coerce.number().int().min(0).optional(),
  cliques: z.coerce.number().int().min(0).optional(),
});

/**
 * Divulgação em redes sociais.
 *
 * O sistema **planeja e aprova; não publica.** Publicar de verdade exigiria
 * OAuth e revisão de aplicativo da Meta, que leva semanas e não sairia a tempo
 * do pleito. O que fica: calendário de conteúdo, aprovação com responsável
 * nominal, vínculo com o eixo narrativo e métricas aferidas à mão.
 *
 * O `url_publicacao` preenchido depois de postar é o que fecha o ciclo — sem
 * ele a métrica não tem onde ser conferida.
 */
@Controller('divulgacao')
class DivulgacaoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('publicacoes')
  @ExigePermissao('divulgacao.ler')
  async listar(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<unknown[]> {
    const p = z.object({ idCampanha: Uuid, status: StatusPublicacao.optional() }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select p.id, p.rede, p.titulo, p.texto, p.status, p.agendada_para, p.publicada_em,
                p.url_publicacao, p.impulsionada, p.gerado_por_ia,
                e.titulo as eixo, m.titulo as material, u.nome as criador,
                -- Só a aferição mais recente: a série inteira é ruído numa lista.
                (select jsonb_build_object(
                          'alcance', mt.alcance, 'curtidas', mt.curtidas,
                          'comentarios', mt.comentarios,
                          'compartilhamentos', mt.compartilhamentos,
                          'aferida_em', mt.aferida_em)
                   from public.publicacao_metricas mt
                  where mt.id_publicacao = p.id
                  order by mt.aferida_em desc limit 1) as ultima_metrica
           from public.publicacoes p
           left join public.eixos_narrativos e on e.id = p.id_eixo
           left join public.materiais_graficos m on m.id = p.id_material
           left join public.usuarios u on u.id = p.id_usuario_criador
          where p.id_campanha = $1
            and ($2::public.status_publicacao is null or p.status = $2)
          order by coalesce(p.publicada_em, p.agendada_para, p.criado_em) desc`,
        [p.idCampanha, p.status ?? null],
      );
      return rows;
    });
  }

  /**
   * Cobertura da narrativa nas redes.
   *
   * A pergunta que nenhum outro lugar do sistema responde: a campanha está
   * falando, em público, do que levantou em campo? Um eixo com dez problemas de
   * origem e zero publicações é um diagnóstico que não virou discurso.
   */
  @Get('cobertura-narrativa')
  @ExigePermissao('divulgacao.ler')
  async coberturaNarrativa(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown[]> {
    const p = z.object({ idCampanha: Uuid }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select e.id, e.titulo, e.prioridade,
                (select count(*)::int from public.eixo_problemas ep where ep.id_eixo = e.id)
                  as problemas_de_origem,
                count(p.id) filter (where p.status = 'PUBLICADA')::int as publicadas,
                count(p.id) filter (where p.status <> 'PUBLICADA'
                                      and p.status <> 'CANCELADA')::int as na_fila
           from public.eixos_narrativos e
           left join public.publicacoes p on p.id_eixo = e.id
          where e.id_campanha = $1
          group by e.id, e.titulo, e.prioridade
          order by case e.prioridade when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end,
                   publicadas asc`,
        [p.idCampanha],
      );
      return rows;
    });
  }

  @Post('publicacoes')
  @ExigePermissao('divulgacao.gerenciar')
  async criar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ id: string; titulo: string }> {
    const entrada = EntradaPublicacao.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; titulo: string }>(
        `insert into public.publicacoes
           (id_organizacao, id_campanha, rede, titulo, texto, id_eixo, id_material, id_acao,
            agendada_para, gerado_por_ia, id_usuario_criador)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id, titulo`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.rede,
          entrada.titulo,
          entrada.texto ?? null,
          entrada.idEixo ?? null,
          entrada.idMaterial ?? null,
          entrada.idAcao ?? null,
          entrada.agendadaPara ?? null,
          entrada.geradoPorIa,
          claims.sub,
        ],
      );
      return rows[0]!;
    });
  }

  /**
   * Muda o status da peça.
   *
   * Aprovação e publicação passam pela mesma rota de propósito: são transições
   * do mesmo objeto, e separá-las em duas rotas convidaria a esquecer de gravar
   * quem aprovou.
   */
  @Put('publicacoes/:id')
  @ExigePermissao('divulgacao.gerenciar')
  async alterar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ alterado: boolean }> {
    const idPublicacao = Uuid.parse(id);
    const entrada = z
      .object({
        status: StatusPublicacao.optional(),
        texto: z.string().trim().max(4000).optional(),
        urlPublicacao: z.string().trim().url().max(500).optional(),
      })
      .parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        /*
         * `publicada_em` é preenchido pelo banco na transição para PUBLICADA, e
         * não pelo cliente. A tabela tem `check (status <> 'PUBLICADA' or
         * publicada_em is not null)`; deixar a data a cargo do frontend faria a
         * constraint estourar como erro cru sempre que alguém esquecesse.
         */
        `update public.publicacoes
            set status = coalesce($2::public.status_publicacao, status),
                texto = coalesce($3, texto),
                url_publicacao = coalesce($4, url_publicacao),
                publicada_em = case when $2 = 'PUBLICADA' then coalesce(publicada_em, now())
                                    else publicada_em end,
                aprovada_em = case when $2 = 'APROVADA' then coalesce(aprovada_em, now())
                                   else aprovada_em end,
                aprovada_por = case when $2 = 'APROVADA' then coalesce(aprovada_por, $5::uuid)
                                    else aprovada_por end
          where id = $1`,
        [
          idPublicacao,
          entrada.status ?? null,
          entrada.texto ?? null,
          entrada.urlPublicacao ?? null,
          claims.sub,
        ],
      );

      if (entrada.status) {
        await this.auditoria.registrarNaTransacao(conexao, claims, {
          acao: 'ALTERAR',
          entidade: 'publicacoes',
          idEntidade: idPublicacao,
          dadosDepois: { status: entrada.status },
          ip: requisicao.ip ?? null,
          userAgent: requisicao.headers['user-agent'] ?? null,
          idCorrelacao: requisicao.idCorrelacao ?? null,
        });
      }

      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  @Get('publicacoes/:id/metricas')
  @ExigePermissao('divulgacao.ler')
  async metricas(@Claims() claims: ClaimsUsuario, @Param('id') id: string): Promise<unknown[]> {
    const idPublicacao = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select aferida_em, alcance, impressoes, curtidas, comentarios,
                compartilhamentos, cliques
           from public.publicacao_metricas
          where id_publicacao = $1
          order by aferida_em asc`,
        [idPublicacao],
      );
      return rows;
    });
  }

  @Post('publicacoes/:id/metricas')
  @ExigePermissao('divulgacao.gerenciar')
  async registrarMetrica(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const idPublicacao = Uuid.parse(id);
    const entrada = EntradaMetrica.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        // A campanha vem da publicação, e não do corpo: aferição registrada
        // numa campanha diferente da peça seria dado corrompido sem erro.
        `insert into public.publicacao_metricas
           (id_organizacao, id_campanha, id_publicacao, alcance, impressoes, curtidas,
            comentarios, compartilhamentos, cliques, id_usuario_registro)
         select $1, p.id_campanha, p.id, $3, $4, $5, $6, $7, $8, $9
           from public.publicacoes p
          where p.id = $2
         returning id`,
        [
          claims.idOrganizacao,
          idPublicacao,
          entrada.alcance ?? null,
          entrada.impressoes ?? null,
          entrada.curtidas ?? null,
          entrada.comentarios ?? null,
          entrada.compartilhamentos ?? null,
          entrada.cliques ?? null,
          claims.sub,
        ],
      );
      return rows[0]!;
    });
  }
}

@Module({ controllers: [DivulgacaoController] })
export class DivulgacaoModule {}
