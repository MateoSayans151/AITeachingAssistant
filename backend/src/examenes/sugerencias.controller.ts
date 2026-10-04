import { BadGatewayException, Body, Controller, HttpCode, HttpException, HttpStatus, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AiService } from '../ai/ai.service';
import { SugerirCriteriosDto } from '../ai/dto/sugerir-criterios.dto';
import { CANTIDAD_CRITERIOS_DEFECTO, SugerenciaCriterios } from '../ai/ai.types';
import { MENSAJE_FALLO_IA } from '../ai/sugerencia-criterios.util';

// Mismo prefijo que ExamenesController, pero en un controller aparte: la ruta es literal
// (`sugerir-criterios`), no choca con `:id` porque ahí no hay ningún POST de un solo segmento.
@Controller('examenes')
export class SugerenciasController {
  private readonly logger = new Logger(SugerenciasController.name);

  constructor(private readonly ai: AiService) {}

  // Docente autenticado (el guard global lo exige; NO es @Public). Cada llamada cuesta plata, así
  // que además del límite global (120/min) lleva uno más estricto: 20 por minuto.
  // HTTP 200 y no 201: no se crea nada, es una consulta que devuelve un borrador.
  @Post('sugerir-criterios')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async sugerirCriterios(@Body() dto: SugerirCriteriosDto): Promise<SugerenciaCriterios> {
    try {
      return await this.ai.sugerirCriterios({
        enunciado: dto.enunciado,
        tipo: dto.tipo,
        cantidad: dto.cantidad ?? CANTIDAD_CRITERIOS_DEFECTO,
      });
    } catch (error) {
      // Los errores nuestros (502 con mensaje propio) pasan tal cual; cualquier otra cosa viene del
      // proveedor o de un bug y no tiene por qué llegar al cliente: mensaje genérico y 502.
      if (error instanceof HttpException) throw error;
      this.logger.error(`Falló la sugerencia de criterios: ${(error as Error | undefined)?.name ?? 'error desconocido'}`);
      throw new BadGatewayException(MENSAJE_FALLO_IA);
    }
  }
}
