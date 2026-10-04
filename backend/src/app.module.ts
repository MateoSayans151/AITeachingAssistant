import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { AccesoModule } from './acceso/acceso.module';
import { TrabajosPracticosModule } from './trabajos-practicos/trabajos-practicos.module';
import { EntregasModule } from './entregas/entregas.module';
import { CorreccionesModule } from './correcciones/correcciones.module';
import { ResumenCursoModule } from './resumen-curso/resumen-curso.module';
import { CursosModule } from './cursos/cursos.module';
import { ComisionesModule } from './comisiones/comisiones.module';
import { MaterialesCursoModule } from './materiales-curso/materiales-curso.module';
import { MatricesRubricaModule } from './matrices-rubrica/matrices-rubrica.module';
import { ExamenesModule } from './examenes/examenes.module';
import { RespuestasExamenModule } from './respuestas-examen/respuestas-examen.module';
import { NotificacionesModule } from './mail/notificaciones.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AiModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuthModule,
    AccesoModule,
    TrabajosPracticosModule,
    EntregasModule,
    CorreccionesModule,
    ResumenCursoModule,
    // Cátedra: exámenes con preguntas tipadas, cursos/comisiones y vara — feature-set
    // nuevo, en paralelo al flujo de arriba (TrabajoPractico/Entrega/Correccion).
    CursosModule,
    ComisionesModule,
    MaterialesCursoModule,
    MatricesRubricaModule,
    ExamenesModule,
    RespuestasExamenModule,
    // Mails con la nota (Resend): lo usan Examenes (publicar notas) y RespuestasExamen (revisar).
    NotificacionesModule,
  ],
  providers: [
    // Orden importa: primero el rate limit, después la autenticación (default-deny).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
