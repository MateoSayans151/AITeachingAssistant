import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialCursoDto } from './dto/create-material-curso.dto';
import { RagService } from '../rag/rag.service';
import { extensionDe, extraerTexto } from './extractor-texto.util';

@Injectable()
export class MaterialesCursoService {
  private readonly logger = new Logger(MaterialesCursoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
  ) {}

  async create(cursoId: string, dto: CreateMaterialCursoDto) {
    const material = await this.prisma.materialCurso.create({
      data: {
        cursoId,
        titulo: dto.titulo,
        unidad: dto.unidad,
        contenido: dto.contenido,
      },
    });
    // Si el proveedor falla, se conserva el material y se puede reintentar por endpoint.
    try {
      await this.rag.indexarMaterial(material.id);
    } catch (error) {
      // No bloqueamos al docente ni borramos su contenido por una falla transitoria de IA.
      this.logger.error(`No se pudo indexar el material ${material.id} en RAG`, error as Error);
    }
    return material;
  }

  async createDesdeArchivo(cursoId: string, archivo: Buffer, nombreArchivo: string, titulo?: string, unidad?: string) {
    const contenido = await extraerTexto(archivo, nombreArchivo);
    const porDefecto = nombreArchivo.slice(0, nombreArchivo.length - extensionDe(nombreArchivo).length - 1) || nombreArchivo;
    return this.create(cursoId, {
      titulo: titulo?.trim().slice(0, 200) || porDefecto,
      unidad: unidad?.trim() || undefined,
      contenido,
    });
  }

  findAllByCurso(cursoId: string) {
    return this.prisma.materialCurso.findMany({
      where: { cursoId },
      orderBy: { createdAt: 'asc' },
    });
  }

  reindexarCurso(cursoId: string) {
    return this.rag.reindexarCurso(cursoId);
  }

  async remove(id: string) {
    const material = await this.prisma.materialCurso.findUnique({ where: { id } });
    if (!material) throw new NotFoundException(`Material ${id} no encontrado`);
    await this.prisma.materialCurso.delete({ where: { id } });
  }
}
