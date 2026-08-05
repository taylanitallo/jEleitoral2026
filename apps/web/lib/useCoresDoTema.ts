'use client';

import { useEffect, useState } from 'react';
import { Color } from 'three';
import { useTema } from '@jeleitoral/ui';

export interface CoresGrafico3D {
  acento: Color;
  apoiador: Color;
  provavel: Color;
  indeciso: Color;
  oposicao: Color;
  naoInformou: Color;
  superficie: Color;
  texto: Color;
}

/** HSL "142 71% 32%" (o formato dos tokens) → `THREE.Color`. */
function corDeVariavelHsl(nome: string, raiz: CSSStyleDeclaration): Color {
  const partes = raiz
    .getPropertyValue(nome)
    .trim()
    .split(/\s+/)
    .map((parte) => parseFloat(parte));
  const [h, s, l] = partes;
  const cor = new Color();
  cor.setHSL((h ?? 0) / 360, (s ?? 0) / 100, (l ?? 50) / 100);
  return cor;
}

function lerTodas(): CoresGrafico3D {
  const raiz = getComputedStyle(document.documentElement);
  return {
    acento: corDeVariavelHsl('--acento', raiz),
    apoiador: corDeVariavelHsl('--apoiador', raiz),
    provavel: corDeVariavelHsl('--provavel', raiz),
    indeciso: corDeVariavelHsl('--indeciso', raiz),
    oposicao: corDeVariavelHsl('--oposicao', raiz),
    naoInformou: corDeVariavelHsl('--nao-informou', raiz),
    superficie: corDeVariavelHsl('--superficie', raiz),
    texto: corDeVariavelHsl('--texto', raiz),
  };
}

const CORES_PADRAO: CoresGrafico3D = {
  acento: new Color(0x2563eb),
  apoiador: new Color(0x16a34a),
  provavel: new Color(0x0284c7),
  indeciso: new Color(0xca8a04),
  oposicao: new Color(0xdc2626),
  naoInformou: new Color(0x6b7280),
  superficie: new Color(0xffffff),
  texto: new Color(0x111827),
};

/**
 * Ponte entre os tokens de tema (HSL, em CSS) e `THREE.Color`.
 *
 * WebGL não lê variável CSS — o material precisa do valor já resolvido. A
 * troca de tema em CSS não dispara re-render nenhum (é o navegador trocando
 * a cor computada por baixo), então esta ponte tem que ir atrás: reage a
 * `temaAplicado` (troca explícita, `<ProvedorTema>`) e observa o próprio
 * `documentElement` (troca de `--acento` ao mudar de campanha, que
 * `ProvedorTema` aplica direto via `style.setProperty`, sem passar pelo
 * contexto React).
 */
export function useCoresDoTema(): CoresGrafico3D {
  const { temaAplicado } = useTema();
  const [cores, definirCores] = useState<CoresGrafico3D>(CORES_PADRAO);

  useEffect(() => {
    const recalcular = (): void => definirCores(lerTodas());
    recalcular();

    const observador = new MutationObserver(recalcular);
    observador.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema', 'style'],
    });
    return () => observador.disconnect();
  }, [temaAplicado]);

  return cores;
}
