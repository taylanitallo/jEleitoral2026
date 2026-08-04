/**
 * Contrato de provedor de IA.
 *
 * Existe para o `IaService` não conhecer nenhum tipo de fornecedor. Antes ele
 * era, ao mesmo tempo, o adaptador da Anthropic, o orquestrador das regras de
 * negócio e o contabilizador de custo — e o formato da resposta da Anthropic
 * vazava por quatro pontos da classe (`Anthropic.Message` na assinatura, a
 * leitura de `content[].type`, `stop_reason === 'refusal'` e o formato de
 * `usage`).
 *
 * Com a interface, trocar de provedor deixa de tocar em regra de negócio, e
 * — mais importante — passa a ser possível testar a orquestração com um
 * provedor falso. Hoje `ia.service.ts` não tem nenhum teste, e não tinha como
 * ter: qualquer teste precisaria de rede ou de mocar o SDK inteiro.
 */

export type EsforcoIa = 'baixo' | 'medio' | 'alto';

export interface PedidoIa {
  /** Vai para `usos_ia.funcionalidade`. */
  operacao: string;
  instrucaoSistema: string;
  entradaUsuario: string;
  maxTokensSaida: number;
  esforco: EsforcoIa;
  /** Pede raciocínio estendido quando o provedor suportar. */
  raciocinio: boolean;
  /**
   * Esquema em forma NEUTRA, não o JSON Schema de um fornecedor. Cada adaptador
   * compila para o próprio dialeto — ver `esquemas/dialetos.ts`.
   */
  esquemaSaida: import('../esquemas/neutro.js').EsquemaNeutro;
  /** Dica de cache do bloco de sistema. O adaptador pode ignorar. */
  cachearSistema: boolean;
}

export interface UsoTokens {
  entrada: number;
  saida: number;
  /**
   * Tokens de cache ficavam de fora da conta de custo. O diagnóstico usa cache
   * no bloco de sistema, então não eram zero — eram invisíveis.
   */
  cacheLeitura: number;
  cacheEscrita: number;
  raciocinio: number;
}

export interface RespostaIa {
  /** Texto bruto que deve ser JSON válido conforme o esquema pedido. */
  textoJson: string;
  uso: UsoTokens;
  /**
   * O provedor recusou por política de conteúdo.
   *
   * Não é erro de transporte: a Anthropic devolve HTTP 200 com
   * `stop_reason: 'refusal'` e o Gemini sinaliza por `blockReason` ou
   * `finishReason`. Tratar como falha de rede faria o sistema tentar de novo
   * uma requisição que vai ser recusada de novo.
   */
  recusada: boolean;
  motivoParada: string;
  /** O modelo que de fato respondeu, que pode diferir do pedido. */
  modeloEfetivo: string;
}

export interface ProvedorIa {
  readonly nome: 'anthropic' | 'gemini';
  readonly modeloPadrao: string;
  /** Falso quando falta a chave. O módulo sobe desabilitado em vez de derrubar a API. */
  disponivel(): boolean;
  gerar(pedido: PedidoIa): Promise<RespostaIa>;
}
