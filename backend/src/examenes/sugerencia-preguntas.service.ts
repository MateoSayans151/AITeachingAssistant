import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { CANTIDAD_PREGUNTAS_DEFECTO, SugerenciaPreguntas } from '../ai/ai.types';
import { SugerirPreguntasDto } from '../ai/dto/sugerir-preguntas.dto';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_CONSULTA_RAG, RagService } from '../rag/rag.service';
import { PRESUPUESTO_MATERIAL, seleccionarFragmentos } from './fragmentos-material.util';

export const MENSAJE_SIN_MATERIAL_NI_TEMA =
  'Este curso todavía no tiene material cargado. Subí apuntes en la pestaña «Material» del curso o escribí un tema para que la IA sepa de qué armar las preguntas.';

/**
 * "Sugerir preguntas con IA": reúne el material del curso que corresponde al pedido (ver fragmentos-material.util.ts) y se lo pasa a
 * AiService. El acceso del docente al curso lo verifica el controller; acá el material siempre se busca por `cursoId`, nunca se
 * mezcla con el de otro curso.
 */
@Injectable()
export class SugerenciaPreguntasService {
  private readonly logger = new Logger(SugerenciaPreguntasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rag: RagService,
    private readonly ai: AiService,
  ) {}

  async sugerir(dto: SugerirPreguntasDto): Promise<SugerenciaPreguntas> {
    const temas = (dto.temas ?? []).map((t) => t.trim()).filter(Boolean);
    const foco = (dto.foco ?? '').trim();

    const materiales = await this.prisma.materialCurso.findMany({
      where: { cursoId: dto.cursoId },
      select: { titulo: true, unidad: true, contenido: true },
      orderBy: { createdAt: 'asc' },
    });
    if (materiales.length === 0 && temas.length === 0 && !foco) throw new BadRequestException(MENSAJE_SIN_MATERIAL_NI_TEMA);

    // Búsqueda semántica con lo que pidió el docente. Si falla (proveedor de embeddings caído, material sin indexar) no corta el
    // pedido: se arma con el material directo.
    let rankeados: Awaited<ReturnType<RagService['buscarMaterial']>> = [];
    const consulta = [...temas, foco].filter(Boolean).join('. ').slice(0, MAX_CONSULTA_RAG);
    if (consulta && materiales.length > 0) {
      try {
        rankeados = await this.rag.buscarMaterial(dto.cursoId, consulta, Math.ceil(PRESUPUESTO_MATERIAL / 2_000));
      } catch (error) {
        this.logger.warn(`La búsqueda semántica falló (${(error as Error | undefined)?.name ?? 'error'}): se usa el material directo.`);
      }
    }

    const fragmentos = seleccionarFragmentos({ materiales, temas, rankeados });
    return this.ai.sugerirPreguntas({
      tipos: dto.tipos,
      cantidad: dto.cantidad ?? CANTIDAD_PREGUNTAS_DEFECTO,
      dificultad: dto.dificultad ?? 'media',
      temas,
      foco,
      fragmentos,
      existentes: dto.existentes,
    });
  }
}
