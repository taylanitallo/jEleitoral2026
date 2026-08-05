'use client';

import dynamic from 'next/dynamic';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EstadoVazio } from '@jeleitoral/ui';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { useCoresDoTema } from '@/lib/useCoresDoTema';
import { useMovimentoReduzido } from '@/lib/useMovimentoReduzido';
import { Grafico3D } from './Grafico3D';
import type { LinhaIntencao } from './CenaBarrasIntencao';

const CenaBarrasIntencao = dynamic(() => import('./CenaBarrasIntencao'), { ssr: false });

/** Uma coluna por cargo, uma barra por candidato — a forma 2D do mesmo agrupamento do 3D. */
function paraSerie2D(dados: LinhaIntencao[]): {
  linhas: Array<Record<string, string | number>>;
  candidatos: string[];
} {
  const candidatos = Array.from(new Set(dados.map((linha) => linha.candidato)));
  const porCargo = new Map<string, Record<string, string | number>>();
  for (const linha of dados) {
    const registro = porCargo.get(linha.cargo) ?? { cargo: linha.cargo };
    registro[linha.candidato] = linha.intencoes;
    porCargo.set(linha.cargo, registro);
  }
  return { linhas: Array.from(porCargo.values()), candidatos };
}

export function Barras3DIntencao({ dados }: { dados: LinhaIntencao[] }): JSX.Element {
  const cores = useCoresDoTema();
  const movimentoReduzido = useMovimentoReduzido();

  if (dados.length === 0) {
    return (
      <EstadoVazio
        titulo="Sem intenções no recorte"
        descricao="O gráfico aparece assim que houver intenções de voto registradas."
      />
    );
  }

  const { linhas, candidatos } = paraSerie2D(dados);
  const coresCandidato = [
    '#2563eb',
    '#16a34a',
    '#ea580c',
    '#9333ea',
    '#0891b2',
    '#ca8a04',
    '#db2777',
    '#4d7c0f',
  ];

  const colunas: Array<Coluna<LinhaIntencao>> = [
    { chave: 'cargo', rotulo: 'Cargo', render: (linha) => linha.cargo },
    { chave: 'candidato', rotulo: 'Candidato', render: (linha) => linha.candidato },
    {
      chave: 'numero_urna',
      rotulo: 'Número',
      numerico: true,
      render: (linha) => linha.numero_urna ?? '—',
    },
    { chave: 'intencoes', rotulo: 'Intenções', numerico: true, render: (linha) => linha.intencoes },
  ];

  return (
    <Grafico3D
      chave="relatorio-barras-intencao"
      render3D={
        <CenaBarrasIntencao dados={dados} cores={cores} movimentoReduzido={movimentoReduzido} />
      }
      render2D={
        <div className="flex flex-col gap-3">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={linhas} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--borda))" />
                <XAxis
                  dataKey="cargo"
                  tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 11 }}
                  stroke="hsl(var(--borda))"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 11 }}
                  stroke="hsl(var(--borda))"
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--superficie))',
                    border: '1px solid hsl(var(--borda))',
                    borderRadius: 'var(--raio)',
                    color: 'hsl(var(--texto))',
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {candidatos.map((candidato, indice) => (
                  <Bar
                    key={candidato}
                    dataKey={candidato}
                    fill={coresCandidato[indice % coresCandidato.length]}
                    radius={[3, 3, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Tabela
            linhas={dados}
            chaveDe={(linha) => `${linha.cargo}:${linha.candidato}`}
            colunas={colunas}
          />
        </div>
      }
    />
  );
}
