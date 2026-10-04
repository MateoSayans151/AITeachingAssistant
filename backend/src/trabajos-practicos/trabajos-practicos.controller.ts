import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TrabajosPracticosService } from './trabajos-practicos.service';
import { CreateTrabajoPracticoDto } from './dto/create-trabajo-practico.dto';
import { DocenteId } from '../auth/docente-id.decorator';

@Controller('trabajos-practicos')
export class TrabajosPracticosController {
  constructor(private readonly service: TrabajosPracticosService) {}

  @Post()
  create(@DocenteId() docenteId: string, @Body() dto: CreateTrabajoPracticoDto) {
    return this.service.create(docenteId, dto);
  }

  @Get()
  findAll(@DocenteId() docenteId: string) {
    return this.service.findAll(docenteId);
  }

  @Get(':id')
  findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    return this.service.findOne(docenteId, id);
  }
}
