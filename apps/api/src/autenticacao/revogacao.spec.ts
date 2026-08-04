import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RevogacaoService } from './revogacao.service.js';
import type { BancoService } from '../banco/banco.service.js';

const ID = '11111111-1111-4111-8111-111111111111';

/** Banco falso que devolve uma marca controlada e conta as consultas. */
function bancoFalso(marca: Date | null | (() => Date | null)) {
  const chamadas = { total: 0 };
  const banco = {
    executarEmTabelasDeReferencia: vi.fn(async (trabalho: (c: unknown) => Promise<unknown>) => {
      chamadas.total += 1;
      const valor = typeof marca === 'function' ? marca() : marca;
      return trabalho({
        query: async () => ({ rows: [{ marca: valor }] }),
      });
    }),
  } as unknown as BancoService;
  return { banco, chamadas };
}

describe('RevogacaoService', () => {
  let servico: RevogacaoService;

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('aceita o token emitido DEPOIS da invalidação', async () => {
    const invalidacao = new Date('2026-08-04T12:00:00Z');
    const { banco } = bancoFalso(invalidacao);
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2026-08-04T12:05:00Z').getTime() / 1000);
    expect(await servico.tokenDesatualizado(ID, iat)).toBe(false);
  });

  it('recusa o token emitido ANTES da invalidação', async () => {
    const invalidacao = new Date('2026-08-04T12:00:00Z');
    const { banco } = bancoFalso(invalidacao);
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2026-08-04T11:30:00Z').getTime() / 1000);
    expect(await servico.tokenDesatualizado(ID, iat)).toBe(true);
  });

  it('compara segundos com milissegundos na unidade certa', async () => {
    /*
     * A regressão mais provável deste arquivo, e a mais destrutiva: `iat` vem em
     * SEGUNDOS (padrão JWT) e a marca do banco em MILISSEGUNDOS. Comparar sem
     * converter faria todo token parecer anterior a 1970 — 401 em toda
     * requisição, para todo usuário, com o sistema parecendo simplesmente
     * quebrado.
     */
    const agora = Date.now();
    const { banco } = bancoFalso(new Date(agora - 60_000));
    servico = new RevogacaoService(banco);

    expect(await servico.tokenDesatualizado(ID, Math.floor(agora / 1000))).toBe(false);
  });

  it('tolera um segundo de arredondamento do iat', async () => {
    /*
     * Sem a tolerância: o token emitido 300 ms depois da invalidação chega com
     * `iat` truncado para o segundo anterior e pareceria velho. O cliente
     * renovaria, receberia outro token igualmente "velho", e o laço só pararia
     * no limite de tentativas — um logout que ninguém pediu.
     */
    const invalidacao = new Date('2026-08-04T12:00:00.700Z');
    const { banco } = bancoFalso(invalidacao);
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2026-08-04T12:00:00.300Z').getTime() / 1000); // 12:00:00
    expect(await servico.tokenDesatualizado(ID, iat)).toBe(false);
  });

  it('token sem iat passa: não é motivo para derrubar sessão', async () => {
    const { banco } = bancoFalso(new Date());
    servico = new RevogacaoService(banco);
    expect(await servico.tokenDesatualizado(ID, undefined)).toBe(false);
  });

  it('usuário fora de public.usuarios (backoffice) não é revogado', async () => {
    const { banco } = bancoFalso(null);
    servico = new RevogacaoService(banco);
    const iat = Math.floor(Date.now() / 1000);
    expect(await servico.tokenDesatualizado(ID, iat)).toBe(false);
  });

  it('banco indisponível NÃO derruba a sessão', async () => {
    /*
     * Escolha deliberada: negar aqui transformaria uma indisponibilidade
     * momentânea do Postgres num logout em massa no meio de um dia de campo. E
     * não há perda real — o RLS é a barreira que decide o que cada um enxerga, e
     * ele também depende do banco.
     */
    const banco = {
      executarEmTabelasDeReferencia: vi.fn(async () => {
        throw new Error('conexão recusada');
      }),
    } as unknown as BancoService;
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2000-01-01T00:00:00Z').getTime() / 1000);
    expect(await servico.tokenDesatualizado(ID, iat)).toBe(false);
  });

  it('usa o cache em vez de consultar o banco a cada requisição', async () => {
    const { banco, chamadas } = bancoFalso(new Date('2026-08-04T12:00:00Z'));
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2026-08-04T12:05:00Z').getTime() / 1000);
    await servico.tokenDesatualizado(ID, iat);
    await servico.tokenDesatualizado(ID, iat);
    await servico.tokenDesatualizado(ID, iat);

    expect(chamadas.total).toBe(1);
  });

  it('esquecer() força a releitura', async () => {
    const { banco, chamadas } = bancoFalso(new Date('2026-08-04T12:00:00Z'));
    servico = new RevogacaoService(banco);

    const iat = Math.floor(new Date('2026-08-04T12:05:00Z').getTime() / 1000);
    await servico.tokenDesatualizado(ID, iat);
    servico.esquecer(ID);
    await servico.tokenDesatualizado(ID, iat);

    expect(chamadas.total).toBe(2);
  });
});
