import { Body, Controller, Param, Patch } from '@nestjs/common';
import { CorreccionesService } from './correcciones.service';
import { RevisarCorreccionDto } from './dto/revisar-correccion.dto';

@Controller('entregas/:entregaId/correccion')
export class CorreccionesController {
  constructor(private readonly service: CorreccionesService) {}

  @Patch()
  revisar(@Param('entregaId') entregaId: string, @Body() dto: RevisarCorreccionDto) {
    return this.service.revisar(entregaId, dto);
  }
}
