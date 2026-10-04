import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CursosService } from './cursos.service';
import { CreateCursoDto } from './dto/create-curso.dto';
import { DocenteId } from '../auth/docente-id.decorator';

@Controller('cursos')
export class CursosController {
  constructor(private readonly service: CursosService) {}

  @Post()
  create(@DocenteId() docenteId: string, @Body() dto: CreateCursoDto) {
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
