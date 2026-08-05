import { describe, expect, it } from 'vitest';
import { deveAdotar, numeroDaMigration } from './ordemMigrations.js';

describe('numeroDaMigration', () => {
  it('lê o número do nome do arquivo', () => {
    expect(numeroDaMigration('0018_bairros_unicidade.sql')).toBe(18);
  });

  it('aceita o número puro, como vem da linha de comando', () => {
    expect(numeroDaMigration('0018')).toBe(18);
  });

  it('devolve NaN para texto sem número', () => {
    expect(numeroDaMigration('bairros.sql')).toBeNaN();
  });
});

describe('deveAdotar', () => {
  it('INCLUI a migration do limite', () => {
    /*
     * O teste que existe por causa de um defeito real.
     *
     * A comparação anterior era `arquivo.localeCompare(limite) <= 0`, e
     * `'0018_bairros_unicidade.sql'.localeCompare('0018')` é 1 — o nome é mais
     * longo que o limite. Resultado: `--adotar-ate=0018` adotava até a 0017 e
     * tentava EXECUTAR a 0018 num banco que já a tinha. A migration abortava
     * com "already exists" e a adoção do banco de produção não passava.
     */
    expect(deveAdotar('0018_bairros_unicidade.sql', '0018')).toBe(true);
  });

  it('inclui as anteriores', () => {
    expect(deveAdotar('0001_extensoes_e_funcoes.sql', '0018')).toBe(true);
    expect(deveAdotar('0017_hmac_indice_falha_alto.sql', '0018')).toBe(true);
  });

  it('exclui as posteriores', () => {
    expect(deveAdotar('0019_perfis_padrao_em_tabela.sql', '0018')).toBe(false);
    expect(deveAdotar('0027_revogacao_de_sessao.sql', '0018')).toBe(false);
  });

  it('não se confunde ao passar de 9 para 10', () => {
    // Comparação textual diria que '0009' > '0010'. Numérica, não.
    expect(deveAdotar('0009_seguranca.sql', '0010')).toBe(true);
    expect(deveAdotar('0010_qualquer.sql', '0009')).toBe(false);
  });

  it('limite ilegível NÃO adota nada', () => {
    // Pular migration por erro de digitação deixaria o banco sem uma alteração
    // que ninguém saberia que faltou — o pior modo de falhar deste script.
    expect(deveAdotar('0001_extensoes_e_funcoes.sql', 'ultima')).toBe(false);
    expect(deveAdotar('0001_extensoes_e_funcoes.sql', '')).toBe(false);
  });
});
