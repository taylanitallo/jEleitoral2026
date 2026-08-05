'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import { Color, type Mesh } from 'three';
import type { CoresGrafico3D } from '@/lib/useCoresDoTema';

export interface LinhaIntencao {
  cargo: string;
  candidato: string;
  numero_urna: number | null;
  intencoes: number;
}

const ALTURA_MAXIMA = 3;
const ESPACAMENTO_CARGO = 2.6;
const ESPACAMENTO_CANDIDATO = 1.1;

/**
 * Paleta categórica fixa. A cor de um candidato vem do NÚMERO DE URNA — não
 * da posição na lista filtrada. Um candidato que muda de cor quando o filtro
 * muda é a forma mais enganosa de mentir com cor num gráfico de campanha.
 */
const PALETA = [0x2563eb, 0x16a34a, 0xea580c, 0x9333ea, 0x0891b2, 0xca8a04, 0xdb2777, 0x4d7c0f];

function corDoCandidato(numeroUrna: number | null, cores: CoresGrafico3D): Color {
  if (numeroUrna === null) return cores.naoInformou;
  const indice = numeroUrna % PALETA.length;
  return new Color(PALETA[indice]);
}

function BarraIntencao({
  posicao,
  alturaAlvo,
  cor,
  rotulo,
  movimentoReduzido,
}: {
  posicao: [number, number];
  alturaAlvo: number;
  cor: Color;
  rotulo: string;
  movimentoReduzido: boolean;
}): JSX.Element {
  const malha = useRef<Mesh>(null);
  const alturaAtual = useRef(movimentoReduzido ? alturaAlvo : 0.05);

  useFrame((_estado, delta) => {
    if (!malha.current) return;
    const alvo = Math.max(0.05, alturaAlvo);
    alturaAtual.current = movimentoReduzido
      ? alvo
      : alturaAtual.current + (alvo - alturaAtual.current) * Math.min(1, delta / 0.4);
    malha.current.scale.y = alturaAtual.current;
    malha.current.position.y = alturaAtual.current / 2;
  });

  return (
    <group position={[posicao[0], 0, posicao[1]]}>
      <mesh ref={malha}>
        <boxGeometry args={[0.8, 1, 0.8]} />
        <meshStandardMaterial color={cor} />
      </mesh>
      <Text
        position={[0, ALTURA_MAXIMA + 0.45, 0]}
        fontSize={0.2}
        color="#1f2937"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#ffffff"
        maxWidth={1.4}
        textAlign="center"
      >
        {rotulo}
      </Text>
    </group>
  );
}

/**
 * Barras 3D — X = cargo, Z = candidato dentro do cargo, Y = intenções.
 *
 * Barra 3D oclui e distorce magnitude por perspectiva — é o exemplo clássico
 * de má visualização. Três salvaguardas: o par 2D/tabela sempre presente
 * (`Barras3DIntencao.tsx`), rótulo numérico no topo de cada barra (abaixo), e
 * este componente nunca é montado sozinho — sempre dentro de `<Grafico3D>`,
 * que garante o par.
 */
export default function CenaBarrasIntencao({
  dados,
  cores,
  movimentoReduzido,
}: {
  dados: LinhaIntencao[];
  cores: CoresGrafico3D;
  movimentoReduzido: boolean;
}): JSX.Element {
  const cargos = useMemo(() => Array.from(new Set(dados.map((linha) => linha.cargo))), [dados]);
  const maiorValor = Math.max(1, ...dados.map((linha) => linha.intencoes));

  const barras = useMemo(() => {
    const lista: Array<{ linha: LinhaIntencao; posicao: [number, number] }> = [];
    cargos.forEach((cargo, indiceCargo) => {
      const doCargo = dados.filter((linha) => linha.cargo === cargo);
      const deslocamentoZ = ((doCargo.length - 1) * ESPACAMENTO_CANDIDATO) / 2;
      doCargo.forEach((linha, indiceCandidato) => {
        lista.push({
          linha,
          posicao: [
            indiceCargo * ESPACAMENTO_CARGO - ((cargos.length - 1) * ESPACAMENTO_CARGO) / 2,
            indiceCandidato * ESPACAMENTO_CANDIDATO - deslocamentoZ,
          ],
        });
      });
    });
    return lista;
  }, [dados, cargos]);

  return (
    <Canvas camera={{ position: [0, 6, 9], fov: 42 }} dpr={[1, 1.75]}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />
      {cargos.map((cargo, indiceCargo) => (
        <Text
          key={cargo}
          position={[
            indiceCargo * ESPACAMENTO_CARGO - ((cargos.length - 1) * ESPACAMENTO_CARGO) / 2,
            -0.3,
            2.6,
          ]}
          fontSize={0.24}
          color="#1f2937"
          anchorX="center"
          outlineWidth={0.01}
          outlineColor="#ffffff"
        >
          {cargo}
        </Text>
      ))}
      {barras.map(({ linha, posicao }) => (
        <BarraIntencao
          key={`${linha.cargo}:${linha.candidato}`}
          posicao={posicao}
          alturaAlvo={(linha.intencoes / maiorValor) * ALTURA_MAXIMA}
          cor={corDoCandidato(linha.numero_urna, cores)}
          rotulo={`${linha.candidato}\n${linha.intencoes}`}
          movimentoReduzido={movimentoReduzido}
        />
      ))}
      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={18}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
