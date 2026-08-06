import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ClaimsUsuario, StatusOrganizacao, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { gerarSenhaInicial } from '../comum/gerarSenhaInicial.js';

const EntradaAcessoSuporte = z.object({
  idUsuarioProvedor: Uuid,
  emailProvedor: z.string().email(),
  motivo: z.string().trim().min(20, 'Descreva o motivo com pelo menos 20 caracteres.'),
  horasDeAcesso: z.number().int().min(1).max(168).default(24),
});

const EntradaCriarOrganizacao = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da organização.').max(120),
  razaoSocial: z.string().trim().max(160).optional(),
  idPlano: Uuid,
  corAcento: z
    .string()
    .regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/, 'Cor inválida — use o formato "matiz saturação% luz%".')
    .optional(),
  administrador: z.object({
    nome: z.string().trim().min(3, 'Informe o nome do administrador.').max(120),
    email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  }),
});

const EntradaStatusOrganizacao = z.object({ status: StatusOrganizacao });

const EntradaPlanoOrganizacao = z.object({
  idPlano: Uuid,
  expiraEm: z.coerce.date().optional(),
});

/**
 * Backoffice da Jeos e acesso de suporte.
 *
 * Duas metades com regras opostas, e a separação é o ponto:
 *
 *  • **O que o provedor vê sozinho** — cadastro comercial e métricas agregadas,
 *    lidas de `catalogo.metricas_uso`, uma tabela de contadores alimentada por
 *    job. Nunca a tabela de origem. Não há caminho, nem acidental, do painel do
 *    provedor até a intenção de voto de um eleitor.
 *
 *  • **O que exige autorização do cliente** — qualquer leitura de dado de campo.
 *    Concedida pelo administrador da organização, com motivo, prazo e
 *    notificação. O provedor não consegue se autoconceder: seu token não tem
 *    `id_organizacao`, e a política de INSERT em `acessos_suporte` exige que o
 *    autorizador seja o próprio usuário autenticado da organização.
 *
 * Isso não é preciosismo. Intenção de voto é dado sensível pela LGPD e o
 * sistema atende campanhas adversárias no mesmo banco — acesso irrestrito do
 * provedor seria um risco jurídico concreto, não teórico.
 */
@Injectable()
export class ProvedorService {
  private readonly configuracao = carregarConfiguracao();

  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private clienteAdministrativo() {
    return createClient(this.configuracao.SUPABASE_URL, this.configuracao.SUPABASE_CHAVE_SERVICO, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /** Painel comercial: organizações, planos, contratos e uso agregado. */
  async listarOrganizacoes(claims: ClaimsUsuario): Promise<unknown[]> {
    this.exigirProvedor(claims);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select o.id, o.nome, o.status, o.contratado_em, o.expira_em,
                p.nome as plano, p.limite_usuarios, p.limite_entrevistas_mes,
                m.usuarios_ativos, m.entrevistas_no_mes, m.armazenamento_mb,
                m.chamadas_ia, m.custo_ia, m.ultima_atividade
           from public.organizacoes o
           join public.planos p on p.id = o.id_plano
           left join lateral (
             select * from catalogo.metricas_uso mu
              where mu.id_organizacao = o.id
              order by mu.data_referencia desc limit 1
           ) m on true
          order by o.nome`,
      );
      return rows;
    });
  }

  /** Catálogo de planos, para o formulário de nova organização e de troca de plano. */
  async listarPlanos(claims: ClaimsUsuario): Promise<unknown[]> {
    this.exigirProvedor(claims);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select id, nome, limite_usuarios, limite_entrevistas_mes, valor_mensal
           from public.planos where ativo order by valor_mensal`,
      );
      return rows;
    });
  }

  /**
   * Cria uma organização e seu primeiro administrador.
   *
   * Generaliza o que `scripts/semearOrganizacao.mjs` fazia à mão para a
   * primeira organização do sistema: insere a organização, semeia os 7
   * perfis-padrão (`semear_perfis_organizacao`) e cria o usuário ADMINISTRADOR
   * já vinculado a eles. Não cria campanha nenhuma — isso é trabalho do
   * próprio administrador recém-criado, na tela de Campanhas.
   *
   * A conta no Supabase Auth nasce ANTES da transação SQL, como em
   * `UsuariosController.criar()`: se a parte SQL falhar depois, a conta órfã
   * é desfeita no `catch` — a alternativa (SQL primeiro) deixaria uma
   * organização sem ninguém capaz de entrar nela.
   */
  async criarOrganizacao(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaCriarOrganizacao>,
  ): Promise<{ idOrganizacao: string; senhaInicial: string }> {
    this.exigirProvedor(claims);

    const senhaInicial = gerarSenhaInicial();
    const administrativo = this.clienteAdministrativo();

    const { data, error } = await administrativo.auth.admin.createUser({
      email: entrada.administrador.email,
      password: senhaInicial,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new BadRequestException(
        'Não foi possível criar o acesso do administrador. Verifique se este e-mail já está em uso.',
      );
    }

    try {
      return await this.banco.executarComoUsuario(claims, async (conexao) => {
        const { rows: org } = await conexao.query<{ id: string }>(
          `insert into public.organizacoes (nome, razao_social, id_plano, cor_acento)
           values ($1, $2, $3, $4) returning id`,
          [entrada.nome, entrada.razaoSocial ?? null, entrada.idPlano, entrada.corAcento ?? null],
        );
        const idOrganizacao = org[0]!.id;

        await conexao.query('select public.semear_perfis_organizacao($1)', [idOrganizacao]);

        const { rows: perfil } = await conexao.query<{ id: string }>(
          `select id from public.perfis_acesso where id_organizacao = $1 and nome = 'ADMINISTRADOR'`,
          [idOrganizacao],
        );

        await conexao.query(
          `insert into public.usuarios (id, id_organizacao, nome, email, id_perfil, ativo)
           values ($1, $2, $3, $4, $5, true)`,
          [
            data.user.id,
            idOrganizacao,
            entrada.administrador.nome,
            entrada.administrador.email,
            perfil[0]!.id,
          ],
        );

        await this.auditoria.registrarNaTransacao(conexao, claims, {
          acao: 'CRIAR',
          entidade: 'organizacoes',
          idEntidade: idOrganizacao,
          idOrganizacaoAlvo: idOrganizacao,
          dadosDepois: {
            nome: entrada.nome,
            idPlano: entrada.idPlano,
            administrador: entrada.administrador.email,
          },
        });

        return { idOrganizacao, senhaInicial };
      });
    } catch (erro) {
      // Mesma lógica de `UsuariosController.criar()`: a conta de autenticação
      // já existe, mas a organização não — desfazer evita um usuário capaz de
      // entrar e não pertencer a lugar nenhum.
      await administrativo.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw erro;
    }
  }

  async definirStatusOrganizacao(
    claims: ClaimsUsuario,
    idOrganizacao: string,
    status: StatusOrganizacao,
  ): Promise<{ status: StatusOrganizacao }> {
    this.exigirProvedor(claims);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query<{ status: StatusOrganizacao }>(
        'select status from public.organizacoes where id = $1',
        [idOrganizacao],
      );
      if (!antes[0]) throw new BadRequestException('Organização não encontrada.');

      const { rows } = await conexao.query<{ status: StatusOrganizacao }>(
        'update public.organizacoes set status = $2, atualizado_em = now() where id = $1 returning status',
        [idOrganizacao, status],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'organizacoes',
        idEntidade: idOrganizacao,
        idOrganizacaoAlvo: idOrganizacao,
        dadosAntes: antes[0],
        dadosDepois: rows[0],
      });

      return rows[0]!;
    });
  }

  async definirPlanoOrganizacao(
    claims: ClaimsUsuario,
    idOrganizacao: string,
    entrada: z.infer<typeof EntradaPlanoOrganizacao>,
  ): Promise<{ idPlano: string; expiraEm: Date | null }> {
    this.exigirProvedor(claims);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query(
        'select id_plano, expira_em from public.organizacoes where id = $1',
        [idOrganizacao],
      );
      if (!antes[0]) throw new BadRequestException('Organização não encontrada.');

      const { rows } = await conexao.query<{ id_plano: string; expira_em: Date | null }>(
        `update public.organizacoes
            set id_plano = $2, expira_em = coalesce($3, expira_em), atualizado_em = now()
          where id = $1
        returning id_plano, expira_em`,
        [idOrganizacao, entrada.idPlano, entrada.expiraEm ?? null],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'organizacoes',
        idEntidade: idOrganizacao,
        idOrganizacaoAlvo: idOrganizacao,
        dadosAntes: antes[0],
        dadosDepois: rows[0],
      });

      return { idPlano: rows[0]!.id_plano, expiraEm: rows[0]!.expira_em };
    });
  }

  /**
   * Métricas de uso agregadas. Contadores, nunca conteúdo.
   *
   * O job que alimenta esta tabela roda com a chave de serviço, que ignora RLS —
   * é um dos poucos lugares em que isso é legítimo, porque ele só escreve
   * totais e nunca devolve linha de dado de campo para lugar nenhum.
   */
  async consolidarMetricas(dataReferencia = new Date()): Promise<{ organizacoes: number }> {
    return this.banco.executarEmTabelasDeReferencia(async (conexao) => {
      const { rowCount } = await conexao.query(
        `insert into catalogo.metricas_uso
           (id_organizacao, data_referencia, usuarios_ativos, entrevistas_no_mes,
            entrevistados_total, chamadas_ia, custo_ia, ultima_atividade)
         select o.id,
                $1::date,
                (select count(*) from public.usuarios u
                  where u.id_organizacao = o.id and u.ativo),
                (select count(*) from public.entrevistas e
                  where e.id_organizacao = o.id
                    and e.data_hora >= date_trunc('month', $1::date)),
                (select count(*) from public.entrevistados en
                  where en.id_organizacao = o.id and en.anonimizado_em is null),
                (select count(*) from public.usos_ia i
                  where i.id_organizacao = o.id
                    and i.criado_em >= date_trunc('month', $1::date)),
                (select coalesce(sum(i.custo_estimado), 0) from public.usos_ia i
                  where i.id_organizacao = o.id
                    and i.criado_em >= date_trunc('month', $1::date)),
                (select max(u.ultimo_acesso) from public.usuarios u
                  where u.id_organizacao = o.id)
           from public.organizacoes o
         on conflict (id_organizacao, data_referencia) do update
           set usuarios_ativos = excluded.usuarios_ativos,
               entrevistas_no_mes = excluded.entrevistas_no_mes,
               entrevistados_total = excluded.entrevistados_total,
               chamadas_ia = excluded.chamadas_ia,
               custo_ia = excluded.custo_ia,
               ultima_atividade = excluded.ultima_atividade`,
        [dataReferencia],
      );
      return { organizacoes: rowCount ?? 0 };
    });
  }

  /**
   * O **administrador da organização** concede acesso temporário ao suporte.
   *
   * Repare em quem chama: `claims` é do cliente, não do provedor. O provedor
   * pede por fora (telefone, chamado) e o cliente autoriza aqui. Inverter isso
   * — deixar o provedor solicitar e o cliente apenas "aprovar" — pareceria
   * equivalente e não é: criaria um caminho em que a solicitação já existe no
   * banco antes de qualquer decisão do titular dos dados.
   */
  async concederAcessoSuporte(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaAcessoSuporte>,
  ): Promise<{ id: string; expiraEm: Date }> {
    if (!claims.idOrganizacao) {
      throw new ForbiddenException('Apenas um administrador da organização pode conceder acesso.');
    }

    const expiraEm = new Date(Date.now() + entrada.horasDeAcesso * 60 * 60 * 1000);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.acessos_suporte
           (id_organizacao, id_usuario_provedor, email_provedor, motivo,
            autorizado_por, expira_em)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idUsuarioProvedor,
          entrada.emailProvedor,
          entrada.motivo,
          claims.sub,
          expiraEm,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CONCEDER_ACESSO_SUPORTE',
        entidade: 'acessos_suporte',
        idEntidade: rows[0]!.id,
        dadosDepois: {
          emailProvedor: entrada.emailProvedor,
          motivo: entrada.motivo,
          expiraEm: expiraEm.toISOString(),
        },
      });

      // A notificação por e-mail ao cliente ainda não está implementada —
      // depende do serviço de envio, que não existe. Até lá, a concessão fica
      // visível na tela de acessos da organização, que é consultável por
      // qualquer usuário dela.
      return { id: rows[0]!.id, expiraEm };
    });
  }

  async revogarAcessoSuporte(
    claims: ClaimsUsuario,
    idAcesso: string,
  ): Promise<{ revogado: boolean }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.acessos_suporte
            set revogado_em = now(), revogado_por = $2
          where id = $1 and revogado_em is null`,
        [idAcesso, claims.sub],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'REVOGAR_ACESSO_SUPORTE',
        entidade: 'acessos_suporte',
        idEntidade: idAcesso,
      });

      return { revogado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  /**
   * Não é `private`: a checagem precisa poder rodar de um controller que não
   * passa pelo resto do serviço — como `auditoria()` abaixo, que consulta a
   * view direto. O guard já barra por permissão, mas repetir a checagem aqui
   * evita que uma refatoração futura reaproveite o serviço ou o controller
   * sem a proteção certa.
   */
  exigirProvedor(claims: ClaimsUsuario): void {
    if (claims.idOrganizacao) {
      throw new ForbiddenException('Esta área é exclusiva do backoffice.');
    }
  }
}

@Controller('provedor')
class ProvedorController {
  constructor(
    private readonly banco: BancoService,
    private readonly provedor: ProvedorService,
  ) {}

  @Get('organizacoes')
  async organizacoes(@Claims() claims: ClaimsUsuario): Promise<unknown[]> {
    return this.provedor.listarOrganizacoes(claims);
  }

  @Get('planos')
  async planos(@Claims() claims: ClaimsUsuario): Promise<unknown[]> {
    return this.provedor.listarPlanos(claims);
  }

  @Post('organizacoes')
  async criarOrganizacao(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ idOrganizacao: string; senhaInicial: string }> {
    return this.provedor.criarOrganizacao(claims, EntradaCriarOrganizacao.parse(corpo));
  }

  @Patch('organizacoes/:id/status')
  async status(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ status: string }> {
    const entrada = EntradaStatusOrganizacao.parse(corpo);
    return this.provedor.definirStatusOrganizacao(claims, Uuid.parse(id), entrada.status);
  }

  @Patch('organizacoes/:id/plano')
  async plano(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ idPlano: string; expiraEm: Date | null }> {
    return this.provedor.definirPlanoOrganizacao(
      claims,
      Uuid.parse(id),
      EntradaPlanoOrganizacao.parse(corpo),
    );
  }

  /** Auditoria em nível de metadado: quem acessou o quê, sem o conteúdo. */
  @Get('auditoria')
  async auditoria(
    @Claims() claims: ClaimsUsuario,
    @Query('idOrganizacao') id?: string,
  ): Promise<unknown[]> {
    this.provedor.exigirProvedor(claims);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select * from provedor.auditoria_metadados
          where ($1::uuid is null or id_organizacao = $1::uuid)
          order by criado_em desc limit 200`,
        [id ?? null],
      );
      return rows;
    });
  }
}

@Controller('suporte')
class SuporteController {
  constructor(private readonly provedor: ProvedorService) {}

  @Post('conceder')
  @ExigePermissao('suporte.autorizar', 'CAMPANHA')
  async conceder(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ id: string; expiraEm: Date }> {
    return this.provedor.concederAcessoSuporte(claims, EntradaAcessoSuporte.parse(corpo));
  }

  @Post('revogar')
  @ExigePermissao('suporte.autorizar', 'CAMPANHA')
  async revogar(
    @Claims() claims: ClaimsUsuario,
    @Body('idAcesso') idAcesso: string,
  ): Promise<{ revogado: boolean }> {
    return this.provedor.revogarAcessoSuporte(claims, Uuid.parse(idAcesso));
  }
}

@Module({
  controllers: [ProvedorController, SuporteController],
  providers: [BancoService, AuditoriaService, ProvedorService],
  exports: [ProvedorService],
})
export class ProvedorModule {}
