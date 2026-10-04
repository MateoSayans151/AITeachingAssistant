import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// El registro, el login y la recuperación de contraseña los hace Supabase Auth (desde el front);
// acá solo queda saber quién es el docente de la sesión.
@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async me(docenteId: string) {
    const docente = await this.prisma.docente.findUnique({ where: { id: docenteId } });
    if (!docente) throw new UnauthorizedException('Sesión inválida');
    return { id: docente.id, nombre: docente.nombre, email: docente.email };
  }
}
