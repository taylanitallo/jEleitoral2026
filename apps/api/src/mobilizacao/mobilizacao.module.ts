import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ClaimsUsuario,
  PapelAtivista,
  ParametrosPaginacao,
  TipoComite,
  Uuid,
  montarPagina,
  type PaginaDe,
} from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';

const EntradaAtivista = z.object({
  idCampanha: Uuid,
  nome: z.string().trim().min(3, 'Informe o nome.').max(120),
  apelido: z.string().trim().max(60).optional(),
  telefone: z.string().trim().max(20).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  papel: PapelAtivista.default('MULTIPLICADOR'),
  idBairro: Uuid.optional(),
  idComite: Uuid.optional(),
  nivelEngajamento: z.coerce.number().int().min(1).max(5).default(3),
  disponibilidade: z.string().trim().max(200).optional(),
  habilidades: z.array(z.string().trim().max(40)).max(20).default([]),
  observacoes: z.string().trim().max(500).optional(),
});

const EntradaComite = z.object({
  idCampanha: Uuid,
  nome: z.string().trim().min(3, 'Informe o nome do comitê.').max(120),
  tipo: TipoComite.default('BAIRRO'),
  idBairro: Uuid.optional(),
  idEquipe: Uuid.optional(),
  idCoordenador: Uuid.optional(),
  numero: z.string().trim().max(20).optional(),
  complemento: z.string().trim().max(60).optional(),
  telefoneContato: z.string().trim().max(20).optional(),
  horarioFuncionamento: z.string().trim().max(120).optional(),
  dataInauguracao: z.string().date().optional(),
  observacoes: z.string().trim().max(500).optional(),
});

const EntradaMembro = z
  .object({
    idUsuario: Uuid.optional(),
    idAtivista: Uuid.optional(),
    papel: z.string().trim().max(40).default('MEMBRO'),
  })
  .refine((valor) => Boolean(valor.idUsuario) !== Boolean(valor.idAtivista), {
    // Espelha o `check` da tabela. Validar aqui devolve mensagem em português;
    // deixar o banco recusar devolveria uma violação de constraint crua.
    message: 'Informe um usuário OU um ativista, nunca os dois.',
  });

const ConsultaAtivistas = ParametrosPaginacao.extend({
  idCampanha: Uuid,
  busca: z.string().trim().min(2).optional(),
  papel: PapelAtivista.optional(),
  idComite: Uuid.optional(),
  apenasAtivos: z.coerce.boolean().default(true),
});

interface Ativista {
  id: string;
  nome: string;
  apelido: string | null;
  telefone: string | null;
  papel: string;
  nivel_engajamento: number;
  ativo: boolean;
  bairro: string | null;
  comite: string | null;
}

interface Comite {
  id: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  bairro: string | null;
  coordenador: string | null;
  total_membros: number;
}

/**
 * Mobilização — a militância e os comitês.
 *
 * Repare no que **não** aparece nas consultas: nenhum `where id_organizacao`.
 * O filtro é do banco, via RLS. E no caso de `ativistas` a política vai além do
 * inquilino — ela aplica `visivel_no_escopo`, então o mobilizador enxerga só a
 * militância que ele mesmo arregimentou ou a do território dele. Escrever o
 * filtro aqui seria redundância inofensiva; confiar nele seria o erro.
 */
@Controller('mobilizacao')
export class MobilizacaoController {
  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // --- Ativistas -------------------------------------------------------------

  @Get('ativistas')
  @ExigePermissao('mobilizacao.ler')
  async listarAtivistas(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<Ativista>> {
    const p = ConsultaAtivistas.parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Ativista & { total: string }>(
        `select a.id, a.nome, a.apelido, a.telefone, a.papel, a.nivel_engajamento, a.ativo,
                b.nome as bairro, c.nome as comite,
                count(*) over () as total
           from public.ativistas a
           left join public.bairros b on b.id = a.id_bairro
           left join public.comites c on c.id = a.id_comite
          where a.id_campanha = $1
            and ($2::boolean is false or a.ativo)
            and ($3::text is null or a.nome_normalizado like '%' || public.normalizar_texto($3) || '%')
            and ($4::text is null or a.papel::text = $4)
            and ($5::uuid is null or a.id_comite = $5)
          order by a.ativo desc, a.nome
          limit $6 offset $7`,
        [
          p.idCampanha,
          p.apenasAtivos,
          p.busca ?? null,
          p.papel ?? null,
          p.idComite ?? null,
          p.limite,
          (p.pagina - 1) * p.limite,
        ],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...ativista }) => ativista),
        total,
        p,
      );
    });
  }

  @Post('ativistas')
  @ExigePermissao('mobilizacao.gerenciar')
  async criarAtivista(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; nome: string }> {
    const entrada = EntradaAtivista.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; nome: string }>(
        `insert into public.ativistas
           (id_organizacao, id_campanha, nome, apelido, telefone, email, papel,
            id_bairro, id_comite, id_usuario_padrinho, nivel_engajamento,
            disponibilidade, habilidades, observacoes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         returning id, nome`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.nome,
          entrada.apelido ?? null,
          entrada.telefone ?? null,
          entrada.email || null,
          entrada.papel,
          entrada.idBairro ?? null,
          entrada.idComite ?? null,
          // Do token, sempre. A política de inserção exige que o padrinho seja
          // quem está gravando — ninguém arregimenta em nome de terceiro.
          claims.sub,
          entrada.nivelEngajamento,
          entrada.disponibilidade ?? null,
          entrada.habilidades,
          entrada.observacoes ?? null,
        ],
      );
      const criado = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'ativistas',
        idEntidade: criado.id,
        idCampanha: entrada.idCampanha,
        dadosDepois: { nome: criado.nome, papel: entrada.papel },
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criado;
    });
  }

  @Put('ativistas/:id')
  @ExigePermissao('mobilizacao.gerenciar')
  async alterarAtivista(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ alterado: boolean }> {
    const idAtivista = Uuid.parse(id);
    const entrada = EntradaAtivista.partial().extend({ ativo: z.boolean().optional() }).parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const resultado = await conexao.query(
        `update public.ativistas
            set nome = coalesce($2, nome),
                apelido = coalesce($3, apelido),
                telefone = coalesce($4, telefone),
                papel = coalesce($5::public.papel_ativista, papel),
                id_bairro = coalesce($6, id_bairro),
                id_comite = coalesce($7, id_comite),
                nivel_engajamento = coalesce($8, nivel_engajamento),
                disponibilidade = coalesce($9, disponibilidade),
                observacoes = coalesce($10, observacoes),
                ativo = coalesce($11, ativo)
          where id = $1`,
        [
          idAtivista,
          entrada.nome ?? null,
          entrada.apelido ?? null,
          entrada.telefone ?? null,
          entrada.papel ?? null,
          entrada.idBairro ?? null,
          entrada.idComite ?? null,
          entrada.nivelEngajamento ?? null,
          entrada.disponibilidade ?? null,
          entrada.observacoes ?? null,
          entrada.ativo ?? null,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'ALTERAR',
        entidade: 'ativistas',
        idEntidade: idAtivista,
        dadosDepois: entrada,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return { alterado: (resultado.rowCount ?? 0) > 0 };
    });
  }

  // --- Comitês ---------------------------------------------------------------

  @Get('comites')
  @ExigePermissao('mobilizacao.ler')
  async listarComites(
    @Claims() claims: ClaimsUsuario,
    @Query() consulta: unknown,
  ): Promise<PaginaDe<Comite>> {
    const p = ParametrosPaginacao.extend({ idCampanha: Uuid }).parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<Comite & { total: string }>(
        `select c.id, c.nome, c.tipo, c.ativo,
                b.nome as bairro, u.nome as coordenador,
                (select count(*)::int from public.comite_membros m
                  where m.id_comite = c.id and m.ativo) as total_membros,
                count(*) over () as total
           from public.comites c
           left join public.bairros b on b.id = c.id_bairro
           left join public.usuarios u on u.id = c.id_coordenador
          where c.id_campanha = $1
          order by c.ativo desc, c.nome
          limit $2 offset $3`,
        [p.idCampanha, p.limite, (p.pagina - 1) * p.limite],
      );
      const total = rows[0] ? Number(rows[0].total) : 0;
      return montarPagina(
        rows.map(({ total: _ignorado, ...comite }) => comite),
        total,
        p,
      );
    });
  }

  @Post('comites')
  @ExigePermissao('mobilizacao.gerenciar')
  async criarComite(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; nome: string }> {
    const entrada = EntradaComite.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string; nome: string }>(
        `insert into public.comites
           (id_organizacao, id_campanha, nome, tipo, id_bairro, id_equipe, id_coordenador,
            numero, complemento, telefone_contato, horario_funcionamento, data_inauguracao,
            observacoes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning id, nome`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.nome,
          entrada.tipo,
          entrada.idBairro ?? null,
          entrada.idEquipe ?? null,
          entrada.idCoordenador ?? null,
          entrada.numero ?? null,
          entrada.complemento ?? null,
          entrada.telefoneContato ?? null,
          entrada.horarioFuncionamento ?? null,
          entrada.dataInauguracao ?? null,
          entrada.observacoes ?? null,
        ],
      );
      const criado = rows[0]!;

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'CRIAR',
        entidade: 'comites',
        idEntidade: criado.id,
        idCampanha: entrada.idCampanha,
        dadosDepois: criado,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
        idCorrelacao: requisicao.idCorrelacao ?? null,
      });

      return criado;
    });
  }

  @Post('comites/:id/membros')
  @ExigePermissao('mobilizacao.gerenciar')
  async incluirMembro(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const idComite = Uuid.parse(id);
    const entrada = EntradaMembro.parse(corpo);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // `id_campanha` vem do comitê, não do corpo: um membro não pode acabar
      // numa campanha diferente da do comitê a que pertence.
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.comite_membros
           (id_organizacao, id_campanha, id_comite, id_usuario, id_ativista, papel)
         select $1, c.id_campanha, c.id, $3, $4, $5
           from public.comites c where c.id = $2
         returning id`,
        [
          claims.idOrganizacao,
          idComite,
          entrada.idUsuario ?? null,
          entrada.idAtivista ?? null,
          entrada.papel,
        ],
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Comitê não encontrado.'), { code: '42501' });
      }
      return rows[0];
    });
  }

  @Delete('comites/:id/membros/:idMembro')
  @ExigePermissao('mobilizacao.gerenciar')
  async removerMembro(
    @Claims() claims: ClaimsUsuario,
    @Param('idMembro') idMembro: string,
  ): Promise<{ removido: boolean }> {
    const alvo = Uuid.parse(idMembro);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      // Desativa em vez de apagar: quem passou pelo comitê faz parte da história
      // da campanha, e a folha de presença de atividades antigas aponta para cá.
      const resultado = await conexao.query(
        'update public.comite_membros set ativo = false where id = $1',
        [alvo],
      );
      return { removido: (resultado.rowCount ?? 0) > 0 };
    });
  }
}

@Module({
  controllers: [MobilizacaoController],
  providers: [BancoService, AuditoriaService],
})
export class MobilizacaoModule {}
