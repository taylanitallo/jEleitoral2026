import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ClaimsUsuario, ClassificacaoEleitor, EntradaIntencaoVoto } from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';

export interface EntradaRetificacao {
  motivo: string;
  entrevistado: { nome: string; classificacao: ClassificacaoEleitor };
  recusouResponder: boolean;
  observacoes?: string;
  intencoes: EntradaIntencaoVoto[];
}

interface ContextoAuditoria {
  ip: string | null;
  userAgent: string | null;
  idCorrelacao: string | null;
}

/**
 * Cria a próxima versão de uma entrevista.
 *
 * Não é edição — é uma entrevista NOVA, presa à cadeia pela `id_entrevista_
 * original`, com o entrevistador ORIGINAL preservado (senão o relatório de
 * produtividade creditaria a quem só corrigiu um erro). Os triggers da
 * migration 0030 fazem o resto: a versão nasce RASCUNHO (livre para inserir
 * intenções), conclui normalmente, e só então vira a vigente.
 *
 * `entrevistados.nome`/`classificacao` são corrigidos por UPDATE direto, e
 * não pela cadeia de versões: são fatos de IDENTIDADE da pessoa, não do
 * conteúdo desta entrevista — a mesma pessoa pode ter sido entrevistada mais
 * de uma vez, e corrigir o nome dela não deveria depender de qual entrevista
 * está sendo retificada. O registro do que mudou fica na auditoria.
 */
@Injectable()
export class RetificacaoService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async retificar(
    claims: ClaimsUsuario,
    idEntrevista: string,
    entrada: EntradaRetificacao,
    contexto: ContextoAuditoria,
  ): Promise<{ idNovaVersao: string; versao: number }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const atual = await this.buscarVigente(conexao, idEntrevista);

      if (atual.status === 'RASCUNHO') {
        throw new BadRequestException(
          'Entrevista ainda em rascunho: edite diretamente, não é preciso retificar.',
        );
      }

      await this.corrigirEntrevistado(conexao, claims, atual, entrada, contexto);

      const idOriginal = atual.id_entrevista_original ?? atual.id;
      const novaVersao = atual.versao + 1;

      const { rows: nova } = await conexao.query<{ id: string }>(
        `insert into public.entrevistas
           (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador, id_equipe,
            natureza, data_hora, latitude, longitude, precisao_gps_metros, dispositivo, status,
            recusou_responder, observacoes, versao, id_entrevista_original, vigente,
            motivo_retificacao, id_usuario_retificador)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RASCUNHO',$12,$13,$14,$15,false,$16,$17)
         returning id`,
        [
          claims.idOrganizacao,
          atual.id_campanha,
          atual.id_entrevistado,
          // Preservado: quem foi a campo continua sendo o dono do trabalho.
          atual.id_usuario_entrevistador,
          atual.id_equipe,
          atual.natureza,
          atual.data_hora,
          atual.latitude,
          atual.longitude,
          atual.precisao_gps_metros,
          atual.dispositivo,
          entrada.recusouResponder,
          entrada.observacoes ?? null,
          novaVersao,
          idOriginal,
          entrada.motivo,
          // Quem retifica, não quem entrevistou — e é por isso que a política
          // de INSERT (0030) tem uma cláusula própria para este caso.
          claims.sub,
        ],
      );
      const idNova = nova[0]!.id;

      for (const intencao of entrada.intencoes) {
        await conexao.query(
          `insert into public.intencoes_voto
             (id_organizacao, id_campanha, id_entrevista, id_cargo, id_candidato,
              numero_declarado, tipo, grau_certeza, voto_definido)
           values ($1,$2,$3,$4,$5,$6,$7::public.tipo_intencao,$8,$9)`,
          [
            claims.idOrganizacao,
            atual.id_campanha,
            idNova,
            intencao.idCargo,
            intencao.idCandidato ?? null,
            intencao.numeroDeclarado ?? null,
            intencao.tipo,
            intencao.grauCerteza,
            intencao.votoDefinido,
          ],
        );
      }

      /*
       * Retificação sempre aterrissa em CONCLUIDA, mesmo que a versão anterior
       * estivesse VALIDADA. Uma validação era um julgamento sobre O CONTEÚDO
       * ANTERIOR; o conteúdo mudou, então o julgamento precisa ser refeito.
       * Manter VALIDADA automaticamente daria a uma versão nunca revista a
       * aparência de ter passado por revisão.
       */
      await conexao.query(`update public.entrevistas set status = 'CONCLUIDA' where id = $1`, [
        idNova,
      ]);

      /*
       * A antiga primeiro. O índice único (`entrevistas_vigente_idx`) garante
       * no máximo uma vigente por cadeia — inverter a ordem abriria uma
       * janela, dentro desta mesma transação, com duas vigentes ao mesmo
       * tempo.
       */
      await conexao.query(
        'update public.entrevistas set vigente = false, id_entrevista_substituta = $2 where id = $1',
        [atual.id, idNova],
      );
      await conexao.query('update public.entrevistas set vigente = true where id = $1', [idNova]);

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'entrevistas',
        idEntidade: idNova,
        idCampanha: atual.id_campanha,
        dadosAntes: { id: atual.id, versao: atual.versao },
        dadosDepois: { id: idNova, versao: novaVersao, motivo: entrada.motivo },
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        idCorrelacao: contexto.idCorrelacao,
      });

      return { idNovaVersao: idNova, versao: novaVersao };
    });
  }

  private async buscarVigente(
    conexao: PoolClient,
    idEntrevista: string,
  ): Promise<{
    id: string;
    id_campanha: string;
    id_entrevistado: string;
    id_usuario_entrevistador: string;
    id_equipe: string | null;
    natureza: string;
    data_hora: Date;
    latitude: number | null;
    longitude: number | null;
    precisao_gps_metros: number | null;
    dispositivo: string | null;
    status: string;
    versao: number;
    id_entrevista_original: string | null;
    vigente: boolean;
  }> {
    const { rows } = await conexao.query(
      `select id, id_campanha, id_entrevistado, id_usuario_entrevistador, id_equipe, natureza,
              data_hora, latitude, longitude, precisao_gps_metros, dispositivo, status, versao,
              id_entrevista_original, vigente
         from public.entrevistas where id = $1`,
      [idEntrevista],
    );
    const atual = rows[0];
    if (!atual) throw new NotFoundException('Entrevista não encontrada.');
    if (!atual.vigente) {
      // A RLS já teria negado se fosse de outra organização; chegar aqui com
      // `vigente=false` quer dizer que o link aberto aponta para uma versão
      // superada — a pessoa estava vendo o histórico e tentou retificar dali.
      throw new ConflictException(
        'Esta não é a versão vigente da entrevista. Abra a versão atual para retificar.',
      );
    }
    return atual;
  }

  private async corrigirEntrevistado(
    conexao: PoolClient,
    claims: ClaimsUsuario,
    atual: { id_entrevistado: string; id_campanha: string },
    entrada: EntradaRetificacao,
    contexto: ContextoAuditoria,
  ): Promise<void> {
    const { rows } = await conexao.query<{ nome: string; classificacao: string }>(
      'select nome, classificacao from public.entrevistados where id = $1',
      [atual.id_entrevistado],
    );
    const antes = rows[0];
    if (!antes) return;

    if (
      antes.nome === entrada.entrevistado.nome &&
      antes.classificacao === entrada.entrevistado.classificacao
    ) {
      return;
    }

    await conexao.query(
      'update public.entrevistados set nome = $2, classificacao = $3 where id = $1',
      [atual.id_entrevistado, entrada.entrevistado.nome, entrada.entrevistado.classificacao],
    );

    await this.auditoria.registrarNaTransacao(conexao, claims, {
      acao: 'ALTERAR',
      entidade: 'entrevistados',
      idEntidade: atual.id_entrevistado,
      idCampanha: atual.id_campanha,
      dadosAntes: antes,
      dadosDepois: entrada.entrevistado,
      ip: contexto.ip,
      userAgent: contexto.userAgent,
      idCorrelacao: contexto.idCorrelacao,
    });
  }
}
