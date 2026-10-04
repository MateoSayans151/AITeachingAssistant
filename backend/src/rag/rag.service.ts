import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embed } from 'ai';
import { google } from '@ai-sdk/google';
import { PrismaService } from '../prisma/prisma.service';
import { MaterialCursoInput } from '../ai/ai.types';

const CHUNK_SIZE = 2_200;
const CHUNK_OVERLAP = 300;
const DEFAULT_MATCH_COUNT = 6;
// Tope de la consulta que se embebe: el modelo de embeddings tiene un límite de entrada
// (~2048 tokens) y una respuesta de alumno puede llegar a 50k caracteres. ~6000 alcanza de sobra
// para ubicar el tema, que es lo único que necesita la búsqueda semántica.
export const MAX_CONSULTA_RAG = 6_000;

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

/**
 * Arma la consulta de búsqueda de una respuesta de examen sin pasarse de `max` caracteres.
 * Los enunciados tienen prioridad y van completos (son lo que más ubica el tema); lo que
 * sobra se reparte entre las respuestas del alumno, todas truncadas en la misma proporción
 * (se conserva el principio de cada una). Si ni los enunciados entran, se achican entre sí igual.
 */
export function armarConsultaRag(preguntas: Array<{ enunciado: string; respuesta: string }>, max = MAX_CONSULTA_RAG): string {
  const items = preguntas
    .map((p) => ({ enunciado: p.enunciado.trim(), respuesta: p.respuesta.trim() }))
    .filter((p) => p.enunciado || p.respuesta);
  if (items.length === 0) return '';

  // Separadores que se agregan al unir: "\n\n" entre preguntas y "\n" antes de cada respuesta.
  const separadores = (items.length - 1) * 2 + items.filter((p) => p.respuesta).length;
  const presupuesto = Math.max(max - separadores, 0);

  const totalEnunciados = items.reduce((suma, p) => suma + p.enunciado.length, 0);
  const totalRespuestas = items.reduce((suma, p) => suma + p.respuesta.length, 0);
  const cortar = (texto: string, proporcion: number) => texto.slice(0, Math.floor(texto.length * proporcion)).trim();

  const proporcionEnunciados = totalEnunciados <= presupuesto ? 1 : presupuesto / totalEnunciados;
  const sobrante = Math.max(presupuesto - totalEnunciados, 0);
  const proporcionRespuestas = totalRespuestas <= sobrante ? 1 : sobrante / totalRespuestas;

  return items
    .map((p) => {
      const enunciado = cortar(p.enunciado, proporcionEnunciados);
      const respuesta = cortar(p.respuesta, proporcionRespuestas);
      return respuesta ? `${enunciado}\n${respuesta}` : enunciado;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, max);
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly embeddingModelId: string;
  private readonly dimensions: number;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    // Una coleccion vectorial usa siempre el mismo modelo y la misma dimension.
    this.embeddingModelId = this.config.get<string>('RAG_EMBEDDING_MODEL_ID', 'gemini-embedding-001');
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

  /** ¿El curso tiene algo indexado? Consulta barata por curso_id (hay índice), sin tocar embeddings. */
  private async cursoTieneMaterialIndexado(cursoId: string): Promise<boolean> {
    const filas = await this.prisma.$queryRaw<Array<{ existe: number }>>`
      SELECT 1 AS existe FROM rag_fragmentos_material WHERE curso_id = ${cursoId}::uuid LIMIT 1
    `;
    return filas.length > 0;
  }

  /** Recupera evidencia solo del curso consultado; nunca mezcla materiales entre cursos. */
  async buscarMaterial(cursoId: string, consulta: string, limite = DEFAULT_MATCH_COUNT): Promise<MaterialCursoInput[]> {
    // Tope de seguridad por si algún llamador no acotó la consulta con armarConsultaRag.
    const texto = consulta.trim().slice(0, MAX_CONSULTA_RAG);
    if (!texto) return [];
    // Sin material indexado no hay nada que buscar: no se gasta una llamada a la API de embeddings.
    if (!(await this.cursoTieneMaterialIndexado(cursoId))) return [];
    const vector = this.vectorLiteral(await this.embedding(texto, 'RETRIEVAL_QUERY'));
    return this.prisma.$queryRaw<Array<{ titulo: string; unidad: string | null; contenido: string }>>`
      SELECT m.titulo, m.unidad, f.contenido
      FROM rag_fragmentos_material f INNER JOIN materiales_curso m ON m.id = f.material_id
      WHERE f.curso_id = ${cursoId}::uuid
      ORDER BY f.embedding <=> ${vector}::extensions.vector
      LIMIT ${limite}
    `;
  }
}
