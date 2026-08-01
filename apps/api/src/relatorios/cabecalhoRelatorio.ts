import type { NaturezaLevantamento } from '@jeleitoral/tipos';

/**
 * Cabeçalho, tarja e marca d'água dos relatórios exportados.
 *
 * Lógica pura, e é aqui que mora a conformidade da exportação:
 *
 *  • **Tarja de uso interno** — pesquisa destinada ao conhecimento público
 *    exige registro prévio no PesqEle (Lei 9.504/97, art. 33). Um levantamento
 *    interno divulgado sem registro sujeita a multa, e o TSE já penalizou quem
 *    apenas replicou pesquisa não registrada. A tarja é obrigatória e sai do
 *    tipo de retorno, não da lembrança de quem programa a tela.
 *  • **Marca d'água pessoal** — nome, CPF parcial e data/hora do operador em
 *    todo PDF. Não impede o vazamento; torna rastreável quem exportou.
 *  • **Filtros por extenso** — sem eles, uma planilha exportada é impossível de
 *    auditar três meses depois.
 */

export interface ContextoExportacao {
  nomeCampanha: string;
  natureza: NaturezaLevantamento;
  operador: { nome: string; cpfParcial: string | null };
  filtros: Array<{ rotulo: string; valor: string }>;
  quantidadeRegistros: number;
  geradoEm: Date;
  /** Preenchido quando `natureza` é PESQUISA_REGISTRADA. */
  registroPesqEle?: {
    numero: string;
    contratante: string;
    metodologia: string;
    margemErro: number;
    intervaloConfianca: number;
  } | null;
}

export interface CabecalhoRelatorio {
  titulo: string;
  subtitulo: string;
  linhasDeFiltro: string[];
  /** `null` quando a natureza é PESQUISA_REGISTRADA. */
  tarja: string | null;
  marcaDagua: string;
  rodape: string[];
}

export const TARJA_USO_INTERNO = 'USO INTERNO — VEDADA A DIVULGAÇÃO PÚBLICA';

const FORMATO_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function montarCabecalho(
  titulo: string,
  contexto: ContextoExportacao,
): CabecalhoRelatorio {
  const momento = FORMATO_DATA_HORA.format(contexto.geradoEm);

  const linhasDeFiltro =
    contexto.filtros.length > 0
      ? contexto.filtros.map((filtro) => `${filtro.rotulo}: ${filtro.valor}`)
      : ['Sem filtros — toda a campanha'];

  const rodape: string[] = [
    `Gerado em ${momento} por ${contexto.operador.nome}`,
    `${contexto.quantidadeRegistros.toLocaleString('pt-BR')} registro(s)`,
  ];

  if (contexto.natureza === 'PESQUISA_REGISTRADA' && contexto.registroPesqEle) {
    const registro = contexto.registroPesqEle;
    rodape.push(
      `Registro PesqEle nº ${registro.numero} · Contratante: ${registro.contratante}`,
      `${registro.metodologia} · Margem de erro ${registro.margemErro.toLocaleString('pt-BR')} p.p. · ` +
        `Intervalo de confiança ${registro.intervaloConfianca.toLocaleString('pt-BR')}%`,
    );
  } else {
    rodape.push(
      'Este documento não substitui assessoria jurídica eleitoral nem prestação de contas oficial.',
    );
  }

  return {
    titulo,
    subtitulo: contexto.nomeCampanha,
    linhasDeFiltro,
    // A tarja some **apenas** quando há registro no PesqEle. Marcar como
    // pesquisa registrada sem informar o número não remove a tarja: seria
    // exatamente a brecha que ela existe para fechar.
    tarja:
      contexto.natureza === 'PESQUISA_REGISTRADA' && contexto.registroPesqEle
        ? null
        : TARJA_USO_INTERNO,
    marcaDagua: montarMarcaDagua(contexto.operador, contexto.geradoEm),
    rodape,
  };
}

/**
 * Marca d'água pessoal: nome, CPF parcial e momento da exportação.
 *
 * Quando o CPF não foi coletado (é opcional por minimização), a marca sai só
 * com nome e horário — ainda identifica quem exportou, que é o objetivo.
 */
export function montarMarcaDagua(
  operador: { nome: string; cpfParcial: string | null },
  geradoEm: Date,
): string {
  const partes = [operador.nome];
  if (operador.cpfParcial) partes.push(operador.cpfParcial);
  partes.push(FORMATO_DATA_HORA.format(geradoEm));
  return partes.join(' · ');
}

/**
 * Acima deste volume a exportação vai para fila assíncrona: gerar 80 mil linhas
 * dentro da requisição HTTP estoura o tempo limite do proxy e deixa o
 * coordenador olhando para uma tela travada.
 */
export const LIMITE_EXPORTACAO_SINCRONA = 5000;

export function exigeProcessamentoAssincrono(quantidadeRegistros: number): boolean {
  return quantidadeRegistros > LIMITE_EXPORTACAO_SINCRONA;
}
