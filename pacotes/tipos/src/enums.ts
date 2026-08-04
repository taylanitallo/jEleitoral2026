import { z } from 'zod';

/**
 * Enums do domínio. Cada um existe em três formas que precisam permanecer
 * sincronizadas: o `enum` do PostgreSQL (migrations), o esquema Zod aqui, e o
 * rótulo em português exibido na tela. Alterar um sem o outro é a origem mais
 * comum de bug silencioso neste tipo de sistema, então mantemos os três lado a
 * lado, no mesmo arquivo.
 */

// --- Organização e plano ----------------------------------------------------

export const StatusOrganizacao = z.enum(['ATIVA', 'SUSPENSA', 'CANCELADA']);
export type StatusOrganizacao = z.infer<typeof StatusOrganizacao>;

export const RotuloStatusOrganizacao: Record<StatusOrganizacao, string> = {
  ATIVA: 'Ativa',
  SUSPENSA: 'Suspensa',
  CANCELADA: 'Cancelada',
};

// --- Campanha ---------------------------------------------------------------

export const AbrangenciaCampanha = z.enum(['FEDERAL', 'ESTADUAL', 'MUNICIPAL']);
export type AbrangenciaCampanha = z.infer<typeof AbrangenciaCampanha>;

export const RotuloAbrangenciaCampanha: Record<AbrangenciaCampanha, string> = {
  FEDERAL: 'Federal',
  ESTADUAL: 'Estadual',
  MUNICIPAL: 'Municipal',
};

// --- Acesso -----------------------------------------------------------------

/**
 * Perfis-semente. São criados por seed em cada organização e podem ser
 * editados pelo administrador — as permissões são dados, não código. O que
 * está fixo aqui é apenas o conjunto inicial.
 */
export const PerfilPadrao = z.enum([
  'ADMINISTRADOR',
  'COORDENADOR',
  'MOBILIZADOR',
  'ENTREVISTADOR',
  'ANALISTA',
  'FINANCEIRO',
  'CANDIDATO',
]);
export type PerfilPadrao = z.infer<typeof PerfilPadrao>;

export const RotuloPerfilPadrao: Record<PerfilPadrao, string> = {
  ADMINISTRADOR: 'Administrador',
  COORDENADOR: 'Coordenador',
  MOBILIZADOR: 'Mobilizador',
  ENTREVISTADOR: 'Entrevistador',
  ANALISTA: 'Analista',
  FINANCEIRO: 'Financeiro',
  CANDIDATO: 'Candidato',
};

/**
 * Escopo de visibilidade de uma permissão. É o mecanismo que atende ao
 * requisito "nenhum usuário vê o dado do outro": a mesma permissão
 * `entrevistas.ler` significa coisas diferentes conforme o escopo.
 */
export const EscopoPermissao = z.enum(['PROPRIO', 'EQUIPE', 'TERRITORIO', 'CAMPANHA']);
export type EscopoPermissao = z.infer<typeof EscopoPermissao>;

export const RotuloEscopoPermissao: Record<EscopoPermissao, string> = {
  PROPRIO: 'Apenas os próprios registros',
  EQUIPE: 'Registros da equipe',
  TERRITORIO: 'Registros do território designado',
  CAMPANHA: 'Toda a campanha',
};

/** Ordem crescente de abrangência — usada para comparar escopos. */
export const ORDEM_ESCOPO: Record<EscopoPermissao, number> = {
  PROPRIO: 0,
  EQUIPE: 1,
  TERRITORIO: 2,
  CAMPANHA: 3,
};

/**
 * Perfil do backoffice da Jeos. Fica fora da árvore de tenants por decisão de
 * arquitetura (seção 1.1.1): o provedor não é uma organização.
 */
export const PerfilProvedor = z.enum(['SUPORTE_PROVEDOR', 'ADMINISTRADOR_PROVEDOR']);
export type PerfilProvedor = z.infer<typeof PerfilProvedor>;

// --- Território -------------------------------------------------------------

export const OrigemRegistroTerritorial = z.enum(['IBGE', 'CEP', 'TSE', 'CNEFE', 'USUARIO']);
export type OrigemRegistroTerritorial = z.infer<typeof OrigemRegistroTerritorial>;

export const RotuloOrigemRegistroTerritorial: Record<OrigemRegistroTerritorial, string> = {
  IBGE: 'IBGE',
  CEP: 'Base de CEP',
  TSE: 'TSE',
  CNEFE: 'CNEFE / Censo 2022',
  USUARIO: 'Cadastrado em campo',
};

export const TipoLocalidade = z.enum(['POVOADO', 'ASSENTAMENTO', 'SITIO', 'COMUNIDADE', 'RURAL']);
export type TipoLocalidade = z.infer<typeof TipoLocalidade>;

// --- Estrutura eleitoral ----------------------------------------------------

export const TipoVoto = z.enum(['NOMINAL', 'LEGENDA', 'BRANCO', 'NULO', 'ABSTENCAO']);
export type TipoVoto = z.infer<typeof TipoVoto>;

export const RotuloTipoVoto: Record<TipoVoto, string> = {
  NOMINAL: 'Nominal',
  LEGENDA: 'Legenda',
  BRANCO: 'Branco',
  NULO: 'Nulo',
  ABSTENCAO: 'Abstenção',
};

// --- Candidatos -------------------------------------------------------------

export const OrigemCandidato = z.enum(['MANUAL', 'DIVULGACAND', 'DADOS_ABERTOS']);
export type OrigemCandidato = z.infer<typeof OrigemCandidato>;

export const RotuloOrigemCandidato: Record<OrigemCandidato, string> = {
  MANUAL: 'Cadastro manual',
  DIVULGACAND: 'DivulgaCandContas',
  DADOS_ABERTOS: 'TSE Dados Abertos',
};

// --- Mapeamento de campo ----------------------------------------------------

/**
 * Classificação do eleitor. As cores semânticas do design system são fixas
 * para estes valores e sempre acompanhadas de ícone e rótulo — nunca só cor,
 * por acessibilidade.
 */
export const ClassificacaoEleitor = z.enum([
  'APOIADOR',
  'PROVAVEL',
  'INDECISO',
  'OPOSICAO',
  'NAO_INFORMOU',
]);
export type ClassificacaoEleitor = z.infer<typeof ClassificacaoEleitor>;

export const RotuloClassificacaoEleitor: Record<ClassificacaoEleitor, string> = {
  APOIADOR: 'Apoiador',
  PROVAVEL: 'Provável',
  INDECISO: 'Indeciso',
  OPOSICAO: 'Oposição',
  NAO_INFORMOU: 'Não informou',
};

export const StatusEntrevista = z.enum(['RASCUNHO', 'CONCLUIDA', 'VALIDADA', 'INVALIDADA']);
export type StatusEntrevista = z.infer<typeof StatusEntrevista>;

export const RotuloStatusEntrevista: Record<StatusEntrevista, string> = {
  RASCUNHO: 'Rascunho',
  CONCLUIDA: 'Concluída',
  VALIDADA: 'Validada',
  INVALIDADA: 'Invalidada',
};

export const TipoVisita = z.enum(['PRIMEIRA', 'RETORNO', 'ENTREGA_MATERIAL']);
export type TipoVisita = z.infer<typeof TipoVisita>;

export const CanalConsentimento = z.enum(['VERBAL_REGISTRADO', 'ASSINATURA_EM_TELA', 'DIGITAL']);
export type CanalConsentimento = z.infer<typeof CanalConsentimento>;

export const RotuloCanalConsentimento: Record<CanalConsentimento, string> = {
  VERBAL_REGISTRADO: 'Verbal, registrado pelo entrevistador',
  ASSINATURA_EM_TELA: 'Assinatura em tela',
  DIGITAL: 'Aceite digital',
};

/**
 * Natureza do levantamento. Distinção com consequência jurídica direta:
 * pesquisa destinada a conhecimento público exige registro prévio no PesqEle
 * (Lei 9.504/97, art. 33). O padrão é sempre o uso interno.
 */
export const NaturezaLevantamento = z.enum(['LEVANTAMENTO_INTERNO', 'PESQUISA_REGISTRADA']);
export type NaturezaLevantamento = z.infer<typeof NaturezaLevantamento>;

export const RotuloNaturezaLevantamento: Record<NaturezaLevantamento, string> = {
  LEVANTAMENTO_INTERNO: 'Levantamento interno (vedada a divulgação pública)',
  PESQUISA_REGISTRADA: 'Pesquisa registrada no PesqEle',
};

/** Sinalizações do painel de qualidade da coleta (antifraude de campo). */
export const TipoAlertaColeta = z.enum([
  'DURACAO_CURTA',
  'GPS_DISTANTE',
  'VOLUME_IMPROVAVEL',
  'DUPLICIDADE_SUSPEITA',
  'SEM_GEOLOCALIZACAO',
  'FORA_DO_TERRITORIO',
]);
export type TipoAlertaColeta = z.infer<typeof TipoAlertaColeta>;

export const RotuloTipoAlertaColeta: Record<TipoAlertaColeta, string> = {
  DURACAO_CURTA: 'Entrevista curta demais',
  GPS_DISTANTE: 'GPS distante do endereço declarado',
  VOLUME_IMPROVAVEL: 'Volume improvável de entrevistas por hora',
  DUPLICIDADE_SUSPEITA: 'Possível duplicidade de entrevistado',
  SEM_GEOLOCALIZACAO: 'Entrevista sem geolocalização',
  FORA_DO_TERRITORIO: 'Fora do território designado',
};

// --- Metas e projeção -------------------------------------------------------

export const TipoMeta = z.enum(['VOTOS_ABSOLUTOS', 'PERCENTUAL']);
export type TipoMeta = z.infer<typeof TipoMeta>;

/**
 * Níveis de agregação territorial. A ordem importa: o motor de projeção
 * agrega de baixo para cima e o filtro do dashboard desce de cima para baixo.
 */
export const NivelTerritorial = z.enum(['SECAO', 'LOCAL', 'BAIRRO', 'ZONA', 'MUNICIPIO', 'ESTADO']);
export type NivelTerritorial = z.infer<typeof NivelTerritorial>;

export const RotuloNivelTerritorial: Record<NivelTerritorial, string> = {
  SECAO: 'Seção',
  LOCAL: 'Local de votação',
  BAIRRO: 'Bairro',
  ZONA: 'Zona eleitoral',
  MUNICIPIO: 'Município',
  ESTADO: 'Estado',
};

export const ORDEM_NIVEL_TERRITORIAL: Record<NivelTerritorial, number> = {
  SECAO: 0,
  LOCAL: 1,
  BAIRRO: 2,
  ZONA: 3,
  MUNICIPIO: 4,
  ESTADO: 5,
};

export const MetodoProjecao = z.enum([
  'AMOSTRA_DIRETA',
  'HISTORICO_PONDERADO',
  'HIBRIDO',
  'SEM_BASE',
]);
export type MetodoProjecao = z.infer<typeof MetodoProjecao>;

export const RotuloMetodoProjecao: Record<MetodoProjecao, string> = {
  AMOSTRA_DIRETA: 'Amostra direta do mapeamento',
  HISTORICO_PONDERADO: 'Histórico oficial ponderado',
  HIBRIDO: 'Híbrido (amostra + histórico)',
  SEM_BASE: 'Sem base suficiente',
};

// --- Financeiro -------------------------------------------------------------

export const TipoLancamento = z.enum(['RECEITA', 'DESPESA']);
export type TipoLancamento = z.infer<typeof TipoLancamento>;

export const StatusLancamento = z.enum(['PREVISTO', 'CONFIRMADO', 'PAGO', 'CANCELADO']);
export type StatusLancamento = z.infer<typeof StatusLancamento>;

export const FormaPagamento = z.enum([
  'PIX',
  'TRANSFERENCIA',
  'DINHEIRO',
  'CARTAO',
  'BOLETO',
  'CHEQUE',
]);
export type FormaPagamento = z.infer<typeof FormaPagamento>;

// --- Artes gráficas ---------------------------------------------------------

export const TipoMaterialGrafico = z.enum([
  'SANTINHO',
  'ADESIVO',
  'BANNER',
  'CARD_REDE',
  'PANFLETO',
  'BONE',
  'CAMISA',
]);
export type TipoMaterialGrafico = z.infer<typeof TipoMaterialGrafico>;

export const RotuloTipoMaterialGrafico: Record<TipoMaterialGrafico, string> = {
  SANTINHO: 'Santinho',
  ADESIVO: 'Adesivo',
  BANNER: 'Banner',
  CARD_REDE: 'Card para redes sociais',
  PANFLETO: 'Panfleto',
  BONE: 'Boné',
  CAMISA: 'Camisa',
};

// --- Integrações ------------------------------------------------------------

export const FonteIntegracao = z.enum([
  'IBGE_LOCALIDADES',
  'CEP',
  'TSE_DADOS_ABERTOS',
  'DIVULGACAND',
  'RESULTADOS_AO_VIVO',
  'CNEFE',
]);
export type FonteIntegracao = z.infer<typeof FonteIntegracao>;

export const StatusSincronizacao = z.enum([
  'PENDENTE',
  'EM_EXECUCAO',
  'CONCLUIDA',
  'CONCLUIDA_COM_ERROS',
  'FALHOU',
  'CANCELADA',
]);
export type StatusSincronizacao = z.infer<typeof StatusSincronizacao>;

export const RotuloStatusSincronizacao: Record<StatusSincronizacao, string> = {
  PENDENTE: 'Pendente',
  EM_EXECUCAO: 'Em execução',
  CONCLUIDA: 'Concluída',
  CONCLUIDA_COM_ERROS: 'Concluída com erros',
  FALHOU: 'Falhou',
  CANCELADA: 'Cancelada',
};

// --- Auditoria --------------------------------------------------------------

export const AcaoAuditoria = z.enum([
  'LER',
  'CRIAR',
  'ALTERAR',
  'EXCLUIR',
  'EXPORTAR',
  'IMPRIMIR',
  'AUTENTICAR',
  'FALHA_AUTENTICACAO',
  'CONCEDER_ACESSO_SUPORTE',
  'REVOGAR_ACESSO_SUPORTE',
]);
export type AcaoAuditoria = z.infer<typeof AcaoAuditoria>;

export const RotuloAcaoAuditoria: Record<AcaoAuditoria, string> = {
  LER: 'Consultou',
  CRIAR: 'Criou',
  ALTERAR: 'Alterou',
  EXCLUIR: 'Excluiu',
  EXPORTAR: 'Exportou',
  IMPRIMIR: 'Imprimiu',
  AUTENTICAR: 'Autenticou-se',
  FALHA_AUTENTICACAO: 'Falha de autenticação',
  CONCEDER_ACESSO_SUPORTE: 'Concedeu acesso de suporte',
  REVOGAR_ACESSO_SUPORTE: 'Revogou acesso de suporte',
};

// --- Relatórios -------------------------------------------------------------

export const FormatoExportacao = z.enum(['PDF', 'XLSX', 'CSV']);
export type FormatoExportacao = z.infer<typeof FormatoExportacao>;

// --- Mobilização ------------------------------------------------------------

/**
 * Militância sem acesso ao sistema. Espelha `public.papel_ativista` (0020).
 *
 * A distinção entre MULTIPLICADOR e CABO_ELEITORAL não é cosmética: o
 * multiplicador é quem recebe capacitação e repassa a mensagem, e é o público
 * das atividades do tipo CAPACITACAO.
 */
export const PapelAtivista = z.enum([
  'MULTIPLICADOR',
  'LIDERANCA',
  'CABO_ELEITORAL',
  'VOLUNTARIO',
  'APOIADOR',
]);
export type PapelAtivista = z.infer<typeof PapelAtivista>;

export const RotuloPapelAtivista: Record<PapelAtivista, string> = {
  MULTIPLICADOR: 'Multiplicador',
  LIDERANCA: 'Liderança',
  CABO_ELEITORAL: 'Cabo eleitoral',
  VOLUNTARIO: 'Voluntário',
  APOIADOR: 'Apoiador',
};

/** Espelha `public.tipo_comite` (0020). */
export const TipoComite = z.enum(['CENTRAL', 'REGIONAL', 'BAIRRO', 'TEMATICO', 'MOVEL']);
export type TipoComite = z.infer<typeof TipoComite>;

export const RotuloTipoComite: Record<TipoComite, string> = {
  CENTRAL: 'Central',
  REGIONAL: 'Regional',
  BAIRRO: 'De bairro',
  TEMATICO: 'Temático',
  MOVEL: 'Móvel',
};

// --- Agenda -----------------------------------------------------------------

/**
 * Espelha `public.tipo_atividade` (0021).
 *
 * Uma agenda só para cronograma, encontro com candidato, visita de
 * conscientização e capacitação: são todos evento com data, local, responsável
 * e presença. O que muda entre eles cabe em colunas anuláveis.
 */
export const TipoAtividade = z.enum([
  'REUNIAO_EQUIPE',
  'ENCONTRO_CANDIDATO',
  'VISITA_CONSCIENTIZACAO',
  'CAPACITACAO',
  'REUNIAO_COMITE',
  'MUTIRAO',
  'CARREATA',
  'EVENTO_PUBLICO',
  'AGENDA_EXTERNA',
  'OUTRA',
]);
export type TipoAtividade = z.infer<typeof TipoAtividade>;

export const RotuloTipoAtividade: Record<TipoAtividade, string> = {
  REUNIAO_EQUIPE: 'Reunião de equipe',
  ENCONTRO_CANDIDATO: 'Encontro com candidato',
  VISITA_CONSCIENTIZACAO: 'Visita de conscientização',
  CAPACITACAO: 'Capacitação',
  REUNIAO_COMITE: 'Reunião de comitê',
  MUTIRAO: 'Mutirão',
  CARREATA: 'Carreata',
  EVENTO_PUBLICO: 'Evento público',
  AGENDA_EXTERNA: 'Agenda externa',
  OUTRA: 'Outra',
};

export const StatusAtividade = z.enum([
  'PLANEJADA',
  'CONFIRMADA',
  'REALIZADA',
  'CANCELADA',
  'ADIADA',
]);
export type StatusAtividade = z.infer<typeof StatusAtividade>;

export const RotuloStatusAtividade: Record<StatusAtividade, string> = {
  PLANEJADA: 'Planejada',
  CONFIRMADA: 'Confirmada',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
  ADIADA: 'Adiada',
};

export const SituacaoParticipante = z.enum([
  'CONVIDADO',
  'CONFIRMADO',
  'PRESENTE',
  'AUSENTE',
  'JUSTIFICADO',
]);
export type SituacaoParticipante = z.infer<typeof SituacaoParticipante>;

export const RotuloSituacaoParticipante: Record<SituacaoParticipante, string> = {
  CONVIDADO: 'Convidado',
  CONFIRMADO: 'Confirmado',
  PRESENTE: 'Presente',
  AUSENTE: 'Ausente',
  JUSTIFICADO: 'Falta justificada',
};
