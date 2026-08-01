import { nivelDoFiltro, type FiltroGlobal, type NivelTerritorial } from '@jeleitoral/tipos';

/**
 * Estado do filtro global, serializado na URL.
 *
 * Vive na barra de endereço, não em memória, por três razões práticas: o
 * coordenador cola o link no grupo e todos veem o mesmo recorte; o botão voltar
 * do navegador desfaz um filtro em vez de sair da tela; e recarregar a página
 * numa rede instável não perde o que já estava selecionado.
 *
 * O requisito "quero saber só a previsão da seção X" se resolve preenchendo
 * `idSecao`: todos os painéis passam a responder sobre aquele recorte, sem tela
 * dedicada.
 */

/** Ordem hierárquica: selecionar um nível limpa os mais específicos abaixo. */
const HIERARQUIA: Array<keyof FiltroGlobal> = [
  'uf',
  'idMunicipio',
  'idZona',
  'idLocalVotacao',
  'idSecao',
];

const CHAVES_SERIALIZAVEIS: Array<keyof FiltroGlobal> = [
  'idCampanha',
  'idCargo',
  'idCandidato',
  'uf',
  'idMunicipio',
  'idZona',
  'idLocalVotacao',
  'idSecao',
  'idBairro',
  'idEquipe',
  'idUsuario',
  'dataInicio',
  'dataFim',
];

/** Campos que não contam como "filtro aplicado" — são o contexto, não o recorte. */
const NAO_CONTABILIZADOS = new Set<keyof FiltroGlobal>(['idCampanha']);

export function paraParametrosUrl(filtro: Partial<FiltroGlobal>): URLSearchParams {
  const parametros = new URLSearchParams();
  for (const chave of CHAVES_SERIALIZAVEIS) {
    const valor = filtro[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    parametros.set(chave, valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor));
  }
  return parametros;
}

export function deParametrosUrl(parametros: URLSearchParams): Partial<FiltroGlobal> {
  const filtro: Record<string, unknown> = {};
  for (const chave of CHAVES_SERIALIZAVEIS) {
    const valor = parametros.get(chave);
    if (valor === null || valor === '') continue;
    if (chave === 'dataInicio' || chave === 'dataFim') {
      const data = new Date(`${valor}T00:00:00`);
      if (!Number.isNaN(data.getTime())) filtro[chave] = data;
      continue;
    }
    if (chave === 'idMunicipio') {
      const numero = Number(valor);
      if (Number.isInteger(numero)) filtro[chave] = numero;
      continue;
    }
    filtro[chave] = valor;
  }
  return filtro as Partial<FiltroGlobal>;
}

/**
 * Aplica uma seleção limpando os níveis mais específicos.
 *
 * Sem isto, trocar de município mantendo a seção anterior produziria um recorte
 * impossível — e o painel mostraria zero sem explicar por quê, que é a pior
 * forma de errar: parece dado, é inconsistência.
 */
export function selecionarNivel(
  filtro: Partial<FiltroGlobal>,
  chave: keyof FiltroGlobal,
  valor: string | number | undefined,
): Partial<FiltroGlobal> {
  const novo: Record<string, unknown> = { ...filtro };

  if (valor === undefined || valor === '') delete novo[chave];
  else novo[chave] = valor;

  const posicao = HIERARQUIA.indexOf(chave);
  if (posicao >= 0) {
    for (const abaixo of HIERARQUIA.slice(posicao + 1)) delete novo[abaixo];
    // Bairro não está na hierarquia oficial do TSE, mas pertence a um
    // município: trocar de município invalida o bairro selecionado.
    if (posicao <= HIERARQUIA.indexOf('idMunicipio')) delete novo['idBairro'];
  }

  return novo as Partial<FiltroGlobal>;
}

export function limparFiltro(filtro: Partial<FiltroGlobal>): Partial<FiltroGlobal> {
  return filtro.idCampanha ? { idCampanha: filtro.idCampanha } : {};
}

export function contarFiltrosAtivos(filtro: Partial<FiltroGlobal>): number {
  return CHAVES_SERIALIZAVEIS.filter(
    (chave) =>
      !NAO_CONTABILIZADOS.has(chave) &&
      filtro[chave] !== undefined &&
      filtro[chave] !== null &&
      filtro[chave] !== '',
  ).length;
}

export function nivelAtual(filtro: Partial<FiltroGlobal>): NivelTerritorial | null {
  return nivelDoFiltro(filtro as FiltroGlobal);
}

/**
 * Descrição do recorte por extenso, para o cabeçalho do PDF e para a aba de
 * metadados do Excel. Exportação sem os filtros escritos por extenso é uma
 * planilha que ninguém consegue auditar três meses depois.
 */
export function descreverFiltro(
  filtro: Partial<FiltroGlobal>,
  rotulos: Partial<Record<keyof FiltroGlobal, string>> = {},
): string {
  const partes: string[] = [];
  const nomes: Partial<Record<keyof FiltroGlobal, string>> = {
    idCargo: 'Cargo',
    idCandidato: 'Candidato',
    uf: 'UF',
    idMunicipio: 'Município',
    idZona: 'Zona',
    idLocalVotacao: 'Local de votação',
    idSecao: 'Seção',
    idBairro: 'Bairro',
    idEquipe: 'Equipe',
    idUsuario: 'Entrevistador',
  };

  for (const [chave, nome] of Object.entries(nomes) as Array<[keyof FiltroGlobal, string]>) {
    const valor = filtro[chave];
    if (valor === undefined || valor === null || valor === '') continue;
    partes.push(`${nome}: ${rotulos[chave] ?? String(valor)}`);
  }

  if (filtro.dataInicio || filtro.dataFim) {
    const inicio = filtro.dataInicio?.toLocaleDateString('pt-BR') ?? 'início';
    const fim = filtro.dataFim?.toLocaleDateString('pt-BR') ?? 'hoje';
    partes.push(`Período: ${inicio} a ${fim}`);
  }

  return partes.length > 0 ? partes.join(' · ') : 'Sem filtros — toda a campanha';
}
