import { BadGatewayException, Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AccesoService } from '../acceso/acceso.service';
import { SugerenciaPreguntas } from '../ai/ai.types';
import { SugerirPreguntasDto } from '../ai/dto/sugerir-preguntas.dto';
import { MENSAJE_FALLO_IA_PREGUNTAS } from '../ai/sugerencia-preguntas.util';
import { DocenteId } from '../auth/docente-id.decorator';
import { SugerenciaPreguntasService } from './sugerencia-preguntas.service';

// Mismo prefijo que ExamenesController, en un controller aparte (como SugerenciasController): la ruta es literal
// (`sugerir-preguntas`) y no choca con `:id`.
@Controller('examenes')
export class SugerenciasPreguntasController {
  private readonly logger = new Logger(SugerenciasPreguntasController.name);

  constructor(
    private readonly service: SugerenciaPreguntasService,
    private readonly acceso: AccesoService,
  ) {}

  // Docente autenticado (el guard global lo exige; NO es @Public) y dueño del curso. Cada llamada cuesta más que una sugerencia
  // de criterios (lleva material y pide varias preguntas): además del límite global (120/min), 10 por minuto.
  // HTTP 200 y no 201: no se crea nada, es una consulta que devuelve un borrador.
  @Post('sugerir-preguntas')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async sugerirPreguntas(@DocenteId() docenteId: string, @Body() dto: SugerirPreguntasDto): Promise<SugerenciaPreguntas> {
    await this.acceso.curso(docenteId, dto.cursoId);
    try {
      return await this.service.sugerir(dto);
    } catch (error) {
      // Los errores nuestros (400 sin material, 502 con mensaje propio) pasan tal cual; cualquier otra cosa viene del proveedor o
      // de un bug y no tiene por qué llegar al cliente: mensaje genérico y 502.
      if (error instanceof HttpException) throw error;
      this.logger.error(`Falló la sugerencia de preguntas: ${(error as Error | undefined)?.name ?? 'error desconocido'}`);
      throw new BadGatewayException(MENSAJE_FALLO_IA_PREGUNTAS);
    }
  }
}
