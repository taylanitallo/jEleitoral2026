import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ClassificacaoEleitor,
  ClaimsUsuario,
  EntradaIntencaoVoto,
  LoteSincronizacaoOffline,
  ParametrosPaginacao,
  StatusEntrevista,
  Uuid,
  montarPagina,
  type PaginaDe,
  type ResultadoItemSincronizacao,
} from '@jeleitoral/tipos';
import { normalizarLogradouro } from '@jeleitoral/utilitarios';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { diferencaEntreVersoes, type EntrevistaComparavel } from './diferencaEntrevista.js';
import { RetificacaoService } from './retificacao.service.js';
import { SincronizacaoOfflineService } from './sincronizacaoOffline.service.js';

const EntradaRetificacao = z.object({
  motivo: z.string().trim().min(10, 'Explique em poucas palavras o que está corrigindo.').max(500),
  entrevistado: z.object({
    nome: z.string().trim().min(3, 'Informe o nome do entrevistado.').max(150),
    classificacao: ClassificacaoEleitor,
  }),
  recusouResponder: z.boolean().default(false),
  observacoes: z.string().trim().max(2000).optional(),
  intencoes: z.array(EntradaIntencaoVoto).default([]),
});

const ConsultaEntrevistas = ParametrosPaginacao.extend({
  idCampanha: Uuid,
  texto: z.string().trim().max(150).optional(),
  status: StatusEntrevista.optional(),
  apenasVigentes: z.coerce.boolean().default(true),
  comAlerta: z.coerce.boolean().optional(),
});

const EntradaDomicilio = z.object({
  idCampanha: Uuid,
  idMunicipio: z.coerce.number().int(),
  bairro: z.string().trim().min(2, 'Informe o bairro.').max(120),
  logradouro: z.string().trim().min(3, 'Informe a rua.').max(160),
  numero: z.string().trim().max(20).default('SN'),
  complemento: z.string().trim().max(60).optional(),
  pontoReferencia: z.string().trim().max(120).optional(),
  cep: z.string().trim().max(9).optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

const ConsultaDuplicidade = z.object({
  idCampanha: Uuid,
  nome: z.string().trim().min(3),
  idDomicilio: Uuid.optional(),
});

@Controller('campo')
export class CampoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
    private readonly sincronizacao: SincronizacaoOfflineService,
    private readonly retificacao: RetificacaoService,
  ) {}

  /**
   * Tudo o que a tela de entrevista precisa saber antes da primeira pergunta.
   *
   * Existia como constante no código, com UUID de demonstração: cargos fixos,
   * um domicílio inventado e uma versão de consentimento que não era a vigente.
   * Enquanto for assim, a entrevista grava contra identificadores que não
   * pertencem à organização — e o gatilho de consentimento recusa a conclusão,
   * com uma mensagem que parece defeito do formulário.
   */
  @Get('contexto')
  @ExigePermissao('campo.ler')
  async contexto(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<{
    campanha: {
      id: string;
      nome: string;
      uf: string | null;
      idMunicipio: number | null;
      anoPleito: number;
    };
    cargos: Array<{
      id: string;
      nome: string;
      quantidadeVotosPermitida: number;
      digitosNumeroUrna: number;
    }>;
    candidatos: Array<{
      id: string;
      idCargo: string;
      nomeUrna: string;
      numeroUrna: string;
      siglaPartido: string | null;
      proprio: boolean;
    }>;
    consentimento: { id: string; versao: string; texto: string } | null;
    atualizadoEm: string;
  }> {
    const { idCampanha } = z.object({ idCampanha: Uuid }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: campanhas } = await conexao.query<{
        id: string;
        nome: string;
        uf: string | null;
        id_municipio_base: number | null;
        ano_pleito: number;
      }>('select id, nome, uf, id_municipio_base, ano_pleito from public.campanhas where id = $1', [
        idCampanha,
      ]);

      const campanha = campanhas[0];
      if (!campanha) {
        throw Object.assign(new Error('Campanha não encontrada.'), { code: '42501' });
      }

      /*
       * Cargos DECLARADOS pela campanha (migration 0029), com queda para a
       * regra antiga quando não há linha nenhuma em `campanha_cargos` — uma
       * campanha criada antes desta migration, ou cuja semente falhou por
       * qualquer motivo, continua funcionando. Não remover esta queda até
       * 2027: é a rede de segurança contra a tela ficar sem cargo nenhum.
       */
      const { rows: declarados } = await conexao.query<{
        id: string;
        nome: string;
        quantidade_votos_permitida: number;
        digitos_numero_urna: number;
      }>(
        `select cg.id, cg.nome, cg.quantidade_votos_permitida, cg.digitos_numero_urna
           from public.campanha_cargos cc
           join public.cargos cg on cg.id = cc.id_cargo
          where cc.id_campanha = $1
          order by cc.ordem`,
        [idCampanha],
      );

      let cargos = declarados;
      if (cargos.length === 0) {
        // Nas eleições gerais o eleitor vota nos cinco cargos. `Deputado
        // Distrital` só existe no Distrito Federal, e lá substitui o estadual.
        const ehDistritoFederal = campanha.uf === 'DF';
        const { rows } = await conexao.query<{
          id: string;
          nome: string;
          quantidade_votos_permitida: number;
          digitos_numero_urna: number;
        }>(
          `select id, nome, quantidade_votos_permitida, digitos_numero_urna
             from public.cargos
            where nome <> $1
            order by case nome
                       when 'Presidente' then 1
                       when 'Governador' then 2
                       when 'Senador' then 3
                       when 'Deputado Federal' then 4
                       else 5
                     end`,
          [ehDistritoFederal ? 'Deputado Estadual' : 'Deputado Distrital'],
        );
        cargos = rows;
      }

      /*
       * Candidatos da campanha, para o entrevistador escolher pelo NOME.
       *
       * Sem isto o entrevistador digitava um número às cegas, e o número virava
       * `numero_declarado` sem nunca se tornar `id_candidato` — a raiz do
       * defeito que a migration 0028 corrigiu. `proprio` primeiro: são os que a
       * campanha mais precisa que o entrevistador ache rápido.
       */
      const { rows: candidatos } = await conexao.query<{
        id: string;
        id_cargo: string;
        nome_urna: string;
        numero_urna: string;
        sigla_partido: string | null;
        proprio: boolean;
      }>(
        `select c.id, c.id_cargo, c.nome_urna, c.numero_urna, p.sigla as sigla_partido, c.proprio
           from public.candidatos c
           left join public.partidos p on p.id = c.id_partido
          where c.id_campanha = $1 and c.ativo
          order by c.proprio desc, c.nome_urna`,
        [idCampanha],
      );

      // A vigente é a de `vigente_ate` nulo. Havendo mais de uma por engano,
      // vale a mais recente — trocar o termo no meio da campanha é legítimo, e
      // o consentimento já coletado guarda o texto da época.
      const { rows: termos } = await conexao.query<{
        id: string;
        versao: string;
        texto: string;
      }>(
        `select id, versao, texto
           from public.versoes_consentimento
          where vigente_ate is null and vigente_de <= now()
          order by vigente_de desc
          limit 1`,
      );

      return {
        campanha: {
          id: campanha.id,
          nome: campanha.nome,
          uf: campanha.uf,
          idMunicipio: campanha.id_municipio_base,
          anoPleito: campanha.ano_pleito,
        },
        cargos: cargos.map((cargo) => ({
          id: cargo.id,
          nome: cargo.nome,
          quantidadeVotosPermitida: cargo.quantidade_votos_permitida,
          digitosNumeroUrna: cargo.digitos_numero_urna,
        })),
        candidatos: candidatos.map((candidato) => ({
          id: candidato.id,
          idCargo: candidato.id_cargo,
          nomeUrna: candidato.nome_urna,
          numeroUrna: candidato.numero_urna,
          siglaPartido: candidato.sigla_partido,
          proprio: candidato.proprio,
        })),
        consentimento: termos[0] ?? null,
        atualizadoEm: new Date().toISOString(),
      };
    });
  }

  /**
   * Resolve o domicílio onde a entrevista acontece, criando o que faltar.
   *
   * O entrevistador está na porta da casa. Ele não vai cadastrar bairro, depois
   * logradouro, depois domicílio em três telas — vai digitar o endereço e tocar
   * em continuar. Por isso esta rota é idempotente e cria a cadeia inteira numa
   * transação só.
   *
   * Bairro e logradouro criados aqui entram como **não validados**, e caem na
   * fila de curadoria do coordenador. É o que impede "Centro", "centro" e "CENTRO"
   * de virarem três territórios distintos e estragarem toda agregação por bairro.
   */
  @Post('domicilios')
  @ExigePermissao('campo.gerenciar')
  async resolverDomicilio(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; enderecoResumido: string; criado: boolean }> {
    const entrada = EntradaDomicilio.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: bairros } = await conexao.query<{ id: string }>(
        `insert into public.bairros
           (id_organizacao, id_campanha, id_municipio, nome, origem, id_usuario_criador)
         values ($1, $2, $3, $4, 'USUARIO', $5)
         on conflict (id_organizacao, id_municipio, nome_normalizado)
           where id_bairro_mesclado_em is null
           do update set nome = public.bairros.nome
         returning id`,
        [claims.idOrganizacao, entrada.idCampanha, entrada.idMunicipio, entrada.bairro, claims.sub],
      );
      const idBairro = bairros[0]!.id;

      // `nome_canonico` é calculado aqui, e não no banco: ele expande
      // abreviaturas ("R." → "RUA"), e essa expansão vive no pacote de
      // utilitários, compartilhada com a sugestão de duplicados do front.
      const nomeCanonico = normalizarLogradouro(entrada.logradouro);

      const { rows: logradouros } = await conexao.query<{ id: string }>(
        `insert into public.logradouros
           (id_organizacao, id_campanha, id_bairro, nome, nome_canonico, cep, origem,
            id_usuario_criador)
         values ($1, $2, $3, $4, $5, $6, 'USUARIO', $7)
         -- Espelha logradouros_unicidade_idx, que e PARCIAL: sem a clausula
         -- where, o Postgres nao acha indice correspondente e recusa.
         on conflict (id_bairro, nome_canonico)
           where id_logradouro_mesclado_em is null
           do update set cep = coalesce(excluded.cep, public.logradouros.cep)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          idBairro,
          entrada.logradouro,
          nomeCanonico,
          (entrada.cep ?? '').replace(/\D+/g, '') || null,
          claims.sub,
        ],
      );
      const idLogradouro = logradouros[0]!.id;

      // "S/N", "s n" e "SN" são a mesma casa. Sem normalizar, a segunda visita
      // ao mesmo endereço criaria um domicílio novo e a cobertura do bairro
      // ficaria inflada.
      const numeroNormalizado = (entrada.numero || 'SN').toUpperCase().replace(/[^A-Z0-9]/g, '');

      const { rows: existentes } = await conexao.query<{ id: string }>(
        `select id from public.domicilios
          where id_logradouro = $1 and numero_normalizado = $2
            and coalesce(complemento, '') = coalesce($3, '')
          limit 1`,
        [idLogradouro, numeroNormalizado, entrada.complemento ?? null],
      );

      if (existentes[0]) {
        return {
          id: existentes[0].id,
          enderecoResumido: `${entrada.logradouro}, ${entrada.numero} — ${entrada.bairro}`,
          criado: false,
        };
      }

      const { rows: criados } = await conexao.query<{ id: string }>(
        `insert into public.domicilios
           (id_organizacao, id_campanha, id_logradouro, id_bairro, numero, numero_normalizado,
            complemento, ponto_referencia, latitude, longitude, id_usuario_cadastro)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          idLogradouro,
          idBairro,
          entrada.numero || 'SN',
          numeroNormalizado,
          entrada.complemento ?? null,
          entrada.pontoReferencia ?? null,
          entrada.latitude ?? null,
          entrada.longitude ?? null,
          // A politica de insercao exige que o dono seja quem esta gravando:
          // ninguem cadastra em nome de terceiro. Sem esta coluna o RLS recusa
          // com "registro nao encontrado", que nao sugere a causa.
          claims.sub,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'domicilios',
        idEntidade: criados[0]!.id,
        idCampanha: entrada.idCampanha,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return {
        id: criados[0]!.id,
        enderecoResumido: `${entrada.logradouro}, ${entrada.numero} — ${entrada.bairro}`,
        criado: true,
      };
    });
  }

  /**
   * Recebe a fila offline. Idempotente por `idLocalOffline`: o aparelho pode
   * reenviar o mesmo lote até receber confirmação, sem risco de duplicar.
   */
  @Post('sincronizar')
  @ExigePermissao('campo.gerenciar')
  async sincronizarOffline(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ resultados: ResultadoItemSincronizacao[]; resumo: Record<string, number> }> {
    const lote = LoteSincronizacaoOffline.parse(corpo);
    const resultados = await this.sincronizacao.sincronizar(claims, lote);

    const resumo = resultados.reduce<Record<string, number>>((contagem, item) => {
      contagem[item.situacao] = (contagem[item.situacao] ?? 0) + 1;
      return contagem;
    }, {});

    await this.auditoria.registrar(claims, {
      acao: 'CRIAR',
      entidade: 'entrevistas',
      idCampanha: lote.idCampanha,
      quantidadeRegistros: resumo['CRIADA'] ?? 0,
      dadosDepois: resumo,
      ip: requisicao.ip ?? null,
      userAgent: requisicao.headers['user-agent'] ?? null,
      idCorrelacao: requisicao.idCorrelacao ?? null,
    });

    return { resultados, resumo };
  }

  /**
   * Sugere entrevistados parecidos antes de gravar um novo.
   *
   * Chamado enquanto o entrevistador digita o nome, na porta da casa. Combina
   * similaridade de nome com coincidência de domicílio: nome parecido em outro
   * bairro provavelmente é outra pessoa; na mesma casa, é quase certamente a
   * mesma. Sem isso, a mesma dona Maria entra três vezes e a projeção da seção
   * infla.
   */
  @Get('entrevistados/duplicidade')
  @ExigePermissao('campo.ler')
  async verificarDuplicidade(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<
    Array<{
      id: string;
      nome: string;
      apelido: string | null;
      mesmoDomicilio: boolean;
      similaridade: number;
    }>
  > {
    const parametros = ConsultaDuplicidade.parse(consulta);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        'select * from public.sugerir_entrevistados_similares($1, $2, $3)',
        [parametros.idCampanha, parametros.nome, parametros.idDomicilio ?? null],
      );
      return rows.map((linha) => ({
        id: linha.id,
        nome: linha.nome,
        apelido: linha.apelido,
        mesmoDomicilio: linha.mesmo_domicilio,
        similaridade: Number(linha.similaridade),
      }));
    });
  }

  /**
   * Painel de qualidade da coleta. Alertas pendentes de revisão, do mais grave
   * para o mais recente — a fila de trabalho do coordenador.
   */
  @Get('qualidade/alertas')
  @ExigePermissao('qualidade.ler')
  async listarAlertas(
    @Claims() claims: ClaimsUsuario,
    @Query('idCampanha') idCampanha: string,
  ): Promise<unknown[]> {
    const campanha = Uuid.parse(idCampanha);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select a.id, a.tipo, a.gravidade, a.detalhe, a.criado_em,
                a.id_entrevista, u.nome as entrevistador
           from public.alertas_coleta a
           join public.usuarios u on u.id = a.id_usuario_avaliado
          where a.id_campanha = $1 and a.revisado_em is null
          order by a.gravidade desc, a.criado_em desc
          limit 200`,
        [campanha],
      );
      return rows;
    });
  }

  /**
   * Marca um alerta de qualidade como revisado. Colunas que existem desde a
   * 0007 e que, até esta rota, nada nunca escrevia — o painel de qualidade
   * mostrava a fila e não tinha como esvaziá-la.
   */
  @Post('qualidade/alertas/:id/revisar')
  @ExigePermissao('qualidade.gerenciar')
  async revisarAlerta(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ revisado: boolean }> {
    const idAlerta = Uuid.parse(id);
    const { procedente } = z.object({ procedente: z.boolean() }).parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.alertas_coleta
            set revisado_por = $2, revisado_em = now(), procedente = $3
          where id = $1`,
        [idAlerta, claims.sub, procedente],
      );
      return { revisado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  // =============================================================================
  // Registro de entrevistas — listagem, detalhe, histórico e retificação
  // =============================================================================

  /**
   * Listagem paginada. `apenasVigentes` (padrão true) evita que versões
   * superadas apareçam ao lado do registro atual — quem quer ver a versão
   * antiga entra pelo histórico da vigente, não pela lista principal.
   *
   * Nenhum `where` de escopo aqui: a RLS de `entrevistas`/`entrevistas_vigentes`
   * já chama `visivel_no_escopo('campo.ler', ...)`. ENTREVISTADOR/PROPRIO só
   * recebe as próprias linhas; a consulta não precisa saber disso.
   */
  @Get('entrevistas')
  @ExigePermissao('campo.ler')
  async listarEntrevistas(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<unknown>> {
    const parametros = ConsultaEntrevistas.parse(consulta);
    // `tabela` nunca vem da requisição — é um de dois literais fixos.
    const tabela = parametros.apenasVigentes ? 'public.entrevistas_vigentes' : 'public.entrevistas';

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const condicoes: string[] = ['ent.id_campanha = $1'];
      const valores: unknown[] = [parametros.idCampanha];

      if (parametros.texto) {
        valores.push(parametros.texto);
        condicoes.push(
          `e.nome_normalizado ilike '%' || public.normalizar_texto($${valores.length}) || '%'`,
        );
      }
      if (parametros.status) {
        valores.push(parametros.status);
        condicoes.push(`ent.status = $${valores.length}`);
      }
      if (parametros.comAlerta) {
        condicoes.push(
          `exists (select 1 from public.alertas_coleta a
                    where a.id_entrevista = ent.id and a.revisado_em is null)`,
        );
      }

      valores.push(parametros.limite, (parametros.pagina - 1) * parametros.limite);

      const { rows } = await conexao.query<Record<string, unknown> & { total: string }>(
        `select ent.id, ent.data_hora, ent.status, ent.versao, ent.vigente,
                e.nome as entrevistado, b.nome as bairro, u.nome as entrevistador,
                (select count(*)::int from public.intencoes_voto i where i.id_entrevista = ent.id)
                  as total_intencoes,
                exists(
                  select 1 from public.alertas_coleta a
                   where a.id_entrevista = ent.id and a.revisado_em is null
                ) as tem_alerta,
                count(*) over () as total
           from ${tabela} ent
           join public.entrevistados e on e.id = ent.id_entrevistado
           left join public.domicilios d on d.id = e.id_domicilio
           left join public.bairros b on b.id = d.id_bairro
           join public.usuarios u on u.id = ent.id_usuario_entrevistador
          where ${condicoes.join(' and ')}
          order by ent.data_hora desc
          limit $${valores.length - 1} offset $${valores.length}`,
        valores,
      );

      const total = rows[0] ? Number(rows[0]['total']) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...linha }) => linha),
        total,
        parametros,
      );
    });
  }

  /**
   * Detalhe somente-leitura. Sem CPF nem título decifrados — o coordenador vê
   * "coletado", não o documento; descriptografar aqui seria expor dado
   * sensível numa tela que não precisa dele para nada.
   */
  @Get('entrevistas/:id')
  @ExigePermissao('campo.ler')
  async detalharEntrevista(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<unknown> {
    const idEntrevista = Uuid.parse(id);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        id: string;
        id_entrevistado: string;
        data_hora: Date;
        status: string;
        versao: number;
        vigente: boolean;
        natureza: string;
        duracao_segundos: number | null;
        latitude: number | null;
        longitude: number | null;
        precisao_gps_metros: number | null;
        dispositivo: string | null;
        observacoes: string | null;
        recusou_responder: boolean;
        motivo_retificacao: string | null;
        criado_em: Date;
        entrevistado: string;
        apelido: string | null;
        classificacao: string;
        entrevistador: string;
        retificador: string | null;
        logradouro: string | null;
        numero: string | null;
        complemento: string | null;
        bairro: string | null;
      }>(
        `select ent.id, ent.id_entrevistado, ent.data_hora, ent.status, ent.versao, ent.vigente,
                ent.natureza, ent.duracao_segundos, ent.latitude, ent.longitude,
                ent.precisao_gps_metros, ent.dispositivo, ent.observacoes, ent.recusou_responder,
                ent.motivo_retificacao, ent.criado_em,
                e.nome as entrevistado, e.apelido, e.classificacao,
                u.nome as entrevistador, ur.nome as retificador,
                l.nome as logradouro, d.numero, d.complemento, b.nome as bairro
           from public.entrevistas ent
           join public.entrevistados e on e.id = ent.id_entrevistado
           join public.usuarios u on u.id = ent.id_usuario_entrevistador
           left join public.usuarios ur on ur.id = ent.id_usuario_retificador
           left join public.domicilios d on d.id = e.id_domicilio
           left join public.logradouros l on l.id = d.id_logradouro
           left join public.bairros b on b.id = d.id_bairro
          where ent.id = $1`,
        [idEntrevista],
      );
      const linha = rows[0];
      if (!linha) throw new NotFoundException('Entrevista não encontrada.');

      const intencoes = await this.buscarIntencoes(conexao, idEntrevista);

      const { rows: consentimentoRows } = await conexao.query<{
        canal: string;
        aceito_em: Date;
        versao: string;
      }>(
        `select c.canal, c.aceito_em, vc.versao
           from public.consentimentos c
           join public.versoes_consentimento vc on vc.id = c.id_versao_consentimento
          where c.id_entrevistado = $1 and c.revogado_em is null
          order by c.aceito_em desc limit 1`,
        [linha.id_entrevistado],
      );

      const { rows: alertas } = await conexao.query(
        `select tipo, gravidade, detalhe, criado_em, revisado_em, procedente
           from public.alertas_coleta where id_entrevista = $1 order by gravidade desc`,
        [idEntrevista],
      );

      return {
        id: linha.id,
        dataHora: linha.data_hora,
        status: linha.status,
        versao: linha.versao,
        vigente: linha.vigente,
        natureza: linha.natureza,
        duracaoSegundos: linha.duracao_segundos,
        latitude: linha.latitude,
        longitude: linha.longitude,
        precisaoGpsMetros: linha.precisao_gps_metros,
        dispositivo: linha.dispositivo,
        observacoes: linha.observacoes,
        recusouResponder: linha.recusou_responder,
        motivoRetificacao: linha.motivo_retificacao,
        criadoEm: linha.criado_em,
        entrevistado: {
          nome: linha.entrevistado,
          apelido: linha.apelido,
          classificacao: linha.classificacao,
        },
        entrevistador: linha.entrevistador,
        retificador: linha.retificador,
        endereco:
          linha.logradouro && linha.bairro
            ? {
                logradouro: linha.logradouro,
                numero: linha.numero,
                complemento: linha.complemento,
                bairro: linha.bairro,
              }
            : null,
        consentimento: consentimentoRows[0]
          ? {
              canal: consentimentoRows[0].canal,
              aceitoEm: consentimentoRows[0].aceito_em,
              versao: consentimentoRows[0].versao,
            }
          : null,
        intencoes: intencoes.map((i) => ({
          idCargo: i.id_cargo,
          nomeCargo: i.nome_cargo,
          posicao: i.posicao,
          tipo: i.tipo,
          rotulo: i.rotulo,
          // Para o formulário de retificação pré-preencher o SeletorCandidato
          // sem o coordenador ter que escolher tudo de novo do zero.
          idCandidato: i.id_candidato,
          numeroDeclarado: i.numero_declarado,
        })),
        alertas,
      };
    });
  }

  /**
   * A cadeia inteira, com o diff entre cada par de versões consecutivas.
   *
   * Aceita o id de QUALQUER versão da cadeia — não só a vigente — porque o
   * coordenador pode chegar aqui a partir de uma versão antiga.
   */
  @Get('entrevistas/:id/historico')
  @ExigePermissao('campo.ler')
  async historicoEntrevista(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
  ): Promise<{
    versoes: Array<{
      id: string;
      versao: number;
      vigente: boolean;
      status: string;
      criadoEm: Date;
      motivoRetificacao: string | null;
      usuarioRetificador: string | null;
      diferencas: ReturnType<typeof diferencaEntreVersoes>;
    }>;
  }> {
    const idQualquerVersao = Uuid.parse(id);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: raiz } = await conexao.query<{ id_cadeia: string }>(
        `select coalesce(id_entrevista_original, id) as id_cadeia
           from public.entrevistas where id = $1`,
        [idQualquerVersao],
      );
      if (!raiz[0]) throw new NotFoundException('Entrevista não encontrada.');

      const { rows: versoesBrutas } = await conexao.query<{
        id: string;
        versao: number;
        vigente: boolean;
        status: string;
        criado_em: Date;
        motivo_retificacao: string | null;
        nome_retificador: string | null;
      }>(
        `select ent.id, ent.versao, ent.vigente, ent.status, ent.criado_em,
                ent.motivo_retificacao, u.nome as nome_retificador
           from public.entrevistas ent
           left join public.usuarios u on u.id = ent.id_usuario_retificador
          where coalesce(ent.id_entrevista_original, ent.id) = $1
          order by ent.versao`,
        [raiz[0].id_cadeia],
      );

      const comparaveis = await Promise.all(
        versoesBrutas.map((v) => this.montarComparavel(conexao, v.id)),
      );

      const versoes = versoesBrutas.map((v, indice) => ({
        id: v.id,
        versao: v.versao,
        vigente: v.vigente,
        status: v.status,
        criadoEm: v.criado_em,
        motivoRetificacao: v.motivo_retificacao,
        usuarioRetificador: v.nome_retificador,
        diferencas:
          indice === 0 ? [] : diferencaEntreVersoes(comparaveis[indice - 1]!, comparaveis[indice]!),
      }));

      return { versoes };
    });
  }

  /**
   * Cria a próxima versão da entrevista. A regra fica em `RetificacaoService`
   * — aqui só valida o corpo e repassa o contexto de auditoria.
   */
  @Post('entrevistas/:id/retificar')
  @ExigePermissao('campo.retificar')
  async retificarEntrevista(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ idNovaVersao: string; versao: number }> {
    const idEntrevista = Uuid.parse(id);
    const entrada = EntradaRetificacao.parse(corpo);
    return this.retificacao.retificar(claims, idEntrevista, entrada, {
      ip: requisicao.ip ?? null,
      userAgent: requisicao.headers['user-agent'] ?? null,
      idCorrelacao: requisicao.idCorrelacao ?? null,
    });
  }

  /** Intenções de uma entrevista, já com posição no slot e rótulo pronto. */
  private async buscarIntencoes(
    conexao: PoolClient,
    idEntrevista: string,
  ): Promise<
    Array<{
      id_cargo: string;
      nome_cargo: string;
      posicao: number;
      tipo: string;
      rotulo: string;
      id_candidato: string | null;
      numero_declarado: string | null;
    }>
  > {
    const { rows } = await conexao.query(
      `select cg.id as id_cargo, cg.nome as nome_cargo,
              row_number() over (partition by i.id_cargo order by i.criado_em, i.id)::int
                as posicao,
              i.tipo::text as tipo,
              case i.tipo::text
                when 'CANDIDATO' then
                  coalesce(c.nome_urna, '') || ' (' || coalesce(c.numero_urna, '') || ')'
                when 'NAO_CADASTRADO' then coalesce(i.numero_declarado, '') || ' (não cadastrado)'
                when 'BRANCO' then 'Branco'
                when 'NULO' then 'Nulo'
                when 'INDECISO' then 'Ainda não decidiu'
                else 'Não quis dizer'
              end as rotulo,
              i.id_candidato, i.numero_declarado
         from public.intencoes_voto i
         join public.cargos cg on cg.id = i.id_cargo
         left join public.candidatos c on c.id = i.id_candidato
        where i.id_entrevista = $1
        order by cg.codigo_tse, posicao`,
      [idEntrevista],
    );
    return rows;
  }

  /** Monta o objeto comparável (nome/classificação/intenções) de UMA versão. */
  private async montarComparavel(
    conexao: PoolClient,
    idEntrevista: string,
  ): Promise<EntrevistaComparavel> {
    const { rows } = await conexao.query<{
      recusou_responder: boolean;
      observacoes: string | null;
      id_entrevistado: string;
    }>(
      'select recusou_responder, observacoes, id_entrevistado from public.entrevistas where id = $1',
      [idEntrevista],
    );
    const entrevista = rows[0]!;

    const { rows: entrevistadoRows } = await conexao.query<{
      nome: string;
      classificacao: string;
    }>('select nome, classificacao from public.entrevistados where id = $1', [
      entrevista.id_entrevistado,
    ]);
    const entrevistado = entrevistadoRows[0]!;

    const intencoes = await this.buscarIntencoes(conexao, idEntrevista);

    return {
      nomeEntrevistado: entrevistado.nome,
      classificacao: entrevistado.classificacao,
      recusouResponder: entrevista.recusou_responder,
      observacoes: entrevista.observacoes,
      intencoes: intencoes.map((i) => ({
        idCargo: i.id_cargo,
        nomeCargo: i.nome_cargo,
        posicao: i.posicao,
        rotulo: i.rotulo,
      })),
    };
  }
}
