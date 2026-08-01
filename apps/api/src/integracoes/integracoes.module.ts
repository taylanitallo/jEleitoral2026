import { Module } from '@nestjs/common';
import { BancoService } from '../banco/banco.service.js';
import { ConectorCep } from './conectorCep.js';
import { ConectorDivulgaCand } from './conectorDivulgaCand.js';
import { ConectorIbgeLocalidades } from './conectorIbgeLocalidades.js';
import { ConectorTseDadosAbertos } from './conectorTseDadosAbertos.js';
import { ConectorResultadosAoVivo } from './conectorResultadosAoVivo.js';
import { ConectorTseEstrutura } from './conectorTseEstrutura.js';

/**
 * Camada de ingestão.
 *
 * O frontend nunca fala com TSE ou IBGE. Tudo entra por aqui, é normalizado e
 * gravado na nossa base — o que faz as telas responderem rápido e o sistema
 * continuar funcionando quando a fonte externa cai. Todo conector implementa a
 * mesma interface `ConectorExterno`, então acrescentar uma fonte nova não muda
 * nada no agendador nem na tela de sincronização.
 */
@Module({
  providers: [
    BancoService,
    ConectorIbgeLocalidades,
    ConectorCep,
    ConectorTseDadosAbertos,
    ConectorTseEstrutura,
    ConectorDivulgaCand,
    ConectorResultadosAoVivo,
  ],
  exports: [
    ConectorIbgeLocalidades,
    ConectorCep,
    ConectorTseDadosAbertos,
    ConectorTseEstrutura,
    ConectorDivulgaCand,
    ConectorResultadosAoVivo,
  ],
})
export class IntegracoesModule {}
