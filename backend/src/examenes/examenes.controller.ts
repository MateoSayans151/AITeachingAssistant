import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ExamenesService } from './examenes.service';
import { CreateExamenDto } from './dto/create-examen.dto';
import { PublicarComisionDto } from './dto/publicar-comision.dto';
import { AplicarVaraDto } from './dto/aplicar-vara.dto';

@Controller('examenes')
export class ExamenesController {
  constructor(private readonly service: ExamenesService) {}

  @Post()
  create(@Body() dto: CreateExamenDto) {
    return this.service.create(dto);
  }

  @Get()
  findAllByCurso(@Query('cursoId') cursoId: string) {
    return this.service.findAllByCurso(cursoId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post(':id/comisiones')
  publicarAComision(@Param('id') id: string, @Body() dto: PublicarComisionDto) {
    return this.service.publicarAComision(id, dto);
  }

  @Patch(':id/vara')
  aplicarVara(@Param('id') id: string, @Body() dto: AplicarVaraDto) {
    return this.service.aplicarVara(id, dto);
  }

  @Post(':id/liberar-feedback')
  liberarFeedback(@Param('id') id: string) {
    return this.service.liberarFeedback(id);
  }
}
