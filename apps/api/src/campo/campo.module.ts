import { Module } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { BancoService } from '../banco/banco.service.js';
import { CampoController } from './campo.controller.js';
import { RetificacaoService } from './retificacao.service.js';
import { SincronizacaoOfflineService } from './sincronizacaoOffline.service.js';

@Module({
  controllers: [CampoController],
  providers: [BancoService, AuditoriaService, SincronizacaoOfflineService, RetificacaoService],
  exports: [SincronizacaoOfflineService],
})
export class CampoModule {}
