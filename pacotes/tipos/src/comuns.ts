import { z } from 'zod';
import { EscopoPermissao as EscopoPermissaoClaim, NivelTerritorial } from './enums';

/** Contratos compartilhados entre API e web. Fonte única da verdade. */

export const Uuid = z.string().uuid('Identificador inválido.');
export type Uuid = z.infer<typeof Uuid>;

/** Sigla de UF em maiúsculas. */
export const SiglaUf = z
  .string()
  .length(2, 'A UF deve ter 2 letras.')
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{2}$/.test(v), 'UF inválida.');

// --- Paginação --------------------------------------------------------------

export const LIMITE_PAGINA_PADRAO = 50;
export const LIMITE_PAGINA_MAXIMO = 200;

export const ParametrosPaginacao = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(LIMITE_PAGINA_MAXIMO).default(LIMITE_PAGINA_PADRAO),
  ordenarPor: z.string().optional(),
  ordem: z.enum(['asc', 'desc']).default('asc'),
});
export type ParametrosPaginacao = z.infer<typeof ParametrosPaginacao>;

export interface PaginaDe<T> {
  itens: T[];
  pagina: number;
  limite: number;
  total: number;
  totalPaginas: number;
}

export function montarPagina<T>(
  itens: T[],
  total: number,
  parametros: ParametrosPaginacao,
): PaginaDe<T> {
  return {
    itens,
    pagina: parametros.pagina,
    limite: parametros.limite,
    total,
    totalPaginas: Math.max(1, Math.ceil(total / parametros.limite)),
  };
}

// --- Erro padronizado -------------------------------------------------------

/**
 * Envelope de erro da API. Mensagem sempre em português e endereçada ao
 * usuário final — o detalhe técnico vai para o log, não para a tela.
 */
export const ErroApi = z.object({
  codigo: z.string(),
  mensagem: z.string(),
  detalhes: z.record(z.string(), z.array(z.string())).optional(),
  idCorrelacao: z.string().optional(),
});
export type ErroApi = z.infer<typeof ErroApi>;

// --- Contexto de autenticação ----------------------------------------------

/**
 * Claims que a API lê do JWT. `idOrganizacao` **nunca** vem do corpo da
 * requisição nem de query string: se viesse, o cliente poderia se declarar de
 * outra organização. Vem do token, que é assinado pelo Supabase Auth, e é o
 * mesmo valor que as políticas RLS leem dentro do PostgreSQL.
 */
export const ClaimsUsuario = z.object({
  sub: Uuid,
  email: z.string().email(),
  idOrganizacao: Uuid,
  idPerfil: Uuid,
  perfil: z.string(),
  campanhas: z.array(Uuid).default([]),
  equipes: z.array(Uuid).default([]),
  territorios: z.array(Uuid).default([]),
  /**
   * Mapa chave-de-permissão → escopo, montado pelo Custom Access Token Hook a
   * partir de `perfil_permissoes`. As políticas RLS leem daqui, e não de uma
   * consulta a tabela: com `FORCE ROW LEVEL SECURITY`, uma função chamada de
   * dentro de uma política que consultasse `usuarios` entraria em recursão.
   *
   * Efeito colateral a conhecer: mudança de permissão só vale no próximo token.
   * O serviço de perfis revoga a sessão ao salvar, para tornar o efeito imediato.
   */
  permissoes: z.record(z.string(), EscopoPermissaoClaim).default({}),
  mfaVerificado: z.boolean().default(false),
});
export type ClaimsUsuario = z.infer<typeof ClaimsUsuario>;

/** Claims do backoffice da Jeos — não possuem `idOrganizacao`. */
export const ClaimsProvedor = z.object({
  sub: Uuid,
  email: z.string().email(),
  perfilProvedor: z.enum(['SUPORTE_PROVEDOR', 'ADMINISTRADOR_PROVEDOR']),
  mfaVerificado: z.boolean().default(false),
});
export type ClaimsProvedor = z.infer<typeof ClaimsProvedor>;

// --- Filtro global do dashboard --------------------------------------------

/**
 * Filtro único que atravessa todos os painéis. O requisito "quero saber só a
 * previsão da seção X" se resolve preenchendo `idSecao`: todos os painéis
 * passam a responder sobre aquele recorte, sem tela dedicada.
 */
export const FiltroGlobal = z.object({
  idCampanha: Uuid,
  idCargo: Uuid.optional(),
  idCandidato: Uuid.optional(),
  uf: SiglaUf.optional(),
  idMunicipio: z.coerce.number().int().optional(),
  idZona: Uuid.optional(),
  idLocalVotacao: Uuid.optional(),
  idSecao: Uuid.optional(),
  idBairro: Uuid.optional(),
  idEquipe: Uuid.optional(),
  idUsuario: Uuid.optional(),
  dataInicio: z.coerce.date().optional(),
  dataFim: z.coerce.date().optional(),
});
export type FiltroGlobal = z.infer<typeof FiltroGlobal>;

/**
 * Nível mais específico presente no filtro. Determina a granularidade do
 * cálculo e o texto do cabeçalho dos relatórios exportados.
 */
export function nivelDoFiltro(filtro: FiltroGlobal): NivelTerritorial | null {
  if (filtro.idSecao) return 'SECAO';
  if (filtro.idLocalVotacao) return 'LOCAL';
  if (filtro.idBairro) return 'BAIRRO';
  if (filtro.idZona) return 'ZONA';
  if (filtro.idMunicipio) return 'MUNICIPIO';
  if (filtro.uf) return 'ESTADO';
  return null;
}

// --- Coordenadas ------------------------------------------------------------

export const Coordenada = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  precisaoMetros: z.number().nonnegative().optional(),
});
export type Coordenada = z.infer<typeof Coordenada>;

/**
 * Distância em metros pela fórmula de Haversine. Usada pelo antifraude de
 * campo para comparar o GPS da entrevista com o endereço declarado.
 */
export function distanciaEmMetros(a: Coordenada, b: Coordenada): number {
  const RAIO_TERRA_METROS = 6_371_000;
  const emRadianos = (graus: number): number => (graus * Math.PI) / 180;
  const deltaLat = emRadianos(b.latitude - a.latitude);
  const deltaLon = emRadianos(b.longitude - a.longitude);
  const termo =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(emRadianos(a.latitude)) *
      Math.cos(emRadianos(b.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * RAIO_TERRA_METROS * Math.asin(Math.min(1, Math.sqrt(termo)));
}

// --- Integrações ------------------------------------------------------------

export const ParametrosSincronizacao = z.object({
  uf: SiglaUf.optional(),
  idMunicipio: z.coerce.number().int().optional(),
  ano: z.coerce.number().int().min(1994).max(2100).optional(),
  turno: z.coerce.number().int().min(1).max(2).optional(),
  forcarRecarga: z.boolean().default(false),
});
export type ParametrosSincronizacao = z.infer<typeof ParametrosSincronizacao>;

export interface ResultadoSincronizacao {
  fonte: string;
  sucesso: boolean;
  registrosProcessados: number;
  registrosInseridos: number;
  registrosAtualizados: number;
  registrosIgnorados: number;
  erros: string[];
  iniciadoEm: Date;
  finalizadoEm: Date;
}

/**
 * Contrato único dos conectores externos. Qualquer fonte nova (IBGE, TSE,
 * CEP, CNEFE) implementa esta interface e nada mais precisa mudar no
 * agendador nem na tela de sincronização.
 */
export interface ConectorExterno {
  readonly identificador: string;
  sincronizar(parametros: ParametrosSincronizacao): Promise<ResultadoSincronizacao>;
  verificarDisponibilidade(): Promise<boolean>;
}
