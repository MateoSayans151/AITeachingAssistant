import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { MaterialesCursoService } from './materiales-curso.service';
import { CreateMaterialCursoDto } from './dto/create-material-curso.dto';

@Controller('cursos/:cursoId/materiales')
export class MaterialesCursoController {
  constructor(private readonly service: MaterialesCursoService) {}

  @Post()
  create(@Param('cursoId') cursoId: string, @Body() dto: CreateMaterialCursoDto) {
    return this.service.create(cursoId, dto);
  }

  @Get()
  findAllByCurso(@Param('cursoId') cursoId: string) {
    return this.service.findAllByCurso(cursoId);
  }
}

@Controller('materiales')
export class MaterialDetalleController {
  constructor(private readonly service: MaterialesCursoService) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
