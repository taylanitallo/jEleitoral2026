import { Body, Controller, Get, Injectable, Module, Patch } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { Criptografia } from '../comum/criptografia.js';

const EntradaOrganizacao = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da organização.').max(120),
  razaoSocial: z.string().trim().max(160).optional(),
  cnpj: z.string().trim().max(20).optional(),
  corAcento: z
    .string()
    .regex(/^\d{1,3} \d{1,3}% \d{1,3}%$/, 'Cor inválida — use o formato "matiz saturação% luz%".')
    .optional(),
  logoUrl: z.string().trim().url('Informe uma URL válida.').max(500).optional(),
});

interface LinhaOrganizacao {
  nome: string;
  razao_social: string | null;
  cnpj_criptografado: string | null;
  cor_acento: string | null;
  logo_url: string | null;
  status: string;
  plano: string;
  contratado_em: string;
  expira_em: string | null;
}

/**
 * Dados editáveis da própria organização — a aba "Gerais" de Configurações.
 *
 * `status`, `plano` e `expira_em` NÃO entram aqui: são comerciais, e mudam
 * só pelo backoffice do provedor (`apps/api/src/provedor/provedor.module.ts`).
 * Esta tela devolve os três para exibição, mas o `PATCH` os ignora mesmo que
 * alguém os envie — a permissão `organizacao.alterar` é da própria
 * organização, não dá para virar porta para editar o próprio contrato.
 */
@Injectable()
export class OrganizacaoService {
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

  async obter(claims: ClaimsUsuario): Promise<Record<string, unknown>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<LinhaOrganizacao>(
        `select o.nome, o.razao_social, o.cnpj_criptografado, o.cor_acento, o.logo_url,
                o.status, p.nome as plano, o.contratado_em, o.expira_em
           from public.organizacoes o
           join public.planos p on p.id = o.id_plano
          where o.id = $1`,
        [claims.idOrganizacao],
      );
      const linha = rows[0];
      if (!linha) throw new Error('Organização não encontrada.');

      return {
        nome: linha.nome,
        razaoSocial: linha.razao_social,
        cnpj: this.criptografia.decifrar(linha.cnpj_criptografado),
        corAcento: linha.cor_acento,
        logoUrl: linha.logo_url,
        status: linha.status,
        plano: linha.plano,
        contratadoEm: linha.contratado_em,
        expiraEm: linha.expira_em,
      };
    });
  }

  async atualizar(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaOrganizacao>,
  ): Promise<Record<string, unknown>> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: antes } = await conexao.query<LinhaOrganizacao>(
        `select nome, razao_social, cnpj_criptografado, cor_acento, logo_url
           from public.organizacoes where id = $1`,
        [claims.idOrganizacao],
      );

      const cnpj = entrada.cnpj !== undefined ? this.criptografia.paraGravacao(entrada.cnpj) : null;

      const { rows } = await conexao.query<{ nome: string }>(
        `update public.organizacoes
            set nome = coalesce($2, nome),
                razao_social = case when $3::boolean then $4 else razao_social end,
                cnpj_criptografado = case when $5::boolean then $6 else cnpj_criptografado end,
                cnpj_hmac = case when $5::boolean then $7 else cnpj_hmac end,
                cor_acento = case when $8::boolean then $9 else cor_acento end,
                logo_url = case when $10::boolean then $11 else logo_url end,
                atualizado_em = now()
          where id = $1
        returning nome`,
        [
          claims.idOrganizacao,
          entrada.nome ?? null,
          entrada.razaoSocial !== undefined,
          entrada.razaoSocial ?? null,
          entrada.cnpj !== undefined,
          cnpj?.criptografado ?? null,
          cnpj?.hmac ?? null,
          entrada.corAcento !== undefined,
          entrada.corAcento ?? null,
          entrada.logoUrl !== undefined,
          entrada.logoUrl ?? null,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'organizacoes',
        idEntidade: claims.idOrganizacao,
        dadosAntes: antes[0],
        dadosDepois: rows[0],
      });

      return this.obter(claims);
    });
  }
}

@Controller('organizacao')
class OrganizacaoController {
  constructor(private readonly organizacao: OrganizacaoService) {}

  @Get()
  @ExigePermissao('organizacao.alterar')
  async obter(@Claims() claims: ClaimsUsuario): Promise<Record<string, unknown>> {
    return this.organizacao.obter(claims);
  }

  @Patch()
  @ExigePermissao('organizacao.alterar', 'CAMPANHA')
  async atualizar(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<Record<string, unknown>> {
    return this.organizacao.atualizar(claims, EntradaOrganizacao.parse(corpo));
  }
}

@Module({
  controllers: [OrganizacaoController],
  providers: [BancoService, AuditoriaService, OrganizacaoService],
})
export class OrganizacaoModule {}
