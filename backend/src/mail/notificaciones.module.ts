import { Module } from '@nestjs/common';
import { MailModule } from './mail.module';
import { NotificacionesService } from './notificaciones.service';

// Lo importan ExamenesModule (publicar notas) y RespuestasExamenModule (revisar). No depende de ninguno de los dos:
// la regla de a quién se notifica vive en funciones puras (respuestas-examen/resultado.util.ts), no en un servicio.
@Module({
  imports: [MailModule],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
