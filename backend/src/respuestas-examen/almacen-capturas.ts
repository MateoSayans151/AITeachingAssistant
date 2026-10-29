import { Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// Dónde viven las imágenes de las capturas. La base solo guarda la ruta ("<intentoId>/<uuid>.jpg").
//   - Supabase Storage (bucket privado "capturas"), si hay SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY: es lo que se usa en producción.
//   - Carpeta local (CAPTURAS_DIR, por defecto ./.capturas): para desarrollo y tests. En un host con disco efímero (Render, etc.)
//     las imágenes se perderían al reiniciar: por eso en producción hay que configurar Supabase.

export const ALMACEN_CAPTURAS = 'ALMACEN_CAPTURAS';
export const BUCKET_CAPTURAS = 'capturas';

export interface AlmacenCapturas {
  guardar(ruta: string, datos: Buffer): Promise<void>;
  leer(ruta: string): Promise<Buffer | null>;
  borrar(ruta: string): Promise<void>;
}

const RUTA_VALIDA = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;
function validarRuta(ruta: string) {
  if (!RUTA_VALIDA.test(ruta)) throw new Error('Ruta de captura inválida');
}

export class AlmacenCapturasLocal implements AlmacenCapturas {
  private readonly base: string;
  constructor(carpeta: string) {
    this.base = resolve(carpeta);
  }
  private archivo(ruta: string) {
    validarRuta(ruta);
    const f = resolve(join(this.base, ruta));
    if (!f.startsWith(this.base + sep)) throw new Error('Ruta de captura inválida');
    return f;
  }
  async guardar(ruta: string, datos: Buffer) {
    const f = this.archivo(ruta);
    await fs.mkdir(dirname(f), { recursive: true });
    await fs.writeFile(f, datos);
  }
  async leer(ruta: string) {
    return fs.readFile(this.archivo(ruta)).catch(() => null);
  }
  async borrar(ruta: string) {
    await fs.rm(this.archivo(ruta), { force: true });
  }
}

export class AlmacenCapturasSupabase implements AlmacenCapturas {
  private readonly logger = new Logger(AlmacenCapturasSupabase.name);
  constructor(
    private readonly url: string,
    private readonly claveServicio: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  private endpoint(ruta: string, autenticado = false) {
    validarRuta(ruta);
    return `${this.url.replace(/\/+$/, '')}/storage/v1/object/${autenticado ? 'authenticated/' : ''}${BUCKET_CAPTURAS}/${ruta}`;
  }
  private get cabeceras() {
    return { Authorization: `Bearer ${this.claveServicio}`, apikey: this.claveServicio };
  }
  async guardar(ruta: string, datos: Buffer) {
    const res = await this.fetchImpl(this.endpoint(ruta), {
      method: 'POST',
      headers: { ...this.cabeceras, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
      body: new Uint8Array(datos),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Supabase Storage respondió ${res.status} al guardar una captura`);
  }
  async leer(ruta: string) {
    const res = await this.fetchImpl(this.endpoint(ruta, true), { headers: this.cabeceras, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Supabase Storage respondió ${res.status} al leer una captura`);
    return Buffer.from(await res.arrayBuffer());
  }
  async borrar(ruta: string) {
    const res = await this.fetchImpl(this.endpoint(ruta), { method: 'DELETE', headers: this.cabeceras, signal: AbortSignal.timeout(15_000) });
    if (!res.ok && res.status !== 404) this.logger.warn(`No se pudo borrar una captura (HTTP ${res.status})`);
  }
}
