import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MaterialesCursoService } from './materiales-curso.service';
import { CreateMaterialCursoDto } from './dto/create-material-curso.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { MAX_ARCHIVO_BYTES } from './extractor-texto.util';

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

  /** Sube un archivo (pdf, docx, pptx, md, txt): se extrae su texto y se guarda como un material más. */
  @Post('archivo')
  @UseInterceptors(FileInterceptor('archivo', { storage: memoryStorage(), limits: { fileSize: MAX_ARCHIVO_BYTES, files: 1 } }))
  async subirArchivo(
    @DocenteId() docenteId: string,
    @Param('cursoId') cursoId: string,
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body('titulo') titulo?: string,
    @Body('unidad') unidad?: string,
  ) {
    await this.acceso.curso(docenteId, cursoId);
    if (!archivo) throw new BadRequestException('Falta el archivo.');
    // multer entrega el nombre en latin1; se lo pasa a utf8 para conservar tildes y ñ.
    const nombre = Buffer.from(archivo.originalname, 'latin1').toString('utf8');
    return this.service.createDesdeArchivo(cursoId, archivo.buffer, nombre, titulo, unidad);
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
