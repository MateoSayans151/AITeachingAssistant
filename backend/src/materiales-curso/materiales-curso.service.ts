import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialCursoDto } from './dto/create-material-curso.dto';

@Injectable()
export class MaterialesCursoService {
  constructor(private readonly prisma: PrismaService) {}

  create(cursoId: string, dto: CreateMaterialCursoDto) {
    return this.prisma.materialCurso.create({
      data: {
        cursoId,
        titulo: dto.titulo,
        unidad: dto.unidad,
        contenido: dto.contenido,
      },
    });
  }

  findAllByCurso(cursoId: string) {
    return this.prisma.materialCurso.findMany({
      where: { cursoId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(id: string) {
    const material = await this.prisma.materialCurso.findUnique({ where: { id } });
    if (!material) throw new NotFoundException(`Material ${id} no encontrado`);
    await this.prisma.materialCurso.delete({ where: { id } });
  }
}
