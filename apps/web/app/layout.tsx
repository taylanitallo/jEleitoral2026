import type { Metadata, Viewport } from 'next';
import { ProvedorTema, SCRIPT_TEMA_INICIAL } from '@jeleitoral/ui';
import { Cabecalho } from '@/componentes/Cabecalho';
import './globals.css';

export const metadata: Metadata = {
  title: 'jEleitoral',
  description: 'Mapeamento, projeção e gestão eleitoral — Eleições Gerais 2026',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // O entrevistador usa o celular na rua, muitas vezes no sol. Bloquear zoom
  // seria hostil com quem tem dificuldade de leitura.
  maximumScale: 5,
};

export default function LayoutRaiz({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/*
          Aplica o tema antes da primeira pintura. Sem isto, quem usa tema
          escuro leva um flash branco a cada navegação — desconfortável em
          qualquer tela e péssimo à noite, que é quando a apuração acontece.
        */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="min-h-dvh antialiased">
        <ProvedorTema>
          <Cabecalho />
          {children}
        </ProvedorTema>
      </body>
    </html>
  );
}
