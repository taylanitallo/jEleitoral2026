import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Request } from 'express';
import { ClaimsUsuario, type EscopoPermissao } from '@jeleitoral/tipos';
import { carregarConfiguracao } from '../comum/configuracao.js';

/** Marca uma rota como pública (login, /saude). */
export const ROTA_PUBLICA = 'rota_publica';
export const Publica = (): MethodDecorator & ClassDecorator => SetMetadata(ROTA_PUBLICA, true);

/**
 * Rota autenticada que NÃO exige o segundo fator.
 *
 * Existe por um problema de partida real: o perfil ADMINISTRADOR exige MFA, mas
 * o primeiro administrador ainda não tem fator inscrito. Sem esta exceção ele
 * autentica e é barrado em todas as rotas — inclusive na que serviria para
 * inscrever o fator. Use com parcimônia; hoje só a inscrição de MFA a usa.
 */
export const DISPENSA_MFA = 'dispensa_mfa';
export const DispensaMfa = (): MethodDecorator & ClassDecorator => SetMetadata(DISPENSA_MFA, true);

/** Exige uma permissão, opcionalmente com escopo mínimo. */
export const PERMISSAO_EXIGIDA = 'permissao_exigida';
export const ExigePermissao = (
  chave: string,
  escopoMinimo?: EscopoPermissao,
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSAO_EXIGIDA, { chave, escopoMinimo });

/** Perfis para os quais MFA é obrigatório (seção 4 do escopo). */
const PERFIS_COM_MFA_OBRIGATORIO = new Set(['ADMINISTRADOR', 'FINANCEIRO']);

declare module 'express' {
  interface Request {
    claims?: ClaimsUsuario;
    idCorrelacao?: string;
  }
}

/**
 * Guard de autenticação.
 *
 * O token vem de cookie HTTP-only, `Secure`, `SameSite=Strict` — nunca de
 * `localStorage`, que é legível por qualquer script injetado. O cabeçalho
 * `Authorization` é aceito apenas em ambiente de desenvolvimento, para permitir
 * testes com cliente HTTP.
 *
 * Vale notar o que este guard **não** faz: ele não filtra dados. A decisão
 * sobre quais linhas o usuário enxerga é do PostgreSQL, via RLS. Aqui só
 * verificamos identidade e permissão de rota. Se este guard tiver um defeito, o
 * banco continua negando — é essa redundância que dá segurança ao desenho.
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  private readonly registrador = new Logger(AutenticacaoGuard.name);
  private readonly chaves: JWTVerifyGetKey;
  private readonly emDesenvolvimento: boolean;

  constructor(private readonly reflector: Reflector) {
    const configuracao = carregarConfiguracao();
    // Os tokens de usuário do Supabase são assinados em ES256 e verificados
    // pelo JWKS público do projeto. O `jose` busca as chaves sob demanda e
    // refaz a busca quando elas rodam — o que um segredo simétrico fixo não
    // acompanharia, e é por isso que não há segredo de JWT na configuração.
    this.chaves = createRemoteJWKSet(
      new URL('/auth/v1/.well-known/jwks.json', configuracao.SUPABASE_URL),
    );
    this.emDesenvolvimento = configuracao.AMBIENTE === 'desenvolvimento';
  }

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(ROTA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publica) return true;

    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const token = this.extrairToken(requisicao);
    if (!token) {
      throw new UnauthorizedException('Sessão não encontrada. Entre novamente.');
    }

    const claims = await this.verificarToken(token);
    requisicao.claims = claims;

    const dispensaMfa = this.reflector.getAllAndOverride<boolean>(DISPENSA_MFA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);

    if (!dispensaMfa && PERFIS_COM_MFA_OBRIGATORIO.has(claims.perfil) && !claims.mfaVerificado) {
      throw new ForbiddenException(
        'Este perfil exige verificação em duas etapas. Conclua a verificação para continuar.',
      );
    }

    const exigencia = this.reflector.getAllAndOverride<{
      chave: string;
      escopoMinimo?: EscopoPermissao;
    }>(PERMISSAO_EXIGIDA, [contexto.getHandler(), contexto.getClass()]);

    if (exigencia) {
      const escopoConcedido = claims.permissoes[exigencia.chave];
      if (!escopoConcedido) {
        throw new ForbiddenException('Seu perfil não tem permissão para esta operação.');
      }
      if (exigencia.escopoMinimo && !this.escopoSuficiente(escopoConcedido, exigencia.escopoMinimo)) {
        throw new ForbiddenException(
          'Seu perfil tem alcance menor do que esta operação exige. Fale com o administrador da campanha.',
        );
      }
    }

    return true;
  }

  private extrairToken(requisicao: Request): string | null {
    const cookies = requisicao.cookies as Record<string, string> | undefined;
    const doCookie = cookies?.['jeleitoral_sessao'];
    if (doCookie) return doCookie;

    if (this.emDesenvolvimento) {
      const cabecalho = requisicao.headers.authorization;
      if (cabecalho?.startsWith('Bearer ')) return cabecalho.slice(7);
    }
    return null;
  }

  private async verificarToken(token: string): Promise<ClaimsUsuario> {
    try {
      const { payload } = await jwtVerify(token, this.chaves);
      // Zod aqui não é preciosismo: um token válido mas com claim faltando
      // (hook do Supabase mal configurado) produziria um `idOrganizacao`
      // indefinido, e toda política RLS negaria sem explicação clara.
      return ClaimsUsuario.parse({
        sub: payload.sub,
        email: payload['email'],
        idOrganizacao: payload['id_organizacao'],
        idPerfil: payload['id_perfil'],
        perfil: payload['perfil'],
        campanhas: payload['campanhas'] ?? [],
        equipes: payload['equipes'] ?? [],
        territorios: payload['territorios'] ?? [],
        permissoes: payload['permissoes'] ?? {},
        mfaVerificado: payload['aal'] === 'aal2' || payload['mfa_verificado'] === true,
      });
    } catch (erro) {
      this.registrador.debug(`Token recusado: ${String(erro)}`);
      throw new UnauthorizedException('Sessão inválida ou expirada. Entre novamente.');
    }
  }

  private escopoSuficiente(concedido: EscopoPermissao, minimo: EscopoPermissao): boolean {
    const ordem: Record<EscopoPermissao, number> = {
      PROPRIO: 0,
      EQUIPE: 1,
      TERRITORIO: 2,
      CAMPANHA: 3,
    };
    return ordem[concedido] >= ordem[minimo];
  }
}
