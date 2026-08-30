import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EntregasService } from './entregas.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';

@Controller('entregas')
export class EntregasController {
  constructor(private readonly service: EntregasService) {}

  @Post()
  create(@Body() dto: CreateEntregaDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Reintentar la corrección de IA (p. ej. si falló la primera vez, o para regenerar)
  @Post(':id/recorregir')
  recorregir(@Param('id') id: string) {
    return this.service.corregir(id);
  }
}
