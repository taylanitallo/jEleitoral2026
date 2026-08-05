import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  ClaimsUsuario,
  EntradaEntrevista,
  LoteSincronizacaoOffline,
  ResultadoItemSincronizacao,
} from '@jeleitoral/tipos';
import { BancoService } from '../banco/banco.service.js';
import { Criptografia } from '../comum/criptografia.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { avaliarEntrevista } from './antifraude.js';

/**
 * Sincronização da fila offline.
 *
 * O entrevistador em zona rural preenche sem sinal e a fila local (IndexedDB)
 * sobe quando a conexão volta. Três propriedades governam este código:
 *
 *  1. **Idempotência.** O aparelho reenvia o mesmo lote quantas vezes for
 *     preciso até receber confirmação. `id_local_offline` é gerado no aparelho
 *     e tem índice único por campanha; reenviar não duplica.
 *  2. **Isolamento por item.** Cada entrevista tem a própria transação. Um
 *     registro inválido no meio do lote não pode derrubar os outros 199 — o
 *     entrevistador perderia um dia de trabalho por causa de um CPF digitado
 *     errado.
 *  3. **Nenhuma exceção de regra.** A fila offline entra pelo mesmo caminho da
 *     tela: mesmas políticas RLS, mesmo gatilho de consentimento. Um "modo
 *     sincronização" que relaxasse a validação seria a porta dos fundos para
 *     entrevista sem consentimento.
 */
@Injectable()
export class SincronizacaoOfflineService {
  private readonly registrador = new Logger(SincronizacaoOfflineService.name);
  private readonly criptografia: Criptografia;

  constructor(private readonly banco: BancoService) {
    const configuracao = carregarConfiguracao();
    this.criptografia = new Criptografia(
      configuracao.CHAVE_CRIPTOGRAFIA_AES,
      configuracao.SEGREDO_HMAC_INDICE,
    );
  }

  async sincronizar(
    claims: ClaimsUsuario,
    lote: LoteSincronizacaoOffline,
  ): Promise<ResultadoItemSincronizacao[]> {
    const resultados: ResultadoItemSincronizacao[] = [];

    for (const entrevista of lote.entrevistas) {
      try {
        const resultado = await this.banco.executarComoUsuario(claims, (conexao) =>
          this.processarUma(conexao, claims, lote.idCampanha, entrevista),
        );
        resultados.push(resultado);
      } catch (erro) {
        // O aparelho marca o item como recusado e para de reenviá-lo, mas
        // mantém o conteúdo para o entrevistador corrigir. Descartar seria
        // perder coleta de campo, que é insubstituível.
        this.registrador.warn(
          `Item offline recusado (${entrevista.idLocalOffline ?? 'sem id'}): ${String(erro)}`,
        );
        resultados.push({
          idLocalOffline: entrevista.idLocalOffline ?? null,
          situacao: 'RECUSADA',
          idEntrevista: null,
          motivo: erro instanceof Error ? erro.message : 'Falha ao sincronizar.',
        });
      }
    }

    return resultados;
  }

  private async processarUma(
    conexao: PoolClient,
    claims: ClaimsUsuario,
    idCampanha: string,
    entrada: EntradaEntrevista,
  ): Promise<ResultadoItemSincronizacao> {
    // --- Idempotência --------------------------------------------------------
    if (entrada.idLocalOffline) {
      const { rows } = await conexao.query<{ id: string }>(
        'select id from public.entrevistas where id_campanha = $1 and id_local_offline = $2',
        [idCampanha, entrada.idLocalOffline],
      );
      if (rows[0]) {
        return {
          idLocalOffline: entrada.idLocalOffline,
          situacao: 'JA_EXISTIA',
          idEntrevista: rows[0].id,
          motivo: null,
        };
      }
    }

    // --- Entrevistado --------------------------------------------------------
    let idEntrevistado = entrada.idEntrevistado ?? null;
    if (!idEntrevistado) {
      if (!entrada.entrevistado) {
        throw new Error('Informe o entrevistado ou o identificador de um já cadastrado.');
      }
      const dados = entrada.entrevistado;
      const cpf = this.criptografia.paraGravacao(dados.cpf);
      const titulo = this.criptografia.paraGravacao(dados.tituloEleitor);

      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.entrevistados
           (id_organizacao, id_campanha, id_domicilio, nome, apelido, telefone,
            data_nascimento, genero, cpf_criptografado, cpf_hmac,
            titulo_criptografado, titulo_hmac, id_secao, classificacao, id_usuario_cadastro)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         returning id`,
        [
          claims.idOrganizacao,
          idCampanha,
          entrada.idDomicilio,
          dados.nome,
          dados.apelido ?? null,
          dados.telefone ?? null,
          dados.dataNascimento ?? null,
          dados.genero ?? null,
          cpf.criptografado,
          cpf.hmac,
          titulo.criptografado,
          titulo.hmac,
          dados.idSecao ?? null,
          dados.classificacao,
          claims.sub,
        ],
      );
      idEntrevistado = rows[0]!.id;
    }

    // --- Consentimento -------------------------------------------------------
    // Gravado ANTES da entrevista de propósito: o gatilho
    // `validar_conclusao_entrevista` recusa a conclusão sem consentimento
    // vigente, então a ordem importa.
    if (entrada.consentimento) {
      const consentimento = entrada.consentimento;
      const { rows } = await conexao.query<{ versao: string; finalidade: string }>(
        'select versao, finalidade from public.versoes_consentimento where id = $1',
        [consentimento.idVersaoConsentimento],
      );
      const versao = rows[0];
      if (!versao) {
        throw new Error('Versão do termo de consentimento não encontrada.');
      }
      await conexao.query(
        `insert into public.consentimentos
           (id_organizacao, id_campanha, id_entrevistado, id_versao_consentimento,
            versao_texto, finalidade, canal, aceito_em, id_usuario_coletor,
            evidencia_url, latitude, longitude)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         on conflict do nothing`,
        [
          claims.idOrganizacao,
          idCampanha,
          idEntrevistado,
          consentimento.idVersaoConsentimento,
          versao.versao,
          versao.finalidade,
          consentimento.canal,
          consentimento.aceitoEm,
          claims.sub,
          consentimento.evidenciaUrl ?? null,
          consentimento.latitude ?? null,
          consentimento.longitude ?? null,
        ],
      );
    }

    // --- Entrevista ----------------------------------------------------------
    // Entra como RASCUNHO e só depois vira CONCLUIDA: as intenções de voto
    // precisam existir para o gatilho aceitar a conclusão.
    const { rows: criada } = await conexao.query<{ id: string }>(
      `insert into public.entrevistas
         (id_organizacao, id_campanha, id_entrevistado, id_usuario_entrevistador,
          natureza, data_hora, duracao_segundos, latitude, longitude,
          precisao_gps_metros, dispositivo, status, recusou_responder, observacoes,
          sincronizado_de_offline, id_local_offline)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'RASCUNHO', $12, $13, true, $14)
       returning id`,
      [
        claims.idOrganizacao,
        idCampanha,
        idEntrevistado,
        claims.sub,
        entrada.natureza,
        entrada.dataHora,
        entrada.duracaoSegundos ?? null,
        entrada.latitude ?? null,
        entrada.longitude ?? null,
        entrada.precisaoGpsMetros ?? null,
        entrada.dispositivo ?? null,
        entrada.recusouResponder,
        entrada.observacoes ?? null,
        entrada.idLocalOffline ?? null,
      ],
    );
    const idEntrevista = criada[0]!.id;

    for (const intencao of entrada.intencoes) {
      // `tipo` viaja explícito para a trigger de resolução (migration 0028)
      // saber diferenciar "declarou branco" de "só mandou um número" — os dois
      // chegam com `idCandidato` nulo, e só o `tipo` distingue.
      await conexao.query(
        `insert into public.intencoes_voto
           (id_organizacao, id_campanha, id_entrevista, id_cargo, id_candidato,
            numero_declarado, tipo, grau_certeza, voto_definido)
         values ($1, $2, $3, $4, $5, $6, $7::public.tipo_intencao, $8, $9)`,
        [
          claims.idOrganizacao,
          idCampanha,
          idEntrevista,
          intencao.idCargo,
          intencao.idCandidato ?? null,
          intencao.numeroDeclarado ?? null,
          intencao.tipo,
          intencao.grauCerteza,
          intencao.votoDefinido,
        ],
      );
    }

    for (const voto of entrada.votosDomicilio) {
      await conexao.query(
        `insert into public.votos_domicilio
           (id_organizacao, id_campanha, id_entrevista, id_cargo, id_candidato,
            quantidade_declarada)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          claims.idOrganizacao,
          idCampanha,
          idEntrevista,
          voto.idCargo,
          voto.idCandidato ?? null,
          voto.quantidadeDeclarada,
        ],
      );
    }

    if (entrada.status !== 'RASCUNHO') {
      // Aqui o gatilho do banco valida consentimento e conteúdo. Se recusar, a
      // transação inteira desta entrevista é desfeita — e só desta.
      await conexao.query('update public.entrevistas set status = $2 where id = $1', [
        idEntrevista,
        entrada.status,
      ]);
    }

    await this.registrarAlertas(conexao, claims, idCampanha, idEntrevista, entrada);

    return {
      idLocalOffline: entrada.idLocalOffline ?? null,
      situacao: 'CRIADA',
      idEntrevista,
      motivo: null,
    };
  }

  private async registrarAlertas(
    conexao: PoolClient,
    claims: ClaimsUsuario,
    idCampanha: string,
    idEntrevista: string,
    entrada: EntradaEntrevista,
  ): Promise<void> {
    const { rows: enderecos } = await conexao.query<{
      latitude: number | null;
      longitude: number | null;
      id_bairro: string;
    }>(
      `select d.latitude, d.longitude, d.id_bairro
         from public.domicilios d where d.id = $1`,
      [entrada.idDomicilio],
    );
    const endereco = enderecos[0];

    const { rows: recentes } = await conexao.query<{ data_hora: Date }>(
      `select data_hora from public.entrevistas
        where id_usuario_entrevistador = $1
          and data_hora > $2::timestamptz - interval '1 hour'
          and data_hora <= $2::timestamptz
          and id <> $3`,
      [claims.sub, entrada.dataHora, idEntrevista],
    );

    const alertas = avaliarEntrevista(
      {
        duracaoSegundos: entrada.duracaoSegundos ?? null,
        latitude: entrada.latitude ?? null,
        longitude: entrada.longitude ?? null,
        precisaoGpsMetros: entrada.precisaoGpsMetros ?? null,
        quantidadeIntencoes: entrada.intencoes.length,
        dataHora: entrada.dataHora,
      },
      {
        coordenadaEndereco:
          endereco?.latitude != null && endereco.longitude != null
            ? { latitude: endereco.latitude, longitude: endereco.longitude }
            : null,
        idBairroDeclarado: endereco?.id_bairro ?? null,
        territoriosDesignados: claims.territorios,
        entrevistasNaUltimaHora: recentes.map((linha) => linha.data_hora),
      },
    );

    for (const alerta of alertas) {
      await conexao.query(
        `insert into public.alertas_coleta
           (id_organizacao, id_campanha, id_entrevista, id_usuario_avaliado,
            tipo, detalhe, gravidade)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          claims.idOrganizacao,
          idCampanha,
          idEntrevista,
          claims.sub,
          alerta.tipo,
          JSON.stringify({ ...alerta.detalhe, mensagem: alerta.mensagem }),
          alerta.gravidade,
        ],
      );
    }
  }
}
