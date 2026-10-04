import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EntregasService } from './entregas.service';
import { CreateEntregaDto } from './dto/create-entrega.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('entregas')
export class EntregasController {
  constructor(
    private readonly service: EntregasService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  async create(@DocenteId() docenteId: string, @Body() dto: CreateEntregaDto) {
    await this.acceso.trabajoPractico(docenteId, dto.trabajoPracticoId);
    return this.service.create(dto);
  }

  @Get(':id')
  async findOne(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.entrega(docenteId, id);
    return this.service.findOne(id);
  }

  // Reintentar la corrección de IA (p. ej. si falló la primera vez, o para regenerar)
  @Post(':id/recorregir')
  async recorregir(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.entrega(docenteId, id);
    return this.service.corregir(id);
  }
}
