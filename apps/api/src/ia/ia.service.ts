import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ClaimsUsuario } from '@jeleitoral/tipos';
import {
  Diagnostico,
  EsquemaJsonConsulta,
  EsquemaJsonDiagnostico,
  EsquemaJsonRevisao,
  InterpretacaoConsulta,
  RevisaoTexto,
} from './esquemasSaida.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import {
  garantirSemDadoPessoal,
  mascararDocumentosEmTexto,
  montarAdvertenciaDeCobertura,
} from './redacaoSegura.js';

/** Preço por milhão de tokens do Claude Opus 5, para registrar custo por campanha. */
const PRECO_ENTRADA_POR_MILHAO = 5;
const PRECO_SAIDA_POR_MILHAO = 25;

/**
 * Camada de IA.
 *
 * Três invariantes governam o arquivo:
 *
 *  1. **A chave nunca sai daqui.** Todo acesso ao modelo é servidor-a-servidor;
 *     o frontend chama o nosso endpoint, nunca a Anthropic.
 *  2. **Nenhum dado pessoal atravessa.** Todo payload passa por
 *     `garantirSemDadoPessoal`, que **recusa** em vez de sanitizar — um campo
 *     novo com nome inesperado é bloqueado, não silenciosamente aceito.
 *  3. **Todo custo é registrado** em `usos_ia`, por campanha. Sem isso, um laço
 *     mal feito no diagnóstico geraria fatura inesperada e ninguém saberia de
 *     qual cliente cobrar.
 */
@Injectable()
export class IaService {
  private readonly registrador = new Logger(IaService.name);
  private readonly cliente: Anthropic | null;
  private readonly modelo: string;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.modelo = configuracao.IA_MODELO_PADRAO;
    // Sem chave configurada o módulo sobe desabilitado em vez de derrubar a
    // API: IA é recurso acessório, e uma campanha em campo não pode parar
    // porque o diagnóstico está indisponível.
    this.cliente = configuracao.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: configuracao.ANTHROPIC_API_KEY })
      : null;
  }

  /**
   * Diagnóstico estratégico sobre o recorte filtrado.
   *
   * Recebe apenas agregados. A cobertura amostral entra no prompt e a
   * advertência é anexada **fora** do modelo — assim ela não depende de a IA
   * lembrar de escrevê-la.
   */
  async diagnosticar(
    claims: ClaimsUsuario,
    entrada: {
      idCampanha: string;
      agregados: Record<string, unknown>;
      coberturaAmostral: number;
    },
  ): Promise<{ diagnostico: Diagnostico; advertencia: string | null; geradoPorIa: true }> {
    const cliente = this.exigirCliente();
    garantirSemDadoPessoal(entrada.agregados, 'agregados');

    const inicio = Date.now();
    const resposta = await cliente.messages.create({
      model: this.modelo,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: EsquemaJsonDiagnostico },
      },
      system: [
        {
          type: 'text',
          text:
            'Você analisa dados agregados de mapeamento eleitoral para uma equipe de campanha ' +
            'brasileira. Responda em português do Brasil. Trabalhe apenas com os números ' +
            'fornecidos: não estime, não invente contexto político e não faça afirmação factual ' +
            'sobre candidatos. Quando a cobertura amostral for baixa, diga isso na justificativa ' +
            'em vez de apresentar conclusões como certezas.',
          // O sistema é estável entre chamadas; cachear corta o custo de
          // entrada em campanhas que rodam diagnóstico várias vezes ao dia.
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content:
            `Cobertura amostral do recorte: ${(entrada.coberturaAmostral * 100).toFixed(1)}%.\n` +
            `Agregados:\n${JSON.stringify(entrada.agregados, null, 2)}`,
        },
      ],
    });

    this.recusarSeRecusado(resposta.stop_reason);

    await this.registrarUso(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'diagnostico',
      uso: resposta.usage,
      duracaoMs: Date.now() - inicio,
      resumoEntrada: {
        cobertura: entrada.coberturaAmostral,
        chaves: Object.keys(entrada.agregados),
      },
    });

    return {
      diagnostico: this.extrairEstruturado(resposta, Diagnostico, 'diagnóstico'),
      advertencia: montarAdvertenciaDeCobertura(entrada.coberturaAmostral),
      geradoPorIa: true,
    };
  }

  /**
   * Revisão de texto com diferença explícita.
   *
   * Devolve o texto revisado **e** a lista de alterações; a tela mostra o diff e
   * exige aceite. A IA nunca altera o campo sozinha — o requisito é do escopo e
   * a assinatura do retorno o torna estrutural.
   */
  async revisarTexto(
    claims: ClaimsUsuario,
    entrada: { idCampanha: string; texto: string },
  ): Promise<{ textoRevisado: string; alteracoes: Array<{ trecho: string; motivo: string }> }> {
    const cliente = this.exigirCliente();
    // Observação de campo é texto livre: aqui mascaramos em vez de recusar,
    // senão um telefone anotado inutilizaria o recurso.
    const texto = mascararDocumentosEmTexto(entrada.texto);

    const inicio = Date.now();
    const resposta = await cliente.messages.create({
      model: this.modelo,
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EsquemaJsonRevisao } },
      system:
        'Você revisa textos curtos escritos por equipes de campanha em português do Brasil. ' +
        'Corrija ortografia, concordância e clareza. Preserve o sentido, o tom e os nomes ' +
        'próprios. Não acrescente informação que não esteja no original.',
      messages: [{ role: 'user', content: texto }],
    });

    this.recusarSeRecusado(resposta.stop_reason);

    await this.registrarUso(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'revisao_texto',
      uso: resposta.usage,
      duracaoMs: Date.now() - inicio,
      resumoEntrada: { caracteres: texto.length },
    });

    return this.extrairEstruturado(resposta, RevisaoTexto, 'revisão');
  }

  /**
   * Consulta em linguagem natural sobre uma **lista branca** de perguntas.
   *
   * O modelo escolhe qual consulta pré-definida responde a pergunta e extrai os
   * parâmetros. Ele **nunca** gera SQL. Deixar um LLM escrever consulta contra
   * um banco com intenção de voto de duas campanhas adversárias seria
   * indefensável, por melhor que fosse o prompt.
   */
  async interpretarConsulta(
    claims: ClaimsUsuario,
    entrada: { idCampanha: string; pergunta: string },
  ): Promise<{ consulta: string; parametros: Record<string, number | string>; confianca: number }> {
    const cliente = this.exigirCliente();

    const inicio = Date.now();
    const resposta = await cliente.messages.create({
      model: this.modelo,
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: EsquemaJsonConsulta },
      },
      system:
        'Você traduz perguntas de coordenadores de campanha para uma lista fixa de consultas ' +
        'pré-definidas. Escolha a que melhor responde à pergunta e extraia os parâmetros. ' +
        'Se nenhuma consulta servir, responda "nao_suportada" — não force uma aproximação.',
      messages: [{ role: 'user', content: entrada.pergunta }],
    });

    this.recusarSeRecusado(resposta.stop_reason);

    await this.registrarUso(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'consulta_natural',
      uso: resposta.usage,
      duracaoMs: Date.now() - inicio,
      resumoEntrada: { caracteres: entrada.pergunta.length },
    });

    const interpretado = this.extrairEstruturado(resposta, InterpretacaoConsulta, 'consulta');
    return {
      consulta: interpretado.consulta,
      parametros: {
        ...(interpretado.limiarPercentual !== undefined
          ? { limiarPercentual: interpretado.limiarPercentual }
          : {}),
        ...(interpretado.limite !== undefined ? { limite: interpretado.limite } : {}),
      },
      confianca: interpretado.confianca,
    };
  }

  /**
   * Extrai a saída estruturada da resposta.
   *
   * Com `output_config.format`, o conteúdo chega como um bloco de texto
   * contendo o JSON. Validamos com Zod na chegada: o JSON Schema garante o
   * formato, o Zod garante que o conteúdo cabe nos limites do domínio — uma
   * `confianca: 1.7` ou uma consulta fora da lista branca é recusada aqui, e
   * não repassada à tela.
   */
  private extrairEstruturado<T>(
    resposta: Anthropic.Message,
    esquema: { parse: (valor: unknown) => T },
    rotulo: string,
  ): T {
    const bloco = resposta.content.find((item) => item.type === 'text');
    if (!bloco || bloco.type !== 'text') {
      throw new ServiceUnavailableException(
        `A IA não devolveu um resultado de ${rotulo}. Tente novamente.`,
      );
    }
    try {
      return esquema.parse(JSON.parse(bloco.text));
    } catch (erro) {
      this.registrador.warn(`Saída de IA fora do esquema (${rotulo}): ${String(erro)}`);
      throw new ServiceUnavailableException(
        `A IA devolveu um resultado de ${rotulo} em formato inesperado. Tente novamente.`,
      );
    }
  }

  private exigirCliente(): Anthropic {
    if (!this.cliente) {
      throw new ServiceUnavailableException(
        'Os recursos de IA não estão configurados nesta instalação.',
      );
    }
    return this.cliente;
  }

  /**
   * Os classificadores de segurança podem recusar uma requisição: a resposta
   * vem com HTTP 200 e `stop_reason: "refusal"`, e `content` fica vazio. Ler
   * `content[0]` sem checar isso quebraria com um erro obscuro.
   */
  private recusarSeRecusado(stopReason: string | null): void {
    if (stopReason === 'refusal') {
      throw new ServiceUnavailableException(
        'A IA recusou processar este conteúdo. Revise o texto e tente novamente.',
      );
    }
  }

  private async registrarUso(
    claims: ClaimsUsuario,
    dados: {
      idCampanha: string;
      funcionalidade: string;
      uso: { input_tokens: number; output_tokens: number };
      duracaoMs: number;
      resumoEntrada: Record<string, unknown>;
    },
  ): Promise<void> {
    const custo =
      (dados.uso.input_tokens / 1_000_000) * PRECO_ENTRADA_POR_MILHAO +
      (dados.uso.output_tokens / 1_000_000) * PRECO_SAIDA_POR_MILHAO;

    try {
      await this.banco.executarComoUsuario(claims, async (conexao) => {
        await conexao.query(
          `insert into public.usos_ia
             (id_organizacao, id_campanha, id_usuario, funcionalidade, modelo,
              tokens_entrada, tokens_saida, custo_estimado, duracao_ms, resumo_entrada)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            claims.idOrganizacao,
            dados.idCampanha,
            claims.sub,
            dados.funcionalidade,
            this.modelo,
            dados.uso.input_tokens,
            dados.uso.output_tokens,
            custo,
            dados.duracaoMs,
            // `resumo_entrada` guarda só metadados: contagem de caracteres e
            // nomes de chave. Nunca o conteúdo enviado.
            JSON.stringify(dados.resumoEntrada),
          ],
        );
      });
    } catch (erro) {
      // Falha no registro de custo não pode derrubar a resposta ao usuário, mas
      // precisa gritar: é dinheiro não contabilizado.
      this.registrador.error(`Falha ao registrar uso de IA: ${String(erro)}`);
    }
  }
}
