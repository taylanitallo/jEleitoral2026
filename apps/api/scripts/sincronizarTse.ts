/**
 * `pnpm tse:sincronizar <UF> [ano]`
 *
 * Carga da base eleitoral do TSE para uma UF: perfil do eleitorado por seção
 * (o denominador de toda projeção) e estrutura de zonas, seções e locais de
 * votação.
 *
 *   pnpm tse:sincronizar CE
 *   pnpm tse:sincronizar CE 2026
 *
 * **A UF é obrigatória, e isso é decisão de arquitetura, não descuido.** Os
 * dados por seção do país inteiro passam de dezenas de gigabytes, e nenhuma
 * campanha precisa de todos: carrega-se sob demanda o estado onde ela disputa.
 *
 * Reaproveita os conectores de produção em vez de reescrever a ingestão — o que
 * roda aqui é o mesmo que o agendador roda, então um defeito de mapeamento
 * aparece uma vez só e não em duas versões que divergem com o tempo.
 */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { BancoService } from '../src/banco/banco.service.js';
import { ConectorTseDadosAbertos } from '../src/integracoes/conectorTseDadosAbertos.js';
import { ConectorTseEstrutura } from '../src/integracoes/conectorTseEstrutura.js';

config({ path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env') });

async function principal(): Promise<void> {
  const [ufBruta, anoBruto] = process.argv.slice(2);
  const uf = ufBruta?.toUpperCase();

  if (!uf || !/^[A-Z]{2}$/.test(uf)) {
    process.stderr.write('Uso: pnpm tse:sincronizar <UF> [ano]   (ex.: pnpm tse:sincronizar CE)\n');
    process.exit(1);
  }

  const ano = anoBruto ? Number(anoBruto) : 2026;
  const banco = new BancoService();
  const ckan = new ConectorTseDadosAbertos(banco);
  const estrutura = new ConectorTseEstrutura(banco, ckan);

  /*
   * A ESTRUTURA VEM PRIMEIRO, e a ordem não é preferência.
   *
   * O perfil do eleitorado resolve cada linha procurando a seção em
   * `secoes_eleitorais` para descobrir a que id ela pertence. Rodando antes da
   * estrutura, nenhuma seção existe, toda linha é descartada e a carga termina
   * com zero gravado — que foi exatamente o que aconteceu na primeira execução
   * do Ceará.
   */
  const passadas = [
    ['Estrutura eleitoral (zonas, seções, locais)', estrutura],
    ['Perfil do eleitorado por seção', ckan],
  ] as const;

  let houveFalha = false;

  for (const [rotulo, conector] of passadas) {
    process.stdout.write(`\n→ ${rotulo} — ${uf}/${ano}\n`);
    const resultado = await conector.sincronizar({ uf, ano, forcarRecarga: true });

    process.stdout.write(
      `${resultado.sucesso ? '  OK  ' : ' FALHA'} ` +
        `${resultado.registrosProcessados} processados, ` +
        `${resultado.registrosInseridos} inseridos, ` +
        `${resultado.registrosAtualizados} atualizados\n`,
    );

    for (const erro of resultado.erros) {
      process.stdout.write(`        ${erro}\n`);
    }
    if (!resultado.sucesso) houveFalha = true;
  }

  // `process.exit` em vez de deixar o processo terminar sozinho: o pool do
  // BancoService mantém conexões abertas e o script ficaria pendurado.
  process.exit(houveFalha ? 1 : 0);
}

principal().catch((erro: unknown) => {
  process.stderr.write(`Falha na carga do TSE: ${String(erro)}\n`);
  process.exit(1);
});
