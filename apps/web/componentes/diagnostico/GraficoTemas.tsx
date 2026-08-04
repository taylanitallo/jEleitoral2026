'use client';

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
import { RotuloTemaProblema, type TemaProblema } from '@jeleitoral/tipos';

export interface TemaAgregado {
  tema: TemaProblema;
  problemas: number;
  relatos: number;
  gravidadeMedia: number;
}

/**
 * Temas mais citados no diagnóstico.
 *
 * Barras horizontais, e não verticais: rótulo de tema é palavra ("Assistência
 * social", "Infraestrutura"), e em barra vertical o texto ou gira 45 graus ou
 * é truncado. Deitar o gráfico deixa o rótulo legível e resolve de graça o
 * problema de caber no celular.
 *
 * Ordena por RELATOS, não por quantidade de problemas: um problema citado
 * quarenta vezes pesa mais que quatro problemas citados uma vez cada, e a
 * contagem simples diria o contrário.
 *
 * A cor codifica gravidade, mas **nunca sozinha** — o valor numérico aparece no
 * eixo e a gravidade média vai na dica. Cor como único portador de informação
 * quebra WCAG 1.4.1 e some para quem imprime em preto e branco, que é como o
 * coordenador leva o material para a reunião.
 */
export function GraficoTemas({ dados }: { dados: TemaAgregado[] }): JSX.Element {
  if (dados.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--texto-fraco))]">
        Nenhum problema registrado ainda — o gráfico aparece quando houver.
      </p>
    );
  }

  const linhas = dados.map((item) => ({
    ...item,
    rotulo: RotuloTemaProblema[item.tema] ?? item.tema,
  }));

  // Cor por faixa de gravidade média, reusando os tokens semânticos do tema em
  // vez de inventar uma paleta que não acompanha o modo escuro.
  const corDaGravidade = (gravidade: number): string => {
    if (gravidade >= 4) return 'hsl(var(--perigo))';
    if (gravidade >= 3) return 'hsl(var(--atencao))';
    return 'hsl(var(--informacao))';
  };

  return (
    <div className="w-full" style={{ height: Math.max(200, linhas.length * 34 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={linhas} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid horizontal={false} stroke="hsl(var(--borda))" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fill: 'hsl(var(--texto-secundario))', fontSize: 12 }}
            stroke="hsl(var(--borda))"
          />
          <YAxis
            type="category"
            dataKey="rotulo"
            width={130}
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
              const linha = item.payload as (typeof linhas)[number];
              return [
                `${valor} ${valor === 1 ? 'relato' : 'relatos'} · ${linha.problemas} ${
                  linha.problemas === 1 ? 'problema' : 'problemas'
                } · gravidade média ${linha.gravidadeMedia.toFixed(1).replace('.', ',')}`,
                'Citações',
              ];
            }}
          />
          <Bar dataKey="relatos" radius={[0, 4, 4, 0]}>
            {linhas.map((linha) => (
              <Cell key={linha.tema} fill={corDaGravidade(linha.gravidadeMedia)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
