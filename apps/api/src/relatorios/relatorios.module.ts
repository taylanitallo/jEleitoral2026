import {
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  FiltroGlobal,
  FormatoExportacao,
  NaturezaLevantamento,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { construirRecorte } from '../painel/construirRecorte.js';
import { exigeProcessamentoAssincrono, montarCabecalho } from './cabecalhoRelatorio.js';
import { gerarCsv, gerarExcel, gerarPdf, type ColunaRelatorio } from './geradores.js';

/**
 * Relatórios prontos. A lista é fechada de propósito — o usuário escolhe um
 * relatório e um recorte, nunca escreve a consulta.
 *
 * `titulo`/`descricao` alimentam `GET /relatorios/catalogo`: antes a lista
 * vivia duplicada, literalmente, aqui e em `apps/web/app/relatorios/page.tsx`
 * — as duas divergiam no instante em que alguém acrescentasse um relatório
 * de um lado só. Agora o catálogo tem uma fonte só.
 */
const RELATORIOS = {
  mapeamento_por_bairro: {
    titulo: 'Mapeamento por bairro',
    descricao: 'Domicílios, entrevistados e apoiadores por bairro do recorte.',
    permissao: 'campo.ler',
    colunas: [
      { chave: 'bairro', rotulo: 'Bairro', largura: 30 },
      { chave: 'domicilios', rotulo: 'Domicílios', tipo: 'numero' },
      { chave: 'entrevistados', rotulo: 'Entrevistados', tipo: 'numero' },
      { chave: 'apoiadores', rotulo: 'Apoiadores', tipo: 'numero' },
    ] as ColunaRelatorio[],
    sql: (predicado: string) => `
      select b.nome as bairro,
             count(distinct d.id) as domicilios,
             count(distinct e.id) as entrevistados,
             count(distinct e.id) filter (where e.classificacao = 'APOIADOR') as apoiadores
        from public.bairros b
        left join public.domicilios d on d.id_bairro = b.id
        left join public.entrevistados e
          on e.id_domicilio = d.id and e.anonimizado_em is null
       where ${predicado}
       group by b.nome order by entrevistados desc`,
    colunasRecorte: { idCampanha: 'b.id_campanha', idBairro: 'b.id' },
  },
  produtividade_por_entrevistador: {
    titulo: 'Produtividade por entrevistador',
    descricao: 'Volume e qualidade da coleta por pessoa da equipe.',
    permissao: 'campo.ler',
    colunas: [
      { chave: 'entrevistador', rotulo: 'Entrevistador', largura: 30 },
      { chave: 'entrevistas', rotulo: 'Entrevistas', tipo: 'numero' },
      { chave: 'duracao_media', rotulo: 'Duração média (s)', tipo: 'numero' },
      { chave: 'alertas', rotulo: 'Alertas de qualidade', tipo: 'numero' },
    ] as ColunaRelatorio[],
    // A subconsulta de alertas ganhou `a.id_campanha = ent.id_campanha`: sem
    // isso, um entrevistador que trabalha em duas campanhas da mesma
    // organização tinha os alertas da OUTRA campanha somados aqui, inflando
    // a coluna neste recorte.
    sql: (predicado: string) => `
      select u.nome as entrevistador,
             count(ent.id) as entrevistas,
             round(avg(ent.duracao_segundos)) as duracao_media,
             (select count(*) from public.alertas_coleta a
               where a.id_usuario_avaliado = u.id and a.id_campanha = ent.id_campanha) as alertas
        from public.entrevistas_vigentes ent
        join public.usuarios u on u.id = ent.id_usuario_entrevistador
       where ent.status in ('CONCLUIDA', 'VALIDADA') and ${predicado}
       group by u.id, u.nome order by entrevistas desc`,
    colunasRecorte: {
      idCampanha: 'ent.id_campanha',
      idEquipe: 'ent.id_equipe',
      dataReferencia: 'ent.data_hora',
    },
  },
  lista_para_mobilizacao: {
    titulo: 'Apoiadores para mobilização',
    descricao: 'Contatos classificados para acionamento no dia da eleição.',
    permissao: 'campo.ler',
    colunas: [
      { chave: 'secao', rotulo: 'Seção', largura: 14 },
      { chave: 'local', rotulo: 'Local de votação', largura: 40 },
      { chave: 'apoiadores', rotulo: 'Apoiadores', tipo: 'numero' },
    ] as ColunaRelatorio[],
    // Lista AGREGADA por seção, não nominal. Uma listagem com nome e endereço
    // de apoiador circulando em grupo no dia da eleição é exatamente o
    // vazamento que o sistema inteiro existe para evitar.
    sql: (predicado: string) => `
      select s.numero::text as secao, l.nome as local,
             count(e.id) filter (where e.classificacao = 'APOIADOR') as apoiadores
        from public.entrevistados e
        join public.secoes_eleitorais s on s.id = e.id_secao
        join public.locais_votacao l on l.id = s.id_local_votacao
       where e.anonimizado_em is null and ${predicado}
       group by s.numero, l.nome order by apoiadores desc`,
    colunasRecorte: { idCampanha: 'e.id_campanha', idSecao: 'e.id_secao' },
  },
  intencao_por_candidato: {
    titulo: 'Intenção de voto por candidato',
    descricao: 'Quantas intenções cada candidato da chapa recebeu, cargo a cargo.',
    permissao: 'campo.ler',
    colunas: [
      { chave: 'cargo', rotulo: 'Cargo', largura: 22 },
      { chave: 'candidato', rotulo: 'Candidato', largura: 30 },
      { chave: 'numero_urna', rotulo: 'Número', tipo: 'numero' },
      { chave: 'intencoes', rotulo: 'Intenções', tipo: 'numero' },
    ] as ColunaRelatorio[],
    sql: (predicado: string) => `
      select cg.nome as cargo,
             case
               when iv.tipo = 'CANDIDATO' then c.nome_urna
               when iv.tipo = 'BRANCO' then 'Branco'
               when iv.tipo = 'NULO' then 'Nulo'
               when iv.tipo = 'INDECISO' then 'Indeciso'
               when iv.tipo = 'NAO_RESPONDEU' then 'Não respondeu'
               else 'Não cadastrado'
             end as candidato,
             c.numero_urna,
             count(*) as intencoes
        from public.intencoes_voto iv
        join public.entrevistas_vigentes ent on ent.id = iv.id_entrevista
        join public.entrevistados en on en.id = ent.id_entrevistado
        left join public.domicilios d on d.id = en.id_domicilio
        join public.cargos cg on cg.id = iv.id_cargo
        left join public.candidatos c on c.id = iv.id_candidato
       where ${predicado}
       group by cg.nome, candidato, c.numero_urna
       order by cg.nome, intencoes desc`,
    colunasRecorte: {
      idCampanha: 'ent.id_campanha',
      idCargo: 'iv.id_cargo',
      idCandidato: 'iv.id_candidato',
      idEquipe: 'ent.id_equipe',
      idBairro: 'd.id_bairro',
      idSecao: 'en.id_secao',
      dataReferencia: 'ent.data_hora',
    },
  },
  evolucao_diaria: {
    titulo: 'Evolução diária da coleta',
    descricao: 'Entrevistas concluídas por dia, no recorte selecionado.',
    permissao: 'campo.ler',
    colunas: [
      { chave: 'dia', rotulo: 'Dia', tipo: 'data' },
      { chave: 'entrevistas', rotulo: 'Entrevistas', tipo: 'numero' },
    ] as ColunaRelatorio[],
    sql: (predicado: string) => `
      select date_trunc('day', ent.data_hora)::date as dia, count(*) as entrevistas
        from public.entrevistas_vigentes ent
        join public.entrevistados en on en.id = ent.id_entrevistado
        left join public.domicilios d on d.id = en.id_domicilio
       where ent.status in ('CONCLUIDA', 'VALIDADA') and ${predicado}
       group by dia order by dia`,
    colunasRecorte: {
      idCampanha: 'ent.id_campanha',
      idEquipe: 'ent.id_equipe',
      idBairro: 'd.id_bairro',
      idSecao: 'en.id_secao',
      dataReferencia: 'ent.data_hora',
    },
  },
  chapa_consolidada: {
    titulo: 'Chapa consolidada',
    descricao: 'Projeção mais recente de cada candidato próprio, lado a lado.',
    permissao: 'projecao.ler',
    colunas: [
      { chave: 'cargo', rotulo: 'Cargo', largura: 22 },
      { chave: 'candidato', rotulo: 'Candidato', largura: 30 },
      { chave: 'numero_urna', rotulo: 'Número', tipo: 'numero' },
      { chave: 'votos_projetados', rotulo: 'Projeção', tipo: 'numero' },
      { chave: 'intervalo_min', rotulo: 'Mínimo', tipo: 'numero' },
      { chave: 'intervalo_max', rotulo: 'Máximo', tipo: 'numero' },
      { chave: 'cobertura_amostral', rotulo: 'Cobertura', tipo: 'percentual' },
    ] as ColunaRelatorio[],
    // Nível MUNICIPIO: é o recorte da campanha inteira, o mesmo em que
    // `recalcularCampanha` (projeção, Fase 1) agrega a chapa toda.
    sql: (predicado: string) => `
      select cg.nome as cargo, c.nome_urna as candidato, c.numero_urna,
             p.votos_projetados, p.intervalo_min, p.intervalo_max, p.cobertura_amostral
        from public.projecoes p
        join public.candidatos c on c.id = p.id_candidato
        join public.cargos cg on cg.id = p.id_cargo
       where p.nivel = 'MUNICIPIO' and c.proprio = true and ${predicado}
       order by cg.nome`,
    colunasRecorte: {
      idCampanha: 'p.id_campanha',
      idCargo: 'p.id_cargo',
      idCandidato: 'p.id_candidato',
    },
  },
} as const;

type NomeRelatorio = keyof typeof RELATORIOS;

const EntradaExportacao = z.object({
  relatorio: z.enum(Object.keys(RELATORIOS) as [NomeRelatorio, ...NomeRelatorio[]]),
  formato: FormatoExportacao,
  filtro: FiltroGlobal,
  natureza: NaturezaLevantamento.default('LEVANTAMENTO_INTERNO'),
  filtrosPorExtenso: z.array(z.object({ rotulo: z.string(), valor: z.string() })).default([]),
});

const ConsultaDados = FiltroGlobal.extend({
  relatorio: z.enum(Object.keys(RELATORIOS) as [NomeRelatorio, ...NomeRelatorio[]]),
});

/** Teto do preview ao vivo — bem abaixo de `LIMITE_EXPORTACAO_SINCRONA`: é
 * para desenhar um gráfico na tela, não para uma planilha inteira. */
const LIMITE_DADOS_AO_VIVO = 300;

@Injectable()
export class RelatoriosService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async exportar(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaExportacao>,
    contexto: { ip?: string | null; userAgent?: string | null; idCorrelacao?: string | null },
  ): Promise<{ arquivo: Buffer; nomeArquivo: string; tipoMime: string } | { assincrono: true }> {
    const definicao = RELATORIOS[entrada.relatorio];

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const recorte = construirRecorte(entrada.filtro, definicao.colunasRecorte);
      const { rows } = await conexao.query(definicao.sql(recorte.predicado), recorte.parametros);

      // A auditoria é gravada ANTES de gerar o arquivo: registra a intenção de
      // exportar mesmo que a geração falhe depois.
      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'EXPORTAR',
        entidade: entrada.relatorio,
        idCampanha: entrada.filtro.idCampanha,
        filtroAplicado: entrada.filtrosPorExtenso,
        quantidadeRegistros: rows.length,
        ip: contexto.ip ?? null,
        userAgent: contexto.userAgent ?? null,
        idCorrelacao: contexto.idCorrelacao ?? null,
      });

      if (exigeProcessamentoAssincrono(rows.length)) {
        await conexao.query(
          `insert into public.exportacoes
             (id_organizacao, id_campanha, id_usuario, relatorio, formato,
              filtro_aplicado, natureza, quantidade_registros, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDENTE')`,
          [
            claims.idOrganizacao,
            entrada.filtro.idCampanha,
            claims.sub,
            entrada.relatorio,
            entrada.formato,
            JSON.stringify(entrada.filtrosPorExtenso),
            entrada.natureza,
            rows.length,
          ],
        );
        // A fila BullMQ que consome estas linhas ainda não existe; até lá, a
        // exportação fica registrada como PENDENTE e a tela avisa o usuário.
        return { assincrono: true as const };
      }

      const { rows: usuarios } = await conexao.query<{
        nome: string;
        cpf_criptografado: string | null;
      }>('select nome, cpf_criptografado from public.usuarios where id = $1', [claims.sub]);
      const { rows: campanhas } = await conexao.query<{ nome: string }>(
        'select nome from public.campanhas where id = $1',
        [entrada.filtro.idCampanha],
      );

      const cabecalho = montarCabecalho(definicao.titulo, {
        nomeCampanha: campanhas[0]?.nome ?? 'Campanha',
        natureza: entrada.natureza,
        operador: {
          nome: usuarios[0]?.nome ?? claims.email,
          // O CPF do operador está cifrado; decifrar só para a marca d'água
          // exporia o documento inteiro num arquivo que vai circular. O nome e
          // o horário bastam para rastrear.
          cpfParcial: null,
        },
        filtros: entrada.filtrosPorExtenso,
        quantidadeRegistros: rows.length,
        geradoEm: new Date(),
        registroPesqEle: null,
      });

      const dataArquivo = new Date().toISOString().slice(0, 10);
      if (entrada.formato === 'XLSX') {
        return {
          arquivo: await gerarExcel(cabecalho, definicao.colunas, rows),
          nomeArquivo: `${entrada.relatorio}-${dataArquivo}.xlsx`,
          tipoMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      }

      // CSV estava na lista de formatos (`FormatoExportacao`) sem gerador
      // próprio — pedir CSV baixava um PDF em silêncio, com extensão .pdf
      // dentro de um arquivo que o usuário salvou como .csv.
      if (entrada.formato === 'CSV') {
        return {
          arquivo: gerarCsv(cabecalho, definicao.colunas, rows),
          nomeArquivo: `${entrada.relatorio}-${dataArquivo}.csv`,
          tipoMime: 'text/csv; charset=utf-8',
        };
      }

      return {
        arquivo: await gerarPdf(cabecalho, definicao.colunas, rows),
        nomeArquivo: `${entrada.relatorio}-${dataArquivo}.pdf`,
        tipoMime: 'application/pdf',
      };
    });
  }

  /** Catálogo de relatórios disponíveis, para a tela montar a lista sem duplicá-la. */
  catalogo(): Array<{ chave: NomeRelatorio; titulo: string; descricao: string }> {
    return (Object.keys(RELATORIOS) as NomeRelatorio[]).map((chave) => ({
      chave,
      titulo: RELATORIOS[chave].titulo,
      descricao: RELATORIOS[chave].descricao,
    }));
  }

  /**
   * Mesma consulta do export, em JSON, para desenhar um gráfico na tela — os
   * 3D do relatório (e o par 2D deles) vivem disto, não de um arquivo baixado.
   * Não audita: não é uma exportação, é a tela recalculando com o filtro.
   */
  async dados(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof ConsultaDados>,
  ): Promise<{ colunas: ColunaRelatorio[]; linhas: Array<Record<string, unknown>> }> {
    const { relatorio, ...filtro } = entrada;
    const definicao = RELATORIOS[relatorio];

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const recorte = construirRecorte(filtro, definicao.colunasRecorte);
      const { rows } = await conexao.query(
        `select * from (${definicao.sql(recorte.predicado)}) consulta limit ${LIMITE_DADOS_AO_VIVO}`,
        recorte.parametros,
      );
      return { colunas: definicao.colunas, linhas: rows };
    });
  }
}

@Controller('relatorios')
class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

  @Get('catalogo')
  @ExigePermissao('relatorios.exportar')
  catalogo(): Array<{ chave: NomeRelatorio; titulo: string; descricao: string }> {
    return this.relatorios.catalogo();
  }

  @Get('dados')
  @ExigePermissao('relatorios.exportar')
  async dados(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<{ colunas: ColunaRelatorio[]; linhas: Array<Record<string, unknown>> }> {
    return this.relatorios.dados(claims, ConsultaDados.parse(consulta));
  }

  @Post('exportar')
  @ExigePermissao('relatorios.exportar')
  @Header('Cache-Control', 'no-store')
  async exportar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res() resposta: Response,
  ): Promise<void> {
    const entrada = EntradaExportacao.parse(corpo);
    const resultado = await this.relatorios.exportar(claims, entrada, {
      ip: requisicao.ip ?? null,
      userAgent: requisicao.headers['user-agent'] ?? null,
      idCorrelacao: requisicao.idCorrelacao ?? null,
    });

    if ('assincrono' in resultado) {
      resposta.status(202).json({
        assincrono: true,
        mensagem:
          'A exportação é grande e foi enfileirada. Você receberá um aviso quando o arquivo estiver pronto.',
      });
      return;
    }

    resposta
      .status(200)
      .setHeader('Content-Type', resultado.tipoMime)
      .setHeader('Content-Disposition', `attachment; filename="${resultado.nomeArquivo}"`)
      .send(resultado.arquivo);
  }
}

@Module({
  controllers: [RelatoriosController],
  providers: [BancoService, AuditoriaService, RelatoriosService],
  exports: [RelatoriosService],
})
export class RelatoriosModule {}
