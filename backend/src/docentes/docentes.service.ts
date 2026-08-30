import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocenteDto } from './dto/create-docente.dto';

@Injectable()
export class DocentesService {
  constructor(private readonly prisma: PrismaService) {}

  // MVP sin autenticación real: identificamos al docente por email.
  // Si ya existe, lo devuelve; si no, lo crea. Login de verdad queda para v2 (Supabase Auth).
  create(dto: CreateDocenteDto) {
    return this.prisma.docente.upsert({
      where: { email: dto.email },
      update: { nombre: dto.nombre },
      create: dto,
    });
  }

  findAll() {
    return this.prisma.docente.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const docente = await this.prisma.docente.findUnique({ where: { id } });
    if (!docente) throw new NotFoundException(`Docente ${id} no encontrado`);
    return docente;
  }
}
