import { redirect } from 'next/navigation';

/**
 * A raiz não tem conteúdo próprio: quem chega autenticado vai para o painel.
 *
 * Aqui havia um placeholder de "em construção" — que era o que o usuário via
 * depois de entrar, dando a impressão de que o login não tinha funcionado.
 */
export default function PaginaInicial(): never {
  redirect('/painel');
}
