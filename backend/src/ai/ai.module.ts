import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';

// Global porque lo usan varios módulos (corrección de respuestas de examen, sugerencias al armar el examen).
@Global()
@Module({
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
