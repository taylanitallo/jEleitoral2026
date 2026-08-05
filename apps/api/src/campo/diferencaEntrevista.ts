/**
 * Diferença legível entre duas versões de uma entrevista.
 *
 * Lógica pura, sem banco — mesmo padrão de `motorProjecao.ts` e
 * `calculoMetas.ts`: a regra que decide o que aparece no histórico precisa
 * ser testável sem um Postgres de pé.
 *
 * Compara por CAMPO, não por linha bruta de `intencoes_voto`: o coordenador
 * que abre o histórico quer ler "Senador (2º voto): João (123) → Maria
 * (456)", não duas linhas de tabela com UUID.
 */

export interface IntencaoComparavel {
  idCargo: string;
  nomeCargo: string;
  /** 1-based. É o que rotula "1º voto" / "2º voto" no Senado. */
  posicao: number;
  /** Já pronto para exibição: "João (123)", "Branco", "133 (não cadastrado)". */
  rotulo: string;
}

export interface EntrevistaComparavel {
  nomeEntrevistado: string;
  classificacao: string;
  recusouResponder: boolean;
  observacoes: string | null;
  intencoes: readonly IntencaoComparavel[];
}

export interface CampoAlterado {
  campo: string;
  rotulo: string;
  antes: string | null;
  depois: string | null;
  natureza: 'IDENTIFICACAO' | 'INTENCAO' | 'CLASSIFICACAO' | 'OBSERVACAO' | 'CONTEXTO';
}

/** Chave estável de uma intenção entre versões: o slot, não o valor. */
function chaveIntencao(intencao: IntencaoComparavel): string {
  return `${intencao.idCargo}:${intencao.posicao}`;
}

function rotuloDoSlot(intencao: IntencaoComparavel): string {
  return intencao.posicao > 1
    ? `${intencao.nomeCargo} (${intencao.posicao}º voto)`
    : intencao.nomeCargo;
}

/**
 * Compara duas versões e devolve só o que mudou.
 *
 * Ordem de saída: identificação e classificação primeiro (o que mais chama
 * atenção num erro de digitação), intenções depois (na ordem em que apareciam
 * na versão mais recente), observações por último.
 */
export function diferencaEntreVersoes(
  anterior: EntrevistaComparavel,
  atual: EntrevistaComparavel,
): CampoAlterado[] {
  const mudancas: CampoAlterado[] = [];

  if (anterior.nomeEntrevistado !== atual.nomeEntrevistado) {
    mudancas.push({
      campo: 'nomeEntrevistado',
      rotulo: 'Nome',
      antes: anterior.nomeEntrevistado,
      depois: atual.nomeEntrevistado,
      natureza: 'IDENTIFICACAO',
    });
  }

  if (anterior.classificacao !== atual.classificacao) {
    mudancas.push({
      campo: 'classificacao',
      rotulo: 'Classificação',
      antes: anterior.classificacao,
      depois: atual.classificacao,
      natureza: 'CLASSIFICACAO',
    });
  }

  if (anterior.recusouResponder !== atual.recusouResponder) {
    mudancas.push({
      campo: 'recusouResponder',
      rotulo: 'Recusou responder',
      antes: anterior.recusouResponder ? 'Sim' : 'Não',
      depois: atual.recusouResponder ? 'Sim' : 'Não',
      natureza: 'CONTEXTO',
    });
  }

  const antesPorSlot = new Map(anterior.intencoes.map((i) => [chaveIntencao(i), i]));
  const depoisPorSlot = new Map(atual.intencoes.map((i) => [chaveIntencao(i), i]));
  const todasAsChaves = new Set([...antesPorSlot.keys(), ...depoisPorSlot.keys()]);

  // Ordenado pela posição de exibição da versão atual (ou, se o slot só
  // existia antes, pela posição de quando existia) — evita que a ordem das
  // chaves do Map (inserção) produza uma lista que parece aleatória.
  const chavesOrdenadas = [...todasAsChaves].sort((a, b) => {
    const pa = depoisPorSlot.get(a)?.posicao ?? antesPorSlot.get(a)!.posicao;
    const pb = depoisPorSlot.get(b)?.posicao ?? antesPorSlot.get(b)!.posicao;
    return pa - pb;
  });

  for (const chave of chavesOrdenadas) {
    const antes = antesPorSlot.get(chave);
    const depois = depoisPorSlot.get(chave);

    if (antes && depois && antes.rotulo === depois.rotulo) continue;

    const referencia = depois ?? antes!;
    mudancas.push({
      campo: `intencao:${chave}`,
      rotulo: rotuloDoSlot(referencia),
      antes: antes?.rotulo ?? null,
      depois: depois?.rotulo ?? null,
      natureza: 'INTENCAO',
    });
  }

  const antesObs = anterior.observacoes?.trim() || null;
  const depoisObs = atual.observacoes?.trim() || null;
  if (antesObs !== depoisObs) {
    mudancas.push({
      campo: 'observacoes',
      rotulo: 'Observações',
      antes: antesObs,
      depois: depoisObs,
      natureza: 'OBSERVACAO',
    });
  }

  return mudancas;
}
