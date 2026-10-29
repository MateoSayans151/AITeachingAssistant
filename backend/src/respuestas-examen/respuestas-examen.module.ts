import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RespuestasExamenController } from './respuestas-examen.controller';
import { RendirController } from './rendir.controller';
import { RespuestasExamenService } from './respuestas-examen.service';
import { IntentosService } from './intentos.service';
import { RagModule } from '../rag/rag.module';
import { ExamenesModule } from '../examenes/examenes.module';
import { NotificacionesModule } from '../mail/notificaciones.module';
import { MailModule } from '../mail/mail.module';
import { CodigosAccesoService } from './codigos-acceso.service';
import { IntegridadService } from './integridad.service';
import { ALMACEN_CAPTURAS, AlmacenCapturas, AlmacenCapturasLocal, AlmacenCapturasSupabase } from './almacen-capturas';

@Module({
  imports: [RagModule, ExamenesModule, NotificacionesModule, MailModule],
  controllers: [RespuestasExamenController, RendirController],
  providers: [
    RespuestasExamenService,
    IntentosService,
    CodigosAccesoService,
    IntegridadService,
    {
      // Producción: Supabase Storage (bucket privado "capturas"). Desarrollo: carpeta local.
      provide: ALMACEN_CAPTURAS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AlmacenCapturas => {
        const url = config.get<string>('SUPABASE_URL');
        const clave = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
        if (url && clave) return new AlmacenCapturasSupabase(url, clave);
        if (process.env.NODE_ENV === 'production') {
          new Logger('AlmacenCapturas').warn('Sin SUPABASE_SERVICE_ROLE_KEY: las capturas van a disco local y se pierden si el host reinicia.');
        }
        return new AlmacenCapturasLocal(config.get<string>('CAPTURAS_DIR') ?? '.capturas');
      },
    },
  ],
})
export class RespuestasExamenModule {}
