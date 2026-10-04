import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { MaterialesCursoService } from './materiales-curso.service';
import { CreateMaterialCursoDto } from './dto/create-material-curso.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('cursos/:cursoId/materiales')
export class MaterialesCursoController {
  constructor(
    private readonly service: MaterialesCursoService,
    private readonly acceso: AccesoService,
  ) {}

  @Post()
  async create(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string, @Body() dto: CreateMaterialCursoDto) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.create(cursoId, dto);
  }

  @Get()
  async findAllByCurso(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.findAllByCurso(cursoId);
  }

  @Post('reindexar')
  async reindexarCurso(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.service.reindexarCurso(cursoId);
  }
}

@Controller('materiales')
export class MaterialDetalleController {
  constructor(
    private readonly service: MaterialesCursoService,
    private readonly acceso: AccesoService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.material(docenteId, id);
    return this.service.remove(id);
  }
}
