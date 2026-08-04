import type { Metadata, Viewport } from 'next';
import { ProvedorTema, SCRIPT_TEMA_INICIAL } from '@jeleitoral/ui';
import { Estrutura } from '@/componentes/navegacao/Estrutura';
import { RegistrarServiceWorker } from '@/componentes/RegistrarServiceWorker';
import './globals.css';

export const metadata: Metadata = {
  title: 'jEleitoral',
  description: 'Mapeamento, projeção e gestão eleitoral — Eleições Gerais 2026',
  robots: { index: false, follow: false },
  manifest: '/manifest.json',
  // Instalado na tela inicial, o aplicativo abre sem barra de navegador — é
  // assim que o entrevistador usa em campo.
  appleWebApp: {
    capable: true,
    title: 'jEleitoral',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icone-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icone-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // O entrevistador usa o celular na rua, muitas vezes no sol. Bloquear zoom
  // seria hostil com quem tem dificuldade de leitura.
  maximumScale: 5,
  themeColor: '#1450d2',
  // Instalado, o aplicativo ocupa a tela inteira: a barra de status precisa
  // acompanhar o fundo em vez de deixar uma faixa branca no aparelho recortado.
  viewportFit: 'cover',
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
          <RegistrarServiceWorker />
          <Estrutura>{children}</Estrutura>
        </ProvedorTema>
      </body>
    </html>
  );
}
