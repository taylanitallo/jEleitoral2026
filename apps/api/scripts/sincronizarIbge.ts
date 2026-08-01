/**
 * `pnpm ibge:sincronizar [UF …]`
 *
 * Carga inicial de estados, municípios, distritos e subdistritos do IBGE.
 *
 * Sem argumentos, carrega o país inteiro (27 UFs, ~5.570 municípios) — leva
 * alguns minutos e só precisa rodar uma vez por ambiente. Com siglas, carrega
 * apenas aquelas:
 *
 *   pnpm ibge:sincronizar          # tudo
 *   pnpm ibge:sincronizar SP MG    # só duas
 *
 * Reaproveita o conector de produção em vez de reescrever os `insert`s: o que
 * roda aqui é exatamente o que o agendador roda, então um defeito de mapeamento
 * aparece uma vez só, e não em duas versões que divergem com o tempo.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { BancoService } from '../src/banco/banco.service.js';
import { ConectorIbgeLocalidades } from '../src/integracoes/conectorIbgeLocalidades.js';

async function principal(): Promise<void> {
  const ufs = process.argv.slice(2).map((argumento) => argumento.toUpperCase());
  const banco = new BancoService();
  const conector = new ConectorIbgeLocalidades(banco);

  // Sem UF, uma passada só carrega o país. Com UFs, uma passada por sigla — o
  // conector aceita uma de cada vez.
  const passadas =
    ufs.length > 0
      ? ufs.map((uf) => ({ uf, forcarRecarga: true }))
      : [{ forcarRecarga: true }];
  let houveFalha = false;

  for (const parametros of passadas) {
    const resultado = await conector.sincronizar(parametros);
    const alvo = 'uf' in parametros ? parametros.uf : 'Brasil';

    console.log(
      `${resultado.sucesso ? 'OK  ' : 'FALHA'} ${alvo}: ` +
        `${resultado.registrosInseridos} inseridos, ` +
        `${resultado.registrosAtualizados} atualizados, ` +
        `${Math.round((resultado.finalizadoEm.getTime() - resultado.iniciadoEm.getTime()) / 1000)}s`,
    );

    for (const erro of resultado.erros) console.error(`      ${erro}`);
    if (!resultado.sucesso) houveFalha = true;
  }

  await banco.onModuleDestroy();
  // Falha visível em vez de carga silenciosamente parcial: um município que não
  // entrou vira uma tela de filtro sem opções, e ninguém liga uma coisa à outra.
  if (houveFalha) process.exitCode = 1;
}

principal().catch((erro: unknown) => {
  console.error('Falha na sincronização do IBGE:', erro);
  process.exitCode = 1;
});
