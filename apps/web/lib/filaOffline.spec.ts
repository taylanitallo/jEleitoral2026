import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntradaEntrevista, ResultadoItemSincronizacao } from '@jeleitoral/tipos';
import { FilaOffline, type EnviarLote } from './filaOffline.js';

const ID_CAMPANHA = '11111111-1111-4111-8111-111111111111';
const ID_DOMICILIO = '22222222-2222-4222-8222-222222222222';

function entrevista(alteracoes: Partial<EntradaEntrevista> = {}): EntradaEntrevista {
  return {
    idDomicilio: ID_DOMICILIO,
    natureza: 'LEVANTAMENTO_INTERNO',
    dataHora: new Date('2026-08-20T10:00:00Z'),
    recusouResponder: false,
    intencoes: [],
    votosDomicilio: [],
    status: 'CONCLUIDA',
    ...alteracoes,
  } as EntradaEntrevista;
}

function respondendo(
  situacao: ResultadoItemSincronizacao['situacao'],
  motivo: string | null = null,
): EnviarLote {
  return async (_idCampanha, entrevistas) =>
    entrevistas.map((item) => ({
      idLocalOffline: item.idLocalOffline ?? null,
      situacao,
      idEntrevista: situacao === 'RECUSADA' ? null : '33333333-3333-4333-8333-333333333333',
      motivo,
    }));
}

let fila: FilaOffline;

beforeEach(async () => {
  // Banco novo a cada teste: o `fake-indexeddb/auto` é global e vazaria estado.
  // A exclusão precisa ser aguardada — uma conexão aberta a bloqueia.
  await new Promise<void>((resolver, rejeitar) => {
    const requisicao = indexedDB.deleteDatabase('jeleitoral');
    requisicao.onsuccess = () => resolver();
    requisicao.onerror = () => rejeitar(requisicao.error);
    requisicao.onblocked = () => rejeitar(new Error('Exclusão do banco bloqueada.'));
  });
  fila = new FilaOffline();
});

afterEach(() => {
  fila.fechar();
});

describe('enfileirar', () => {
  it('grava a entrevista antes de qualquer tentativa de envio', async () => {
    const item = await fila.enfileirar(ID_CAMPANHA, entrevista());
    expect(item.situacao).toBe('PENDENTE');
    expect(item.idLocalOffline).toBeTruthy();
    expect(await fila.resumir()).toMatchObject({ pendentes: 1, total: 1 });
  });

  it('gera identificador local e o injeta na entrevista', async () => {
    const item = await fila.enfileirar(ID_CAMPANHA, entrevista());
    expect(item.entrevista.idLocalOffline).toBe(item.idLocalOffline);
  });

  it('preserva o identificador quando já informado', async () => {
    const item = await fila.enfileirar(
      ID_CAMPANHA,
      entrevista({ idLocalOffline: 'identificador-fixo' }),
    );
    expect(item.idLocalOffline).toBe('identificador-fixo');
  });
});

describe('sincronizar', () => {
  it('marca como enviada quando o servidor confirma', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    const resumo = await fila.sincronizar(respondendo('CRIADA'));
    expect(resumo).toMatchObject({ pendentes: 0, atencao: 0 });
    expect(await fila.listar('ENVIADA')).toHaveLength(1);
  });

  it('trata JA_EXISTIA como sucesso — é o caso do reenvio', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    await fila.sincronizar(respondendo('JA_EXISTIA'));
    expect(await fila.listar('ENVIADA')).toHaveLength(1);
  });

  it('não apaga item recusado: envia para ATENCAO com o motivo', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    await fila.sincronizar(respondendo('RECUSADA', 'CPF inválido.'));

    const emAtencao = await fila.listar('ATENCAO');
    expect(emAtencao).toHaveLength(1);
    expect(emAtencao[0]?.motivo).toBe('CPF inválido.');
    // O conteúdo continua no aparelho — coleta de campo não se descarta.
    expect(emAtencao[0]?.entrevista.idDomicilio).toBe(ID_DOMICILIO);
  });

  it('devolve para PENDENTE quando falta conexão', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    const semRede: EnviarLote = async () => {
      throw new Error('Failed to fetch');
    };
    const resumo = await fila.sincronizar(semRede);
    expect(resumo.pendentes).toBe(1);
    const pendentes = await fila.listar('PENDENTE');
    expect(pendentes[0]?.tentativas).toBe(1);
  });

  it('devolve para PENDENTE quando o servidor não responde sobre o item', async () => {
    // Resposta parcial: o servidor processou o lote pela metade. Reenviar é
    // seguro por causa da idempotência, então o item volta para a fila.
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    const respostaVazia: EnviarLote = async () => [];
    const resumo = await fila.sincronizar(respostaVazia);
    expect(resumo.pendentes).toBe(1);
  });

  it('agrupa por campanha e envia em lotes do tamanho pedido', async () => {
    for (let i = 0; i < 5; i += 1) {
      await fila.enfileirar(ID_CAMPANHA, entrevista());
    }
    const enviar = vi.fn(respondendo('CRIADA'));
    await fila.sincronizar(enviar, 2);
    // 5 itens em lotes de 2 → 3 chamadas.
    expect(enviar).toHaveBeenCalledTimes(3);
  });

  it('respeita o backoff antes de tentar de novo', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    const semRede: EnviarLote = async () => {
      throw new Error('Failed to fetch');
    };
    await fila.sincronizar(semRede);

    // Segunda chamada imediata: o item ainda está no período de espera.
    const enviar = vi.fn(respondendo('CRIADA'));
    await fila.sincronizar(enviar);
    expect(enviar).not.toHaveBeenCalled();
    expect((await fila.resumir()).pendentes).toBe(1);
  });

  it('não envia o mesmo item duas vezes em disparos concorrentes', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    const enviar = vi.fn(async (_id: string, itens: EntradaEntrevista[]) => {
      await new Promise((resolver) => setTimeout(resolver, 20));
      return itens.map((item) => ({
        idLocalOffline: item.idLocalOffline ?? null,
        situacao: 'CRIADA' as const,
        idEntrevista: '33333333-3333-4333-8333-333333333333',
        motivo: null,
      }));
    });

    await Promise.all([
      fila.sincronizar(enviar),
      fila.sincronizar(enviar),
      fila.sincronizar(enviar),
    ]);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe('reenviar e limpar', () => {
  it('devolve um item corrigido para a fila', async () => {
    const item = await fila.enfileirar(ID_CAMPANHA, entrevista());
    await fila.sincronizar(respondendo('RECUSADA', 'Consentimento ausente.'));
    expect((await fila.resumir()).atencao).toBe(1);

    await fila.reenviar(item.idLocalOffline, entrevista({ recusouResponder: true }));
    const resumo = await fila.resumir();
    expect(resumo).toMatchObject({ pendentes: 1, atencao: 0 });
  });

  it('limpa apenas os confirmados', async () => {
    await fila.enfileirar(ID_CAMPANHA, entrevista());
    await fila.sincronizar(respondendo('CRIADA'));
    await fila.enfileirar(ID_CAMPANHA, entrevista());

    const removidos = await fila.limparEnviados();
    expect(removidos).toBe(1);
    expect(await fila.resumir()).toMatchObject({ pendentes: 1, total: 1 });
  });
});
