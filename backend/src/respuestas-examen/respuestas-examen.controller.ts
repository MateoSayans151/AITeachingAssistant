import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RespuestasExamenService } from './respuestas-examen.service';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';

@Controller('examenes/:examenId/respuestas')
export class RespuestasExamenController {
  constructor(private readonly service: RespuestasExamenService) {}

  @Get()
  findAllByExamen(@Param('examenId') examenId: string) {
    return this.service.findAllByExamen(examenId);
  }

  @Post('bulk-aceptar')
  bulkAceptar(@Param('examenId') examenId: string) {
    return this.service.bulkAceptar(examenId);
  }

  @Get(':id')
  findOne(@Param('examenId') examenId: string, @Param('id') id: string) {
    return this.service.findOne(examenId, id);
  }

  @Patch(':id')
  revisar(
    @Param('examenId') examenId: string,
    @Param('id') id: string,
    @Body() dto: RevisarRespuestaExamenDto,
  ) {
    return this.service.revisar(examenId, id, dto);
  }

  @Post(':id/recorregir')
  recorregir(@Param('examenId') examenId: string, @Param('id') id: string) {
    return this.service.corregir(id);
  }
}
