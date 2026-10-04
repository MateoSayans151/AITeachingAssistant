import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CorreccionesService } from './correcciones.service';
import { RevisarCorreccionDto } from './dto/revisar-correccion.dto';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';

@Controller('entregas/:entregaId/correccion')
export class CorreccionesController {
  constructor(
    private readonly service: CorreccionesService,
    private readonly acceso: AccesoService,
  ) {}

  @Patch()
  async revisar(@DocenteId() docenteId: string, @Param('entregaId') entregaId: string, @Body() dto: RevisarCorreccionDto) {
    await this.acceso.entrega(docenteId, entregaId);
    return this.service.revisar(entregaId, dto);
  }
}
