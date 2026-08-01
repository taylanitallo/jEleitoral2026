import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ClaimsUsuario, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import {
  avaliarMesclagem,
  parearCandidaturas,
  type CandidatoManual,
  type CandidaturaOficial,
} from './mesclagem.js';

const EntradaCandidato = z.object({
  idCampanha: Uuid,
  idCargo: Uuid,
  nomeCompleto: z.string().trim().min(5).max(150),
  nomeUrna: z.string().trim().min(2).max(60),
  numeroUrna: z.string().regex(/^\d{2,5}$/, 'O número de urna tem de 2 a 5 dígitos.'),
  idPartido: Uuid.optional(),
  uf: z.string().length(2).optional(),
  proprio: z.boolean().default(false),
});

const DecisaoMesclagem = z.object({
  idMesclagem: Uuid,
  aceitar: z.boolean(),
});

@Injectable()
export class CandidatosService {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Confronta os pré-candidatos cadastrados à mão com as candidaturas oficiais
   * já sincronizadas e alimenta a fila de mesclagem.
   *
   * Só o caso de evidência redundante (número + partido + nome) é mesclado
   * automaticamente. Todo o resto vira uma linha em `mesclagens_candidato` com
   * a justificativa escrita, para o coordenador decidir em segundos.
   */
  async sugerirMesclagens(
    claims: ClaimsUsuario,
    idCampanha: string,
  ): Promise<{ mescladas: number; paraRevisar: number }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows: manuais } = await conexao.query<CandidatoManual & { id: string }>(
        `select c.id, c.nome_urna as "nomeUrna", c.nome_completo as "nomeCompleto",
                c.numero_urna as "numeroUrna", p.sigla as "siglaPartido", c.id_cargo as "idCargo"
           from public.candidatos c
           left join public.partidos p on p.id = c.id_partido
          where c.id_campanha = $1 and c.origem = 'MANUAL' and c.id_tse is null and c.ativo`,
        [idCampanha],
      );

      const { rows: oficiais } = await conexao.query<CandidaturaOficial>(
        `select c.id_tse as "idTse", c.nome_urna as "nomeUrna", c.nome_completo as "nomeCompleto",
                c.numero_urna as "numeroUrna", p.sigla as "siglaPartido", c.id_cargo as "idCargo"
           from public.candidatos c
           left join public.partidos p on p.id = c.id_partido
          where c.id_campanha = $1 and c.origem <> 'MANUAL' and c.id_tse is not null and c.ativo`,
        [idCampanha],
      );

      const pares = parearCandidaturas(manuais, oficiais);
      let mescladas = 0;
      let paraRevisar = 0;

      for (const par of pares) {
        if (par.avaliacao.decisao === 'MESCLAR') {
          await conexao.query(
            `update public.candidatos
                set id_tse = $2, origem = 'DADOS_ABERTOS', sincronizado_em = now()
              where id = $1`,
            [par.manual.id, par.oficial.idTse],
          );
          mescladas += 1;
          continue;
        }

        await conexao.query(
          `insert into public.mesclagens_candidato
             (id_organizacao, id_campanha, id_candidato_manual, id_tse_sugerido,
              dados_oficiais, similaridade_nome, numero_confere, partido_confere)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (id_campanha, id_candidato_manual, id_tse_sugerido) do nothing`,
          [
            claims.idOrganizacao,
            idCampanha,
            par.manual.id,
            par.oficial.idTse,
            JSON.stringify({ ...par.oficial, justificativa: par.avaliacao.justificativa }),
            par.avaliacao.similaridadeNome,
            par.avaliacao.numeroConfere,
            par.avaliacao.partidoConfere,
          ],
        );
        paraRevisar += 1;
      }

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'candidatos',
        idCampanha,
        dadosDepois: { mescladas, paraRevisar },
      });

      return { mescladas, paraRevisar };
    });
  }

  /** Aplica a decisão do coordenador sobre uma sugestão de mesclagem. */
  async decidirMesclagem(
    claims: ClaimsUsuario,
    entrada: { idMesclagem: string; aceitar: boolean },
  ): Promise<{ aplicada: boolean }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        id_candidato_manual: string;
        id_tse_sugerido: string;
        id_campanha: string;
      }>(
        `select id_candidato_manual, id_tse_sugerido, id_campanha
           from public.mesclagens_candidato where id = $1 and status = 'PENDENTE'`,
        [entrada.idMesclagem],
      );
      const sugestao = rows[0];
      if (!sugestao) return { aplicada: false };

      if (entrada.aceitar) {
        await conexao.query(
          `update public.candidatos
              set id_tse = $2, origem = 'DADOS_ABERTOS', sincronizado_em = now()
            where id = $1`,
          [sugestao.id_candidato_manual, sugestao.id_tse_sugerido],
        );
      }

      await conexao.query(
        `update public.mesclagens_candidato
            set status = $2, decidido_por = $3, decidido_em = now()
          where id = $1`,
        [entrada.idMesclagem, entrada.aceitar ? 'ACEITA' : 'RECUSADA', claims.sub],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'mesclagens_candidato',
        idEntidade: entrada.idMesclagem,
        idCampanha: sugestao.id_campanha,
        dadosDepois: { aceita: entrada.aceitar },
      });

      return { aplicada: true };
    });
  }
}

@Controller('candidatos')
class CandidatosController {
  constructor(
    private readonly banco: BancoService,
    private readonly candidatos: CandidatosService,
  ) {}

  @Get()
  @ExigePermissao('candidatos.ler')
  async listar(@Claims() claims: ClaimsUsuario, @Query('idCampanha') id: string): Promise<unknown[]> {
    const idCampanha = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select c.id, c.nome_urna, c.numero_urna, c.proprio, c.origem, c.situacao,
                p.sigla as sigla_partido, cg.nome as cargo
           from public.candidatos c
           left join public.partidos p on p.id = c.id_partido
           join public.cargos cg on cg.id = c.id_cargo
          where c.id_campanha = $1 and c.ativo
          order by c.proprio desc, cg.nome, c.nome_urna`,
        [idCampanha],
      );
      return rows;
    });
  }

  @Post()
  @ExigePermissao('candidatos.gerenciar')
  async criar(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<{ id: string }> {
    const entrada = EntradaCandidato.parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.candidatos
           (id_organizacao, id_campanha, id_cargo, nome_completo, nome_urna,
            numero_urna, id_partido, uf, origem, proprio)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'MANUAL', $9)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.idCargo,
          entrada.nomeCompleto,
          entrada.nomeUrna,
          entrada.numeroUrna,
          entrada.idPartido ?? null,
          entrada.uf ?? null,
          entrada.proprio,
        ],
      );
      return rows[0]!;
    });
  }

  @Get('mesclagens')
  @ExigePermissao('candidatos.gerenciar')
  async listarMesclagens(
    @Claims() claims: ClaimsUsuario,
    @Query('idCampanha') id: string,
  ): Promise<unknown[]> {
    const idCampanha = Uuid.parse(id);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select m.id, m.similaridade_nome, m.numero_confere, m.partido_confere,
                m.dados_oficiais, c.nome_urna as nome_manual, c.numero_urna as numero_manual
           from public.mesclagens_candidato m
           join public.candidatos c on c.id = m.id_candidato_manual
          where m.id_campanha = $1 and m.status = 'PENDENTE'
          order by m.similaridade_nome desc`,
        [idCampanha],
      );
      return rows;
    });
  }

  @Post('mesclagens/sugerir')
  @ExigePermissao('candidatos.gerenciar')
  async sugerir(
    @Claims() claims: ClaimsUsuario,
    @Body('idCampanha') id: string,
  ): Promise<{ mescladas: number; paraRevisar: number }> {
    return this.candidatos.sugerirMesclagens(claims, Uuid.parse(id));
  }

  @Post('mesclagens/decidir')
  @ExigePermissao('candidatos.gerenciar')
  async decidir(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ aplicada: boolean }> {
    return this.candidatos.decidirMesclagem(claims, DecisaoMesclagem.parse(corpo));
  }
}

@Module({
  controllers: [CandidatosController],
  providers: [BancoService, AuditoriaService, CandidatosService],
  exports: [CandidatosService],
})
export class CandidatosModule {}

export { avaliarMesclagem };
