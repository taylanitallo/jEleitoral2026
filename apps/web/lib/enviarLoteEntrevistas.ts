import type { EntradaEntrevista, ResultadoItemSincronizacao } from '@jeleitoral/tipos';
import { api } from './api';
import type { EnviarLote } from './filaOffline';

/**
 * A implementação real de `EnviarLote`, num lugar só.
 *
 * Existia duplicada dentro de `IndicadorFilaOffline.tsx` — e só ali, porque
 * era o único lugar que chamava `filaOffline.sincronizar()`. Isso significava
 * que salvar uma entrevista não disparava envio nenhum: a mensagem de
 * confirmação dizia "está subindo para o servidor", mas nada de fato subia
 * até o próximo gatilho automático do indicador (montagem, evento `online`,
 * ou o intervalo de 2 minutos). Uma entrevista salva com a tela aberta podia
 * ficar até 2 minutos fora do registro. Extrair para cá é o que permite
 * `FormularioEntrevista` também chamar a sincronização, na hora.
 */
export const enviarLoteEntrevistas: EnviarLote = async (
  idCampanha: string,
  entrevistas: EntradaEntrevista[],
) => {
  const resposta = await api.enviar<{ resultados: ResultadoItemSincronizacao[] }>(
    '/campo/sincronizar',
    { idCampanha, entrevistas },
  );
  return resposta.resultados;
};
