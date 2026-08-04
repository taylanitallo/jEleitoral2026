import Anthropic from '@anthropic-ai/sdk';
import { paraAnthropic } from '../esquemas/dialetos.js';
import type { EsforcoIa, PedidoIa, ProvedorIa, RespostaIa } from './provedorIa.js';

const ESFORCO: Record<EsforcoIa, 'low' | 'medium' | 'high'> = {
  baixo: 'low',
  medio: 'medium',
  alto: 'high',
};

/**
 * Adaptador da Anthropic.
 *
 * Concentra tudo o que era formato de fornecedor vazando pelo `IaService`: o
 * tipo `Anthropic.Message`, a leitura de `content[].type === 'text'`, o
 * `stop_reason === 'refusal'` e o formato de `usage`.
 */
export class ProvedorAnthropic implements ProvedorIa {
  readonly nome = 'anthropic' as const;
  readonly modeloPadrao: string;
  private readonly cliente: Anthropic | null;

  constructor(chave: string | undefined, modeloPadrao: string) {
    this.modeloPadrao = modeloPadrao;
    // Sem chave o provedor nasce indisponível em vez de lançar: a API precisa
    // subir mesmo sem IA configurada, e campanha em campo não pode parar por
    // causa de um recurso acessório.
    this.cliente = chave ? new Anthropic({ apiKey: chave }) : null;
  }

  disponivel(): boolean {
    return this.cliente !== null;
  }

  async gerar(pedido: PedidoIa): Promise<RespostaIa> {
    if (!this.cliente) throw new Error('Provedor Anthropic sem chave configurada.');

    /*
     * O bloco de sistema vira array quando se quer cache: `cache_control` é
     * propriedade de bloco, e string simples não tem onde carregá-lo.
     */
    const sistema = pedido.cachearSistema
      ? [
          {
            type: 'text' as const,
            text: pedido.instrucaoSistema,
            cache_control: { type: 'ephemeral' as const },
          },
        ]
      : pedido.instrucaoSistema;

    const resposta = await this.cliente.messages.create({
      model: this.modeloPadrao,
      max_tokens: pedido.maxTokensSaida,
      system: sistema,
      messages: [{ role: 'user', content: pedido.entradaUsuario }],
      ...(pedido.raciocinio ? { thinking: { type: 'adaptive' as const } } : {}),
      output_config: {
        effort: ESFORCO[pedido.esforco],
        format: {
          type: 'json_schema' as const,
          schema: paraAnthropic(pedido.esquemaSaida),
        },
      },
    } as Anthropic.MessageCreateParamsNonStreaming);

    const uso = resposta.usage as unknown as Record<string, number | undefined>;

    return {
      // Primeiro bloco de texto. A resposta pode trazer blocos de raciocínio
      // antes dele, e pegar `content[0]` cegamente devolveria o raciocínio.
      textoJson: resposta.content.find((bloco) => bloco.type === 'text')?.text ?? '',
      uso: {
        entrada: uso['input_tokens'] ?? 0,
        saida: uso['output_tokens'] ?? 0,
        cacheLeitura: uso['cache_read_input_tokens'] ?? 0,
        cacheEscrita: uso['cache_creation_input_tokens'] ?? 0,
        raciocinio: 0,
      },
      // HTTP 200 com recusa: não é erro de transporte, e tratar como tal faria
      // o sistema repetir uma requisição que será recusada de novo.
      recusada: resposta.stop_reason === 'refusal',
      motivoParada: String(resposta.stop_reason ?? ''),
      modeloEfetivo: resposta.model,
    };
  }
}
