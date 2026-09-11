import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RespuestasExamenService } from './respuestas-examen.service';
import { RegistrarRespuestaDto } from './dto/registrar-respuesta.dto';

// Único controller público del proyecto: sin identificación de docente, pensado para
// el alumno que entra desde el link de acceso de su comisión. Ver nota de alcance en
// RespuestasExamenService.crear sobre las limitaciones de esta simulación.
@Controller('rendir/:slug')
export class RendirController {
  constructor(private readonly service: RespuestasExamenService) {}

  @Get()
  obtenerExamen(@Param('slug') slug: string) {
    return this.service.obtenerParaRendir(slug);
  }

  @Post()
  registrarRespuesta(@Param('slug') slug: string, @Body() dto: RegistrarRespuestaDto) {
    return this.service.crear(slug, dto);
  }
}
