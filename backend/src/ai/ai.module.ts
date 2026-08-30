import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

// Global porque tanto EntregasModule (corrección individual) como
// ResumenCursoModule (análisis agregado) necesitan llamarlo.
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
