import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, JWTPayload } from 'jose';

/** Lo que nos interesa del access token que emite Supabase Auth. */
export interface ClaimsSupabase extends JWTPayload {
  sub: string;
  email?: string;
  user_metadata?: { nombre?: string; email_verified?: boolean; [k: string]: unknown };
}

/**
 * Verifica los access tokens de Supabase Auth (el login de los docentes).
 *
 * - Proyectos con claves asimétricas (el caso normal hoy): se verifica la firma contra el JWKS público del
 *   proyecto; no hace falta ningún secreto.
 * - SUPABASE_JWT_SECRET (opcional): para proyectos con el secreto compartido legado (HS256) y para los tests.
 *   Si no está configurado, un token HS256 se rechaza siempre: así el token de un alumno (que firmamos nosotros
 *   con JWT_SECRET, también HS256) jamás puede pasar por sesión de docente.
 *
 * Además de la firma se exige el emisor del proyecto y la audiencia "authenticated".
 */
@Injectable()
export class VerificadorSesion {
  private readonly issuer: string;
  private readonly secreto?: Uint8Array;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL')?.trim().replace(/\/+$/, '');
    if (!url) throw new Error('SUPABASE_URL es obligatorio (ver .env.example): es el proyecto de Supabase que emite los logins');
    this.issuer = `${url}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    const secreto = config.get<string>('SUPABASE_JWT_SECRET');
    if (secreto) this.secreto = new TextEncoder().encode(secreto);
  }

  async verificar(token: string): Promise<ClaimsSupabase> {
    try {
      const opciones = { issuer: this.issuer, audience: 'authenticated' };
      const { alg } = decodeProtectedHeader(token);
      let payload: JWTPayload;
      if (alg === 'HS256') {
        if (!this.secreto) throw new Error('HS256 sin secreto configurado');
        ({ payload } = await jwtVerify(token, this.secreto, { ...opciones, algorithms: ['HS256'] }));
      } else {
        ({ payload } = await jwtVerify(token, this.jwks, { ...opciones, algorithms: ['ES256', 'RS256', 'EdDSA'] }));
      }
      if (!payload.sub) throw new Error('sin sub');
      return payload as ClaimsSupabase;
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
  }
}
