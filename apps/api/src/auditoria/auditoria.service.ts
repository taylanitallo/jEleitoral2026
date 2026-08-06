import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { AcaoAuditoria, ClaimsUsuario } from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';

export interface RegistroAuditoria {
  acao: AcaoAuditoria;
  entidade: string;
  idEntidade?: string | null;
  idCampanha?: string | null;
  /**
   * Só para ações do provedor sobre uma organização alvo: o token do
   * provedor não tem `id_organizacao` (não é uma organização), então
   * `claims.idOrganizacao` sozinho gravaria a linha sem dono. Ignorado para
   * qualquer chamada que não seja do provedor.
   */
  idOrganizacaoAlvo?: string | null;
  dadosAntes?: unknown;
  dadosDepois?: unknown;
  /** Filtro por extenso — obrigatório em exportações. */
  filtroAplicado?: unknown;
  quantidadeRegistros?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  idCorrelacao?: string | null;
}

/**
 * Trilha de auditoria.
 *
 * `logs_auditoria` não tem política de UPDATE nem de DELETE — nem para o
 * administrador da organização. Escrever aqui é definitivo, e é essa
 * imutabilidade que dá valor à trilha: um log que o suspeito pode apagar não
 * serve para nada.
 *
 * Exportações e impressões registram, além da ação, o filtro aplicado e a
 * contagem de registros. É o que permite responder "quem levou embora a lista
 * de apoiadores do bairro X, e quando".
 */
@Injectable()
export class AuditoriaService {
  private readonly registrador = new Logger(AuditoriaService.name);

  constructor(private readonly banco: BancoService) {}

  /**
   * Registra dentro de uma transação já aberta. Preferível sempre que a ação
   * auditada é uma escrita: ou grava os dois, ou não grava nenhum.
   */
  async registrarNaTransacao(
    conexao: PoolClient,
    claims: ClaimsUsuario,
    registro: RegistroAuditoria,
  ): Promise<void> {
    await conexao.query(
      `insert into public.logs_auditoria
         (id_organizacao, id_campanha, id_usuario, acao, entidade, id_entidade,
          dados_antes, dados_depois, filtro_aplicado, quantidade_registros,
          ip, user_agent, id_correlacao)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        registro.idOrganizacaoAlvo ?? claims.idOrganizacao,
        registro.idCampanha ?? null,
        // `logs_auditoria.id_usuario` referencia `public.usuarios`, onde uma
        // conta do backoffice da Jeos nunca está (vive em `provedor.
        // usuarios`, de propósito — não é uma organização). Gravar
        // `claims.sub` de um token de provedor aqui violaria a FK; `null`
        // é o valor correto, não uma perda de rastro — a ação já fica
        // registrada em qual organização, quando e o quê.
        claims.idOrganizacao ? claims.sub : null,
        registro.acao,
        registro.entidade,
        registro.idEntidade ?? null,
        registro.dadosAntes ? JSON.stringify(this.removerSensiveis(registro.dadosAntes)) : null,
        registro.dadosDepois ? JSON.stringify(this.removerSensiveis(registro.dadosDepois)) : null,
        registro.filtroAplicado ? JSON.stringify(registro.filtroAplicado) : null,
        registro.quantidadeRegistros ?? null,
        registro.ip ?? null,
        registro.userAgent ?? null,
        registro.idCorrelacao ?? null,
      ],
    );
  }

  /** Registra fora de transação. Usado por leituras e exportações. */
  async registrar(claims: ClaimsUsuario, registro: RegistroAuditoria): Promise<void> {
    try {
      await this.banco.executarComoUsuario(claims, (conexao) =>
        this.registrarNaTransacao(conexao, claims, registro),
      );
    } catch (erro) {
      // Falha de auditoria não pode derrubar a operação do usuário em campo,
      // mas precisa gritar no log e no Sentry.
      this.registrador.error(
        `Falha ao registrar auditoria (${registro.acao} ${registro.entidade}): ${String(erro)}`,
      );
    }
  }

  /**
   * Remove identificadores sensíveis antes de gravar o "antes/depois".
   *
   * A trilha registra QUE o CPF mudou, não QUAL era. Guardar o valor claro num
   * campo jsonb anularia toda a criptografia em repouso — seria a mesma base
   * sensível, só que numa tabela que ninguém lembra de proteger.
   */
  private removerSensiveis(dados: unknown): unknown {
    if (dados === null || typeof dados !== 'object') return dados;
    if (Array.isArray(dados)) return dados.map((item) => this.removerSensiveis(item));

    const proibidos = new Set([
      'cpf',
      'cpfCriptografado',
      'cpf_criptografado',
      'cpfHmac',
      'cpf_hmac',
      'titulo',
      'tituloCriptografado',
      'titulo_criptografado',
      'tituloHmac',
      'titulo_hmac',
      'cnpjCriptografado',
      'cnpj_criptografado',
      'senha',
      'token',
      'tokenHash',
      'token_hash',
    ]);

    const resultado: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(dados as Record<string, unknown>)) {
      resultado[chave] = proibidos.has(chave) ? '[omitido]' : this.removerSensiveis(valor);
    }
    return resultado;
  }
}
