import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Publica } from '../autenticacao/autenticacao.guard.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';

interface ItemSaude {
  disponivel: boolean;
  latenciaMs?: number;
  detalhe?: string;
}

/**
 * `/saude` — verificação de banco, Storage e integrações externas.
 *
 * A resposta distingue dois graus: `degradado` (uma fonte externa fora do ar,
 * mas o sistema funciona com os dados já sincronizados) e `indisponivel`
 * (banco fora — aí não há o que fazer). Essa distinção importa porque o TSE sai
 * do ar com frequência e isso NÃO deve derrubar a campanha.
 */
@Controller('saude')
export class SaudeController {
  constructor(private readonly banco: BancoService) {}

  @Get()
  @Publica()
  @HttpCode(HttpStatus.OK)
  async verificar(): Promise<{
    status: 'saudavel' | 'degradado' | 'indisponivel';
    verificadoEm: string;
    itens: Record<string, ItemSaude>;
  }> {
    const configuracao = carregarConfiguracao();
    const itens: Record<string, ItemSaude> = {};

    itens['banco'] = await this.banco.verificarSaude();

    const externas: Array<[string, string]> = [
      ['ibge', `${configuracao.IBGE_URL_BASE}/estados/35`],
      ['cep', `${configuracao.BRASILAPI_URL_BASE}/cep/v2/01001000`],
      ['tseDadosAbertos', `${configuracao.TSE_CKAN_URL_BASE}/package_list`],
    ];

    await Promise.all(
      externas.map(async ([nome, url]) => {
        itens[nome] = await this.verificarUrl(url, configuracao.INTEGRACOES_USER_AGENT);
      }),
    );

    const bancoOk = itens['banco']?.disponivel === true;
    const todasOk = Object.values(itens).every((item) => item.disponivel);

    return {
      status: !bancoOk ? 'indisponivel' : todasOk ? 'saudavel' : 'degradado',
      verificadoEm: new Date().toISOString(),
      itens,
    };
  }

  private async verificarUrl(url: string, userAgent: string): Promise<ItemSaude> {
    const inicio = Date.now();
    const cancelamento = AbortSignal.timeout(8000);
    try {
      const resposta = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': userAgent },
        signal: cancelamento,
      });
      return {
        disponivel: resposta.ok,
        latenciaMs: Date.now() - inicio,
        detalhe: resposta.ok ? undefined : `HTTP ${resposta.status}`,
      };
    } catch (erro) {
      return {
        disponivel: false,
        latenciaMs: Date.now() - inicio,
        detalhe: erro instanceof Error ? erro.message : 'falha de rede',
      };
    }
  }
}
