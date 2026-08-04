import {
  Building2,
  CalendarDays,
  ClipboardList,
  Compass,
  FileBarChart,
  Home,
  Image,
  LayoutDashboard,
  Map,
  Megaphone,
  Sparkles,
  Target,
  TrendingUp,
  UserSquare2,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * A árvore de navegação, em um lugar só.
 *
 * Sidebar e abas leem daqui. Quando eram duas listas, bastava alguém
 * acrescentar uma tela em uma delas para o item aparecer no menu e sumir das
 * abas — ou o contrário, que é pior, porque a aba existe e a sidebar não a
 * revela.
 *
 * `permissao` é a chave que o token precisa trazer. O item que o perfil não
 * pode usar **não aparece**: um item visível e depois recusado pela API ensina
 * o usuário a esbarrar em porta trancada.
 */
export interface ItemModulo {
  href: string;
  rotulo: string;
  permissao: string;
}

export interface GrupoModulos {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  /**
   * Prefixo de rota do grupo, usado para descobrir qual grupo está ativo. Não é
   * derivado do `href` do primeiro item de propósito: `/cadastros` hospeda
   * telas de grupos diferentes, e o prefixo precisa ser mais específico que a
   * pasta.
   */
  itens: ItemModulo[];
}

export const GRUPOS: GrupoModulos[] = [
  {
    id: 'painel',
    rotulo: 'Painel',
    icone: LayoutDashboard,
    itens: [{ href: '/painel', rotulo: 'Visão geral', permissao: 'campo.ler' }],
  },
  {
    id: 'campo',
    rotulo: 'Campo',
    icone: ClipboardList,
    itens: [
      { href: '/campo/entrevista', rotulo: 'Entrevista', permissao: 'campo.gerenciar' },
    ],
  },
  {
    id: 'planejamento',
    rotulo: 'Planejamento',
    icone: Compass,
    itens: [
      { href: '/planejamento/areas', rotulo: 'Áreas', permissao: 'planejamento.ler' },
      {
        href: '/planejamento/narrativa',
        rotulo: 'Narrativa',
        permissao: 'planejamento.ler',
      },
      {
        href: '/planejamento/diagnostico',
        rotulo: 'Diagnóstico',
        permissao: 'diagnostico.ler',
      },
    ],
  },
  {
    id: 'agenda',
    rotulo: 'Agenda',
    icone: CalendarDays,
    itens: [{ href: '/agenda', rotulo: 'Atividades', permissao: 'agenda.ler' }],
  },
  {
    id: 'mobilizacao',
    rotulo: 'Mobilização',
    icone: Megaphone,
    itens: [
      { href: '/mobilizacao/ativistas', rotulo: 'Militância', permissao: 'mobilizacao.ler' },
      { href: '/mobilizacao/comites', rotulo: 'Comitês', permissao: 'mobilizacao.ler' },
      { href: '/divulgacao', rotulo: 'Divulgação', permissao: 'divulgacao.ler' },
    ],
  },
  {
    id: 'eleicao',
    rotulo: 'Eleição',
    icone: Target,
    itens: [
      { href: '/cadastros/candidatos', rotulo: 'Candidatos', permissao: 'candidatos.ler' },
      { href: '/cadastros/territorio', rotulo: 'Território', permissao: 'territorio.gerenciar' },
      { href: '/cadastros/metas', rotulo: 'Metas', permissao: 'metas.ler' },
      { href: '/projecao', rotulo: 'Projeção', permissao: 'projecao.ler' },
    ],
  },
  {
    id: 'gestao',
    rotulo: 'Gestão',
    icone: Building2,
    itens: [
      { href: '/cadastros/campanhas', rotulo: 'Campanhas', permissao: 'campanhas.gerenciar' },
      { href: '/cadastros/usuarios', rotulo: 'Equipe', permissao: 'usuarios.ler' },
      { href: '/cadastros/financeiro', rotulo: 'Financeiro', permissao: 'financeiro.ler' },
      { href: '/cadastros/artes', rotulo: 'Artes', permissao: 'artes.ler' },
      { href: '/configuracoes/ia', rotulo: 'Uso de IA', permissao: 'ia.usar' },
    ],
  },
  {
    id: 'relatorios',
    rotulo: 'Relatórios',
    icone: FileBarChart,
    itens: [
      { href: '/relatorios', rotulo: 'Exportações', permissao: 'relatorios.exportar' },
    ],
  },
];

/** Ícones por rota, para a aba e o título da tela. */
export const ICONE_POR_ROTA: Record<string, LucideIcon> = {
  '/painel': LayoutDashboard,
  '/campo/entrevista': ClipboardList,
  '/planejamento/areas': Compass,
  '/planejamento/narrativa': Compass,
  '/planejamento/diagnostico': ClipboardList,
  '/agenda': CalendarDays,
  '/mobilizacao/ativistas': Megaphone,
  '/mobilizacao/comites': Home,
  '/divulgacao': Megaphone,
  '/cadastros/candidatos': UserSquare2,
  '/cadastros/territorio': Map,
  '/cadastros/metas': Target,
  '/projecao': TrendingUp,
  '/cadastros/campanhas': Building2,
  '/cadastros/usuarios': Users,
  '/cadastros/financeiro': Wallet,
  '/cadastros/artes': Image,
  '/configuracoes/ia': Sparkles,
  '/relatorios': FileBarChart,
};

/**
 * Descobre o grupo a que uma rota pertence.
 *
 * Compara pelo `href` mais LONGO que casa, e não pelo primeiro: `/painel` e
 * `/planejamento/areas` compartilham prefixo, e a comparação ingênua colocaria
 * o planejamento dentro do painel.
 */
export function grupoDaRota(caminho: string): GrupoModulos | null {
  let melhor: { grupo: GrupoModulos; tamanho: number } | null = null;

  for (const grupo of GRUPOS) {
    for (const item of grupo.itens) {
      if (caminho === item.href || caminho.startsWith(`${item.href}/`)) {
        if (!melhor || item.href.length > melhor.tamanho) {
          melhor = { grupo, tamanho: item.href.length };
        }
      }
    }
  }

  return melhor?.grupo ?? null;
}

/** Filtra a árvore pelas permissões do token, descartando grupo que ficou vazio. */
export function gruposVisiveis(permissoes: Record<string, string> | null): GrupoModulos[] {
  if (!permissoes) return GRUPOS;
  return GRUPOS.map((grupo) => ({
    ...grupo,
    itens: grupo.itens.filter((item) => Boolean(permissoes[item.permissao])),
  })).filter((grupo) => grupo.itens.length > 0);
}
