import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch } from '@nestjs/common';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { CursosService } from '../cursos/cursos.service';
import { UpdateCursoDto } from '../cursos/dto/update-curso.dto';
import { BorrarConConfirmacionDto } from '../examenes/dto/borrar-con-confirmacion.dto';
import { IntegridadService } from './integridad.service';

// Editar y eliminar un curso. Eliminar vive acá (y no en CursosController) porque también borra las imágenes de las capturas de los
// exámenes del curso, que son de RespuestasExamenModule.
@Controller('cursos/:cursoId')
export class ControlCursoController {
  constructor(
    private readonly cursos: CursosService,
    private readonly integridad: IntegridadService,
    private readonly acceso: AccesoService,
  ) {}

  // Nombre y materia: cualquiera del equipo del curso.
  @Patch()
  async actualizar(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string, @Body() dto: UpdateCursoDto) {
    await this.acceso.curso(docenteId, cursoId);
    return this.cursos.actualizar(cursoId, dto);
  }

  // Lo que se perdería al eliminarlo (para el aviso del diálogo).
  @Get('que-se-pierde')
  async queSePierde(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string) {
    await this.acceso.curso(docenteId, cursoId);
    return this.cursos.queSePierde(cursoId);
  }

  // Solo el último docente del curso, y escribiendo su nombre. Si hay más docentes la respuesta es 409: lo que corresponde es salir.
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@DocenteId() docenteId: string, @Param('cursoId') cursoId: string, @Body() dto: BorrarConConfirmacionDto) {
    await this.acceso.curso(docenteId, cursoId);
    // Se valida ANTES de tocar las imágenes: un pedido rechazado no puede dejar capturas borradas y el curso en pie.
    await this.cursos.validarEliminacion(cursoId, docenteId, dto.confirmacion);
    await this.integridad.borrarImagenesDeCurso(cursoId);
    await this.cursos.eliminar(cursoId, docenteId, dto.confirmacion);
  }
}
