'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import type { Color, Mesh } from 'three';
import type { ClassificacaoEleitor } from '@jeleitoral/tipos';
import type { CoresGrafico3D } from '@/lib/useCoresDoTema';

export interface PontoBairro {
  idBairro: string;
  nome: string;
  mapeados: number;
  classificacaoDominante: ClassificacaoEleitor | null;
}

const ALTURA_MAXIMA = 3.2;
const ESPACAMENTO = 1.35;

function corDaClassificacao3D(
  classificacao: ClassificacaoEleitor | null,
  cores: CoresGrafico3D,
): Color {
  switch (classificacao) {
    case 'APOIADOR':
      return cores.apoiador;
    case 'PROVAVEL':
      return cores.provavel;
    case 'INDECISO':
      return cores.indeciso;
    case 'OPOSICAO':
      return cores.oposicao;
    default:
      return cores.naoInformou;
  }
}

function BlocoBairro({
  ponto,
  posicao,
  alturaAlvo,
  cor,
  selecionado,
  movimentoReduzido,
  aoSelecionar,
}: {
  ponto: PontoBairro;
  posicao: [number, number];
  alturaAlvo: number;
  cor: Color;
  selecionado: boolean;
  movimentoReduzido: boolean;
  aoSelecionar: (idBairro: string) => void;
}): JSX.Element {
  const malha = useRef<Mesh>(null);
  const alturaAtual = useRef(movimentoReduzido ? alturaAlvo : 0.05);

  useFrame((_estado, delta) => {
    if (!malha.current) return;
    const alvo = Math.max(0.05, alturaAlvo);
    if (movimentoReduzido) {
      alturaAtual.current = alvo;
    } else {
      // ~400ms para alcançar o alvo: "a altura anima do valor anterior ao
      // novo" — é o que comunica visualmente o que o filtro mudou.
      alturaAtual.current += (alvo - alturaAtual.current) * Math.min(1, delta / 0.4);
    }
    malha.current.scale.y = alturaAtual.current;
    malha.current.position.y = alturaAtual.current / 2;
  });

  return (
    <group position={[posicao[0], 0, posicao[1]]}>
      <mesh
        ref={malha}
        onClick={(evento) => {
          evento.stopPropagation();
          aoSelecionar(ponto.idBairro);
        }}
      >
        <boxGeometry args={[0.9, 1, 0.9]} />
        <meshStandardMaterial
          color={cor}
          emissive={selecionado ? cor : undefined}
          emissiveIntensity={selecionado ? 0.4 : 0}
        />
      </mesh>
      <Text
        position={[0, ALTURA_MAXIMA + 0.5, 0]}
        fontSize={0.22}
        color="#1f2937"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.01}
        outlineColor="#ffffff"
      >
        {`${ponto.nome}\n${ponto.mapeados}`}
      </Text>
    </group>
  );
}

/**
 * Grade de blocos por bairro — sem malha geográfica real (decisão explícita
 * do plano: começar sem, evoluir depois com a malha do IBGE). Altura =
 * mapeados, cor = classificação dominante. Clicar aplica o filtro de bairro,
 * e o painel inteiro recalcula — é o "se mexem de acordo com os filtros"
 * pedido, na direção de saída (tela → filtro) e na de entrada (filtro →
 * altura anima até o novo valor).
 */
export default function CenaMapaBairros({
  dados,
  cores,
  movimentoReduzido,
  idBairroSelecionado,
  aoSelecionar,
}: {
  dados: PontoBairro[];
  cores: CoresGrafico3D;
  movimentoReduzido: boolean;
  idBairroSelecionado: string | null;
  aoSelecionar: (idBairro: string) => void;
}): JSX.Element {
  const maiorValor = Math.max(1, ...dados.map((ponto) => ponto.mapeados));
  const colunas = Math.max(1, Math.ceil(Math.sqrt(dados.length)));

  const posicionados = useMemo(
    () =>
      dados.map((ponto, indice) => {
        const linha = Math.floor(indice / colunas);
        const coluna = indice % colunas;
        const deslocamentoX = ((colunas - 1) * ESPACAMENTO) / 2;
        const deslocamentoZ = ((Math.ceil(dados.length / colunas) - 1) * ESPACAMENTO) / 2;
        return {
          ponto,
          posicao: [coluna * ESPACAMENTO - deslocamentoX, linha * ESPACAMENTO - deslocamentoZ] as [
            number,
            number,
          ],
        };
      }),
    [dados, colunas],
  );

  return (
    <Canvas camera={{ position: [0, 7, 8], fov: 45 }} dpr={[1, 1.75]}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />
      <group>
        {posicionados.map(({ ponto, posicao }) => (
          <BlocoBairro
            key={ponto.idBairro}
            ponto={ponto}
            posicao={posicao}
            alturaAlvo={(ponto.mapeados / maiorValor) * ALTURA_MAXIMA}
            cor={corDaClassificacao3D(ponto.classificacaoDominante, cores)}
            selecionado={ponto.idBairro === idBairroSelecionado}
            movimentoReduzido={movimentoReduzido}
            aoSelecionar={aoSelecionar}
          />
        ))}
      </group>
      <OrbitControls
        enablePan={false}
        minDistance={4}
        maxDistance={16}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}
