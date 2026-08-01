import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, Uuid } from '@jeleitoral/tipos';
import { normalizarLogradouro } from '@jeleitoral/utilitarios';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { ConectorCep, type EnderecoPorCep } from '../integracoes/conectorCep.js';
import { IntegracoesModule } from '../integracoes/integracoes.module.js';

const EntradaLogradouro = z.object({
  idCampanha: Uuid,
  idBairro: Uuid,
  tipo: z.string().max(30).optional(),
  nome: z.string().trim().min(3).max(150),
  cep: z.string().optional(),
});

const EntradaMesclagem = z.object({
  /** Registro que será absorvido e deixará de ser usado. */
  idOrigem: Uuid,
  /** Registro que permanece como forma canônica. */
  idDestino: Uuid,
  entidade: z.enum(['bairro', 'logradouro']),
});

@Injectable()
export class TerritorioService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Fila de curadoria: o que o campo cadastrou e ainda ninguém conferiu.
   *
   * Existe porque o entrevistador digita no celular, na rua, com pressa — e
   * "Rua São José", "R. Sao Jose" e "rua sao jose" viram três logradouros
   * diferentes se ninguém olhar. Três logradouros diferentes significam três
   * denominadores diferentes na projeção do bairro.
   */
  async filaCuradoria(
    claims: ClaimsUsuario,
    parametros: { idCampanha: string; idMunicipio?: number },
  ): Promise<{ bairros: unknown[]; logradouros: unknown[] }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: bairros } = await conexao.query(
        `select b.id, b.nome, b.id_municipio, b.criado_em, u.nome as cadastrado_por,
                (select count(*) from public.domicilios d where d.id_bairro = b.id) as domicilios
           from public.bairros b
           left join public.usuarios u on u.id = b.id_usuario_criador
          where b.id_campanha = $1 and b.validado = false
            and b.id_bairro_mesclado_em is null
            and ($2::int is null or b.id_municipio = $2::int)
          order by b.criado_em`,
        [parametros.idCampanha, parametros.idMunicipio ?? null],
      );

      const { rows: logradouros } = await conexao.query(
        `select l.id, l.nome, l.nome_canonico, l.cep, b.nome as bairro, l.criado_em,
                u.nome as cadastrado_por,
                (select count(*) from public.domicilios d where d.id_logradouro = l.id) as domicilios
           from public.logradouros l
           join public.bairros b on b.id = l.id_bairro
           left join public.usuarios u on u.id = l.id_usuario_criador
          where l.id_campanha = $1 and l.validado = false
            and l.id_logradouro_mesclado_em is null
          order by l.criado_em`,
        [parametros.idCampanha],
      );

      return { bairros, logradouros };
    });
  }

  /**
   * Mescla dois registros territoriais: os domicílios migram para o destino e a
   * origem fica marcada como absorvida.
   *
   * A origem **não é excluída**. Ela permanece apontando para o destino, porque
   * um aparelho em campo pode estar com a fila offline referenciando aquele
   * identificador — apagar produziria erro de chave estrangeira na
   * sincronização, e o entrevistador perderia a coleta do dia por causa de uma
   * arrumação feita no escritório.
   */
  async mesclar(
    claims: ClaimsUsuario,
    entrada: { idOrigem: string; idDestino: string; entidade: 'bairro' | 'logradouro' },
  ): Promise<{ domiciliosMigrados: number }> {
    if (entrada.idOrigem === entrada.idDestino) {
      throw new Error('Origem e destino são o mesmo registro.');
    }

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const tabela = entrada.entidade === 'bairro' ? 'bairros' : 'logradouros';
      const colunaDomicilio = entrada.entidade === 'bairro' ? 'id_bairro' : 'id_logradouro';
      const colunaMesclagem =
        entrada.entidade === 'bairro' ? 'id_bairro_mesclado_em' : 'id_logradouro_mesclado_em';

      const migracao = await conexao.query(
        `update public.domicilios set ${colunaDomicilio} = $2 where ${colunaDomicilio} = $1`,
        [entrada.idOrigem, entrada.idDestino],
      );

      if (entrada.entidade === 'bairro') {
        // Logradouros do bairro absorvido passam a pertencer ao destino.
        await conexao.query('update public.logradouros set id_bairro = $2 where id_bairro = $1', [
          entrada.idOrigem,
          entrada.idDestino,
        ]);
      }

      await conexao.query(
        `update public.${tabela} set ${colunaMesclagem} = $2, validado = true where id = $1`,
        [entrada.idOrigem, entrada.idDestino],
      );
      await conexao.query(`update public.${tabela} set validado = true where id = $1`, [
        entrada.idDestino,
      ]);

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: tabela,
        idEntidade: entrada.idOrigem,
        dadosDepois: { mescladoEm: entrada.idDestino, domicilios: migracao.rowCount ?? 0 },
      });

      return { domiciliosMigrados: migracao.rowCount ?? 0 };
    });
  }

  async validar(
    claims: ClaimsUsuario,
    entrada: { id: string; entidade: 'bairro' | 'logradouro' },
  ): Promise<void> {
    const tabela = entrada.entidade === 'bairro' ? 'bairros' : 'logradouros';
    await this.banco.executarComoUsuario(claims, async (conexao) => {
      await conexao.query(`update public.${tabela} set validado = true where id = $1`, [
        entrada.id,
      ]);
      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: tabela,
        idEntidade: entrada.id,
        dadosDepois: { validado: true },
      });
    });
  }
}

@Controller('territorio')
class TerritorioController {
  constructor(
    private readonly banco: BancoService,
    private readonly territorio: TerritorioService,
    private readonly cep: ConectorCep,
  ) {}

  @Get('cep/:cep')
  @ExigePermissao('territorio.ler')
  async consultarCep(@Query('cep') cep: string): Promise<EnderecoPorCep> {
    return this.cep.consultar(cep);
  }

  /**
   * UFs disponíveis, direto da tabela de referência.
   *
   * As telas liam uma lista fixa no código — e como só havia demonstração de São
   * Paulo, o filtro mostrava "SP" e nada mais, dando a impressão de que o sistema
   * atendia um estado só. A lista real só existe depois de `pnpm ibge:sincronizar`;
   * se vier vazia, é carga faltando, não estado inexistente.
   */
  @Get('estados')
  @ExigePermissao('territorio.ler')
  async estados(@Claims() claims: ClaimsUsuario): Promise<unknown[]> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select e.id_ibge as "idIbge", e.sigla, e.nome, e.regiao,
                (select count(*) from public.municipios m where m.id_estado = e.id_ibge)
                  ::int as municipios
           from public.estados e
          order by e.nome`,
      );
      return rows;
    });
  }

  /**
   * Municípios de uma UF, com busca por nome opcional.
   *
   * A busca usa a coluna normalizada: quem digita "sao jose" precisa achar
   * "São José", senão o operador conclui que o município não foi carregado.
   */
  @Get('municipios')
  @ExigePermissao('territorio.ler')
  async municipios(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<unknown[]> {
    const parametros = z
      .object({
        uf: z.string().length(2).toUpperCase().optional(),
        busca: z.string().trim().min(2).optional(),
        limite: z.coerce.number().int().min(1).max(1000).default(500),
      })
      .parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select m.id_ibge as "idIbge", m.nome, e.sigla as uf, m.nome_mesorregiao as mesorregiao,
                m.populacao
           from public.municipios m
           join public.estados e on e.id_ibge = m.id_estado
          where ($1::text is null or e.sigla = $1::text)
            and ($2::text is null or m.nome_normalizado like '%' || public.normalizar_texto($2) || '%')
          order by m.nome
          limit $3`,
        [parametros.uf ?? null, parametros.busca ?? null, parametros.limite],
      );
      return rows;
    });
  }

  @Get('curadoria')
  @ExigePermissao('territorio.gerenciar')
  async curadoria(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<{ bairros: unknown[]; logradouros: unknown[] }> {
    const parametros = z
      .object({ idCampanha: Uuid, idMunicipio: z.coerce.number().int().optional() })
      .parse(consulta);
    return this.territorio.filaCuradoria(claims, parametros);
  }

  /**
   * Sugere logradouros parecidos antes de permitir o cadastro.
   *
   * O front chama isto enquanto o entrevistador digita. A comparação roda no
   * banco, com `pg_trgm`, sobre a mesma forma canônica que o pacote de
   * utilitários produz no cliente — as duas pontas precisam concordar, senão a
   * tela sugere um duplicado que o servidor não reconhece.
   */
  @Get('logradouros/similares')
  @ExigePermissao('territorio.ler')
  async similares(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<unknown[]> {
    const parametros = z
      .object({ idMunicipio: z.coerce.number().int(), nome: z.string().min(3) })
      .parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        'select * from public.sugerir_logradouros_similares($1, $2, $3)',
        [claims.idOrganizacao, parametros.idMunicipio, normalizarLogradouro(parametros.nome)],
      );
      return rows;
    });
  }

  @Post('logradouros')
  @ExigePermissao('territorio.gerenciar')
  async criarLogradouro(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const entrada = EntradaLogradouro.parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.logradouros
           (id_organizacao, id_campanha, id_bairro, tipo, nome, nome_canonico, cep,
            origem, id_usuario_criador, validado)
         values ($1, $2, $3, $4, $5, $6, $7, 'USUARIO', $8, false)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.idBairro,
          entrada.tipo ?? null,
          entrada.nome,
          // A forma canônica é calculada no servidor, e não recebida do cliente:
          // um front desatualizado gravaria uma canônica divergente e a
          // deduplicação pararia de funcionar em silêncio.
          normalizarLogradouro(`${entrada.tipo ?? ''} ${entrada.nome}`),
          entrada.cep?.replace(/\D+/g, '') || null,
          claims.sub,
        ],
      );
      return rows[0]!;
    });
  }

  @Post('mesclar')
  @ExigePermissao('territorio.gerenciar')
  async mesclar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ domiciliosMigrados: number }> {
    return this.territorio.mesclar(claims, EntradaMesclagem.parse(corpo));
  }

  @Post('validar')
  @ExigePermissao('territorio.gerenciar')
  async validar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<{ ok: true }> {
    const entrada = z.object({ id: Uuid, entidade: z.enum(['bairro', 'logradouro']) }).parse(corpo);
    await this.territorio.validar(claims, entrada);
    return { ok: true };
  }
}

@Module({
  imports: [IntegracoesModule],
  controllers: [TerritorioController],
  providers: [BancoService, AuditoriaService, TerritorioService],
  exports: [TerritorioService],
})
export class TerritorioModule {}
