import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClaimsSupabase } from './verificador-sesion';

/**
 * Une el usuario de Supabase Auth con la fila de `docentes` (a la que cuelga todo lo demás).
 *
 *  1. Si ya está vinculado (authUserId) → esa fila.
 *  2. Si no, hace falta un email CONFIRMADO en Supabase (email_verified). Sin eso cualquiera podría crear una
 *     cuenta con el email de un docente y quedarse con sus datos.
 *  3. Con email confirmado: si existe un docente con ese email sin vincular (los de antes de Supabase Auth) se
 *     vincula; si no, se crea.
 */
@Injectable()
export class SesionDocenteService {
  constructor(private readonly prisma: PrismaService) {}

  async resolver(claims: ClaimsSupabase): Promise<string> {
    const vinculado = await this.prisma.docente.findUnique({ where: { authUserId: claims.sub }, select: { id: true } });
    if (vinculado) return vinculado.id;

    const email = claims.email?.trim().toLowerCase();
    if (!email) throw new UnauthorizedException('La cuenta no tiene email');
    if (claims.user_metadata?.email_verified !== true) {
      throw new UnauthorizedException('Confirmá tu email (te lo enviamos al registrarte) para poder usar la cuenta');
    }

    try {
      const existente = await this.prisma.docente.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (existente) {
        if (existente.authUserId) throw new ConflictException('Ese email ya está asociado a otra cuenta');
        // updateMany con authUserId null: si dos pedidos compiten, solo uno vincula.
        const r = await this.prisma.docente.updateMany({ where: { id: existente.id, authUserId: null }, data: { authUserId: claims.sub } });
        if (r.count === 0) throw new ConflictException('Ese email ya está asociado a otra cuenta');
        return existente.id;
      }
      const nombre = (typeof claims.user_metadata?.nombre === 'string' && claims.user_metadata.nombre.trim()) || email.split('@')[0];
      const creado = await this.prisma.docente.create({ data: { nombre, email, authUserId: claims.sub } });
      return creado.id;
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      // Dos primeros pedidos a la vez del mismo usuario: gana el que creó, el otro lo encuentra.
      const ahora = await this.prisma.docente.findUnique({ where: { authUserId: claims.sub }, select: { id: true } });
      if (ahora) return ahora.id;
      throw new ConflictException('Ese email ya está asociado a otra cuenta');
    }
  }
}
