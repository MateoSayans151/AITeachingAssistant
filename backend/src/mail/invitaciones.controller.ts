import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DocenteId } from '../auth/docente-id.decorator';
import { AccesoService } from '../acceso/acceso.service';
import { InvitarAlumnosDto } from './dto/invitar-alumnos.dto';
import { InvitacionesService } from './invitaciones.service';

// Invitaciones por mail: el docente le manda a cada alumno el link para rendir un examen ya publicado a su comisión.
// Todas las rutas son del docente (AuthGuard) y chequean que el examen sea suyo ANTES de leer o mandar nada.
@Controller('examenes')
export class InvitacionesController {
  constructor(
    private readonly invitaciones: InvitacionesService,
    private readonly acceso: AccesoService,
  ) {}

  // Cómo va el último envío: cuántos salieron, cuántos fallaron y por qué (el estado vive en memoria del servidor).
  @Get(':id/invitaciones')
  async estado(@DocenteId() docenteId: string, @Param('id') id: string) {
    await this.acceso.examen(docenteId, id);
    return this.invitaciones.estado(id);
  }

  // Lanza en segundo plano el envío a los alumnos (de una publicación, o de todas) y responde con cuántos mails salen.
  @Post(':id/invitaciones')
  async invitar(@DocenteId() docenteId: string, @Param('id') id: string, @Body() dto?: InvitarAlumnosDto) {
    await this.acceso.examen(docenteId, id);
    return this.invitaciones.invitar(id, dto?.examenComisionId);
  }
}
