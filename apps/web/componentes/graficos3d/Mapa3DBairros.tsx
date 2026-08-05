'use client';

import dynamic from 'next/dynamic';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EstadoVazio, EtiquetaClassificacao, corDaClassificacao } from '@jeleitoral/ui';
import { RotuloClassificacaoEleitor } from '@jeleitoral/tipos';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { useCoresDoTema } from '@/lib/useCoresDoTema';
import { useMovimentoReduzido } from '@/lib/useMovimentoReduzido';
import { Grafico3D } from './Grafico3D';
import type { PontoBairro } from './CenaMapaBairros';

// `next/dynamic({ ssr: false })`: `three` toca `window` na importação, e o
// chunk só entra no bundle de quem realmente monta este componente — nunca
// em `/campo/*`, que não importa nada deste diretório.
const CenaMapaBairros = dynamic(() => import('./CenaMapaBairros'), { ssr: false });

export function Mapa3DBairros({
  dados,
  idBairroSelecionado,
  aoSelecionar,
}: {
  dados: PontoBairro[];
  idBairroSelecionado: string | null;
  aoSelecionar: (idBairro: string) => void;
}): JSX.Element {
  const cores = useCoresDoTema();
  const movimentoReduzido = useMovimentoReduzido();

  if (dados.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum bairro com mapeamento"
        descricao="O mapa aparece assim que houver eleitores mapeados no recorte."
      />
    );
  }

  const colunas: Array<Coluna<PontoBairro>> = [
    { chave: 'nome', rotulo: 'Bairro', render: (linha) => linha.nome },
    { chave: 'mapeados', rotulo: 'Mapeados', numerico: true, render: (linha) => linha.mapeados },
    {
      chave: 'classificacao',
      rotulo: 'Classificação dominante',
      render: (linha) =>
        linha.classificacaoDominante ? (
          <EtiquetaClassificacao classificacao={linha.classificacaoDominante} compacta />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Grafico3D
      chave="painel-mapa-bairros"
      render3D={
        <CenaMapaBairros
          dados={dados}
          cores={cores}
          movimentoReduzido={movimentoReduzido}
          idBairroSelecionado={idBairroSelecionado}
          aoSelecionar={aoSelecionar}
        />
      }
      render2D={
        <div className="flex flex-col gap-3">
          <div style={{ height: Math.max(220, dados.length * 28) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dados}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
                onClick={(estado) => {
                  const ponto = estado?.activePayload?.[0]?.payload as PontoBairro | undefined;
                  if (ponto) aoSelecionar(ponto.idBairro);
                }}
              >
                <CartesianGrid horizontal={false} stroke="hsl(var(--borda))" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 12 }}
                  stroke="hsl(var(--borda))"
                />
                <YAxis
                  type="category"
                  dataKey="nome"
                  width={110}
                  tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 12 }}
                  stroke="hsl(var(--borda))"
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--fundo-sutil))' }}
                  contentStyle={{
                    background: 'hsl(var(--superficie))',
                    border: '1px solid hsl(var(--borda))',
                    borderRadius: 'var(--raio)',
                    color: 'hsl(var(--texto))',
                    fontSize: 12,
                  }}
                  formatter={(valor: number, _nome, item) => {
                    const ponto = item.payload as PontoBairro;
                    return [
                      `${valor} mapeado(s) · ${
                        ponto.classificacaoDominante
                          ? RotuloClassificacaoEleitor[ponto.classificacaoDominante]
                          : 'sem classificação dominante'
                      }`,
                      'Bairro',
                    ];
                  }}
                />
                <Bar dataKey="mapeados" radius={[0, 4, 4, 0]} cursor="pointer">
                  {dados.map((ponto) => (
                    <Cell
                      key={ponto.idBairro}
                      fill={
                        ponto.classificacaoDominante
                          ? corDaClassificacao(ponto.classificacaoDominante)
                          : 'hsl(var(--nao-informou))'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Tabela linhas={dados} chaveDe={(linha) => linha.idBairro} colunas={colunas} />
        </div>
      }
    />
  );
}
