import { z } from 'zod';

/**
 * Esquemas de saída estruturada.
 *
 * Cada um existe em duas formas: o **JSON Schema** que vai no
 * `output_config.format` da requisição (é o que restringe a geração do modelo) e
 * o **esquema Zod** que valida a resposta ao chegar. A dupla checagem não é
 * redundância inútil: o JSON Schema garante o formato, o Zod garante que o
 * conteúdo cabe nos limites do nosso domínio.
 *
 * O helper `zodOutputFormat` do SDK faria a ponte automaticamente, mas exige
 * Zod v4 e o monorepo está em v3 — converter a base inteira por causa disto não
 * se justifica. Os esquemas abaixo são escritos à mão e ficam lado a lado com o
 * Zod correspondente, para que divergir seja visível na revisão.
 *
 * Restrições da API a respeitar: todo objeto precisa de `additionalProperties:
 * false` e `required`; `minLength`/`maxLength`/`minimum`/`maximum` **não** são
 * suportados — limites de tamanho vão no prompt e são conferidos pelo Zod.
 */

// --- Diagnóstico estratégico -------------------------------------------------

export const EsquemaJsonDiagnostico = {
  type: 'object',
  properties: {
    pontosFortes: { type: 'array', items: { type: 'string' } },
    secoesCriticas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idReferencia: { type: 'string' },
          motivo: { type: 'string' },
          gravidade: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAIXA'] },
        },
        required: ['idReferencia', 'motivo', 'gravidade'],
        additionalProperties: false,
      },
    },
    ondeInvestirEsforco: { type: 'array', items: { type: 'string' } },
    riscoDeMetaNaoAtingida: {
      type: 'object',
      properties: {
        nivel: { type: 'string', enum: ['ALTO', 'MODERADO', 'BAIXO'] },
        justificativa: { type: 'string' },
      },
      required: ['nivel', 'justificativa'],
      additionalProperties: false,
    },
  },
  required: ['pontosFortes', 'secoesCriticas', 'ondeInvestirEsforco', 'riscoDeMetaNaoAtingida'],
  additionalProperties: false,
} as const;

export const Diagnostico = z.object({
  pontosFortes: z.array(z.string()),
  secoesCriticas: z.array(
    z.object({
      idReferencia: z.string(),
      motivo: z.string(),
      gravidade: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
    }),
  ),
  ondeInvestirEsforco: z.array(z.string()),
  riscoDeMetaNaoAtingida: z.object({
    nivel: z.enum(['ALTO', 'MODERADO', 'BAIXO']),
    justificativa: z.string(),
  }),
});
export type Diagnostico = z.infer<typeof Diagnostico>;

// --- Revisão de texto --------------------------------------------------------

export const EsquemaJsonRevisao = {
  type: 'object',
  properties: {
    textoRevisado: { type: 'string' },
    alteracoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { trecho: { type: 'string' }, motivo: { type: 'string' } },
        required: ['trecho', 'motivo'],
        additionalProperties: false,
      },
    },
  },
  required: ['textoRevisado', 'alteracoes'],
  additionalProperties: false,
} as const;

export const RevisaoTexto = z.object({
  textoRevisado: z.string(),
  alteracoes: z.array(z.object({ trecho: z.string(), motivo: z.string() })),
});
export type RevisaoTexto = z.infer<typeof RevisaoTexto>;

// --- Consulta em linguagem natural ------------------------------------------

/**
 * Lista branca de consultas. O modelo escolhe uma destas — ele **nunca** gera
 * SQL. Deixar um LLM escrever consulta contra um banco que guarda intenção de
 * voto de campanhas adversárias seria indefensável, por melhor que fosse o
 * prompt.
 */
export const CONSULTAS_PERMITIDAS = [
  'secoes_com_baixa_cobertura',
  'ranking_secoes_por_potencial',
  'produtividade_por_entrevistador',
  'classificacao_por_bairro',
  'metas_em_risco',
  'nao_suportada',
] as const;

export const EsquemaJsonConsulta = {
  type: 'object',
  properties: {
    consulta: { type: 'string', enum: [...CONSULTAS_PERMITIDAS] },
    limiarPercentual: { type: 'number' },
    limite: { type: 'integer' },
    confianca: { type: 'number' },
  },
  required: ['consulta', 'confianca'],
  additionalProperties: false,
} as const;

export const InterpretacaoConsulta = z.object({
  consulta: z.enum(CONSULTAS_PERMITIDAS),
  limiarPercentual: z.number().min(0).max(100).optional(),
  limite: z.number().int().min(1).max(200).optional(),
  confianca: z.number().min(0).max(1),
});
export type InterpretacaoConsulta = z.infer<typeof InterpretacaoConsulta>;
