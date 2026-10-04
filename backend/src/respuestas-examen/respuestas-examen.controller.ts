import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RespuestasExamenService } from './respuestas-examen.service';
import { IntentosService } from './intentos.service';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { VaraService } from '../examenes/vara.service';

@Controller('examenes/:examenId/respuestas')
export class RespuestasExamenController {
  constructor(
    private readonly service: RespuestasExamenService,
    private readonly intentos: IntentosService,
    private readonly acceso: AccesoService,
    private readonly vara: VaraService,
  ) {}

  @Get()
  async findAllByExamen(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    // Los intentos vencidos que nadie entregó se cierran acá (además del barrido periódico).
    await this.intentos.cerrarVencidos(examenId);
    return this.service.findAllByExamen(examenId);
  }

  @Post('bulk-aceptar')
  async bulkAceptar(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.service.bulkAceptar(examenId);
  }

  @Get(':id')
  async findOne(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return this.service.findOne(examenId, id);
  }

  @Get(':id/vara')
  async explicarVara(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return this.vara.explicar(examenId, id);
  }

  @Patch(':id')
  async revisar(
    @DocenteId() docenteId: string,
    @Param('examenId') examenId: string,
    @Param('id') id: string,
    @Body() dto: RevisarRespuestaExamenDto,
  ) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return this.service.revisar(examenId, id, dto);
  }

  @Post(':id/recorregir')
  async recorregir(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return this.service.corregir(id);
  }
}
