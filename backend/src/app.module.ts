import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AiModule } from './ai/ai.module';
import { DocentesModule } from './docentes/docentes.module';
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
    // Cátedra: exámenes con preguntas tipadas, cursos/comisiones y vara — feature-set
    // nuevo, en paralelo al flujo de arriba (TrabajoPractico/Entrega/Correccion).
    CursosModule,
    ComisionesModule,
    MaterialesCursoModule,
    MatricesRubricaModule,
    ExamenesModule,
    RespuestasExamenModule,
  ],
})
export class AppModule {}
