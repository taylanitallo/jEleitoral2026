import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaAcessoSuporte = z.object({
  idUsuarioProvedor: Uuid,
  emailProvedor: z.string().email(),
  motivo: z.string().trim().min(20, 'Descreva o motivo com pelo menos 20 caracteres.'),
  horasDeAcesso: z.number().int().min(1).max(168).default(24),
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
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

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

  async revogarAcessoSuporte(claims: ClaimsUsuario, idAcesso: string): Promise<{ revogado: boolean }> {
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

  private exigirProvedor(claims: ClaimsUsuario): void {
    // O guard já barra, mas a checagem aqui evita que uma refatoração futura
    // reaproveite o serviço num controller sem a proteção certa.
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

  /** Auditoria em nível de metadado: quem acessou o quê, sem o conteúdo. */
  @Get('auditoria')
  async auditoria(@Claims() claims: ClaimsUsuario, @Query('idOrganizacao') id?: string): Promise<unknown[]> {
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
