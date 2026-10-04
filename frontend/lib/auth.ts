'use client';

import { useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ApiError, getDocenteActual } from './api';
import { supabase } from './supabase';

export interface DocenteSesion {
  id: string;
  nombre: string;
  email: string;
}

interface EstadoSesion {
  docente: DocenteSesion | null;
  /** Todavía no se sabe si hay sesión. */
  cargando: boolean;
  /** Por qué no se pudo usar la sesión (p. ej. email sin confirmar). */
  error: string | null;
  /** Se abrió el enlace de "restablecer contraseña": hay una sesión temporal solo para cambiarla. */
  recuperando: boolean;
}

// Estado compartido por toda la app (la barra superior y cada página lo leen sin repetir pedidos).
const inicial: EstadoSesion = { docente: null, cargando: true, error: null, recuperando: false };
let estado = inicial;
const oyentes = new Set<() => void>();

function emitir(cambio: Partial<EstadoSesion>) {
  estado = { ...estado, ...cambio };
  oyentes.forEach((f) => f());
}

function mensajeDeSesion(e: unknown): string {
  if (e instanceof ApiError) {
    try {
      const m = JSON.parse(e.body)?.message;
      if (typeof m === 'string') return m;
    } catch {
      /* cuerpo no JSON */
    }
  }
  return 'No se pudo verificar tu sesión. ¿Está corriendo el backend?';
}

let usuarioVerificado: string | null = null;

/** Pide al backend quién es el docente de esta sesión (ahí se vincula la cuenta con sus datos). */
async function resolver(session: Session | null) {
  if (!session) {
    usuarioVerificado = null;
    emitir({ docente: null, cargando: false });
    return;
  }
  if (usuarioVerificado === session.user.id && estado.docente) return; // un refresco de token no cambia nada
  try {
    const docente = await getDocenteActual();
    usuarioVerificado = session.user.id;
    emitir({ docente, cargando: false, error: null });
  } catch (e) {
    // Sesión de Supabase válida pero que el backend no acepta (p. ej. email sin confirmar): no se deja a medias.
    await supabase.auth.signOut();
    emitir({ docente: null, cargando: false, error: mensajeDeSesion(e) });
  }
}

let iniciado = false;
function iniciar() {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;
  supabase.auth.onAuthStateChange((evento, session) => {
    if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;
    if (evento === 'PASSWORD_RECOVERY') {
      emitir({ recuperando: true, cargando: false });
      return;
    }
    if (evento === 'SIGNED_OUT') {
      usuarioVerificado = null;
      emitir({ docente: null, cargando: false, recuperando: false });
      return;
    }
    // Sin sesión temporal de recuperación de por medio. Y fuera del callback: adentro no se puede esperar a supabase.
    if (estado.recuperando) return;
    setTimeout(() => void resolver(session), 0);
  });
}
// Se suscribe apenas se carga el módulo (antes de hidratar) para no perderse el evento del enlace de recuperación.
iniciar();

/** Access token de la sesión actual (supabase-js lo renueva solo cuando vence). */
export async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function cerrarSesion() {
  await supabase.auth.signOut();
}

/** Tras cambiar la contraseña con el enlace de recuperación: sale del modo recuperación y entra normal. */
export async function terminarRecuperacion() {
  emitir({ recuperando: false });
  const { data } = await supabase.auth.getSession();
  await resolver(data.session);
}

function suscribir(cb: () => void) {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
}

export function useSesion(): EstadoSesion {
  return useSyncExternalStore(suscribir, () => estado, () => inicial);
}

/** Docente de la sesión actual (null si no hay sesión o todavía se está cargando). */
export function useDocente(): DocenteSesion | null {
  return useSesion().docente;
}
