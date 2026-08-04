import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ClaimsUsuario } from '@jeleitoral/tipos';
import {
  Diagnostico,
  EixosNarrativosSugeridos,
  EsquemaNeutroConsulta,
  EsquemaNeutroEixos,
  EsquemaNeutroDiagnostico,
  EsquemaNeutroRevisao,
  InterpretacaoConsulta,
  RevisaoTexto,
} from './esquemasSaida.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { calcularCusto } from './precos.js';
import { criarProvedor } from './provedores/fabricaProvedor.js';
import type { ProvedorIa, RespostaIa, UsoTokens } from './provedores/provedorIa.js';
import {
  garantirSemDadoPessoal,
  mascararDocumentosEmTexto,
  montarAdvertenciaDeCobertura,
} from './redacaoSegura.js';

/**
 * Camada de IA.
 *
 * Quatro invariantes governam o arquivo:
 *
 *  1. **A chave nunca sai daqui.** Todo acesso ao modelo é servidor-a-servidor;
 *     o frontend chama o nosso endpoint, nunca o provedor.
 *  2. **Nenhum dado pessoal atravessa.** Todo payload passa por
 *     `garantirSemDadoPessoal`, que **recusa** em vez de sanitizar — um campo
 *     novo com nome inesperado é bloqueado, não silenciosamente aceito.
 *  3. **Todo custo é registrado** em `usos_ia`, por campanha e por provedor.
 *  4. **O serviço não conhece fornecedor.** Ele fala com `ProvedorIa`. Isso
 *     tirou daqui os quatro pontos em que o formato da Anthropic vazava, e é o
 *     que torna esta classe testável — antes qualquer teste exigiria rede.
 */
@Injectable()
export class IaService {
  private readonly registrador = new Logger(IaService.name);
  private readonly provedor: ProvedorIa;
  private readonly limitePadrao: number;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.limitePadrao = configuracao.IA_LIMITE_CREDITOS_MENSAL_PADRAO;
    this.provedor = criarProvedor({
      provedor: configuracao.IA_PROVEDOR,
      chaveAnthropic: configuracao.ANTHROPIC_API_KEY,
      chaveGemini: configuracao.GEMINI_API_KEY,
      modeloPadrao: configuracao.IA_MODELO_PADRAO,
    });

    if (!this.provedor.disponivel()) {
      this.registrador.warn(
        `Provedor ${this.provedor.nome} sem chave: os recursos de IA sobem desabilitados.`,
      );
    }
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
    entrada: { idCampanha: string; agregados: Record<string, unknown>; coberturaAmostral: number },
  ): Promise<{ diagnostico: Diagnostico; advertencia: string | null; geradoPorIa: true }> {
    garantirSemDadoPessoal(entrada.agregados, 'agregados');

    const resposta = await this.executar(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'diagnostico',
      resumoEntrada: {
        cobertura: entrada.coberturaAmostral,
        chaves: Object.keys(entrada.agregados),
      },
      pedido: {
        operacao: 'diagnostico',
        instrucaoSistema:
          'Você analisa dados agregados de mapeamento eleitoral para uma equipe de campanha ' +
          'brasileira. Responda em português do Brasil. Trabalhe apenas com os números ' +
          'fornecidos: não estime, não invente contexto político e não faça afirmação factual ' +
          'sobre candidatos. Quando a cobertura amostral for baixa, diga isso na justificativa ' +
          'em vez de apresentar conclusões como certezas.',
        entradaUsuario:
          `Cobertura amostral do recorte: ${(entrada.coberturaAmostral * 100).toFixed(1)}%.\n` +
          `Agregados:\n${JSON.stringify(entrada.agregados, null, 2)}`,
        maxTokensSaida: 16000,
        esforco: 'alto',
        raciocinio: true,
        esquemaSaida: EsquemaNeutroDiagnostico,
        // O sistema é estável entre chamadas; cachear corta o custo de entrada
        // em campanhas que rodam diagnóstico várias vezes ao dia.
        cachearSistema: true,
      },
    });

    return {
      diagnostico: this.validar(resposta.textoJson, Diagnostico, 'diagnóstico'),
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
  ): Promise<RevisaoTexto> {
    // Observação de campo é texto livre: aqui mascaramos em vez de recusar,
    // senão um telefone anotado inutilizaria o recurso.
    const texto = mascararDocumentosEmTexto(entrada.texto);

    const resposta = await this.executar(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'revisao_texto',
      resumoEntrada: { caracteres: texto.length },
      pedido: {
        operacao: 'revisao_texto',
        instrucaoSistema:
          'Você revisa textos curtos escritos por equipes de campanha em português do Brasil. ' +
          'Corrija ortografia, concordância e clareza. Preserve o sentido, o tom e os nomes ' +
          'próprios. Não acrescente informação que não esteja no original.',
        entradaUsuario: texto,
        maxTokensSaida: 8000,
        esforco: 'baixo',
        raciocinio: false,
        esquemaSaida: EsquemaNeutroRevisao,
        cachearSistema: false,
      },
    });

    return this.validar(resposta.textoJson, RevisaoTexto, 'revisão');
  }

  /**
   * Consulta em linguagem natural sobre uma **lista branca** de perguntas.
   *
   * O modelo escolhe qual consulta pré-definida responde à pergunta e extrai os
   * parâmetros. Ele **nunca** gera SQL. Deixar um LLM escrever consulta contra
   * um banco com intenção de voto de duas campanhas adversárias seria
   * indefensável, por melhor que fosse o prompt.
   */
  async interpretarConsulta(
    claims: ClaimsUsuario,
    entrada: { idCampanha: string; pergunta: string },
  ): Promise<{ consulta: string; parametros: Record<string, number | string>; confianca: number }> {
    const resposta = await this.executar(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'consulta_natural',
      resumoEntrada: { caracteres: entrada.pergunta.length },
      pedido: {
        operacao: 'consulta_natural',
        instrucaoSistema:
          'Você traduz perguntas de coordenadores de campanha para uma lista fixa de consultas ' +
          'pré-definidas. Escolha a que melhor responde à pergunta e extraia os parâmetros. ' +
          'Se nenhuma consulta servir, responda "nao_suportada" — não force uma aproximação.',
        entradaUsuario: entrada.pergunta,
        maxTokensSaida: 4000,
        esforco: 'baixo',
        raciocinio: false,
        esquemaSaida: EsquemaNeutroConsulta,
        cachearSistema: false,
      },
    });

    const interpretado = this.validar(resposta.textoJson, InterpretacaoConsulta, 'consulta');
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
   * Sugere eixos narrativos a partir do diagnóstico agregado.
   *
   * O que entra são contagens: temas mais citados, distribuição por território e
   * o clima eleitoral de cada um. É o cruzamento que produz eixo acionável — "o
   * problema mais citado no Centro é saneamento, e o Centro tem 48% de
   * indecisos" leva a discurso; a lista de problemas sozinha leva a plano de
   * governo genérico.
   *
   * A sugestão **não é persistida aqui**. Ela volta para a tela, o coordenador
   * escolhe o que aproveita, e só o escolhido vira linha em `eixos_narrativos`.
   * Narrativa de campanha gerada e gravada sem alguém ler seria a máquina
   * escrevendo o que o candidato vai dizer.
   */
  async sugerirEixosNarrativos(
    claims: ClaimsUsuario,
    entrada: {
      idCampanha: string;
      agregado: Record<string, unknown>;
      coberturaAmostral: number;
    },
  ): Promise<{
    eixos: EixosNarrativosSugeridos['eixos'];
    advertencia: string | null;
    geradoPorIa: true;
  }> {
    garantirSemDadoPessoal(entrada.agregado, 'agregadoNarrativo');

    const resposta = await this.executar(claims, {
      idCampanha: entrada.idCampanha,
      funcionalidade: 'eixos_narrativos',
      resumoEntrada: {
        cobertura: entrada.coberturaAmostral,
        chaves: Object.keys(entrada.agregado),
      },
      pedido: {
        operacao: 'eixos_narrativos',
        instrucaoSistema:
          'Você ajuda uma equipe de campanha brasileira a transformar o que ela ouviu em campo ' +
          'em eixos de comunicação. Responda em português do Brasil. Trabalhe APENAS com os ' +
          'números fornecidos: não invente contexto político, não faça afirmação factual sobre ' +
          'candidatos ou adversários, e não proponha promessa que os dados não sustentem. ' +
          'Cada eixo deve citar, em "provas", os números do próprio agregado que o justificam. ' +
          'Quando a cobertura amostral for baixa, diga isso nos riscos do eixo. ' +
          'Proponha no máximo quatro eixos: linha narrativa é escolha, não inventário.',
        entradaUsuario:
          `Cobertura amostral: ${(entrada.coberturaAmostral * 100).toFixed(1)}%.
` +
          `Diagnóstico agregado:
${JSON.stringify(entrada.agregado, null, 2)}`,
        maxTokensSaida: 16000,
        esforco: 'alto',
        raciocinio: true,
        esquemaSaida: EsquemaNeutroEixos,
        cachearSistema: true,
      },
    });

    const sugerido = this.validar(resposta.textoJson, EixosNarrativosSugeridos, 'eixos narrativos');

    return {
      eixos: sugerido.eixos,
      advertencia: montarAdvertenciaDeCobertura(entrada.coberturaAmostral),
      geradoPorIa: true,
    };
  }

  /**
   * Consumo do mês corrente, por funcionalidade e por provedor.
   *
   * Devolve também o teto aplicado — um limite que corta a chamada sem que
   * ninguém veja quanto já se gastou produz chamado de suporte, não economia.
   */
  async resumoDeUso(claims: ClaimsUsuario): Promise<{
    provedorAtivo: string;
    modeloPadrao: string;
    disponivel: boolean;
    tokensConsumidos: number;
    tetoMensal: number;
    custoTotal: number;
    porFuncionalidade: Array<{
      funcionalidade: string;
      provedor: string;
      chamadas: number;
      falhas: number;
      tokens: number;
      custo: number;
    }>;
  }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        funcionalidade: string;
        provedor: string;
        chamadas: string;
        falhas: string;
        tokens: string;
        custo: string;
      }>(
        `select u.funcionalidade, u.provedor,
                count(*)::bigint as chamadas,
                count(*) filter (where not u.sucesso)::bigint as falhas,
                sum(u.tokens_entrada + u.tokens_saida)::bigint as tokens,
                sum(u.custo_estimado)::numeric as custo
           from public.usos_ia u
          where u.criado_em >= date_trunc('month', now())
          group by u.funcionalidade, u.provedor
          order by custo desc`,
      );

      const { rows: teto } = await conexao.query<{ limite: number | null }>(
        `select coalesce(p.limite_creditos_ia, o.limite_creditos_ia) as limite
           from public.organizacoes o
           left join public.planos p on p.id = o.id_plano
          where o.id = $1`,
        [claims.idOrganizacao],
      );

      const porFuncionalidade = rows.map((linha) => ({
        funcionalidade: linha.funcionalidade,
        provedor: linha.provedor,
        chamadas: Number(linha.chamadas),
        falhas: Number(linha.falhas),
        tokens: Number(linha.tokens),
        custo: Number(linha.custo),
      }));

      return {
        provedorAtivo: this.provedor.nome,
        modeloPadrao: this.provedor.modeloPadrao,
        disponivel: this.provedor.disponivel(),
        tokensConsumidos: porFuncionalidade.reduce((soma, l) => soma + l.tokens, 0),
        tetoMensal: teto[0]?.limite ?? this.limitePadrao,
        custoTotal: porFuncionalidade.reduce((soma, l) => soma + l.custo, 0),
        porFuncionalidade,
      };
    });
  }

  // --- Orquestração ----------------------------------------------------------

  /**
   * Caminho único de toda chamada: limite, execução, telemetria.
   *
   * Centralizar aqui é o que garante que a falha também seja registrada. Antes,
   * o `insert` em `usos_ia` só acontecia no caminho feliz — e as colunas
   * `sucesso` e `erro` da tabela nunca eram preenchidas por ninguém. Uma
   * chamada que estourava não deixava rastro nenhum, o que fazia o relatório de
   * custo parecer melhor do que era e escondia provedor instável.
   */
  private async executar(
    claims: ClaimsUsuario,
    contexto: {
      idCampanha: string;
      funcionalidade: string;
      resumoEntrada: Record<string, unknown>;
      pedido: Parameters<ProvedorIa['gerar']>[0];
    },
  ): Promise<RespostaIa> {
    if (!this.provedor.disponivel()) {
      throw new ServiceUnavailableException(
        `Os recursos de IA estão desabilitados: falta a chave do provedor ${this.provedor.nome}.`,
      );
    }

    await this.garantirDentroDoLimite(claims);

    const inicio = Date.now();
    try {
      const resposta = await this.provedor.gerar(contexto.pedido);

      await this.registrarUso(claims, {
        ...contexto,
        uso: resposta.uso,
        modelo: resposta.modeloEfetivo,
        duracaoMs: Date.now() - inicio,
        sucesso: !resposta.recusada,
        erro: resposta.recusada ? `recusada pelo provedor (${resposta.motivoParada})` : null,
      });

      if (resposta.recusada) {
        // Recusa não é falha técnica: repetir daria a mesma recusa.
        throw new ServiceUnavailableException(
          'O provedor de IA recusou esta solicitação. Reformule o pedido.',
        );
      }

      return resposta;
    } catch (erro) {
      if (erro instanceof ServiceUnavailableException) throw erro;

      // A falha também consumiu tokens de entrada; registrar é o que permite
      // distinguir "ninguém usou" de "todo mundo tentou e quebrou".
      await this.registrarUso(claims, {
        ...contexto,
        uso: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, raciocinio: 0 },
        modelo: this.provedor.modeloPadrao,
        duracaoMs: Date.now() - inicio,
        sucesso: false,
        erro: erro instanceof Error ? erro.message.slice(0, 500) : String(erro).slice(0, 500),
      });

      this.registrador.error(`Falha na IA (${contexto.funcionalidade}): ${String(erro)}`);
      throw new ServiceUnavailableException('O provedor de IA está indisponível no momento.');
    }
  }

  /**
   * Teto mensal de tokens.
   *
   * A coluna `organizacoes.limite_creditos_ia` e a variável
   * `IA_LIMITE_CREDITOS_MENSAL_PADRAO` existiam desde o começo e **ninguém as
   * consultava** — a única proteção real era o rate limit do controller, que
   * limita frequência e não gasto. Uma campanha podia estourar o plano num dia.
   */
  private async garantirDentroDoLimite(claims: ClaimsUsuario): Promise<void> {
    const { consumido, limite } = await this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ consumido: string; limite: number | null }>(
        `select
           coalesce((
             select sum(u.tokens_entrada + u.tokens_saida)
               from public.usos_ia u
              where u.id_organizacao = o.id
                and u.criado_em >= date_trunc('month', now())
           ), 0) as consumido,
           coalesce(p.limite_creditos_ia, o.limite_creditos_ia) as limite
         from public.organizacoes o
         left join public.planos p on p.id = o.id_plano
        where o.id = $1`,
        [claims.idOrganizacao],
      );
      return {
        consumido: Number(rows[0]?.consumido ?? 0),
        limite: rows[0]?.limite ?? null,
      };
    });

    const teto = limite ?? this.limitePadrao;
    if (teto > 0 && consumido >= teto) {
      throw new ServiceUnavailableException(
        `A campanha atingiu o limite mensal de ${teto.toLocaleString('pt-BR')} tokens de IA. ` +
          'Fale com o administrador para ampliar o plano.',
      );
    }
  }

  /**
   * Valida a saída estruturada.
   *
   * O esquema do provedor garante o FORMATO; o Zod garante que o conteúdo cabe
   * nos limites do domínio — uma `confianca: 1.7` ou uma consulta fora da lista
   * branca é recusada aqui, e não repassada à tela.
   */
  private validar<T>(textoJson: string, esquema: { parse: (v: unknown) => T }, rotulo: string): T {
    if (!textoJson.trim()) {
      throw new ServiceUnavailableException(`A IA devolveu ${rotulo} vazio.`);
    }
    try {
      return esquema.parse(JSON.parse(textoJson));
    } catch (erro) {
      this.registrador.error(`Saída de IA inválida (${rotulo}): ${String(erro)}`);
      throw new ServiceUnavailableException(`A IA devolveu ${rotulo} em formato inesperado.`);
    }
  }

  private async registrarUso(
    claims: ClaimsUsuario,
    dados: {
      idCampanha: string;
      funcionalidade: string;
      resumoEntrada: Record<string, unknown>;
      uso: UsoTokens;
      modelo: string;
      duracaoMs: number;
      sucesso: boolean;
      erro: string | null;
    },
  ): Promise<void> {
    const { custo, precoConhecido } = calcularCusto(dados.modelo, dados.uso);

    // Preço ausente não derruba a chamada, mas não pode sumir: zero calado foi
    // como o custo errado sobreviveu tanto tempo.
    const erro = precoConhecido
      ? dados.erro
      : [dados.erro, `preço desconhecido para o modelo ${dados.modelo}`]
          .filter(Boolean)
          .join(' | ');

    if (!precoConhecido) {
      this.registrador.warn(`Sem preço para o modelo ${dados.modelo}: custo gravado como zero.`);
    }

    try {
      await this.banco.executarComoUsuario(claims, async (conexao) => {
        await conexao.query(
          `insert into public.usos_ia
             (id_organizacao, id_campanha, id_usuario, funcionalidade, provedor, modelo,
              tokens_entrada, tokens_saida, custo_estimado, duracao_ms, resumo_entrada,
              sucesso, erro)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            claims.idOrganizacao,
            dados.idCampanha,
            claims.sub,
            dados.funcionalidade,
            this.provedor.nome,
            dados.modelo,
            // Tokens de cache entram na conta de custo, mas não na de tokens
            // brutos: a coluna existe para medir volume, e cache lido não é
            // volume novo.
            dados.uso.entrada,
            dados.uso.saida + dados.uso.raciocinio,
            custo,
            dados.duracaoMs,
            JSON.stringify(dados.resumoEntrada),
            dados.sucesso,
            erro,
          ],
        );
      });
    } catch (falha) {
      // Telemetria não pode derrubar a resposta que o usuário está esperando.
      this.registrador.error(`Falha ao registrar uso de IA: ${String(falha)}`);
    }
  }
}
