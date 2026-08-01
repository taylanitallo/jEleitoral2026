import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import { z } from 'zod';
import { ClaimsUsuario, TipoMaterialGrafico, Uuid } from '@jeleitoral/tipos';
import { ExigePermissao } from '../autenticacao/autenticacao.guard.js';
import { Claims } from '../autenticacao/claimsUsuario.decorator.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';

/** Bucket privado. Nunca torne público: material gráfico vaza para adversário. */
const BUCKET_ARTES = 'artes';

/**
 * URLs assinadas duram 5 minutos. Curto de propósito: tempo suficiente para o
 * navegador iniciar o download, curto demais para o link ser repassado num
 * grupo de mensagens e continuar valendo no dia seguinte.
 */
const VALIDADE_URL_SEGUNDOS = 300;

const EntradaMaterial = z.object({
  idCampanha: Uuid,
  idCandidato: Uuid.optional(),
  tipo: TipoMaterialGrafico,
  titulo: z.string().trim().min(3).max(120),
  descricao: z.string().trim().max(500).optional(),
});

const EntradaVersao = z.object({
  idMaterial: Uuid,
  idCampanha: Uuid,
  formato: z.string().max(20),
  largura: z.number().int().positive().optional(),
  altura: z.number().int().positive().optional(),
  tamanhoBytes: z
    .number()
    .int()
    .positive()
    .max(200 * 1024 * 1024),
});

@Injectable()
export class ArtesService {
  private readonly storage: SupabaseClient;

  constructor(
    private readonly banco: BancoService,
    private readonly auditoria: AuditoriaService,
  ) {
    const configuracao = carregarConfiguracao();
    // Aqui a chave de serviço é legítima: o Storage do Supabase não aplica as
    // políticas RLS das nossas tabelas, e o controle de acesso é feito antes,
    // consultando `versoes_arte` sob a RLS do usuário. Quem não enxerga a linha
    // não chega a pedir a URL assinada.
    this.storage = createClient(configuracao.SUPABASE_URL, configuracao.SUPABASE_CHAVE_SERVICO, {
      auth: { persistSession: false },
    });
  }

  /**
   * Devolve uma URL de upload assinada.
   *
   * O arquivo vai do navegador direto para o Storage, sem passar pela API —
   * um banner de impressão tem dezenas de megabytes, e trafegá-lo pelo Railway
   * gastaria banda e memória do processo à toa. O caminho é montado pelo
   * servidor a partir da organização, então o cliente não escolhe onde grava.
   */
  async prepararUpload(
    claims: ClaimsUsuario,
    entrada: z.infer<typeof EntradaVersao>,
  ): Promise<{ caminho: string; urlAssinada: string; token: string; versao: number }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ proxima: string }>(
        `select coalesce(max(versao), 0) + 1 as proxima
           from public.versoes_arte where id_material = $1`,
        [entrada.idMaterial],
      );
      const versao = Number(rows[0]?.proxima ?? 1);

      // O caminho começa pela organização: mesmo que alguém liste o bucket com
      // a chave de serviço, os arquivos de clientes diferentes ficam separados.
      const caminho = `${claims.idOrganizacao}/${entrada.idCampanha}/${entrada.idMaterial}/v${versao}.${entrada.formato}`;

      const { data, error } = await this.storage.storage
        .from(BUCKET_ARTES)
        .createSignedUploadUrl(caminho);
      if (error || !data) {
        throw new NotFoundException('Não foi possível preparar o envio do arquivo.');
      }

      await conexao.query(
        `insert into public.versoes_arte
           (id_organizacao, id_campanha, id_material, versao, caminho_arquivo, formato,
            largura, altura, tamanho_bytes, id_usuario_upload)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.idMaterial,
          versao,
          caminho,
          entrada.formato,
          entrada.largura ?? null,
          entrada.altura ?? null,
          entrada.tamanhoBytes,
          claims.sub,
        ],
      );

      return { caminho, urlAssinada: data.signedUrl, token: data.token, versao };
    });
  }

  /**
   * URL assinada de download, com o acesso decidido pela RLS.
   *
   * A consulta a `versoes_arte` roda sob o token do usuário: se ele não pode
   * ver a linha, a função devolve "não encontrado" e nenhuma URL é gerada. O
   * download é registrado antes de a URL ser entregue — se o registro falhar, a
   * URL não sai.
   */
  async gerarUrlDownload(
    claims: ClaimsUsuario,
    idVersao: string,
    contexto: { ip?: string | null; userAgent?: string | null },
  ): Promise<{ url: string; expiraEm: string; nomeArquivo: string }> {
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{
        caminho_arquivo: string;
        formato: string;
        id_campanha: string;
        titulo: string;
      }>(
        `select v.caminho_arquivo, v.formato, v.id_campanha, m.titulo
           from public.versoes_arte v
           join public.materiais_graficos m on m.id = v.id_material
          where v.id = $1`,
        [idVersao],
      );
      const versao = rows[0];
      if (!versao) {
        // Pode não existir ou pertencer a outra organização. A mensagem é a
        // mesma nos dois casos.
        throw new NotFoundException('Arte não encontrada.');
      }

      await conexao.query(
        `insert into public.downloads_arte
           (id_organizacao, id_campanha, id_versao, id_usuario, ip, user_agent)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          claims.idOrganizacao,
          versao.id_campanha,
          idVersao,
          claims.sub,
          contexto.ip ?? null,
          contexto.userAgent ?? null,
        ],
      );

      await this.auditoria.registrarNaTransacao(conexao, claims, {
        acao: 'EXPORTAR',
        entidade: 'versoes_arte',
        idEntidade: idVersao,
        idCampanha: versao.id_campanha,
        quantidadeRegistros: 1,
        ip: contexto.ip ?? null,
        userAgent: contexto.userAgent ?? null,
      });

      const { data, error } = await this.storage.storage
        .from(BUCKET_ARTES)
        .createSignedUrl(versao.caminho_arquivo, VALIDADE_URL_SEGUNDOS, {
          download: `${versao.titulo}-v${idVersao.slice(0, 8)}.${versao.formato}`,
        });
      if (error || !data) {
        throw new NotFoundException('O arquivo desta arte não está mais disponível.');
      }

      return {
        url: data.signedUrl,
        expiraEm: new Date(Date.now() + VALIDADE_URL_SEGUNDOS * 1000).toISOString(),
        nomeArquivo: `${versao.titulo}.${versao.formato}`,
      };
    });
  }
}

@Controller('artes')
class ArtesController {
  constructor(
    private readonly banco: BancoService,
    private readonly artes: ArtesService,
  ) {}

  @Get()
  @ExigePermissao('artes.ler')
  async listar(@Claims() claims: ClaimsUsuario, @Query() consulta: unknown): Promise<unknown[]> {
    const parametros = z
      .object({
        idCampanha: Uuid,
        tipo: TipoMaterialGrafico.optional(),
        idCandidato: Uuid.optional(),
      })
      .parse(consulta);

    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query(
        `select m.id, m.tipo, m.titulo, m.descricao, m.publicado, m.id_candidato,
                (select json_agg(json_build_object(
                   'id', v.id, 'versao', v.versao, 'formato', v.formato,
                   'largura', v.largura, 'altura', v.altura, 'tamanhoBytes', v.tamanho_bytes
                 ) order by v.versao desc)
                   from public.versoes_arte v where v.id_material = m.id) as versoes
           from public.materiais_graficos m
          where m.id_campanha = $1
            and ($2::text is null or m.tipo = $2::public.tipo_material_grafico)
            and ($3::uuid is null or m.id_candidato = $3::uuid)
          order by m.criado_em desc`,
        [parametros.idCampanha, parametros.tipo ?? null, parametros.idCandidato ?? null],
      );
      return rows;
    });
  }

  @Post('materiais')
  @ExigePermissao('artes.gerenciar')
  async criarMaterial(
    @Claims() claims: ClaimsUsuario,
    @Body() corpo: unknown,
  ): Promise<{ id: string }> {
    const entrada = EntradaMaterial.parse(corpo);
    return this.banco.executarComoUsuario(claims, async (conexao) => {
      const { rows } = await conexao.query<{ id: string }>(
        `insert into public.materiais_graficos
           (id_organizacao, id_campanha, id_candidato, tipo, titulo, descricao, id_usuario_criador)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [
          claims.idOrganizacao,
          entrada.idCampanha,
          entrada.idCandidato ?? null,
          entrada.tipo,
          entrada.titulo,
          entrada.descricao ?? null,
          claims.sub,
        ],
      );
      return rows[0]!;
    });
  }

  @Post('versoes/preparar-upload')
  @ExigePermissao('artes.gerenciar')
  async prepararUpload(@Claims() claims: ClaimsUsuario, @Body() corpo: unknown): Promise<unknown> {
    return this.artes.prepararUpload(claims, EntradaVersao.parse(corpo));
  }

  @Get('versoes/:id/download')
  @ExigePermissao('artes.ler')
  async baixar(
    @Claims() claims: ClaimsUsuario,
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<{ url: string; expiraEm: string; nomeArquivo: string }> {
    return this.artes.gerarUrlDownload(claims, Uuid.parse(id), {
      ip: requisicao.ip ?? null,
      userAgent: requisicao.headers['user-agent'] ?? null,
    });
  }
}

@Module({
  controllers: [ArtesController],
  providers: [BancoService, AuditoriaService, ArtesService],
  exports: [ArtesService],
})
export class ArtesModule {}
