import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RespuestasExamenService } from './respuestas-examen.service';
import { IntentosService } from './intentos.service';
import { RevisarRespuestaExamenDto } from './dto/revisar-respuesta-examen.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { VaraService } from '../examenes/vara.service';
import { IntegridadService } from './integridad.service';

@Controller('examenes/:examenId/respuestas')
export class RespuestasExamenController {
  constructor(
    private readonly service: RespuestasExamenService,
    private readonly intentos: IntentosService,
    private readonly acceso: AccesoService,
    private readonly vara: VaraService,
    private readonly integridad: IntegridadService,
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

  // Reintenta en segundo plano las que quedaron en pendiente_correccion. Ruta fija: va antes de las
  // que llevan `:id` para que nunca se la tome por un id.
  @Post('corregir-pendientes')
  async corregirPendientes(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.service.corregirPendientes(examenId);
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

  // ---- Capturas de pantalla del intento (solo el docente dueño del examen) ----
  @Get(':id/capturas')
  async capturas(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return this.integridad.listarCapturas(await this.integridad.intentoIdDeRespuesta(examenId, id));
  }

  @Get(':id/capturas/:capturaId')
  async captura(
    @DocenteId() docenteId: string,
    @Param('examenId') examenId: string,
    @Param('id') id: string,
    @Param('capturaId') capturaId: string,
    @Res() res: Response,
  ) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    const datos = await this.integridad.leerCaptura(await this.integridad.intentoIdDeRespuesta(examenId, id), capturaId);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' }).send(datos);
  }

  @Delete(':id/capturas/:capturaId')
  async borrarCaptura(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string, @Param('capturaId') capturaId: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    await this.integridad.borrarCaptura(await this.integridad.intentoIdDeRespuesta(examenId, id), capturaId);
    return { borrada: true };
  }

  @Delete(':id/capturas')
  async borrarCapturas(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('id') id: string) {
    await this.acceso.respuestaExamen(docenteId, examenId, id);
    return { borradas: await this.integridad.borrarCapturas(await this.integridad.intentoIdDeRespuesta(examenId, id)) };
  }
}
