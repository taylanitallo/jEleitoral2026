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

// --- Forma neutra ------------------------------------------------------------

/*
 * Os mesmos três esquemas, agora independentes de fornecedor.
 *
 * Os `EsquemaJson*` acima descrevem o dialeto da Anthropic e ficam por
 * compatibilidade enquanto houver quem os importe; o que os provedores
 * consomem daqui em diante são estes. Um descritor, dois compiladores — ver
 * `esquemas/dialetos.ts` e o teste que confere as duas saídas.
 */
import { lista, numero, objeto, texto } from './esquemas/neutro.js';
import { TemaProblema } from '@jeleitoral/tipos';

/**
 * Os temas, como tupla, para o enum do esquema.
 *
 * Vem de `TemaProblema` e nao de uma lista repetida aqui: o enum do Postgres, o
 * Zod dos tipos e este esquema tem de mudar juntos, e a unica forma de garantir
 * isso e nao ter uma quarta copia.
 */
const TemaProblemaValores = TemaProblema.options;

export const EsquemaNeutroDiagnostico = objeto({
  pontosFortes: lista(texto()),
  secoesCriticas: lista(
    objeto({
      idReferencia: texto(),
      motivo: texto(),
      gravidade: texto({ enumeracao: ['ALTA', 'MEDIA', 'BAIXA'] }),
    }),
  ),
  ondeInvestirEsforco: lista(texto()),
  riscoDeMetaNaoAtingida: objeto({
    nivel: texto({ enumeracao: ['ALTO', 'MODERADO', 'BAIXO'] }),
    justificativa: texto(),
  }),
});

export const EsquemaNeutroRevisao = objeto({
  textoRevisado: texto(),
  alteracoes: lista(objeto({ trecho: texto(), motivo: texto() })),
});

export const EsquemaNeutroConsulta = objeto(
  {
    consulta: texto({ enumeracao: CONSULTAS_PERMITIDAS }),
    limiarPercentual: numero(),
    limite: numero({ inteiro: true }),
    confianca: numero(),
  },
  // O modelo devolve nulo quando o parâmetro não se aplica à consulta
  // escolhida; o Zod já os tem como opcionais.
  { opcionais: ['limiarPercentual', 'limite'] },
);

// --- Eixos narrativos --------------------------------------------------------

/**
 * Sugestão de linha narrativa a partir do diagnóstico agregado.
 *
 * `temasRelacionados` é o elo que devolve rastreabilidade: o modelo diz de
 * quais temas o eixo saiu, e a tela usa isso para vincular o eixo aos problemas
 * reais. Sem ele a sugestão seria opinião solta, e o valor do módulo é
 * justamente ligar discurso a evidência.
 */
export const EsquemaNeutroEixos = objeto({
  eixos: lista(
    objeto(
      {
        titulo: texto(),
        sintese: texto(),
        publicoAlvo: texto(),
        mensagensChave: lista(texto()),
        provas: lista(texto()),
        riscos: lista(texto()),
        temasRelacionados: lista(texto({ enumeracao: TemaProblemaValores })),
        prioridade: texto({ enumeracao: ['ALTA', 'MEDIA', 'BAIXA'] }),
      },
      { opcionais: ['publicoAlvo'] },
    ),
  ),
});

export const EixosNarrativosSugeridos = z.object({
  eixos: z
    .array(
      z.object({
        titulo: z.string().min(3).max(160),
        sintese: z.string().min(10).max(2000),
        publicoAlvo: z.string().max(200).nullable().optional(),
        mensagensChave: z.array(z.string().max(300)).max(10),
        provas: z.array(z.string().max(300)).max(10),
        riscos: z.array(z.string().max(300)).max(10),
        temasRelacionados: z.array(z.enum(TemaProblemaValores)).max(14),
        prioridade: z.enum(['ALTA', 'MEDIA', 'BAIXA']),
      }),
    )
    // Mais que isso deixa de ser linha narrativa e vira lista de tudo o que a
    // campanha poderia falar — o oposto do que o módulo serve para produzir.
    .max(6),
});
export type EixosNarrativosSugeridos = z.infer<typeof EixosNarrativosSugeridos>;
