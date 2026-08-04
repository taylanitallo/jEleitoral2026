import { z } from 'zod';

/**
 * Configuração validada na inicialização.
 *
 * Falhar cedo e alto: subir a API com `CHAVE_CRIPTOGRAFIA_AES` ausente
 * significaria gravar CPF em claro sem ninguém perceber até a auditoria. É
 * melhor não subir.
 */
const EsquemaConfiguracao = z.object({
  AMBIENTE: z.enum(['desenvolvimento', 'homologacao', 'producao']).default('desenvolvimento'),
  PORTA_API: z.coerce.number().int().positive().default(3333),
  URL_WEB: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_CHAVE_ANONIMA: z.string().min(20),
  SUPABASE_CHAVE_SERVICO: z.string().min(20),
  // Mantido apenas para projetos Supabase legados que ainda assinam em HS256.
  // Projetos atuais usam ES256 + JWKS, e a verificação não precisa de segredo.
  SUPABASE_JWT_SEGREDO: z.string().optional(),
  BANCO_URL: z.string().min(10),

  // 32 bytes em hexadecimal. AES-256-GCM exige exatamente isso.
  CHAVE_CRIPTOGRAFIA_AES: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CHAVE_CRIPTOGRAFIA_AES deve ter 64 caracteres hexadecimais.'),
  SEGREDO_HMAC_INDICE: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SEGREDO_HMAC_INDICE deve ter 64 caracteres hexadecimais.'),

  REDIS_URL: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  IA_MODELO_PADRAO: z.string().default('claude-sonnet-5'),
  /**
   * Teto mensal de tokens por organização, quando o plano não define o seu.
   *
   * Estava no `.env.exemplo` e **não estava aqui** — como o Zod descarta chave
   * desconhecida sem reclamar, a variável era lida do arquivo e jogada fora em
   * silêncio. Quem a preenchesse teria toda razão em supor que havia limite.
   *
   * Declarar não basta para ela valer: quem consulta o limite antes de chamar o
   * modelo ainda não existe. Ver `ia.service.ts`.
   */
  IA_LIMITE_CREDITOS_MENSAL_PADRAO: z.coerce.number().int().nonnegative().default(100_000),

  INTEGRACOES_USER_AGENT: z.string().default('jEleitoral/1.0 (+https://jeos.com.br)'),
  IBGE_URL_BASE: z.string().url().default('https://servicodados.ibge.gov.br/api/v1/localidades'),
  BRASILAPI_URL_BASE: z.string().url().default('https://brasilapi.com.br/api'),
  VIACEP_URL_BASE: z.string().url().default('https://viacep.com.br/ws'),
  TSE_CKAN_URL_BASE: z.string().url().default('https://dadosabertos.tse.jus.br/api/3/action'),
  DIVULGACAND_URL_BASE: z
    .string()
    .url()
    .default('https://divulgacandcontas.tse.jus.br/divulga/rest/v1'),
  DIVULGACAND_REQ_POR_SEGUNDO: z.coerce.number().positive().default(1),

  APURACAO_AO_VIVO_HABILITADA: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  APURACAO_URL_BASE: z.string().optional(),
  APURACAO_INTERVALO_SEGUNDOS: z.coerce.number().int().positive().default(60),

  SENTRY_DSN_API: z.string().optional(),
  NIVEL_LOG: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Configuracao = z.infer<typeof EsquemaConfiguracao>;

export function carregarConfiguracao(fonte: NodeJS.ProcessEnv = process.env): Configuracao {
  const resultado = EsquemaConfiguracao.safeParse(fonte);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((problema) => `  • ${problema.path.join('.')}: ${problema.message}`)
      .join('\n');
    throw new Error(`Configuração inválida. Corrija o .env:\n${problemas}`);
  }
  return resultado.data;
}
