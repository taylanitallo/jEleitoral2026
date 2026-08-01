'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Posicao {
  latitude: number;
  longitude: number;
  precisaoMetros: number;
}

/**
 * Captura de geolocalização para o formulário de campo.
 *
 * Nunca bloqueia o preenchimento. O GPS demora, falha dentro de prédio e é
 * negado por muitos usuários — condicionar a entrevista a ele significaria
 * perder coleta. A posição entra como enriquecimento: quando existe, alimenta
 * o antifraude; quando não, a entrevista gera apenas um aviso leve de
 * `SEM_GEOLOCALIZACAO`, que é informação e não acusação.
 */
export function useGeolocalizacao(): {
  posicao: Posicao | null;
  estado: 'inicial' | 'obtendo' | 'obtida' | 'negada' | 'indisponivel';
  solicitar: () => void;
} {
  const [posicao, definirPosicao] = useState<Posicao | null>(null);
  const [estado, definirEstado] = useState<
    'inicial' | 'obtendo' | 'obtida' | 'negada' | 'indisponivel'
  >('inicial');

  const solicitar = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      definirEstado('indisponivel');
      return;
    }
    definirEstado('obtendo');
    navigator.geolocation.getCurrentPosition(
      (resultado) => {
        definirPosicao({
          latitude: resultado.coords.latitude,
          longitude: resultado.coords.longitude,
          precisaoMetros: resultado.coords.accuracy,
        });
        definirEstado('obtida');
      },
      (erro) => {
        definirEstado(erro.code === erro.PERMISSION_DENIED ? 'negada' : 'indisponivel');
      },
      // `enableHighAccuracy` custa bateria, que em campo acaba antes do dia.
      // 20 s de tolerância e cache de 1 min: o entrevistador anda pouco entre
      // duas casas da mesma rua.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }, []);

  // Pede a posição assim que a tela abre, para que ela já esteja pronta quando
  // o entrevistador terminar de preencher.
  useEffect(() => {
    solicitar();
  }, [solicitar]);

  return { posicao, estado, solicitar };
}
