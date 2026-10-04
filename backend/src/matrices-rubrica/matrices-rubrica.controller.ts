import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MatricesRubricaService } from './matrices-rubrica.service';
import { CreateMatrizRubricaDto } from './dto/create-matriz-rubrica.dto';
import { DocenteId } from '../auth/docente-id.decorator';

@Controller('matrices-rubrica')
export class MatricesRubricaController {
  constructor(private readonly service: MatricesRubricaService) {}

  @Post()
  create(@DocenteId() docenteId: string, @Body() dto: CreateMatrizRubricaDto) {
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
