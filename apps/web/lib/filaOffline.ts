import type { EntradaEntrevista, ResultadoItemSincronizacao } from '@jeleitoral/tipos';

/**
 * Fila offline do formulário de campo.
 *
 * Em zona rural o entrevistador fica sem sinal — não às vezes, com frequência.
 * Perder uma entrevista já preenchida é perder trabalho que não se refaz: a
 * pessoa não vai abrir a porta de novo. Por isso a entrevista é gravada no
 * IndexedDB **antes** de qualquer tentativa de envio, e só sai de lá quando o
 * servidor confirmar.
 *
 * Decisões que sustentam isso:
 *
 *  • `idLocalOffline` é gerado no aparelho e é a chave de idempotência. O envio
 *    pode se repetir à vontade; o servidor reconhece e responde `JA_EXISTIA`.
 *  • Item recusado pelo servidor (`RECUSADA`) **não é apagado**. Vai para o
 *    estado `ATENCAO` e continua visível ao entrevistador para correção.
 *    Descartar silenciosamente seria a pior falha possível deste módulo.
 *  • Sem limite de tentativas por tempo: só o backoff. Um dia inteiro sem sinal
 *    é cenário normal, não erro.
 */

const NOME_BANCO = 'jeleitoral';
/*
 * Versão 2: acrescenta o depósito `contextoCampo` (cache de cargos e
 * candidatos para o formulário funcionar sem rede).
 *
 * NÃO tocar em `filaEntrevistas` neste upgrade. O IndexedDB preserva
 * depósitos existentes ao subir de versão — mexer nele arriscaria coleta
 * ainda não sincronizada de aparelhos que atualizarem o app em campo.
 */
const VERSAO_BANCO = 2;
const DEPOSITO = 'filaEntrevistas';
const DEPOSITO_CONTEXTO = 'contextoCampo';

export type SituacaoItemFila = 'PENDENTE' | 'ENVIANDO' | 'ENVIADA' | 'ATENCAO';

export interface ItemFila {
  idLocalOffline: string;
  idCampanha: string;
  entrevista: EntradaEntrevista;
  situacao: SituacaoItemFila;
  tentativas: number;
  criadoEm: number;
  ultimaTentativaEm: number | null;
  motivo: string | null;
}

export interface ResumoFila {
  pendentes: number;
  enviando: number;
  atencao: number;
  total: number;
}

/** Envio do lote ao servidor. Injetado para permitir teste sem rede. */
export type EnviarLote = (
  idCampanha: string,
  entrevistas: EntradaEntrevista[],
) => Promise<ResultadoItemSincronizacao[]>;

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolver, rejeitar) => {
    const requisicao = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    requisicao.onupgradeneeded = () => {
      const banco = requisicao.result;
      if (!banco.objectStoreNames.contains(DEPOSITO)) {
        const deposito = banco.createObjectStore(DEPOSITO, { keyPath: 'idLocalOffline' });
        deposito.createIndex('porSituacao', 'situacao', { unique: false });
        deposito.createIndex('porCampanha', 'idCampanha', { unique: false });
      }
      if (!banco.objectStoreNames.contains(DEPOSITO_CONTEXTO)) {
        banco.createObjectStore(DEPOSITO_CONTEXTO, { keyPath: 'idCampanha' });
      }
    };
    requisicao.onsuccess = () => resolver(requisicao.result);
    requisicao.onerror = () => rejeitar(requisicao.error);
  });
}

function executarEm<T>(
  banco: IDBDatabase,
  nomeDeposito: string,
  modo: IDBTransactionMode,
  operacao: (deposito: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolver, rejeitar) => {
    const transacao = banco.transaction(nomeDeposito, modo);
    const requisicao = operacao(transacao.objectStore(nomeDeposito));
    requisicao.onsuccess = () => resolver(requisicao.result);
    requisicao.onerror = () => rejeitar(requisicao.error);
  });
}

function executar<T>(
  banco: IDBDatabase,
  modo: IDBTransactionMode,
  operacao: (deposito: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return executarEm(banco, DEPOSITO, modo, operacao);
}

function gerarIdentificador(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Ambientes antigos: aparelho velho é a regra em campo, não a exceção.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export class FilaOffline {
  private banco: IDBDatabase | null = null;
  private sincronizando = false;

  private async obterBanco(): Promise<IDBDatabase> {
    this.banco ??= await abrirBanco();
    return this.banco;
  }

  /**
   * Fecha a conexão com o IndexedDB.
   *
   * Necessário porque uma conexão aberta bloqueia `deleteDatabase` e o
   * `onupgradeneeded` de uma versão nova — o que travaria a atualização do
   * aplicativo no aparelho do entrevistador, não só o teste.
   */
  fechar(): void {
    this.banco?.close();
    this.banco = null;
  }

  /**
   * Guarda o contexto de campo (cargos e candidatos) para o aparelho usar sem
   * rede. É o que permite ao entrevistador escolher candidato pelo nome numa
   * casa sem sinal — sem isto o formulário cairia de volta para o número
   * digitado às cegas em toda área de sombra.
   */
  async gravarContexto<T extends { idCampanha: string }>(item: T): Promise<void> {
    const banco = await this.obterBanco();
    await executarEm(banco, DEPOSITO_CONTEXTO, 'readwrite', (deposito) => deposito.put(item));
  }

  async lerContexto<T>(idCampanha: string): Promise<T | undefined> {
    const banco = await this.obterBanco();
    return executarEm(banco, DEPOSITO_CONTEXTO, 'readonly', (deposito) =>
      deposito.get(idCampanha),
    ) as Promise<T | undefined>;
  }

  /**
   * Grava a entrevista localmente. É o primeiro passo do envio, sempre —
   * inclusive com sinal bom. Assim uma queda de conexão no meio da requisição
   * não perde nada.
   */
  async enfileirar(idCampanha: string, entrevista: EntradaEntrevista): Promise<ItemFila> {
    const banco = await this.obterBanco();
    const idLocalOffline = entrevista.idLocalOffline ?? gerarIdentificador();
    const item: ItemFila = {
      idLocalOffline,
      idCampanha,
      entrevista: { ...entrevista, idLocalOffline },
      situacao: 'PENDENTE',
      tentativas: 0,
      criadoEm: Date.now(),
      ultimaTentativaEm: null,
      motivo: null,
    };
    await executar(banco, 'readwrite', (deposito) => deposito.put(item));
    return item;
  }

  async listar(situacao?: SituacaoItemFila): Promise<ItemFila[]> {
    const banco = await this.obterBanco();
    const itens = await executar<ItemFila[]>(banco, 'readonly', (deposito) => deposito.getAll());
    const ordenados = itens.sort((a, b) => a.criadoEm - b.criadoEm);
    return situacao ? ordenados.filter((item) => item.situacao === situacao) : ordenados;
  }

  async resumir(): Promise<ResumoFila> {
    const itens = await this.listar();
    return {
      pendentes: itens.filter((i) => i.situacao === 'PENDENTE').length,
      enviando: itens.filter((i) => i.situacao === 'ENVIANDO').length,
      atencao: itens.filter((i) => i.situacao === 'ATENCAO').length,
      total: itens.length,
    };
  }

  /**
   * Envia os pendentes em lotes por campanha.
   *
   * Reentrância protegida: o disparo acontece no evento `online`, na abertura da
   * tela e num temporizador. Sem a trava, três gatilhos simultâneos enviariam o
   * mesmo item três vezes — a idempotência do servidor salvaria, mas gastaria
   * banda de um celular em rede fraca, que é justamente o recurso escasso.
   */
  async sincronizar(enviar: EnviarLote, tamanhoLote = 50): Promise<ResumoFila> {
    if (this.sincronizando) return this.resumir();
    this.sincronizando = true;

    try {
      const banco = await this.obterBanco();
      const pendentes = (await this.listar('PENDENTE')).filter((item) =>
        this.podeTentarAgora(item),
      );

      const porCampanha = new Map<string, ItemFila[]>();
      for (const item of pendentes) {
        porCampanha.set(item.idCampanha, [...(porCampanha.get(item.idCampanha) ?? []), item]);
      }

      for (const [idCampanha, itens] of porCampanha) {
        for (let inicio = 0; inicio < itens.length; inicio += tamanhoLote) {
          const lote = itens.slice(inicio, inicio + tamanhoLote);
          await this.marcar(banco, lote, 'ENVIANDO');

          try {
            const resultados = await enviar(
              idCampanha,
              lote.map((item) => item.entrevista),
            );
            await this.aplicarResultados(banco, lote, resultados);
          } catch (erro) {
            // Falha de rede não é culpa do conteúdo: volta para PENDENTE e
            // tenta de novo depois, com espera maior.
            await this.devolverParaFila(banco, lote, erro);
          }
        }
      }

      return this.resumir();
    } finally {
      this.sincronizando = false;
    }
  }

  /** Reenvia um item que o servidor recusou, depois de corrigido. */
  async reenviar(idLocalOffline: string, entrevista: EntradaEntrevista): Promise<void> {
    const banco = await this.obterBanco();
    const item = await executar<ItemFila | undefined>(banco, 'readonly', (deposito) =>
      deposito.get(idLocalOffline),
    );
    if (!item) return;
    await executar(banco, 'readwrite', (deposito) =>
      deposito.put({
        ...item,
        entrevista: { ...entrevista, idLocalOffline },
        situacao: 'PENDENTE' as const,
        motivo: null,
        tentativas: 0,
      }),
    );
  }

  /**
   * Remove os itens já confirmados pelo servidor. Chamado depois de uma
   * sincronização bem-sucedida; nunca apaga PENDENTE nem ATENCAO.
   */
  async limparEnviados(): Promise<number> {
    const banco = await this.obterBanco();
    const enviados = await this.listar('ENVIADA');
    for (const item of enviados) {
      await executar(banco, 'readwrite', (deposito) => deposito.delete(item.idLocalOffline));
    }
    return enviados.length;
  }

  /** Backoff exponencial com teto de 5 minutos, a partir da 2ª tentativa. */
  private podeTentarAgora(item: ItemFila): boolean {
    if (item.tentativas === 0 || item.ultimaTentativaEm === null) return true;
    const esperaMs = Math.min(300_000, 2 ** (item.tentativas - 1) * 5000);
    return Date.now() - item.ultimaTentativaEm >= esperaMs;
  }

  private async marcar(
    banco: IDBDatabase,
    itens: ItemFila[],
    situacao: SituacaoItemFila,
  ): Promise<void> {
    for (const item of itens) {
      await executar(banco, 'readwrite', (deposito) =>
        deposito.put({ ...item, situacao, ultimaTentativaEm: Date.now() }),
      );
    }
  }

  private async aplicarResultados(
    banco: IDBDatabase,
    lote: ItemFila[],
    resultados: ResultadoItemSincronizacao[],
  ): Promise<void> {
    const porId = new Map(resultados.map((r) => [r.idLocalOffline, r]));

    for (const item of lote) {
      const resultado = porId.get(item.idLocalOffline);

      // Sem resposta para o item: o servidor pode ter processado parcialmente.
      // Volta para PENDENTE — a idempotência garante que reenviar é seguro.
      if (!resultado) {
        await executar(banco, 'readwrite', (deposito) =>
          deposito.put({ ...item, situacao: 'PENDENTE' as const, tentativas: item.tentativas + 1 }),
        );
        continue;
      }

      if (resultado.situacao === 'CRIADA' || resultado.situacao === 'JA_EXISTIA') {
        await executar(banco, 'readwrite', (deposito) =>
          deposito.put({ ...item, situacao: 'ENVIADA' as const, motivo: null }),
        );
        continue;
      }

      // RECUSADA: o conteúdo tem problema. Fica no aparelho, visível, para o
      // entrevistador corrigir. Não se apaga coleta de campo.
      await executar(banco, 'readwrite', (deposito) =>
        deposito.put({
          ...item,
          situacao: 'ATENCAO' as const,
          motivo: resultado.motivo,
          tentativas: item.tentativas + 1,
        }),
      );
    }
  }

  private async devolverParaFila(
    banco: IDBDatabase,
    lote: ItemFila[],
    erro: unknown,
  ): Promise<void> {
    for (const item of lote) {
      await executar(banco, 'readwrite', (deposito) =>
        deposito.put({
          ...item,
          situacao: 'PENDENTE' as const,
          tentativas: item.tentativas + 1,
          ultimaTentativaEm: Date.now(),
          motivo: erro instanceof Error ? erro.message : 'Sem conexão.',
        }),
      );
    }
  }
}

export const filaOffline = new FilaOffline();
