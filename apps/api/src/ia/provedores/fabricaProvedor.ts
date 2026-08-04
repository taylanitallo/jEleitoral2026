import { ProvedorAnthropic } from './provedorAnthropic.js';
import { ProvedorGemini } from './provedorGemini.js';
import type { ProvedorIa } from './provedorIa.js';

/**
 * Modelo padrão de cada provedor, quando `IA_MODELO_PADRAO` não é informado.
 *
 * Ficam aqui e não em `configuracao.ts` porque são conhecimento do adaptador:
 * um valor só não serve para os dois, e um default global obrigaria a trocar a
 * variável de ambiente junto com o provedor — que é exatamente o passo que
 * alguém esquece.
 */
const MODELO_PADRAO: Record<'anthropic' | 'gemini', string> = {
  anthropic: 'claude-sonnet-5',
  gemini: 'gemini-2.5-pro',
};

export interface ConfiguracaoProvedor {
  provedor: 'anthropic' | 'gemini';
  chaveAnthropic?: string | undefined;
  chaveGemini?: string | undefined;
  modeloPadrao?: string | undefined;
}

/**
 * Constrói o provedor indicado pela configuração.
 *
 * Nunca lança por falta de chave: devolve um provedor com `disponivel()` falso,
 * e quem chama recusa a operação com mensagem clara. A API sobe com a IA
 * desligada em vez de não subir — o resto do sistema não depende dela.
 */
export function criarProvedor(configuracao: ConfiguracaoProvedor): ProvedorIa {
  const modelo = configuracao.modeloPadrao || MODELO_PADRAO[configuracao.provedor];

  return configuracao.provedor === 'gemini'
    ? new ProvedorGemini(configuracao.chaveGemini, modelo)
    : new ProvedorAnthropic(configuracao.chaveAnthropic, modelo);
}
