// Tests de regresión de seguridad (auth de docentes con Supabase Auth, aislamiento de tokens de alumno, clave de respuestas). Corren sin base de datos:
//   npm test
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../src/auth/auth.guard';
import { IS_PUBLIC_KEY } from '../src/auth/public.decorator';
import { createServer } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { VerificadorSesion } from '../src/auth/verificador-sesion';
import { SesionDocenteService } from '../src/auth/sesion-docente.service';
import { sanitizarOpcionesParaAlumno } from '../src/respuestas-examen/correccion-cerradas.util';
import { IntentosService } from '../src/respuestas-examen/intentos.service';
import { AlmacenFallosMemoria, LimitadorFallos } from '../src/respuestas-examen/limitador-intentos.util';
import { antiCheatActivo, eventoPermitido } from '../src/respuestas-examen/anticheat.util';
import { AuthController } from '../src/auth/auth.controller';
import { RendirController } from '../src/respuestas-examen/rendir.controller';
import { EntregarController } from '../src/trabajos-practicos/entregar.controller';
import { CursosController } from '../src/cursos/cursos.controller';
import { ComisionesController, ComisionDetalleController, AlumnosController } from '../src/comisiones/comisiones.controller';
import { MaterialesCursoController, MaterialDetalleController } from '../src/materiales-curso/materiales-curso.controller';
import { MatricesRubricaController } from '../src/matrices-rubrica/matrices-rubrica.controller';
import { ExamenesController } from '../src/examenes/examenes.controller';
import { SugerenciasController } from '../src/examenes/sugerencias.controller';
import { InvitacionesController } from '../src/mail/invitaciones.controller';
import { RespuestasExamenController } from '../src/respuestas-examen/respuestas-examen.controller';
import { TrabajosPracticosController } from '../src/trabajos-practicos/trabajos-practicos.controller';
import { EntregasController } from '../src/entregas/entregas.controller';
import { CorreccionesController } from '../src/correcciones/correcciones.controller';
import { ResumenCursoController } from '../src/resumen-curso/resumen-curso.controller';

// JWT_SECRET del backend: firma SOLO el token del intento de un alumno.
const SECRET = 'x'.repeat(40);
const jwt = new JwtService({ secret: SECRET });

// Login de docentes = Supabase Auth. En los tests se simula con tokens HS256 (el modo con SUPABASE_JWT_SECRET);
// en producción (claves asimétricas) la firma se verifica contra el JWKS del proyecto.
const SUPABASE_URL = 'https://proyecto-test.supabase.co';
const SUPABASE_SECRET = 's'.repeat(40);
const configDe = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as any;
const verificador = new VerificadorSesion(configDe({ SUPABASE_URL, SUPABASE_JWT_SECRET: SUPABASE_SECRET }));

async function tokenSupabase(
  claims: Record<string, unknown> = {},
  { secreto = SUPABASE_SECRET, iss = `${SUPABASE_URL}/auth/v1`, aud = 'authenticated', exp = '1h' as string | number } = {},
) {
  return new SignJWT({ email: 'doc@x.com', user_metadata: { email_verified: true }, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject((claims.sub as string) ?? 'user-1')
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secreto));
}

function ctx(controller: any, handler: string, authorization?: string): ExecutionContext & { req: any } {
  const req: any = { headers: authorization ? { authorization } : {} };
  return {
    req,
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

// ---------------------------------------------------------------------------
// 1. Superficie pública: si alguien abre una ruta nueva sin querer, este test falla.
// ---------------------------------------------------------------------------
test('las únicas rutas públicas son las de rendir y entregar (el login es de Supabase, no hay rutas de login acá)', () => {
  const controllers = [
    AuthController, RendirController, EntregarController, CursosController, ComisionesController, ComisionDetalleController,
    AlumnosController, MaterialesCursoController, MaterialDetalleController, MatricesRubricaController,
    ExamenesController, RespuestasExamenController, TrabajosPracticosController, EntregasController,
    CorreccionesController, ResumenCursoController, SugerenciasController, InvitacionesController,
  ];
  const publicas: string[] = [];
  for (const c of controllers) {
    for (const m of Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor')) {
      const abierta = Reflect.getMetadata(IS_PUBLIC_KEY, c.prototype[m]) || Reflect.getMetadata(IS_PUBLIC_KEY, c);
      if (abierta) publicas.push(`${c.name}.${m}`);
    }
  }
  assert.deepEqual(publicas.sort(), [
    'RendirController.borrador',
    'RendirController.entregar',
    'RendirController.evento',
    'RendirController.info',
    'RendirController.intento',
    'RendirController.iniciar',
    'EntregarController.borrador',
    'EntregarController.enviar',
    'EntregarController.evento',
    'EntregarController.info',
    'EntregarController.intento',
    'EntregarController.iniciar',
  ].sort());
});

// ---------------------------------------------------------------------------
// 2. AuthGuard: la sesión de docente es el access token de Supabase Auth
// ---------------------------------------------------------------------------
const sesionesFalsas = { resolver: async (claims: any) => `doc:${claims.sub}` } as any;
const guard = new AuthGuard(verificador, sesionesFalsas, new Reflector());

test('sin token, una ruta de docente responde 401', async () => {
  await assert.rejects(() => guard.canActivate(ctx(ExamenesController, 'findOne')), UnauthorizedException);
});

test('token inválido o firmado con otro secreto responde 401', async () => {
  const ajeno = await tokenSupabase({}, { secreto: 'y'.repeat(40) });
  await assert.rejects(() => guard.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${ajeno}`)), UnauthorizedException);
  await assert.rejects(() => guard.canActivate(ctx(ExamenesController, 'findOne', 'Bearer basura')), UnauthorizedException);
});

test('token vencido, de otro proyecto o con otra audiencia responde 401', async () => {
  const vencido = await tokenSupabase({}, { exp: Math.floor(Date.now() / 1000) - 10 });
  const otroProyecto = await tokenSupabase({}, { iss: 'https://otro.supabase.co/auth/v1' });
  const otraAudiencia = await tokenSupabase({}, { aud: 'anon' });
  for (const t of [vencido, otroProyecto, otraAudiencia]) {
    await assert.rejects(() => guard.canActivate(ctx(CursosController, 'findAll', `Bearer ${t}`)), UnauthorizedException);
  }
});

test('token válido deja pasar y expone el docenteId (nunca lo toma del body)', async () => {
  const token = await tokenSupabase({ sub: 'user-1' });
  const c = ctx(CursosController, 'findAll', `Bearer ${token}`);
  c.req.body = { docenteId: 'otro-docente' };
  assert.equal(await guard.canActivate(c), true);
  assert.equal(c.req.docenteId, 'doc:user-1');
});

test('rendir es público sin token', async () => {
  assert.equal(await guard.canActivate(ctx(RendirController, 'info')), true);
});

test('producción: verifica la firma ES256 contra el JWKS del proyecto y rechaza claves ajenas', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const ajena = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const servidor = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/auth/v1/.well-known/jwks.json' ? JSON.stringify({ keys: [jwk] }) : '{}');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  try {
    const url = `http://127.0.0.1:${(servidor.address() as any).port}`;
    const prod = new VerificadorSesion(configDe({ SUPABASE_URL: url })); // sin secreto compartido: modo asimétrico
    const firmar = (clave: any, extra: { aud?: string; iss?: string } = {}) =>
      new SignJWT({ email: 'a@x.com' })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject('u1')
        .setIssuer(extra.iss ?? `${url}/auth/v1`)
        .setAudience(extra.aud ?? 'authenticated')
        .setExpirationTime('1h')
        .sign(clave);
    assert.equal((await prod.verificar(await firmar(privateKey))).sub, 'u1');
    await assert.rejects(async () => prod.verificar(await firmar(ajena.privateKey)), UnauthorizedException);
    await assert.rejects(async () => prod.verificar(await firmar(privateKey, { aud: 'anon' })), UnauthorizedException);
    await assert.rejects(async () => prod.verificar(await firmar(privateKey, { iss: 'https://otro.supabase.co/auth/v1' })), UnauthorizedException);
  } finally {
    servidor.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Vincular el usuario de Supabase con la fila de docentes
// ---------------------------------------------------------------------------
function prismaDocentes(filas: any[], { carreraEnCreate = false } = {}) {
  return {
    docente: {
      findUnique: async ({ where }: any) => filas.find((f) => f.authUserId === where.authUserId) ?? null,
      findFirst: async ({ where }: any) => filas.find((f) => f.email.toLowerCase() === where.email.equals) ?? null,
      updateMany: async ({ where, data }: any) => {
        const f = filas.find((x) => x.id === where.id && x.authUserId === null);
        if (!f) return { count: 0 };
        Object.assign(f, data);
        return { count: 1 };
      },
      create: async ({ data }: any) => {
        const f = { id: `d${filas.length + 1}`, ...data };
        filas.push(f);
        if (carreraEnCreate) throw Object.assign(new Error('unique'), { code: 'P2002' }); // otro pedido ya lo creó
        return f;
      },
    },
  } as any;
}
const claims = (sub: string, email: string | undefined, extra: any = {}) => ({ sub, email, user_metadata: { email_verified: true, ...extra } }) as any;

test('vincular: un usuario ya vinculado entra directo, aunque el claim no diga verificado', async () => {
  const filas: any[] = [{ id: 'd1', email: 'a@x.com', authUserId: 'u1' }];
  const svc = new SesionDocenteService(prismaDocentes(filas));
  assert.equal(await svc.resolver({ sub: 'u1', email: 'a@x.com', user_metadata: { email_verified: false } } as any), 'd1');
});

test('vincular: sin email confirmado no se crea ni se vincula nada', async () => {
  const filas: any[] = [{ id: 'd1', email: 'a@x.com', authUserId: null, nombre: 'Ana' }];
  const svc = new SesionDocenteService(prismaDocentes(filas));
  await assert.rejects(() => svc.resolver({ sub: 'u9', email: 'a@x.com', user_metadata: { email_verified: false } } as any), UnauthorizedException);
  await assert.rejects(() => svc.resolver({ sub: 'u9', email: 'nuevo@x.com' } as any), UnauthorizedException);
  await assert.rejects(() => svc.resolver(claims('u9', undefined)), UnauthorizedException);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].authUserId, null, 'el atacante que conoce el email no se queda con la cuenta');
});

test('vincular: un docente anterior (sin vincular) se une por email confirmado y conserva su fila', async () => {
  const filas: any[] = [{ id: 'd1', email: 'Ana@X.com', authUserId: null, nombre: 'Ana' }];
  const svc = new SesionDocenteService(prismaDocentes(filas));
  assert.equal(await svc.resolver(claims('u1', 'ana@x.com')), 'd1');
  assert.equal(filas[0].authUserId, 'u1');
  assert.equal(await svc.resolver(claims('u1', 'ana@x.com')), 'd1', 'la segunda vez entra por id');
  assert.equal(filas.length, 1);
});

test('vincular: un email ya asociado a otro usuario no se puede tomar (409)', async () => {
  const filas: any[] = [{ id: 'd1', email: 'a@x.com', authUserId: 'u1' }];
  const svc = new SesionDocenteService(prismaDocentes(filas));
  await assert.rejects(() => svc.resolver(claims('u2', 'a@x.com')), ConflictException);
  assert.equal(filas[0].authUserId, 'u1');
});

test('vincular: un usuario nuevo con email confirmado crea su docente (email en minúscula, nombre del registro)', async () => {
  const filas: any[] = [];
  const svc = new SesionDocenteService(prismaDocentes(filas));
  assert.equal(await svc.resolver(claims('u1', 'Nueva@X.com', { nombre: ' Nora ' })), 'd1');
  assert.deepEqual(filas[0], { id: 'd1', nombre: 'Nora', email: 'nueva@x.com', authUserId: 'u1' });
  await svc.resolver(claims('u2', 'sin.nombre@x.com'));
  assert.equal(filas[1].nombre, 'sin.nombre', 'sin nombre en el registro se usa lo de antes de la arroba');
});

test('vincular: dos primeros pedidos a la vez del mismo usuario terminan en la misma fila', async () => {
  const filas: any[] = [];
  const svc = new SesionDocenteService(prismaDocentes(filas, { carreraEnCreate: true }));
  assert.equal(await svc.resolver(claims('u1', 'a@x.com')), 'd1');
  assert.equal(filas.length, 1);
});

// ---------------------------------------------------------------------------
// 4. La clave de respuestas nunca sale hacia el alumno
// ---------------------------------------------------------------------------
test('sanitizarOpcionesParaAlumno no filtra la clave en ningún tipo', () => {
  const casos: Array<[string, unknown]> = [
    ['opcion_multiple', [{ id: 'a', texto: 'A', correcta: true }, { id: 'b', texto: 'B', correcta: false }]],
    ['casillas', [{ id: 'a', texto: 'A', correcta: true }]],
    ['verdadero_falso', { correcta: true }],
    ['numerica', { respuestaCorrecta: 42, tolerancia: 1 }],
    ['relacionar_pares', { izquierda: ['x'], derecha: ['y'], paresCorrectos: [['x', 'y']] }],
  ];
  for (const [tipo, opciones] of casos) {
    const json = JSON.stringify(sanitizarOpcionesParaAlumno(tipo, opciones));
    for (const prohibido of ['correcta', 'respuestaCorrecta', 'paresCorrectos', '42']) {
      assert.ok(!json.includes(prohibido), `${tipo} filtra "${prohibido}": ${json}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Aislamiento de tokens: el del alumno no sirve de docente y viceversa
// ---------------------------------------------------------------------------
test('un token de intento (alumno) no vale como sesión de docente', async () => {
  const tokenAlumno = await jwt.signAsync({ sub: 'intento-1', typ: 'intento' });
  await assert.rejects(() => guard.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${tokenAlumno}`)), UnauthorizedException);
});

test('en producción (sin SUPABASE_JWT_SECRET) cualquier token HS256 se rechaza: el del alumno no puede pasar de docente', async () => {
  const produccion = new AuthGuard(new VerificadorSesion(configDe({ SUPABASE_URL })), sesionesFalsas, new Reflector());
  const tokenAlumno = await jwt.signAsync({ sub: 'intento-1', typ: 'intento' });
  await assert.rejects(() => produccion.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${tokenAlumno}`)), UnauthorizedException);
  const deSupabase = await tokenSupabase();
  await assert.rejects(() => produccion.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${deSupabase}`)), UnauthorizedException);
});

test('aunque se configurara por error el mismo secreto para los dos, el token del alumno no tiene emisor ni audiencia de Supabase', async () => {
  const mismoSecreto = new AuthGuard(new VerificadorSesion(configDe({ SUPABASE_URL, SUPABASE_JWT_SECRET: SECRET })), sesionesFalsas, new Reflector());
  const tokenAlumno = await jwt.signAsync({ sub: 'intento-1', typ: 'intento' });
  await assert.rejects(() => mismoSecreto.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${tokenAlumno}`)), UnauthorizedException);
});

test('un token firmado por el backend sin los datos de Supabase (viejo/forjado) tampoco vale como docente', async () => {
  const sinTyp = await jwt.signAsync({ sub: 'doc-1' });
  const viejoDocente = await jwt.signAsync({ sub: 'doc-1', typ: 'docente' });
  for (const t of [sinTyp, viejoDocente]) {
    await assert.rejects(() => guard.canActivate(ctx(ExamenesController, 'findOne', `Bearer ${t}`)), UnauthorizedException);
  }
});

function intentosServiceFalso(prisma: any = {}) {
  return new IntentosService(prisma, jwt, {} as any);
}

test('un token de docente no sirve para autoguardar/entregar como alumno', async () => {
  const tokenDocente = await tokenSupabase({ sub: 'doc-1' });
  const svc = intentosServiceFalso();
  await assert.rejects(() => svc.intentoDeToken(`Bearer ${tokenDocente}`, 'slug'), UnauthorizedException);
  await assert.rejects(() => svc.intentoDeToken(undefined, 'slug'), UnauthorizedException);
  await assert.rejects(() => svc.intentoDeToken('Bearer basura', 'slug'), UnauthorizedException);
});

test('el token de un intento no se puede usar contra el link de otro examen', async () => {
  const token = await jwt.signAsync({ sub: 'i-1', typ: 'intento' });
  const prisma = {
    examenComision: { findUnique: async () => ({ examenId: 'ex-B', comisionId: 'c-1', examen: {}, comision: {} }) },
    intentoExamen: { findUnique: async () => ({ id: 'i-1', examenId: 'ex-A', alumno: { comisionId: 'c-1' } }) },
  };
  await assert.rejects(() => intentosServiceFalso(prisma).intentoDeToken(`Bearer ${token}`, 'slug-B'), /no corresponde/);
});

// ---------------------------------------------------------------------------
// 6. Freno a la fuerza bruta del código (solo cuenta fallos, por alumno e IP)
// ---------------------------------------------------------------------------
test('limitador: bloquea tras N fallos en la ventana, se libera al pasar y el éxito borra el conteo', async () => {
  const l = new LimitadorFallos(new AlmacenFallosMemoria(), 3, 1000);
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) { await l.verificar('a', t0); await l.fallo('a', t0); }
  await assert.rejects(() => l.verificar('a', t0 + 10), /Demasiados intentos/);
  await l.verificar('b', t0 + 10); // otra clave no se ve afectada
  await l.verificar('a', t0 + 1001); // pasó la ventana
  await l.fallo('c', t0); await l.exito('c'); await l.fallo('c', t0); await l.fallo('c', t0); await l.verificar('c', t0); // el éxito reinició el conteo
});

// ---------------------------------------------------------------------------
// 7. Anti-cheat: solo se aceptan eventos que el docente activó
// ---------------------------------------------------------------------------
test('antiCheatActivo: null sin controles; eventoPermitido respeta lo configurado', () => {
  assert.equal(antiCheatActivo(null), null);
  assert.equal(antiCheatActivo({ pantallaCompleta: false, cambioPestana: false, pegado: false }), null);
  assert.equal(antiCheatActivo('x'), null);
  const cfg = antiCheatActivo({ pantallaCompleta: true, cambioPestana: false, pegado: true, otro: 1 });
  assert.deepEqual(cfg, { pantallaCompleta: true, cambioPestana: false, pegado: true });
  assert.equal(eventoPermitido(cfg, 'salida_pantalla_completa'), true);
  assert.equal(eventoPermitido(cfg, 'cambio_pestana'), false);
  assert.equal(eventoPermitido(cfg, 'pegado'), true);
  assert.equal(eventoPermitido(cfg, 'inventado'), false);
  assert.equal(eventoPermitido(null, 'pegado'), false);
});
