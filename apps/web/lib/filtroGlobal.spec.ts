import { describe, expect, it } from 'vitest';
import {
  contarFiltrosAtivos,
  deParametrosUrl,
  descreverFiltro,
  limparFiltro,
  nivelAtual,
  paraParametrosUrl,
  selecionarNivel,
} from './filtroGlobal';

const CAMPANHA = '11111111-1111-4111-8111-111111111111';
const SECAO = '22222222-2222-4222-8222-222222222222';

describe('serialização na URL', () => {
  it('ida e volta preserva o filtro', () => {
    const original = {
      idCampanha: CAMPANHA,
      idSecao: SECAO,
      uf: 'SP',
      idMunicipio: 3550308,
      dataInicio: new Date('2026-08-01T00:00:00'),
    };
    const voltou = deParametrosUrl(paraParametrosUrl(original));
    expect(voltou.idCampanha).toBe(CAMPANHA);
    expect(voltou.idSecao).toBe(SECAO);
    expect(voltou.uf).toBe('SP');
    expect(voltou.idMunicipio).toBe(3550308);
    expect(voltou.dataInicio?.getFullYear()).toBe(2026);
  });

  it('ignora campos vazios em vez de gravar string vazia', () => {
    const parametros = paraParametrosUrl({ idCampanha: CAMPANHA, uf: undefined });
    expect(parametros.has('uf')).toBe(false);
  });

  it('descarta município não numérico vindo de URL adulterada', () => {
    const filtro = deParametrosUrl(new URLSearchParams('idMunicipio=abc'));
    expect(filtro.idMunicipio).toBeUndefined();
  });
});

describe('selecionarNivel', () => {
  const completo = {
    idCampanha: CAMPANHA,
    uf: 'SP',
    idMunicipio: 3550308,
    idZona: 'zona-1',
    idSecao: SECAO,
    idBairro: 'bairro-1',
  };

  it('limpa os níveis mais específicos ao trocar de município', () => {
    const novo = selecionarNivel(completo, 'idMunicipio', 3509502);
    expect(novo.idMunicipio).toBe(3509502);
    expect(novo.idZona).toBeUndefined();
    expect(novo.idSecao).toBeUndefined();
    expect(novo.idBairro).toBeUndefined();
  });

  it('preserva os níveis acima', () => {
    const novo = selecionarNivel(completo, 'idZona', 'zona-9');
    expect(novo.uf).toBe('SP');
    expect(novo.idMunicipio).toBe(3550308);
    expect(novo.idSecao).toBeUndefined();
  });

  it('remove o nível quando o valor é vazio', () => {
    const novo = selecionarNivel(completo, 'idSecao', undefined);
    expect(novo.idSecao).toBeUndefined();
    expect(novo.idZona).toBe('zona-1');
  });

  it('não mexe em campos fora da hierarquia territorial', () => {
    const novo = selecionarNivel(completo, 'idEquipe', 'equipe-1');
    expect(novo.idSecao).toBe(SECAO);
    expect(novo.idEquipe).toBe('equipe-1');
  });
});

describe('nivelAtual', () => {
  it('devolve o nível mais específico presente', () => {
    expect(nivelAtual({ idCampanha: CAMPANHA, uf: 'SP', idSecao: SECAO })).toBe('SECAO');
    expect(nivelAtual({ idCampanha: CAMPANHA, uf: 'SP', idMunicipio: 3550308 })).toBe('MUNICIPIO');
    expect(nivelAtual({ idCampanha: CAMPANHA })).toBeNull();
  });
});

describe('contarFiltrosAtivos', () => {
  it('não conta a campanha, que é contexto e não recorte', () => {
    expect(contarFiltrosAtivos({ idCampanha: CAMPANHA })).toBe(0);
  });

  it('conta cada recorte aplicado', () => {
    expect(contarFiltrosAtivos({ idCampanha: CAMPANHA, uf: 'SP', idSecao: SECAO })).toBe(2);
  });
});

describe('limparFiltro', () => {
  it('mantém apenas a campanha', () => {
    const limpo = limparFiltro({ idCampanha: CAMPANHA, uf: 'SP', idSecao: SECAO });
    expect(limpo).toEqual({ idCampanha: CAMPANHA });
  });
});

describe('descreverFiltro', () => {
  it('descreve o recorte por extenso para o cabeçalho do relatório', () => {
    const texto = descreverFiltro(
      { idCampanha: CAMPANHA, uf: 'SP', idSecao: SECAO },
      { idSecao: 'Seção 0042' },
    );
    expect(texto).toContain('UF: SP');
    expect(texto).toContain('Seção: Seção 0042');
  });

  it('deixa explícito quando não há recorte', () => {
    expect(descreverFiltro({ idCampanha: CAMPANHA })).toBe('Sem filtros — toda a campanha');
  });
});
