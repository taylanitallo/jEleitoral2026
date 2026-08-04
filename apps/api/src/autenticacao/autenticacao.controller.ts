import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { ClaimsUsuario } from '@jeleitoral/tipos';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { carregarConfiguracao } from '../comum/configuracao.js';
import { DispensaMfa, Publica } from './autenticacao.guard.js';
import { Claims } from './claimsUsuario.decorator.js';

export const NOME_COOKIE_SESSAO = 'jeleitoral_sessao';
export const NOME_COOKIE_RENOVACAO = 'jeleitoral_renovacao';

const EntradaLogin = z.object({
  email: z.string().email('Informe um e-mail válido.'),
  senha: z.string().min(8, 'A senha tem no mínimo 8 caracteres.'),
});

/** Espelha o portão do guard. Divergir aqui prenderia o usuário do lado de fora. */
const PERFIS_QUE_EXIGEM_MFA = new Set(['ADMINISTRADOR', 'FINANCEIRO']);

const EntradaMfa = z.object({
  idFator: z.string(),
  idDesafio: z.string(),
  codigo: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
});

@Injectable()
export class AutenticacaoService {
  private readonly configuracao = carregarConfiguracao();

  constructor(private readonly auditoria: AuditoriaService) {}

  /** Cliente anônimo, por requisição. Nunca a chave de serviço para login. */
  clienteAnonimo() {
    return createClient(this.configuracao.SUPABASE_URL, this.configuracao.SUPABASE_CHAVE_ANONIMA, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  /**
   * Cliente com a sessão do usuário **de fato carregada**.
   *
   * O detalhe que custou caro: passar o token em `global.headers.Authorization`
   * autentica as chamadas ao PostgREST, mas **não** a camada de auth. Métodos
   * como `mfa.enroll` e `mfa.verify` leem a sessão do estado interno do cliente,
   * que fica vazio — e falham com uma mensagem genérica que não aponta para a
   * causa. `setSession` é o que realmente popula esse estado.
   */
  async clienteComSessao(accessToken: string, refreshToken: string) {
    const supabase = this.clienteAnonimo();
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) return null;
    return supabase;
  }

  /**
   * Opções do cookie de sessão.
   *
   * `httpOnly` para que script injetado não leia o token; `sameSite: strict`
   * porque não há fluxo de terceiros legítimo neste sistema; `secure` fora de
   * desenvolvimento. O token **nunca** vai para `localStorage` — uma base de
   * intenção de voto não é lugar para esse risco.
   */
  opcoesCookie(duracaoSegundos: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configuracao.AMBIENTE !== 'desenvolvimento',
      sameSite: 'strict',
      path: '/',
      maxAge: duracaoSegundos * 1000,
    };
  }
}

@Controller('autenticacao')
export class AutenticacaoController {
  private readonly registrador = new Logger(AutenticacaoController.name);
  private readonly configuracao = carregarConfiguracao();

  constructor(
    private readonly servico: AutenticacaoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Entrada por e-mail e senha.
   *
   * Limite bem mais apertado que o global: endpoint de login é o alvo natural
   * de força bruta, e cada tentativa custa uma verificação de senha no
   * Supabase.
   */
  @Post('entrar')
  @Publica()
  @Throttle({ curta: { limit: 1, ttl: 2000 }, longa: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Res({ passthrough: true }) resposta: Response,
    @Req() requisicao: Request,
  ): Promise<{
    precisaMfa: boolean;
    precisaInscreverMfa?: boolean;
    idFator?: string;
    idDesafio?: string;
    qrCode?: string;
    segredo?: string;
  }> {
    const entrada = EntradaLogin.parse(corpo);
    const supabase = this.servico.clienteAnonimo();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: entrada.email,
      password: entrada.senha,
    });

    if (error || !data.session) {
      // Mensagem única para credencial errada e usuário inexistente: dizer
      // "usuário não encontrado" entrega quais e-mails existem na base.
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    // O nível de garantia (AAL) diz se o MFA já foi cumprido. Perfis
    // ADMINISTRADOR e FINANCEIRO exigem `aal2`; o guard barra quem não tem.
    const { data: garantia } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const precisaMfa =
      garantia?.nextLevel === 'aal2' && garantia.nextLevel !== garantia.currentLevel;

    // A sessão parcial já vale como cookie: o segundo fator é verificado com
    // ela, e o guard recusa qualquer rota protegida enquanto o AAL não subir.
    this.gravarCookies(resposta, data.session);

    if (precisaMfa) {
      const { data: fatores } = await supabase.auth.mfa.listFactors();
      const fator = fatores?.totp?.[0];
      if (fator) {
        const { data: desafio } = await supabase.auth.mfa.challenge({ factorId: fator.id });
        return { precisaMfa: true, idFator: fator.id, idDesafio: desafio?.id };
      }
    }

    /*
     * Partida do perfil que exige MFA e ainda não tem fator.
     *
     * Sem este ramo o usuário autentica, o guard barra tudo, e não existe
     * caminho para inscrever o fator que o guard exige — foi exatamente o que
     * prendeu o primeiro administrador do lado de fora. Aqui a inscrição é
     * oferecida no próprio login.
     */
    if (PERFIS_QUE_EXIGEM_MFA.has(this.perfilDoToken(data.session.access_token))) {
      const inscricao = await this.prepararInscricaoMfa(supabase);
      if (inscricao) return { precisaMfa: true, precisaInscreverMfa: true, ...inscricao };

      /*
       * A inscrição falhou — tipicamente porque o TOTP está desligado na
       * configuração do projeto Supabase deste ambiente.
       *
       * Aqui **não** se pode cair no `precisaMfa: false` lá embaixo. Isso
       * devolvia "entrou" com uma sessão `aal1` que o guard recusa em toda rota
       * protegida: o usuário via a tela piscar e voltar para o login, sem
       * nenhuma pista de que o problema era configuração do ambiente. O sintoma
       * era indistinguível de senha errada — e foi assim que este ambiente
       * passou por "o login não funciona localmente".
       *
       * Falhar aqui, dizendo o que houve, é o comportamento correto: o perfil
       * exige segundo fator, o ambiente não consegue oferecê-lo, e não existe
       * sessão utilizável a entregar.
       */
      this.limparCookies(resposta);
      throw new ServiceUnavailableException(
        'Seu perfil exige segundo fator, mas este ambiente está com o TOTP desabilitado no ' +
          'Supabase. Habilite `auth.mfa.totp.enroll_enabled` no projeto antes de entrar.',
      );
    }

    void this.registrarAutenticacao(data.session.access_token, requisicao, 'AUTENTICAR');
    return { precisaMfa: false };
  }

  @Post('mfa/verificar')
  @Publica()
  @Throttle({ curta: { limit: 1, ttl: 2000 }, longa: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  async verificarMfa(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<{ ok: true }> {
    const entrada = EntradaMfa.parse(corpo);
    const cookies = requisicao.cookies as Record<string, string> | undefined;
    const token = cookies?.[NOME_COOKIE_SESSAO];
    const renovacao = cookies?.[NOME_COOKIE_RENOVACAO] ?? '';
    if (!token) throw new UnauthorizedException('Sessão não encontrada. Entre novamente.');

    const supabase = await this.servico.clienteComSessao(token, renovacao);
    if (!supabase) throw new UnauthorizedException('Sessão inválida. Entre novamente.');

    const { data, error } = await supabase.auth.mfa.verify({
      factorId: entrada.idFator,
      challengeId: entrada.idDesafio,
      code: entrada.codigo,
    });

    if (error || !data) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    this.gravarCookies(resposta, data);
    void this.registrarAutenticacao(data.access_token, requisicao, 'AUTENTICAR');
    return { ok: true };
  }

  /**
   * Inscreve um segundo fator (TOTP) e devolve o QR para o aplicativo
   * autenticador.
   *
   * Dispensada do portão de MFA de propósito: sem isso o primeiro
   * administrador não teria como inscrever o fator que o portão exige dele.
   */
  @Post('mfa/inscrever')
  @DispensaMfa()
  @HttpCode(HttpStatus.OK)
  async inscreverMfa(
    @Req() requisicao: Request,
  ): Promise<{ idFator: string; idDesafio: string; qrCode: string; segredo: string }> {
    const cookies = requisicao.cookies as Record<string, string> | undefined;
    const token = cookies?.[NOME_COOKIE_SESSAO];
    const renovacao = cookies?.[NOME_COOKIE_RENOVACAO] ?? '';
    if (!token) throw new UnauthorizedException('Sessão não encontrada.');

    const supabase = await this.servico.clienteComSessao(token, renovacao);
    if (!supabase) throw new UnauthorizedException('Sessão inválida. Entre novamente.');

    const inscricao = await this.prepararInscricaoMfa(supabase);
    if (!inscricao) {
      throw new UnauthorizedException('Não foi possível inscrever o segundo fator.');
    }
    return inscricao;
  }


  /**
   * Renova a sessão a partir do cookie de renovação.
   *
   * Esta rota **não existia**, e a ausência era um defeito de peso: o cookie de
   * renovação era gravado com trinta dias de validade e nunca usado. Na prática
   * o entrevistador em campo era jogado para o login uma hora depois de entrar
   * — exatamente o que o comentário em `gravarCookies` dizia que não podia
   * acontecer.
   *
   * É também a metade que faz a revogação funcionar: renovar reexecuta o hook
   * de token do Supabase, que remonta os claims a partir do banco. Permissão
   * tirada há dez segundos já não vem no token novo.
   */
  @Post('renovar')
  @Publica()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async renovar(
    @Req() requisicao: Request,
    @Res({ passthrough: true }) resposta: Response,
  ): Promise<{ renovada: true }> {
    const cookies = requisicao.cookies as Record<string, string> | undefined;
    const tokenRenovacao = cookies?.[NOME_COOKIE_RENOVACAO];

    if (!tokenRenovacao) {
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    const supabase = this.servico.clienteAnonimo();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: tokenRenovacao,
    });

    if (error || !data.session) {
      /*
       * Limpa os cookies antes de recusar.
       *
       * Um token de renovação já gasto ou revogado no cookie faria toda
       * requisição seguinte tentar renovar e falhar de novo, prendendo a pessoa
       * num laço sem nunca chegar à tela de login.
       */
      this.limparCookies(resposta);
      throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    }

    this.gravarCookies(resposta, data.session);
    return { renovada: true };
  }

  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  sair(@Res({ passthrough: true }) resposta: Response): void {
    this.limparCookies(resposta);
  }

  /**
   * Apaga os cookies de sessão.
   *
   * Usado ao sair e sempre que o login for abortado no meio: uma sessão parcial
   * esquecida no navegador faz a próxima tentativa partir de um estado que
   * ninguém previu.
   */
  private limparCookies(resposta: Response): void {
    resposta.clearCookie(NOME_COOKIE_SESSAO, this.servico.opcoesCookie(0));
    resposta.clearCookie(NOME_COOKIE_RENOVACAO, this.servico.opcoesCookie(0));
  }

  /**
   * Sessão atual. O front usa para decidir o que exibir — e o que **não**
   * exibir: o menu monta a partir das permissões do token, então um botão que o
   * perfil não pode usar nem aparece.
   */
  @Get('sessao')
  sessao(@Claims() claims: ClaimsUsuario): {
    idUsuario: string;
    email: string;
    perfil: string;
    campanhas: string[];
    permissoes: Record<string, string>;
    mfaVerificado: boolean;
    ehProvedor: boolean;
  } {
    return {
      idUsuario: claims.sub,
      email: claims.email,
      perfil: claims.perfil,
      campanhas: claims.campanhas,
      permissoes: claims.permissoes,
      mfaVerificado: claims.mfaVerificado,
      // Provedor é quem está **fora** da árvore de inquilinos — é a mesma regra
      // que a API aplica para liberar o backoffice. Derivar do perfil daria
      // errado: `ADMINISTRADOR` existe dentro de cada organização e não tem, nem
      // deve ter, acesso ao painel do provedor.
      ehProvedor: !claims.idOrganizacao,
    };
  }

  /** Lê o perfil direto do token, sem passar pelo guard. */
  private perfilDoToken(accessToken: string): string {
    try {
      const carga = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      return String(carga['perfil'] ?? '');
    } catch {
      return '';
    }
  }

  /**
   * Prepara a inscrição de um TOTP: descarta fatores pendentes, inscreve um
   * novo e já cria o desafio.
   *
   * Descartar o pendente não é zelo excessivo — o Supabase recusa uma segunda
   * inscrição enquanto houver fator não verificado, e o segredo do anterior já
   * se perdeu. Sem a limpeza, quem abandona a inscrição no meio fica travado
   * para sempre.
   */
  private async prepararInscricaoMfa(
    supabase: SupabaseClient,
  ): Promise<{ idFator: string; idDesafio: string; qrCode: string; segredo: string } | null> {
    const { data: existentes } = await supabase.auth.mfa.listFactors();
    for (const fator of existentes?.all ?? []) {
      if (fator.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: fator.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) {
      this.registrador.error(`Falha ao inscrever MFA: ${error?.message ?? 'sem detalhe'}`);
      return null;
    }

    const { data: desafio, error: erroDesafio } = await supabase.auth.mfa.challenge({
      factorId: data.id,
    });
    if (erroDesafio || !desafio) {
      this.registrador.error(`Falha ao desafiar MFA: ${erroDesafio?.message ?? 'sem detalhe'}`);
      return null;
    }

    return {
      idFator: data.id,
      idDesafio: desafio.id,
      qrCode: data.totp.qr_code,
      segredo: data.totp.secret,
    };
  }

  private gravarCookies(
    resposta: Response,
    sessao: { access_token: string; refresh_token: string; expires_in?: number },
  ): void {
    resposta.cookie(
      NOME_COOKIE_SESSAO,
      sessao.access_token,
      this.servico.opcoesCookie(sessao.expires_in ?? 3600),
    );
    // Renovação vive 30 dias: o entrevistador em campo não pode ser deslogado
    // no meio do dia por expiração de token de uma hora.
    resposta.cookie(
      NOME_COOKIE_RENOVACAO,
      sessao.refresh_token,
      this.servico.opcoesCookie(30 * 24 * 3600),
    );
  }

  private async registrarAutenticacao(
    accessToken: string,
    requisicao: Request,
    acao: 'AUTENTICAR' | 'FALHA_AUTENTICACAO',
  ): Promise<void> {
    try {
      const carga = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      const claims = ClaimsUsuario.parse({
        sub: carga['sub'],
        email: carga['email'],
        idOrganizacao: carga['id_organizacao'],
        idPerfil: carga['id_perfil'],
        perfil: carga['perfil'],
        campanhas: carga['campanhas'] ?? [],
        equipes: carga['equipes'] ?? [],
        territorios: carga['territorios'] ?? [],
        permissoes: carga['permissoes'] ?? {},
        mfaVerificado: carga['aal'] === 'aal2',
      });
      await this.auditoria.registrar(claims, {
        acao,
        entidade: 'sessoes',
        idEntidade: claims.sub,
        ip: requisicao.ip ?? null,
        userAgent: requisicao.headers['user-agent'] ?? null,
      });
    } catch {
      // Token do provedor ou claims incompletos: não há organização para
      // registrar. A ausência do log aqui é esperada, não um defeito.
    }
  }
}
