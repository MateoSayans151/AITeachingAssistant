import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embed } from 'ai';
import { google } from '@ai-sdk/google';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialCursoInput } from '../ai/ai.types';

const CHUNK_SIZE = 2_200;
const CHUNK_OVERLAP = 300;
const DEFAULT_MATCH_COUNT = 6;

/** Divide texto preservando, cuando es posible, los limites de parrafo y de oracion. */
export function fragmentarTexto(texto: string): string[] {
  const limpio = texto.replace(/\r\n/g, '\n').trim();
  if (!limpio) return [];
  const fragmentos: string[] = [];
  let inicio = 0;
  while (inicio < limpio.length) {
    let fin = Math.min(inicio + CHUNK_SIZE, limpio.length);
    if (fin < limpio.length) {
      const parrafo = limpio.lastIndexOf('\n\n', fin);
      const oracion = Math.max(limpio.lastIndexOf('. ', fin), limpio.lastIndexOf('? ', fin), limpio.lastIndexOf('! ', fin));
      const corte = Math.max(parrafo, oracion);
      if (corte > inicio + Math.floor(CHUNK_SIZE * 0.55)) fin = corte + 1;
    }
    fragmentos.push(limpio.slice(inicio, fin).trim());
    if (fin === limpio.length) break;
    inicio = Math.max(fin - CHUNK_OVERLAP, inicio + 1);
  }
  return fragmentos.filter(Boolean);
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly embeddingModelId: string;
  private readonly dimensions: number;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    // Una coleccion vectorial usa siempre el mismo modelo y la misma dimension.
    this.embeddingModelId = this.config.get<string>('RAG_EMBEDDING_MODEL_ID', 'text-embedding-004');
    this.dimensions = Number(this.config.get<string>('RAG_EMBEDDING_DIMENSIONS', '768'));
  }

  private async embedding(texto: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
    const { embedding } = await embed({
      model: google.textEmbeddingModel(this.embeddingModelId, { outputDimensionality: this.dimensions, taskType }),
      value: texto,
    });
    if (embedding.length !== this.dimensions) {
      throw new Error(`El modelo devolvio ${embedding.length} dimensiones; se esperaban ${this.dimensions}.`);
    }
    return embedding;
  }

  private vectorLiteral(vector: number[]) {
    // El vector procede del proveedor de embeddings; no se compone con texto del usuario.
    return `[${vector.join(',')}]`;
  }

  /** Reemplaza por completo el indice de un material despues de cargarlo o editarlo. */
  async indexarMaterial(materialId: string): Promise<number> {
    const material = await this.prisma.materialCurso.findUnique({ where: { id: materialId } });
    if (!material) return 0;
    const fragmentos = fragmentarTexto(material.contenido);
    const embeddings = await Promise.all(fragmentos.map((x) => this.embedding(x, 'RETRIEVAL_DOCUMENT')));
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM rag_fragmentos_material WHERE material_id = ${material.id}::uuid`;
      for (let indice = 0; indice < fragmentos.length; indice += 1) {
        await tx.$executeRaw`
          INSERT INTO rag_fragmentos_material (material_id, curso_id, indice, contenido, embedding)
          VALUES (${material.id}::uuid, ${material.cursoId}::uuid, ${indice}, ${fragmentos[indice]}, ${this.vectorLiteral(embeddings[indice])}::extensions.vector)
        `;
      }
    });
    this.logger.log(`Material ${materialId} indexado: ${fragmentos.length} fragmentos`);
    return fragmentos.length;
  }

  async reindexarCurso(cursoId: string) {
    const materiales = await this.prisma.materialCurso.findMany({ where: { cursoId }, select: { id: true } });
    let fragmentos = 0;
    for (const material of materiales) fragmentos += await this.indexarMaterial(material.id);
    return { materiales: materiales.length, fragmentos };
  }

  /** Recupera evidencia solo del curso consultado; nunca mezcla materiales entre cursos. */
  async buscarMaterial(cursoId: string, consulta: string, limite = DEFAULT_MATCH_COUNT): Promise<MaterialCursoInput[]> {
    if (!consulta.trim()) return [];
    const vector = this.vectorLiteral(await this.embedding(consulta, 'RETRIEVAL_QUERY'));
    return this.prisma.$queryRaw<Array<{ titulo: string; unidad: string | null; contenido: string }>>`
      SELECT m.titulo, m.unidad, f.contenido
      FROM rag_fragmentos_material f INNER JOIN materiales_curso m ON m.id = f.material_id
      WHERE f.curso_id = ${cursoId}::uuid
      ORDER BY f.embedding <=> ${vector}::extensions.vector
      LIMIT ${limite}
    `;
  }
}
