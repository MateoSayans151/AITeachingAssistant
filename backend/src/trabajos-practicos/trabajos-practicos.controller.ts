import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TrabajosPracticosService } from './trabajos-practicos.service';
import { CreateTrabajoPracticoDto } from './dto/create-trabajo-practico.dto';

@Controller('trabajos-practicos')
export class TrabajosPracticosController {
  constructor(private readonly service: TrabajosPracticosService) {}

  @Post()
  create(@Body() dto: CreateTrabajoPracticoDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
