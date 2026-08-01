import { describe, expect, it } from 'vitest';
import {
  avaliarEntrevista,
  calcularIndiceQualidade,
  type ContextoAvaliacao,
  type EntrevistaParaAvaliacao,
} from './antifraude.js';

const AGORA = new Date('2026-08-15T14:00:00Z');

// Praça da Sé, São Paulo — endereço declarado nos cenários.
const ENDERECO = { latitude: -23.5505, longitude: -46.6333 };

function entrevista(alteracoes: Partial<EntrevistaParaAvaliacao> = {}): EntrevistaParaAvaliacao {
  return {
    duracaoSegundos: 300,
    latitude: ENDERECO.latitude,
    longitude: ENDERECO.longitude,
    precisaoGpsMetros: 10,
    quantidadeIntencoes: 2,
    dataHora: AGORA,
    ...alteracoes,
  };
}

function contexto(alteracoes: Partial<ContextoAvaliacao> = {}): ContextoAvaliacao {
  return {
    coordenadaEndereco: ENDERECO,
    entrevistasNaUltimaHora: [],
    ...alteracoes,
  };
}

describe('avaliarEntrevista — entrevista normal', () => {
  it('não gera alerta quando tudo está dentro do esperado', () => {
    expect(avaliarEntrevista(entrevista(), contexto())).toEqual([]);
  });
});

describe('duração', () => {
  it('acusa gravidade máxima abaixo de 40 segundos', () => {
    const alertas = avaliarEntrevista(entrevista({ duracaoSegundos: 25 }), contexto());
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.tipo).toBe('DURACAO_CURTA');
    expect(alertas[0]?.gravidade).toBe(3);
  });

  it('acusa gravidade leve entre 40 e 90 segundos', () => {
    const alertas = avaliarEntrevista(entrevista({ duracaoSegundos: 60 }), contexto());
    expect(alertas[0]?.gravidade).toBe(1);
  });

  it('não acusa a partir de 90 segundos', () => {
    expect(avaliarEntrevista(entrevista({ duracaoSegundos: 90 }), contexto())).toEqual([]);
  });

  it('ignora duração ausente em vez de tratar como zero', () => {
    // Entrevista vinda da fila offline pode não trazer duração; acusá-la como
    // "0 segundo" produziria alarme falso em massa no primeiro dia de campo.
    const alertas = avaliarEntrevista(entrevista({ duracaoSegundos: null }), contexto());
    expect(alertas.map((a) => a.tipo)).not.toContain('DURACAO_CURTA');
  });
});

describe('geolocalização', () => {
  it('acusa ausência de GPS com gravidade leve', () => {
    const alertas = avaliarEntrevista(
      entrevista({ latitude: null, longitude: null }),
      contexto(),
    );
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.tipo).toBe('SEM_GEOLOCALIZACAO');
    expect(alertas[0]?.gravidade).toBe(1);
  });

  it('acusa desvio acima de 500 m', () => {
    // ~1 km ao norte da Praça da Sé.
    const alertas = avaliarEntrevista(
      entrevista({ latitude: ENDERECO.latitude + 0.009 }),
      contexto(),
    );
    const gps = alertas.find((a) => a.tipo === 'GPS_DISTANTE');
    expect(gps).toBeDefined();
    expect(gps?.gravidade).toBe(2);
    expect(gps?.detalhe['distanciaMetros']).toBeGreaterThan(900);
  });

  it('escala para gravidade máxima acima de 2 km', () => {
    const alertas = avaliarEntrevista(
      entrevista({ latitude: ENDERECO.latitude + 0.05 }),
      contexto(),
    );
    expect(alertas.find((a) => a.tipo === 'GPS_DISTANTE')?.gravidade).toBe(3);
  });

  it('não acusa desvio que a imprecisão declarada do GPS já explica', () => {
    // 1 km de desvio com 1,5 km de imprecisão não é indício de nada.
    const alertas = avaliarEntrevista(
      entrevista({ latitude: ENDERECO.latitude + 0.009, precisaoGpsMetros: 1500 }),
      contexto(),
    );
    expect(alertas.map((a) => a.tipo)).not.toContain('GPS_DISTANTE');
  });

  it('avisa quando a precisão do GPS é ruim demais para confiar', () => {
    const alertas = avaliarEntrevista(entrevista({ precisaoGpsMetros: 350 }), contexto());
    expect(alertas.map((a) => a.tipo)).toContain('SEM_GEOLOCALIZACAO');
  });

  it('não avalia distância quando o endereço não tem coordenada', () => {
    const alertas = avaliarEntrevista(
      entrevista({ latitude: ENDERECO.latitude + 0.05 }),
      contexto({ coordenadaEndereco: null }),
    );
    expect(alertas).toEqual([]);
  });
});

describe('território designado', () => {
  it('acusa entrevista fora do território do entrevistador', () => {
    const alertas = avaliarEntrevista(
      entrevista(),
      contexto({ idBairroDeclarado: 'bairro-x', territoriosDesignados: ['bairro-a', 'bairro-b'] }),
    );
    expect(alertas.map((a) => a.tipo)).toContain('FORA_DO_TERRITORIO');
  });

  it('não acusa quando o entrevistador não tem território restrito', () => {
    const alertas = avaliarEntrevista(
      entrevista(),
      contexto({ idBairroDeclarado: 'bairro-x', territoriosDesignados: [] }),
    );
    expect(alertas).toEqual([]);
  });
});

describe('volume por hora', () => {
  const emMinutos = (minutos: number): Date =>
    new Date(AGORA.getTime() - minutos * 60 * 1000);

  it('acusa mais de 20 entrevistas na mesma hora', () => {
    const anteriores = Array.from({ length: 20 }, (_, i) => emMinutos(i + 1));
    const alertas = avaliarEntrevista(
      entrevista(),
      contexto({ entrevistasNaUltimaHora: anteriores }),
    );
    const volume = alertas.find((a) => a.tipo === 'VOLUME_IMPROVAVEL');
    expect(volume).toBeDefined();
    expect(volume?.detalhe['entrevistasNaHora']).toBe(21);
  });

  it('não acusa no limite exato de 20', () => {
    const anteriores = Array.from({ length: 19 }, (_, i) => emMinutos(i + 1));
    const alertas = avaliarEntrevista(
      entrevista(),
      contexto({ entrevistasNaUltimaHora: anteriores }),
    );
    expect(alertas.map((a) => a.tipo)).not.toContain('VOLUME_IMPROVAVEL');
  });

  it('desconsidera entrevistas fora da janela de uma hora', () => {
    const anteriores = Array.from({ length: 30 }, (_, i) => emMinutos(61 + i));
    const alertas = avaliarEntrevista(
      entrevista(),
      contexto({ entrevistasNaUltimaHora: anteriores }),
    );
    expect(alertas).toEqual([]);
  });
});

describe('calcularIndiceQualidade', () => {
  it('devolve 1 para entrevistador sem alertas', () => {
    expect(calcularIndiceQualidade(50, [])).toBe(1);
  });

  it('devolve 1 quando ainda não há entrevistas', () => {
    expect(calcularIndiceQualidade(0, [])).toBe(1);
  });

  it('pesa gravidade em vez de contar ocorrências', () => {
    const dezLeves = calcularIndiceQualidade(50, Array(10).fill({ gravidade: 1 as const }));
    const umGrave = calcularIndiceQualidade(50, [{ gravidade: 3 }]);
    // Dez avisos de "sem GPS" em área rural incomodam menos que um único caso
    // de volume impossível: o índice do grave precisa ficar MAIS baixo, mesmo
    // sendo uma ocorrência contra dez.
    expect(dezLeves).toBeLessThan(1);
    expect(umGrave).toBeLessThan(dezLeves);
  });

  it('nunca sai do intervalo [0, 1]', () => {
    const catastrofe = calcularIndiceQualidade(2, Array(50).fill({ gravidade: 3 as const }));
    expect(catastrofe).toBe(0);
  });
});
