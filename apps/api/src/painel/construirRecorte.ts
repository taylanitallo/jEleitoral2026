import type { FiltroGlobal } from '@jeleitoral/tipos';

/**
 * Traduz o filtro global em predicado SQL e parâmetros.
 *
 * Duas regras governam este arquivo:
 *
 *  1. **Nenhum valor entra por interpolação.** Todo dado do usuário vira `$n`.
 *     O texto SQL produzido aqui é montado só a partir de nomes de coluna
 *     escritos no próprio arquivo — nada vindo da requisição toca a string.
 *  2. **`id_organizacao` não aparece.** Poderia aparecer, e não faria mal, mas
 *     a ausência é deliberada: quem lê este código precisa entender que o
 *     isolamento é do PostgreSQL, via RLS, e não deste `WHERE`. Um dia alguém
 *     vai escrever uma consulta nova e esquecer o filtro — e nada vai vazar.
 */

export interface Recorte {
  /** Predicado pronto para concatenar após um `where` já existente. */
  predicado: string;
  parametros: unknown[];
}

/** Colunas disponíveis por alias de tabela, para as consultas do painel. */
export interface MapeamentoColunas {
  idCampanha: string;
  idSecao?: string;
  idBairro?: string;
  idZona?: string;
  idLocalVotacao?: string;
  idMunicipio?: string;
  idEquipe?: string;
  idUsuario?: string;
  dataReferencia?: string;
  idCargo?: string;
  idCandidato?: string;
}

/**
 * Monta o recorte. `parametrosIniciais` permite continuar a numeração de `$n`
 * quando a consulta já tem parâmetros antes do filtro.
 */
export function construirRecorte(
  filtro: Partial<FiltroGlobal>,
  colunas: MapeamentoColunas,
  parametrosIniciais: unknown[] = [],
): Recorte {
  const parametros = [...parametrosIniciais];
  const condicoes: string[] = [];

  const acrescentar = (coluna: string | undefined, valor: unknown): void => {
    if (!coluna || valor === undefined || valor === null || valor === '') return;
    parametros.push(valor);
    condicoes.push(`${coluna} = $${parametros.length}`);
  };

  // A campanha é obrigatória: consulta de painel sem campanha não faz sentido e
  // atravessaria campanhas da mesma organização, que a RLS já barraria — mas
  // exigir aqui produz erro claro em vez de resultado vazio inexplicável.
  if (!filtro.idCampanha) {
    throw new Error('O painel exige uma campanha selecionada.');
  }
  acrescentar(colunas.idCampanha, filtro.idCampanha);

  acrescentar(colunas.idSecao, filtro.idSecao);
  acrescentar(colunas.idBairro, filtro.idBairro);
  acrescentar(colunas.idZona, filtro.idZona);
  acrescentar(colunas.idLocalVotacao, filtro.idLocalVotacao);
  acrescentar(colunas.idMunicipio, filtro.idMunicipio);
  acrescentar(colunas.idEquipe, filtro.idEquipe);
  acrescentar(colunas.idUsuario, filtro.idUsuario);
  acrescentar(colunas.idCargo, filtro.idCargo);
  acrescentar(colunas.idCandidato, filtro.idCandidato);

  if (colunas.dataReferencia && filtro.dataInicio) {
    parametros.push(filtro.dataInicio);
    condicoes.push(`${colunas.dataReferencia} >= $${parametros.length}`);
  }
  if (colunas.dataReferencia && filtro.dataFim) {
    parametros.push(filtro.dataFim);
    // Fim de período é inclusivo para o usuário: quem escolhe "até 20/08"
    // espera ver o dia 20 inteiro, não até a meia-noite dele.
    condicoes.push(`${colunas.dataReferencia} < $${parametros.length}::date + interval '1 day'`);
  }

  return {
    predicado: condicoes.length > 0 ? condicoes.join(' and ') : 'true',
    parametros,
  };
}
