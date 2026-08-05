'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface PontoTendencia {
  dia: string;
  total: number;
}

/**
 * Série diária simples — um ponto por dia, uma linha.
 *
 * Reutilizado por qualquer tela que precise mostrar "quanto por dia": o
 * painel (entrevistas), o relatório de evolução diária, e a projeção com
 * banda. O eixo X usa `toLocaleDateString` sem ano — a série nunca cruza
 * mais de alguns meses, e o ano só ocuparia espaço.
 */
export function GraficoTendencia({
  dados,
  rotulo,
  ressalva,
}: {
  dados: PontoTendencia[];
  rotulo: string;
  ressalva?: string;
}): JSX.Element {
  if (dados.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--texto-fraco))]">
        Sem dados suficientes para desenhar a série ainda.
      </p>
    );
  }

  const linhas = dados.map((ponto) => ({
    ...ponto,
    rotuloDia: new Date(`${ponto.dia}T00:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    }),
  }));

  return (
    <div className="flex flex-col gap-1">
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={linhas} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--borda))" />
            <XAxis
              dataKey="rotuloDia"
              tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 11 }}
              stroke="hsl(var(--borda))"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 11 }}
              stroke="hsl(var(--borda))"
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--superficie))',
                border: '1px solid hsl(var(--borda))',
                borderRadius: 'var(--raio)',
                color: 'hsl(var(--texto))',
                fontSize: 12,
              }}
              formatter={(valor: number) => [valor, rotulo]}
              labelFormatter={(_rotulo, item) => {
                const ponto = item[0]?.payload as (typeof linhas)[number] | undefined;
                return ponto?.dia ?? '';
              }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="hsl(var(--acento))"
              strokeWidth={2}
              dot={{ r: 3, fill: 'hsl(var(--acento))' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {ressalva ? <p className="text-xs text-[hsl(var(--texto-fraco))]">{ressalva}</p> : null}
    </div>
  );
}
