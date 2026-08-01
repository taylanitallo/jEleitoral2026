import { describe, expect, it } from 'vitest';
import { construirRecorte, type MapeamentoColunas } from './construirRecorte.js';

const CAMPANHA = '11111111-1111-4111-8111-111111111111';
const SECAO = '22222222-2222-4222-8222-222222222222';

const COLUNAS: MapeamentoColunas = {
  idCampanha: 'e.id_campanha',
  idSecao: 'e.id_secao',
  idBairro: 'd.id_bairro',
  idEquipe: 'e.id_equipe',
  idUsuario: 'e.id_usuario_cadastro',
  dataReferencia: 'e.criado_em',
};

describe('construirRecorte', () => {
  it('exige campanha', () => {
    expect(() => construirRecorte({}, COLUNAS)).toThrow(/campanha/i);
  });

  it('monta predicado só com a campanha quando não há recorte', () => {
    const recorte = construirRecorte({ idCampanha: CAMPANHA }, COLUNAS);
    expect(recorte.predicado).toBe('e.id_campanha = $1');
    expect(recorte.parametros).toEqual([CAMPANHA]);
  });

  it('numera os parâmetros em sequência', () => {
    const recorte = construirRecorte(
      { idCampanha: CAMPANHA, idSecao: SECAO, idEquipe: 'equipe-1' },
      COLUNAS,
    );
    expect(recorte.predicado).toBe('e.id_campanha = $1 and e.id_secao = $2 and e.id_equipe = $3');
    expect(recorte.parametros).toHaveLength(3);
  });

  it('continua a numeração quando já há parâmetros antes', () => {
    const recorte = construirRecorte({ idCampanha: CAMPANHA }, COLUNAS, ['anterior']);
    expect(recorte.predicado).toBe('e.id_campanha = $2');
    expect(recorte.parametros).toEqual(['anterior', CAMPANHA]);
  });

  it('ignora campos sem coluna correspondente na consulta', () => {
    // `idZona` não está no mapeamento desta consulta: deve ser silenciosamente
    // descartado, não gerar SQL inválido.
    const recorte = construirRecorte({ idCampanha: CAMPANHA, idZona: 'zona-1' }, COLUNAS);
    expect(recorte.predicado).toBe('e.id_campanha = $1');
  });

  it('nunca interpola valor do usuário no texto SQL', () => {
    const tentativa = "'; drop table public.entrevistados; --";
    const recorte = construirRecorte({ idCampanha: CAMPANHA, idSecao: tentativa }, COLUNAS);
    expect(recorte.predicado).not.toContain('drop');
    expect(recorte.predicado).toContain('$2');
    expect(recorte.parametros[1]).toBe(tentativa);
  });

  it('não menciona id_organizacao — o isolamento é da RLS, não deste WHERE', () => {
    const recorte = construirRecorte({ idCampanha: CAMPANHA, idSecao: SECAO }, COLUNAS);
    expect(recorte.predicado).not.toContain('id_organizacao');
  });

  it('trata o fim do período como inclusivo', () => {
    const recorte = construirRecorte(
      {
        idCampanha: CAMPANHA,
        dataInicio: new Date('2026-08-01'),
        dataFim: new Date('2026-08-20'),
      },
      COLUNAS,
    );
    expect(recorte.predicado).toContain('>= $2');
    // Quem escolhe "até 20/08" espera o dia 20 inteiro.
    expect(recorte.predicado).toContain("< $3::date + interval '1 day'");
  });

  it('ignora datas quando a consulta não tem coluna temporal', () => {
    const semData: MapeamentoColunas = { idCampanha: 'p.id_campanha' };
    const recorte = construirRecorte(
      { idCampanha: CAMPANHA, dataInicio: new Date('2026-08-01') },
      semData,
    );
    expect(recorte.parametros).toHaveLength(1);
  });
});
