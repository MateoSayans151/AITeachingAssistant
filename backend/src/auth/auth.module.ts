import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { VerificadorSesion } from './verificador-sesion';
import { SesionDocenteService } from './sesion-docente.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      // Este JWT_SECRET firma SOLO el token del intento de un alumno. La sesión del docente es de Supabase Auth.
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) {
          // Falla al arrancar: mejor no levantar que firmar sesiones con un secreto débil o ausente.
          throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres (ver .env.example)');
        }
        return { secret, signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '12h' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, VerificadorSesion, SesionDocenteService],
  exports: [JwtModule, VerificadorSesion, SesionDocenteService],
})
export class AuthModule {}
