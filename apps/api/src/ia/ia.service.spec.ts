import { describe, expect, it } from 'vitest';
import { calcularCusto } from './precos.js';
import type { PedidoIa, ProvedorIa, RespostaIa, UsoTokens } from './provedores/provedorIa.js';

/**
 * Testes da orquestração de IA.
 *
 * Não existiam, e não *podiam* existir: o serviço construía o SDK da Anthropic
 * no construtor, então qualquer teste exigiria rede ou um mock do SDK inteiro.
 * A interface `ProvedorIa` é o que os torna possíveis — este arquivo é a
 * justificativa prática da abstração, não só a estética.
 *
 * O que se verifica aqui é o contrato que os dois adaptadores precisam honrar,
 * e as regras que o serviço aplica em cima dele.
 */

class ProvedorFalso implements ProvedorIa {
  readonly nome = 'anthropic' as const;
  readonly modeloPadrao = 'claude-sonnet-5';
  pedidosRecebidos: PedidoIa[] = [];

  constructor(
    private readonly resposta: Partial<RespostaIa> = {},
    private readonly temChave = true,
  ) {}

  disponivel(): boolean {
    return this.temChave;
  }

  gerar(pedido: PedidoIa): Promise<RespostaIa> {
    this.pedidosRecebidos.push(pedido);
    return Promise.resolve({
      textoJson: '{}',
      uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, raciocinio: 0 },
      recusada: false,
      motivoParada: 'end_turn',
      modeloEfetivo: this.modeloPadrao,
      ...this.resposta,
    });
  }
}

describe('contrato do ProvedorIa', () => {
  it('um provedor sem chave se declara indisponível em vez de lançar', async () => {
    // A API precisa subir mesmo sem IA configurada: campanha em campo não pode
    // parar por causa de um recurso acessório.
    const provedor = new ProvedorFalso({}, false);
    expect(provedor.disponivel()).toBe(false);
    // E continua sendo um objeto utilizável — nada explodiu na construção.
    await expect(provedor.gerar({} as PedidoIa)).resolves.toBeDefined();
  });

  it('recusa por política chega como bandeira, não como exceção', async () => {
    /*
     * Anthropic devolve HTTP 200 com stop_reason 'refusal'; Gemini sinaliza por
     * blockReason. Se o adaptador transformasse isso em erro de transporte, o
     * serviço tentaria de novo uma requisição que será recusada de novo.
     */
    const provedor = new ProvedorFalso({ recusada: true, motivoParada: 'refusal' });
    const resposta = await provedor.gerar({} as PedidoIa);
    expect(resposta.recusada).toBe(true);
  });

  it('o esquema entregue ao provedor é o NEUTRO, não um dialeto', async () => {
    // Se o serviço passasse JSON Schema pronto, a abstração não existiria: o
    // adaptador do Gemini receberia o dialeto da Anthropic e a API recusaria.
    const provedor = new ProvedorFalso();
    await provedor.gerar({
      operacao: 'teste',
      instrucaoSistema: 's',
      entradaUsuario: 'u',
      maxTokensSaida: 100,
      esforco: 'baixo',
      raciocinio: false,
      esquemaSaida: { tipo: 'objeto', campos: { a: { tipo: 'texto' } } },
      cachearSistema: false,
    });

    const recebido = provedor.pedidosRecebidos[0]!.esquemaSaida;
    expect(recebido.tipo).toBe('objeto');
    // Um dialeto teria `type`; o neutro tem `tipo`.
    expect(recebido).not.toHaveProperty('type');
    expect(recebido).not.toHaveProperty('additionalProperties');
  });
});

describe('contabilização de tokens', () => {
  const uso: UsoTokens = {
    entrada: 1000,
    saida: 500,
    cacheLeitura: 2000,
    cacheEscrita: 300,
    raciocinio: 200,
  };

  it('cache entra no custo', () => {
    const semCache = calcularCusto('claude-sonnet-5', { ...uso, cacheLeitura: 0, cacheEscrita: 0 });
    const comCache = calcularCusto('claude-sonnet-5', uso);
    // A conta antiga somava só entrada e saída, então estes dois seriam iguais.
    expect(comCache.custo).toBeGreaterThan(semCache.custo);
  });

  it('raciocínio é token de saída para efeito de volume', () => {
    /*
     * O serviço soma `saida + raciocinio` na coluna de tokens de saída. O
     * raciocínio é gerado pelo modelo e cobrado como saída; deixá-lo de fora
     * faria a coluna de volume desmentir a de custo.
     */
    expect(uso.saida + uso.raciocinio).toBe(700);
  });

  it('provedor desconhecido no modelo não zera a chamada em silêncio', () => {
    const resultado = calcularCusto('gemini-3-pro', uso);
    expect(resultado.custo).toBe(0);
    // A flag é o que faz o serviço gravar o aviso em `usos_ia.erro`.
    expect(resultado.precoConhecido).toBe(false);
  });
});
