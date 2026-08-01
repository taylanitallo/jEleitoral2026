/**
 * Barreira de dados pessoais na fronteira com a IA.
 *
 * Regra do projeto, sem exceção: **nome, CPF, título, telefone e endereço nunca
 * são enviados ao modelo.** Só agregados e identificadores internos.
 *
 * Esta função é a única porta por onde qualquer payload passa antes de virar
 * prompt. Ela não "tenta limpar" — ela **recusa**: se encontrar um campo
 * proibido ou algo que se pareça com um documento, lança. Sanitizar em silêncio
 * seria pior, porque um campo novo com nome inesperado passaria despercebido e
 * ninguém descobriria até o dado já ter saído.
 *
 * Lógica pura e testada de propósito: é a garantia mais importante do módulo de
 * IA e não pode depender de revisão de código para valer.
 */

export class DadoPessoalNaIaError extends Error {
  constructor(readonly caminho: string, readonly motivo: string) {
    super(`Bloqueado o envio de dado pessoal à IA em "${caminho}": ${motivo}`);
    this.name = 'DadoPessoalNaIaError';
  }
}

/**
 * Nomes de campo proibidos, comparados após normalização (minúsculas, sem
 * separadores). Cobre as variações de escrita que aparecem entre o banco
 * (`nome_completo`), a API (`nomeCompleto`) e o front.
 */
const CAMPOS_PROIBIDOS = new Set([
  'nome',
  'nomecompleto',
  'nomeurna',
  'apelido',
  'cpf',
  'cpfcriptografado',
  'cpfhmac',
  'titulo',
  'tituloeleitor',
  'titulocriptografado',
  'titulohmac',
  'cnpj',
  'telefone',
  'celular',
  'email',
  'endereco',
  'logradouro',
  'complemento',
  'cep',
  'datanascimento',
  'latitude',
  'longitude',
  'evidenciaurl',
  'ip',
  'useragent',
]);

/**
 * Padrões que denunciam documento em campo de texto livre — tipicamente em
 * observações de entrevista, onde o entrevistador digita o que quiser.
 */
const PADROES_DOCUMENTO: Array<{ expressao: RegExp; motivo: string }> = [
  { expressao: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, motivo: 'sequência com formato de CPF' },
  { expressao: /\b\d{4}\s?\d{4}\s?\d{4}\b/, motivo: 'sequência com formato de título de eleitor' },
  { expressao: /\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/, motivo: 'sequência com formato de telefone' },
  { expressao: /\b\d{5}-?\d{3}\b/, motivo: 'sequência com formato de CEP' },
  { expressao: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, motivo: 'endereço de e-mail' },
];

function normalizarChave(chave: string): string {
  return chave.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Verifica um payload recursivamente. Devolve o próprio objeto quando está
 * limpo, para poder ser usado em linha: `enviar(garantirSemDadoPessoal(dados))`.
 */
export function garantirSemDadoPessoal<T>(payload: T, caminho = 'raiz'): T {
  if (payload === null || payload === undefined) return payload;

  if (typeof payload === 'string') {
    for (const padrao of PADROES_DOCUMENTO) {
      if (padrao.expressao.test(payload)) {
        throw new DadoPessoalNaIaError(caminho, padrao.motivo);
      }
    }
    return payload;
  }

  if (typeof payload !== 'object') return payload;

  if (Array.isArray(payload)) {
    payload.forEach((item, indice) => garantirSemDadoPessoal(item, `${caminho}[${indice}]`));
    return payload;
  }

  for (const [chave, valor] of Object.entries(payload as Record<string, unknown>)) {
    if (CAMPOS_PROIBIDOS.has(normalizarChave(chave))) {
      throw new DadoPessoalNaIaError(`${caminho}.${chave}`, 'campo de dado pessoal');
    }
    garantirSemDadoPessoal(valor, `${caminho}.${chave}`);
  }

  return payload;
}

/**
 * Remove de um texto livre os trechos que parecem documento, substituindo por
 * marcador.
 *
 * Usado **apenas** na funcionalidade de resumo de observações qualitativas, em
 * que o texto do entrevistador é o insumo e recusar o lote inteiro por causa de
 * um telefone anotado tornaria o recurso inútil. Nos demais fluxos vale a
 * recusa de `garantirSemDadoPessoal`.
 */
export function mascararDocumentosEmTexto(texto: string): string {
  let resultado = texto;
  for (const padrao of PADROES_DOCUMENTO) {
    resultado = resultado.replace(new RegExp(padrao.expressao, 'g'), '[removido]');
  }
  return resultado;
}

/**
 * Cobertura amostral abaixo da qual o diagnóstico precisa vir com ressalva
 * explícita. Espelha o limiar do motor de projeção — os dois falariam coisas
 * diferentes sobre o mesmo recorte se divergissem.
 */
export const COBERTURA_MINIMA_PARA_DIAGNOSTICO = 0.15;

export function montarAdvertenciaDeCobertura(cobertura: number): string | null {
  if (cobertura >= COBERTURA_MINIMA_PARA_DIAGNOSTICO) return null;
  const percentual = (cobertura * 100).toFixed(1).replace('.', ',');
  return (
    `A base tem apenas ${percentual}% de cobertura do eleitorado deste recorte. ` +
    'Trate as conclusões como hipótese a verificar em campo, não como diagnóstico.'
  );
}
