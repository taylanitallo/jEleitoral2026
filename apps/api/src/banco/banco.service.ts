import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import type { ClaimsUsuario } from '@jeleitoral/tipos';
import { carregarConfiguracao } from '../comum/configuracao.js';

/**
 * Acesso ao PostgreSQL **sujeito à RLS**.
 *
 * Este é o ponto mais importante da camada de dados, e o mais fácil de errar:
 * o pool conecta com um usuário privilegiado, mas nenhuma consulta de dados de
 * cliente roda com esse privilégio. Toda consulta passa por
 * `executarComoUsuario`, que dentro da transação faz:
 *
 *   set local role authenticated;
 *   set local request.jwt.claims = '<claims do token>';
 *
 * É exatamente o que o PostgREST faz — e é o que faz as políticas do banco
 * valerem. Sem o `set local role`, a conexão seguiria como dono das tabelas e,
 * ainda que `FORCE ROW LEVEL SECURITY` impeça o bypass total, o papel errado
 * quebraria as políticas que dependem do contexto.
 *
 * A chave `service_role` do Supabase **ignora RLS por design** e não é usada
 * aqui em hipótese alguma. Ela existe apenas para o ETL de tabelas de
 * referência (IBGE/TSE), que não têm `id_organizacao`.
 */
@Injectable()
export class BancoService implements OnModuleDestroy {
  private readonly registrador = new Logger(BancoService.name);
  private readonly pool: Pool;
  private readonly segredoHmac: string;

  constructor() {
    const configuracao = carregarConfiguracao();
    this.segredoHmac = configuracao.SEGREDO_HMAC_INDICE;
    this.pool = new Pool({
      connectionString: configuracao.BANCO_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (erro) => {
      this.registrador.error(`Erro no pool de conexões: ${erro.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Executa uma unidade de trabalho no contexto do usuário autenticado.
   *
   * Tudo dentro do callback enxerga apenas o que a RLS permitir para aquele
   * token. O `set local` é revertido no fim da transação automaticamente, então
   * a conexão volta limpa ao pool — vazar contexto entre requisições seria um
   * vazamento entre clientes.
   */
  async executarComoUsuario<T>(
    claims: ClaimsUsuario,
    trabalho: (conexao: PoolClient) => Promise<T>,
  ): Promise<T> {
    const conexao = await this.pool.connect();
    try {
      await conexao.query('begin');
      await conexao.query('set local role authenticated');
      await conexao.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify(this.paraClaimsDoBanco(claims)),
      ]);
      // Necessário para `public.hmac_indice`, que calcula o índice de busca
      // sobre identificadores criptografados.
      await conexao.query('select set_config($1, $2, true)', ['app.segredo_hmac', this.segredoHmac]);

      const resultado = await trabalho(conexao);
      await conexao.query('commit');
      return resultado;
    } catch (erro) {
      await conexao.query('rollback').catch(() => undefined);
      throw erro;
    } finally {
      conexao.release();
    }
  }

  /**
   * Executa fora do contexto de usuário, para tabelas de REFERÊNCIA.
   *
   * Uso permitido: carga de IBGE, TSE e cache de CEP — dado público, sem
   * `id_organizacao`. Passar por aqui com uma tabela multi-tenant é falha de
   * revisão, e o nome longo é proposital: o chamador precisa se justificar.
   */
  async executarEmTabelasDeReferencia<T>(
    trabalho: (conexao: PoolClient) => Promise<T>,
  ): Promise<T> {
    const conexao = await this.pool.connect();
    try {
      return await trabalho(conexao);
    } finally {
      conexao.release();
    }
  }

  /** Conversão dos claims para o formato que as funções SQL esperam. */
  private paraClaimsDoBanco(claims: ClaimsUsuario): Record<string, unknown> {
    return {
      sub: claims.sub,
      email: claims.email,
      id_organizacao: claims.idOrganizacao,
      campanhas: claims.campanhas,
      equipes: claims.equipes,
      territorios: claims.territorios,
      permissoes: claims.permissoes,
    };
  }

  async verificarSaude(): Promise<{ disponivel: boolean; latenciaMs: number }> {
    const inicio = Date.now();
    try {
      await this.pool.query('select 1');
      return { disponivel: true, latenciaMs: Date.now() - inicio };
    } catch {
      return { disponivel: false, latenciaMs: Date.now() - inicio };
    }
  }
}
