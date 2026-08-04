import { GoogleGenAI } from '@google/genai';
import { paraGemini } from '../esquemas/dialetos.js';
import type { EsforcoIa, PedidoIa, ProvedorIa, RespostaIa } from './provedorIa.js';

/**
 * Orçamento de raciocínio por nível de esforço.
 *
 * O Gemini não tem um parâmetro de "esforço"; tem `thinkingBudget` em tokens.
 * `-1` é o dinâmico, em que o modelo decide — o equivalente mais próximo do
 * `adaptive` da Anthropic. Zero desliga.
 */
const ORCAMENTO_RACIOCINIO: Record<EsforcoIa, number> = {
  baixo: 0,
  medio: 8192,
  alto: -1,
};

/** Motivos de parada que significam recusa por política, não falha técnica. */
const MOTIVOS_DE_RECUSA = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST']);

/**
 * Adaptador do Gemini.
 *
 * Duas diferenças de fundo em relação à Anthropic, e é por elas que a
 * abstração existe:
 *
 *  1. **O esquema é outro dialeto.** `paraGemini` cuida disso.
 *  2. **A recusa se anuncia em dois lugares.** Pode vir como `promptFeedback.
 *     blockReason` (a entrada foi barrada antes de gerar) ou como
 *     `finishReason` do candidato (a geração foi interrompida). Olhar só um
 *     dos dois deixa metade das recusas passar por resposta vazia.
 *
 * O cache explícito é ignorado de propósito: no Gemini ele é uma API à parte,
 * com mínimo de tokens e ciclo de vida próprio. Fingir que `cachearSistema`
 * funciona aqui produziria custo errado — melhor não cobrar cache do que
 * cobrar um cache que não existe.
 */
export class ProvedorGemini implements ProvedorIa {
  readonly nome = 'gemini' as const;
  readonly modeloPadrao: string;
  private readonly cliente: GoogleGenAI | null;

  constructor(chave: string | undefined, modeloPadrao: string) {
    this.modeloPadrao = modeloPadrao;
    this.cliente = chave ? new GoogleGenAI({ apiKey: chave }) : null;
  }

  disponivel(): boolean {
    return this.cliente !== null;
  }

  async gerar(pedido: PedidoIa): Promise<RespostaIa> {
    if (!this.cliente) throw new Error('Provedor Gemini sem chave configurada.');

    const resposta = await this.cliente.models.generateContent({
      model: this.modeloPadrao,
      contents: [{ role: 'user', parts: [{ text: pedido.entradaUsuario }] }],
      config: {
        systemInstruction: pedido.instrucaoSistema,
        maxOutputTokens: pedido.maxTokensSaida,
        responseMimeType: 'application/json',
        responseSchema: paraGemini(pedido.esquemaSaida) as never,
        ...(pedido.raciocinio
          ? { thinkingConfig: { thinkingBudget: ORCAMENTO_RACIOCINIO[pedido.esforco] } }
          : {}),
      },
    });

    const bloqueioDeEntrada = resposta.promptFeedback?.blockReason;
    const candidato = resposta.candidates?.[0];
    const motivoParada = String(bloqueioDeEntrada ?? candidato?.finishReason ?? '');

    const uso = resposta.usageMetadata;

    return {
      textoJson: candidato?.content?.parts?.map((parte) => parte.text ?? '').join('') ?? '',
      uso: {
        entrada: uso?.promptTokenCount ?? 0,
        saida: uso?.candidatesTokenCount ?? 0,
        cacheLeitura: uso?.cachedContentTokenCount ?? 0,
        // Sem cache explícito não há escrita a cobrar.
        cacheEscrita: 0,
        raciocinio: uso?.thoughtsTokenCount ?? 0,
      },
      recusada: Boolean(bloqueioDeEntrada) || MOTIVOS_DE_RECUSA.has(motivoParada),
      motivoParada,
      modeloEfetivo: resposta.modelVersion ?? this.modeloPadrao,
    };
  }
}
