import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { DocentesModule } from './docentes/docentes.module';
import { TrabajosPracticosModule } from './trabajos-practicos/trabajos-practicos.module';
import { EntregasModule } from './entregas/entregas.module';
import { CorreccionesModule } from './correcciones/correcciones.module';
import { ResumenCursoModule } from './resumen-curso/resumen-curso.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AiModule,
    DocentesModule,
    TrabajosPracticosModule,
    EntregasModule,
    CorreccionesModule,
    ResumenCursoModule,
  ],
})
export class AppModule {}
