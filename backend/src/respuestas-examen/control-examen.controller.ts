import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { ExamenesService } from '../examenes/examenes.service';
import { IntentosService } from './intentos.service';
import { IntegridadService } from './integridad.service';
import { BorrarConConfirmacionDto } from '../examenes/dto/borrar-con-confirmacion.dto';
import { CerrarExamenDto } from '../examenes/dto/cerrar-examen.dto';
import { AvisoDto, CierreProgramadoDto, DuracionDto, MAX_MINUTOS_SESION, TiempoExtraDto } from '../examenes/dto/control-tiempo.dto';

// El control del docente sobre un examen en marcha: cerrarlo, reabrirlo, ver quién lo está rindiendo y borrarlo. Vive acá (y no en
// ExamenesController) porque necesita los intentos y las capturas, que son de RespuestasExamenModule (que ya importa ExamenesModule).
@Controller('examenes/:examenId')
export class ControlExamenController {
  constructor(
    private readonly examenes: ExamenesService,
    private readonly intentos: IntentosService,
    private readonly integridad: IntegridadService,
    private readonly acceso: AccesoService,
  ) {}

  // Cuántos están rindiendo ahora: el diálogo de cierre lo muestra para que el docente elija con los números a la vista.
  @Get('en-curso')
  async enCurso(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return { enCurso: await this.intentos.cantidadEnCurso(examenId) };
  }

  // Quién está rindiendo ahora y cómo va (el panel "En vivo"; la pantalla lo consulta cada pocos segundos).
  @Get('en-vivo')
  async enVivo(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.enVivo(examenId);
  }

  // Cierra el examen: nadie nuevo puede empezar. `entregarEnCurso`: lo que los alumnos que están rindiendo tengan escrito se entrega
  // ahora (y se corrige); si no, terminan su intento con normalidad.
  @Post('cerrar')
  async cerrar(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Body() dto: CerrarExamenDto) {
    await this.acceso.examen(docenteId, examenId);
    const cerrado = await this.examenes.cerrar(examenId);
    const entregados = dto.entregarEnCurso ? await this.intentos.entregarEnCurso(examenId) : 0;
    return { ...cerrado, entregados, siguenRindiendo: dto.entregarEnCurso ? 0 : await this.intentos.cantidadEnCurso(examenId) };
  }

  // Cierre automático: a esa hora el examen se cierra solo (con null se quita).
  @Put('cierre-programado')
  async cierreProgramado(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Body() dto: CierreProgramadoDto) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.programarCierre(examenId, dto.cierraEn ? new Date(dto.cierraEn) : null, dto.entregarEnCurso);
  }

  // A quiénes se les cortaría el examen si la sesión durara `minutos`: se muestra antes de confirmar el cambio.
  @Get('duracion/vista-previa')
  async vistaPreviaDuracion(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Query('minutos') minutos: string) {
    await this.acceso.examen(docenteId, examenId);
    const n = Number(minutos);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTOS_SESION) throw new BadRequestException(`La duración tiene que ser un número de minutos entre 1 y ${MAX_MINUTOS_SESION}.`);
    return this.intentos.vistaPreviaDuracion(examenId, n);
  }

  // Cambia cuánto dura la sesión, también para quienes ya están rindiendo, y avisa a todos.
  @Put('duracion')
  async cambiarDuracion(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Body() dto: DuracionDto) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.cambiarDuracion(examenId, dto.minutos);
  }

  // Tiempo extra para UN alumno que está rindiendo.
  @Post('intentos/:intentoId/tiempo-extra')
  async tiempoExtra(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('intentoId') intentoId: string, @Body() dto: TiempoExtraDto) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.darTiempoExtra(examenId, intentoId, dto.minutos);
  }

  // Cierra el examen de UN alumno: se entrega lo que tenga autoguardado.
  @Post('intentos/:intentoId/entregar')
  async entregarAlumno(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Param('intentoId') intentoId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.entregarIntentoPorDocente(examenId, intentoId);
  }

  // Un cartel que ven en el examen todos los que están rindiendo.
  @Put('aviso')
  async avisar(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Body() dto: AvisoDto) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.avisar(examenId, dto.texto);
  }

  @Delete('aviso')
  async quitarAviso(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.intentos.avisar(examenId, null);
  }

  @Post('reabrir')
  async reabrir(@DocenteId() docenteId: string, @Param('examenId') examenId: string) {
    await this.acceso.examen(docenteId, examenId);
    return this.examenes.reabrir(examenId);
  }

  // Borra el examen con todas las respuestas, notas y capturas de los alumnos: no hay vuelta atrás, por eso pide el nombre.
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@DocenteId() docenteId: string, @Param('examenId') examenId: string, @Body() dto: BorrarConConfirmacionDto) {
    await this.acceso.examen(docenteId, examenId);
    // Se valida el nombre ANTES de tocar las imágenes: un nombre mal escrito no puede dejar capturas borradas y el examen en pie.
    await this.examenes.validarConfirmacion(examenId, dto.confirmacion);
    await this.integridad.borrarImagenesDeExamen(examenId);
    await this.examenes.remove(examenId, dto.confirmacion);
  }
}
