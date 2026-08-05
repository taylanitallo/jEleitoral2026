import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  LoteSincronizacaoOffline,
  Uuid,
  type ResultadoItemSincronizacao,
} from '@jeleitoral/tipos';
import { normalizarLogradouro } from '@jeleitoral/utilitarios';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { SincronizacaoOfflineService } from './sincronizacaoOffline.service.js';

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
    campanha: { id: string; nome: string; uf: string | null; anoPleito: number };
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
        ano_pleito: number;
      }>('select id, nome, uf, ano_pleito from public.campanhas where id = $1', [idCampanha]);

      const campanha = campanhas[0];
      if (!campanha) {
        throw Object.assign(new Error('Campanha não encontrada.'), { code: '42501' });
      }

      /*
       * Nas eleições gerais o eleitor vota nos cinco cargos, e a campanha
       * pergunta sobre todos — mesmo a que disputa só uma vaga. Saber que o
       * eleitor é do candidato a estadual mas não do de governador é
       * exatamente o tipo de informação que orienta palanque.
       *
       * `Deputado Distrital` só existe no Distrito Federal, e lá substitui o
       * estadual. Oferecer os dois faria o entrevistador escolher entre cargos
       * que não coexistem em urna nenhuma.
       */
      const ehDistritoFederal = campanha.uf === 'DF';
      const { rows: cargos } = await conexao.query<{
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
}
