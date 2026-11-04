import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { ComisionesService } from '../comisiones/comisiones.service';
import { BorrarConConfirmacionDto } from '../examenes/dto/borrar-con-confirmacion.dto';
import { IntegridadService } from './integridad.service';

// Eliminar una comisión. Vive acá (y no en ComisionesController) porque también borra las imágenes de las capturas de los alumnos de la
// comisión, que son de RespuestasExamenModule. Cualquiera del equipo del curso puede, igual que con el resto de la comisión.
@Controller('comisiones/:comisionId')
export class ControlComisionController {
  constructor(
    private readonly comisiones: ComisionesService,
    private readonly integridad: IntegridadService,
    private readonly acceso: AccesoService,
  ) {}

  // Lo que se perdería al eliminarla (para el aviso del diálogo).
  @Get('que-se-pierde')
  async queSePierde(@DocenteId() docenteId: string, @Param('comisionId') comisionId: string) {
    await this.acceso.comision(docenteId, comisionId);
    return this.comisiones.queSePierde(comisionId);
  }

  // Borra la comisión con sus alumnos, los links publicados y las respuestas de esos alumnos: pide el nombre de la comisión.
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(@DocenteId() docenteId: string, @Param('comisionId') comisionId: string, @Body() dto: BorrarConConfirmacionDto) {
    await this.acceso.comision(docenteId, comisionId);
    // Se valida ANTES de tocar las imágenes: un pedido rechazado no puede dejar capturas borradas y la comisión en pie.
    await this.comisiones.validarEliminacion(comisionId, dto.confirmacion);
    await this.integridad.borrarImagenesDeComision(comisionId);
    await this.comisiones.eliminar(comisionId, dto.confirmacion);
  }
}
