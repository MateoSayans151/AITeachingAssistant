import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { LIMITE_CUERPO_GENERAL, LIMITE_CUERPO_RENDIR } from './respuestas-examen/limites';

async function bootstrap() {
  // Los parsers se registran a mano para darle más margen solo a las rutas donde el alumno
  // manda sus respuestas (y que exigen el token de su intento); todo lo demás conserva 100 KB.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use('/api/rendir/:slug/borrador', json({ limit: LIMITE_CUERPO_RENDIR }));
  app.use('/api/rendir/:slug/entregar', json({ limit: LIMITE_CUERPO_RENDIR }));
  app.use('/api/entregar/:slug/borrador', json({ limit: LIMITE_CUERPO_RENDIR }));
  app.use('/api/entregar/:slug/enviar', json({ limit: LIMITE_CUERPO_RENDIR }));
  app.use(json({ limit: LIMITE_CUERPO_GENERAL }));
  app.use(urlencoded({ extended: true, limit: LIMITE_CUERPO_GENERAL }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  });

  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AI Teaching Assistant backend escuchando en http://localhost:${port}/api`);
}
bootstrap();
