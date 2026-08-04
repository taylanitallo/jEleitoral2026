import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgendaModule } from './agenda/agenda.module.js';
import { ArtesModule } from './artes/artes.module.js';
import {
  AutenticacaoController,
  AutenticacaoService,
} from './autenticacao/autenticacao.controller.js';
import { AutenticacaoGuard } from './autenticacao/autenticacao.guard.js';
import { AuditoriaService } from './auditoria/auditoria.service.js';
import { BancoService } from './banco/banco.service.js';
import { CampanhasController } from './campanhas/campanhas.controller.js';
import { CampoModule } from './campo/campo.module.js';
import { CandidatosModule } from './candidatos/candidatos.module.js';
import { MetasModule } from './metas/metas.module.js';
import { MobilizacaoModule } from './mobilizacao/mobilizacao.module.js';
import { FiltroExcecoes } from './comum/filtroExcecoes.js';
import { InterceptorCorrelacao } from './comum/interceptorCorrelacao.js';
import { DiagnosticoModule } from './diagnostico/diagnostico.module.js';
import { FinanceiroModule } from './financeiro/financeiro.module.js';
import { IaModule } from './ia/ia.module.js';
import { IntegracoesModule } from './integracoes/integracoes.module.js';
import { PainelModule } from './painel/painel.module.js';
import { PlanejamentoModule } from './planejamento/planejamento.module.js';
import { ProjecaoModule } from './projecao/projecao.module.js';
import { RelatoriosModule } from './relatorios/relatorios.module.js';
import { ProvedorModule } from './provedor/provedor.module.js';
import { TerritorioModule } from './territorio/territorio.module.js';
import { UsuariosController } from './usuarios/usuarios.controller.js';
import { SaudeController } from './saude/saude.controller.js';

@Module({
  imports: [
    // Rate limiting por IP. Duas janelas: uma curta contra rajada, uma longa
    // contra varredura lenta em endpoints de busca (enumeração de eleitores é
    // exatamente o que não queremos facilitar).
    ThrottlerModule.forRoot([
      { name: 'curta', ttl: 1000, limit: 10 },
      { name: 'longa', ttl: 60_000, limit: 200 },
    ]),
    IntegracoesModule,
    CampoModule,
    ProjecaoModule,
    PainelModule,
    CandidatosModule,
    MetasModule,
    MobilizacaoModule,
    AgendaModule,
    PlanejamentoModule,
    DiagnosticoModule,
    TerritorioModule,
    FinanceiroModule,
    ProvedorModule,
    IaModule,
    ArtesModule,
    RelatoriosModule,
  ],
  controllers: [SaudeController, CampanhasController, UsuariosController, AutenticacaoController],
  providers: [
    BancoService,
    AuditoriaService,
    AutenticacaoService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    { provide: APP_INTERCEPTOR, useClass: InterceptorCorrelacao },
    { provide: APP_FILTER, useClass: FiltroExcecoes },
  ],
  exports: [BancoService, AuditoriaService],
})
export class AppModule {}
