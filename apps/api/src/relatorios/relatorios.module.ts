import {
  Body,
  Controller,
  Header,
  Injectable,
  Module,
  Post,
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
import { gerarExcel, gerarPdf, type ColunaRelatorio } from './geradores.js';

/**
 * Relatórios prontos. A lista é fechada de propósito — o usuário escolhe um
 * relatório e um recorte, nunca escreve a consulta.
 */
const RELATORIOS = {
  mapeamento_por_bairro: {
    titulo: 'Mapeamento por bairro',
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
    permissao: 'campo.ler',
    colunas: [
      { chave: 'entrevistador', rotulo: 'Entrevistador', largura: 30 },
      { chave: 'entrevistas', rotulo: 'Entrevistas', tipo: 'numero' },
      { chave: 'duracao_media', rotulo: 'Duração média (s)', tipo: 'numero' },
      { chave: 'alertas', rotulo: 'Alertas de qualidade', tipo: 'numero' },
    ] as ColunaRelatorio[],
    sql: (predicado: string) => `
      select u.nome as entrevistador,
             count(ent.id) as entrevistas,
             round(avg(ent.duracao_segundos)) as duracao_media,
             (select count(*) from public.alertas_coleta a
               where a.id_usuario_avaliado = u.id) as alertas
        from public.entrevistas ent
        join public.usuarios u on u.id = ent.id_usuario_entrevistador
       where ent.status in ('CONCLUIDA', 'VALIDADA') and ${predicado}
       group by u.id, u.nome order by entrevistas desc`,
    colunasRecorte: { idCampanha: 'ent.id_campanha', idEquipe: 'ent.id_equipe' },
  },
  lista_para_mobilizacao: {
    titulo: 'Apoiadores para mobilização',
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
} as const;

type NomeRelatorio = keyof typeof RELATORIOS;

const EntradaExportacao = z.object({
  relatorio: z.enum(Object.keys(RELATORIOS) as [NomeRelatorio, ...NomeRelatorio[]]),
  formato: FormatoExportacao,
  filtro: FiltroGlobal,
  natureza: NaturezaLevantamento.default('LEVANTAMENTO_INTERNO'),
  filtrosPorExtenso: z.array(z.object({ rotulo: z.string(), valor: z.string() })).default([]),
});

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

      const { rows: usuarios } = await conexao.query<{ nome: string; cpf_criptografado: string | null }>(
        'select nome, cpf_criptografado from public.usuarios where id = $1',
        [claims.sub],
      );
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

      return {
        arquivo: await gerarPdf(cabecalho, definicao.colunas, rows),
        nomeArquivo: `${entrada.relatorio}-${dataArquivo}.pdf`,
        tipoMime: 'application/pdf',
      };
    });
  }
}

@Controller('relatorios')
class RelatoriosController {
  constructor(private readonly relatorios: RelatoriosService) {}

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
