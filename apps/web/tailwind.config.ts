import type { Config } from 'tailwindcss';

/**
 * As cores não são declaradas aqui: vivem como variáveis CSS em
 * `pacotes/ui/src/tema/tokens.css` e são usadas via valor arbitrário
 * (`bg-[hsl(var(--acento))]`). O motivo é o acento por campanha, que é trocado
 * em tempo de execução — uma paleta compilada não conseguiria acompanhar.
 */
const configuracao: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './componentes/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../pacotes/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Escala de 4px, como manda a direção visual.
      spacing: { '4.5': '1.125rem', '18': '4.5rem' },
      borderRadius: { DEFAULT: 'var(--raio)' },
      fontFamily: {
        sans: ['var(--fonte-interface)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default configuracao;
