import { z } from 'zod';
import {
  CanalConsentimento,
  ClassificacaoEleitor,
  NaturezaLevantamento,
  StatusEntrevista,
} from '../enums';
import { Uuid } from '../comuns';

/** Contratos do mapeamento de campo, compartilhados entre o formulário e a API. */

export const EntradaConsentimento = z.object({
  idVersaoConsentimento: Uuid,
  canal: CanalConsentimento,
  aceitoEm: z.coerce.date().default(() => new Date()),
  evidenciaUrl: z.string().url().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export type EntradaConsentimento = z.infer<typeof EntradaConsentimento>;

export const EntradaIntencaoVoto = z.object({
  idCargo: Uuid,
  idCandidato: Uuid.optional(),
  numeroDeclarado: z.string().max(5).optional(),
  grauCerteza: z.number().int().min(1).max(5).default(3),
  votoDefinido: z.boolean().default(false),
});
export type EntradaIntencaoVoto = z.infer<typeof EntradaIntencaoVoto>;

export const EntradaVotoDomicilio = z.object({
  idCargo: Uuid,
  idCandidato: Uuid.optional(),
  quantidadeDeclarada: z.number().int().min(0).max(30),
});
export type EntradaVotoDomicilio = z.infer<typeof EntradaVotoDomicilio>;

export const EntradaEntrevistado = z.object({
  nome: z.string().trim().min(3, 'Informe o nome do entrevistado.').max(150),
  apelido: z.string().trim().max(60).optional(),
  telefone: z.string().max(20).optional(),
  dataNascimento: z.coerce.date().optional(),
  genero: z.string().max(30).optional(),
  /**
   * CPF e título só chegam preenchidos se o administrador da campanha tiver
   * habilitado a coleta. A API recusa quando estiverem desabilitados — a
   * minimização não pode depender de o formulário estar correto.
   */
  cpf: z.string().max(14).optional(),
  tituloEleitor: z.string().max(15).optional(),
  idSecao: Uuid.optional(),
  classificacao: ClassificacaoEleitor.default('NAO_INFORMOU'),
});
export type EntradaEntrevistado = z.infer<typeof EntradaEntrevistado>;

/**
 * Entrevista completa como o formulário de campo a envia — inclusive pela fila
 * offline, em lote.
 *
 * `idLocalOffline` é gerado no aparelho e é o que garante idempotência: o
 * entrevistador em zona rural reenvia a mesma fila várias vezes até o sinal
 * pegar, e nenhuma dessas tentativas pode duplicar a entrevista.
 */
export const EntradaEntrevista = z.object({
  idLocalOffline: z.string().min(8).max(64).optional(),
  idDomicilio: Uuid,
  idEntrevistado: Uuid.optional(),
  entrevistado: EntradaEntrevistado.optional(),
  consentimento: EntradaConsentimento.optional(),
  natureza: NaturezaLevantamento.default('LEVANTAMENTO_INTERNO'),
  dataHora: z.coerce.date().default(() => new Date()),
  duracaoSegundos: z.number().int().min(0).max(7200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  precisaoGpsMetros: z.number().min(0).optional(),
  dispositivo: z.string().max(120).optional(),
  recusouResponder: z.boolean().default(false),
  observacoes: z.string().max(2000).optional(),
  intencoes: z.array(EntradaIntencaoVoto).default([]),
  votosDomicilio: z.array(EntradaVotoDomicilio).default([]),
  status: StatusEntrevista.default('CONCLUIDA'),
});
export type EntradaEntrevista = z.infer<typeof EntradaEntrevista>;

/** Lote enviado pela fila offline ao recuperar conexão. */
export const LoteSincronizacaoOffline = z.object({
  idCampanha: Uuid,
  entrevistas: z.array(EntradaEntrevista).min(1).max(200),
});
export type LoteSincronizacaoOffline = z.infer<typeof LoteSincronizacaoOffline>;

export const ResultadoItemSincronizacao = z.object({
  idLocalOffline: z.string().nullable(),
  situacao: z.enum(['CRIADA', 'JA_EXISTIA', 'RECUSADA']),
  idEntrevista: Uuid.nullable(),
  motivo: z.string().nullable(),
});
export type ResultadoItemSincronizacao = z.infer<typeof ResultadoItemSincronizacao>;
