import { Injectable, Logger } from '@nestjs/common';
import { BancoService } from '../banco/banco.service.js';

/**
 * Descobre se um token ainda reflete as permissões atuais do usuário.
 *
 * O problema: as permissões viajam **dentro** do JWT. Tirar `financeiro.gerenciar`
 * de alguém não faz efeito nenhum enquanto o token dessa pessoa não for
 * reemitido. Desligar um coordenador que saiu da campanha, numa sexta à tarde,
 * não o desligava.
 *
 * A solução tem um custo que precisa ser administrado: uma consulta ao banco
 * por requisição autenticada. Daí o cache.
 *
 * **Por que o cache é seguro apesar de servir dado velho.** O que se armazena é
 * o instante da última invalidação, e a janela é de segundos. O pior caso é um
 * usuário continuar com o token antigo por mais alguns segundos depois da
 * mudança — contra a alternativa real, que era continuar por até uma hora, ou
 * até o próximo login. E a metade que de fato tranca a porta é o RLS, que lê
 * o banco a cada consulta, sem cache.
 */
const JANELA_CACHE_MS = 10_000;

/** Não guarda a base inteira: uma campanha grande tem centenas de usuários. */
const TAMANHO_MAXIMO_CACHE = 5_000;

@Injectable()
export class RevogacaoService {
  private readonly registrador = new Logger(RevogacaoService.name);
  private readonly cache = new Map<string, { valor: number; expiraEm: number }>();

  constructor(private readonly banco: BancoService) {}

  /**
   * `true` quando o token foi emitido antes da última invalidação.
   *
   * `iat` vem em segundos (padrão JWT) e a marca em milissegundos. Comparar sem
   * converter daria "sempre desatualizado" — 401 em toda requisição, para todo
   * mundo, com o sistema parecendo simplesmente quebrado.
   */
  async tokenDesatualizado(idUsuario: string, iatSegundos: number | undefined): Promise<boolean> {
    if (iatSegundos === undefined) return false;

    const invalidoApos = await this.invalidoApos(idUsuario);
    if (invalidoApos === null) return false;

    /*
     * Um segundo de tolerância.
     *
     * O `iat` do JWT é truncado para segundos inteiros, e a marca tem precisão
     * de microssegundo. Um token emitido 300 ms depois da invalidação chega com
     * `iat` arredondado para baixo e pareceria anterior a ela — o cliente
     * renovaria, receberia outro token igualmente "velho", e o laço só pararia
     * no limite de tentativas.
     */
    return iatSegundos * 1000 + 1000 < invalidoApos;
  }

  private async invalidoApos(idUsuario: string): Promise<number | null> {
    const agora = Date.now();
    const emCache = this.cache.get(idUsuario);
    if (emCache && emCache.expiraEm > agora) return emCache.valor;

    try {
      const linha = await this.banco.executarEmTabelasDeReferencia(async (conexao) => {
        const { rows } = await conexao.query<{ marca: Date | null }>(
          'select public.claims_invalidos_apos($1) as marca',
          [idUsuario],
        );
        return rows[0]?.marca ?? null;
      });

      // Usuário que não está em `public.usuarios` — o do backoffice do provedor.
      // Nada a revogar por aqui.
      const valor = linha ? linha.getTime() : 0;

      if (this.cache.size >= TAMANHO_MAXIMO_CACHE) this.cache.clear();
      this.cache.set(idUsuario, { valor, expiraEm: agora + JANELA_CACHE_MS });
      return valor;
    } catch (erro) {
      /*
       * Banco indisponível **não** derruba a sessão de ninguém.
       *
       * A escolha é deliberada e vale a pena declarar: negar aqui transformaria
       * uma indisponibilidade momentânea do Postgres num logout em massa no
       * meio de um dia de campo. E não há perda real de segurança — o RLS
       * continua sendo a barreira que decide o que cada um enxerga, e ele
       * também depende do banco: sem banco, não há dado a proteger.
       */
      this.registrador.warn(`Não foi possível verificar revogação: ${String(erro)}`);
      return null;
    }
  }

  /** Descarta o cache de um usuário, para que a próxima requisição releia. */
  esquecer(idUsuario: string): void {
    this.cache.delete(idUsuario);
  }
}
