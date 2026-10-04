import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IntentosService } from './intentos.service';
import { EntregarDto, EventoIntegridadDto, GuardarBorradorDto, IniciarIntentoDto } from './dto/intento.dto';
import { Public } from '../auth/public.decorator';

// Único controller público del proyecto: para el alumno que entra desde el link de su
// comisión. El link solo muestra datos generales; las preguntas se entregan al iniciar
// (con su email, y aceptando el aviso si hay anti-cheat). Nunca devuelve correcciones
// ni notas: el resultado le llega al alumno por mail cuando el docente lo revisa y lo publica.
//
// @SkipThrottle: un aula entera comparte IP, así que el límite por IP del ThrottlerGuard
// bloquearía a los alumnos entre sí (autoguardado cada pocos segundos). El freno a quien
// prueba emails al azar está en IntentosService (solo cuenta intentos fallidos).
@Public()
@SkipThrottle()
@Controller('rendir/:slug')
export class RendirController {
  constructor(private readonly service: IntentosService) {}

  @Get()
  info(@Param('slug') slug: string) {
    return this.service.info(slug);
  }

  @Post('iniciar')
  iniciar(@Param('slug') slug: string, @Body() dto: IniciarIntentoDto, @Ip() ip: string) {
    return this.service.iniciar(slug, dto, ip);
  }

  // Retomar tras un refresh: devuelve preguntas + borrador + vencimiento del intento.
  @Get('intento')
  async intento(@Param('slug') slug: string, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.estadoIntento(intentoId, slug);
  }

  @Put('borrador')
  async borrador(@Param('slug') slug: string, @Body() dto: GuardarBorradorDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.guardarBorrador(intentoId, dto.respuestas);
  }

  @Post('eventos')
  @HttpCode(200)
  async evento(@Param('slug') slug: string, @Body() dto: EventoIntegridadDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.registrarEvento(intentoId, dto);
  }

  @Post('entregar')
  async entregar(@Param('slug') slug: string, @Body() dto: EntregarDto, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug);
    return this.service.entregar(intentoId, dto.respuestas);
  }
}
