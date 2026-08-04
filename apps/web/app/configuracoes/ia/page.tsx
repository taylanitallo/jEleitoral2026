'use client';

import { Sparkles, TriangleAlert } from 'lucide-react';
import { EstadoCarregando, cn } from '@jeleitoral/ui';
import { Tabela, type Coluna } from '@/componentes/cadastro/Tabela';
import { useListagem } from '@/lib/useListagem';

interface LinhaUso {
  funcionalidade: string;
  provedor: string;
  chamadas: number;
  falhas: number;
  tokens: number;
  custo: number;
}

interface ResumoUso {
  provedorAtivo: string;
  modeloPadrao: string;
  disponivel: boolean;
  tokensConsumidos: number;
  tetoMensal: number;
  custoTotal: number;
  porFuncionalidade: LinhaUso[];
}

const ROTULO_FUNCIONALIDADE: Record<string, string> = {
  diagnostico: 'Diagnóstico estratégico',
  revisao_texto: 'Revisão de texto',
  consulta_natural: 'Consulta em linguagem natural',
};

const numero = new Intl.NumberFormat('pt-BR');
const dolar = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * Consumo de IA do mês.
 *
 * Existe porque o teto de créditos passou a valer de verdade. Um limite que
 * corta a chamada sem que ninguém consiga ver quanto já se gastou produz
 * chamado de suporte, não economia.
 *
 * As falhas aparecem em coluna própria: chamada que estourou também consome
 * tokens de entrada, e um relatório que soma só o que deu certo mente para
 * menos — foi assim que o provedor instável ficou invisível por semanas.
 */
export default function PaginaUsoDeIa(): JSX.Element {
  const { dados, carregando, erro } = useListagem<ResumoUso>('/ia/uso');

  if (carregando) return <EstadoCarregando />;

  if (erro || !dados) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6">
        <p role="alert" className="text-sm text-[hsl(var(--perigo))]">
          {erro?.message ?? 'Não foi possível carregar o consumo de IA.'}
        </p>
      </main>
    );
  }

  const percentual = dados.tetoMensal > 0 ? dados.tokensConsumidos / dados.tetoMensal : 0;
  const perto = percentual >= 0.8;

  const colunas: Array<Coluna<LinhaUso>> = [
    {
      chave: 'funcionalidade',
      rotulo: 'Recurso',
      render: (l) => ROTULO_FUNCIONALIDADE[l.funcionalidade] ?? l.funcionalidade,
    },
    { chave: 'provedor', rotulo: 'Provedor', render: (l) => l.provedor },
    { chave: 'chamadas', rotulo: 'Chamadas', numerico: true, render: (l) => numero.format(l.chamadas) },
    {
      chave: 'falhas',
      rotulo: 'Falhas',
      numerico: true,
      render: (l) => (
        <span className={l.falhas > 0 ? 'text-[hsl(var(--perigo))]' : undefined}>
          {numero.format(l.falhas)}
        </span>
      ),
    },
    { chave: 'tokens', rotulo: 'Tokens', numerico: true, render: (l) => numero.format(l.tokens) },
    { chave: 'custo', rotulo: 'Custo', numerico: true, render: (l) => dolar.format(l.custo) },
  ];

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-[hsl(var(--texto))]">Uso de IA</h1>
        <p className="text-sm text-[hsl(var(--texto-secundario))]">
          Consumo do mês corrente, por recurso e por provedor.
        </p>
      </header>

      {!dados.disponivel ? (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-[var(--raio)] border border-[hsl(var(--atencao)/0.4)] bg-[hsl(var(--atencao-sutil))] p-3 text-sm text-[hsl(var(--atencao))]"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          Os recursos de IA estão desabilitados: falta a chave do provedor{' '}
          <strong>{dados.provedorAtivo}</strong> no ambiente.
        </p>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-3">
          <p className="text-xs text-[hsl(var(--texto-fraco))]">Provedor ativo</p>
          <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--texto))]">
            <Sparkles className="size-4 text-[hsl(var(--acento))]" aria-hidden="true" />
            {dados.provedorAtivo}
          </p>
          <p className="font-mono text-xs text-[hsl(var(--texto-fraco))]">{dados.modeloPadrao}</p>
        </div>

        <div className="rounded-[var(--raio)] border border-[hsl(var(--borda))] p-3">
          <p className="text-xs text-[hsl(var(--texto-fraco))]">Custo no mês</p>
          <p className="font-mono text-lg text-[hsl(var(--texto))]">
            {dolar.format(dados.custoTotal)}
          </p>
        </div>

        <div
          className={cn(
            'rounded-[var(--raio)] border p-3',
            perto
              ? 'border-[hsl(var(--atencao)/0.4)] bg-[hsl(var(--atencao-sutil))]'
              : 'border-[hsl(var(--borda))]',
          )}
        >
          <p className="text-xs text-[hsl(var(--texto-fraco))]">Tokens do teto mensal</p>
          <p className="font-mono text-lg text-[hsl(var(--texto))]">
            {numero.format(dados.tokensConsumidos)}{' '}
            <span className="text-sm text-[hsl(var(--texto-fraco))]">
              / {numero.format(dados.tetoMensal)}
            </span>
          </p>
          {perto ? (
            <p className="text-xs text-[hsl(var(--atencao))]">
              {(percentual * 100).toFixed(0)}% do teto. Ao atingir 100%, as chamadas de IA param.
            </p>
          ) : null}
        </div>
      </section>

      {dados.porFuncionalidade.length === 0 ? (
        <p className="text-sm text-[hsl(var(--texto-fraco))]">
          Nenhuma chamada de IA neste mês.
        </p>
      ) : (
        <Tabela
          colunas={colunas}
          linhas={dados.porFuncionalidade}
          chaveDe={(l) => `${l.funcionalidade}:${l.provedor}`}
        />
      )}

      <p className="text-xs text-[hsl(var(--texto-fraco))]">
        Chamadas que falharam também consomem tokens de entrada e por isso aparecem no total. Custo
        estimado a partir da tabela de preços do provedor; a fatura oficial é a dele.
      </p>
    </main>
  );
}
