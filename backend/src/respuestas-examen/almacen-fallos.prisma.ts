import { PrismaService } from '../prisma/prisma.service';
import { AlmacenFallos } from './limitador-intentos.util';

/** Fallos de acceso en Postgres: el freno vale igual con varias instancias del backend. */
export class AlmacenFallosPrisma implements AlmacenFallos {
  constructor(private readonly prisma: PrismaService) {}

  contar(clave: string, desdeMs: number) {
    return this.prisma.falloAcceso.count({ where: { clave, ocurridoEn: { gte: new Date(desdeMs) } } });
  }

  async registrar(clave: string, ahoraMs: number) {
    await this.prisma.falloAcceso.create({ data: { clave, ocurridoEn: new Date(ahoraMs) } });
  }

  async borrar(clave: string) {
    await this.prisma.falloAcceso.deleteMany({ where: { clave } });
  }

  /** Limpieza de lo que ya no cuenta para ninguna ventana. */
  purgarAnteriores(hastaMs: number) {
    return this.prisma.falloAcceso.deleteMany({ where: { ocurridoEn: { lt: new Date(hastaMs) } } });
  }
}
