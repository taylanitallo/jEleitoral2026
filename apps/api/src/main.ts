import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { carregarConfiguracao } from './comum/configuracao.js';

async function iniciar(): Promise<void> {
  // Valida o ambiente antes de qualquer coisa: melhor não subir do que subir
  // sem a chave de criptografia e gravar CPF em claro.
  const configuracao = carregarConfiguracao();
  const aplicacao = await NestFactory.create(AppModule, { bufferLogs: true });

  aplicacao.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', new URL(configuracao.SUPABASE_URL).origin],
          connectSrc: ["'self'", new URL(configuracao.SUPABASE_URL).origin],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      hsts: configuracao.AMBIENTE === 'producao' ? { maxAge: 31_536_000 } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  aplicacao.use(cookieParser());

  // CORS restrito às origens conhecidas. `credentials` é obrigatório porque a
  // sessão vive em cookie HTTP-only, não em cabeçalho.
  aplicacao.enableCors({
    origin: [configuracao.URL_WEB],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-id-correlacao'],
    exposedHeaders: ['x-id-correlacao'],
  });

  aplicacao.setGlobalPrefix('api');
  aplicacao.enableShutdownHooks();

  await aplicacao.listen(configuracao.PORTA_API);
  new Logger('Inicializacao').log(
    `jEleitoral API no ar em ${configuracao.AMBIENTE}, porta ${configuracao.PORTA_API}.`,
  );
}

iniciar().catch((erro: unknown) => {
  // eslint-disable-next-line no-console -- o logger do Nest ainda não existe aqui
  console.error('Falha ao iniciar a API:', erro);
  process.exitCode = 1;
});
