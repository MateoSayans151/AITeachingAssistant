import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CursosService } from './cursos.service';
import { CreateCursoDto } from './dto/create-curso.dto';

@Controller('cursos')
export class CursosController {
  constructor(private readonly service: CursosService) {}

  @Post()
  create(@Body() dto: CreateCursoDto) {
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
