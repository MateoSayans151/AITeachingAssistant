import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Put } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IntentosService, Origen } from './intentos.service';
import { CapturaDto, EntregarDto, EventoIntegridadDto, GuardarBorradorDto, IniciarIntentoDto, LatidoDto, SolicitarCodigoDto } from './dto/intento.dto';
import { OrigenPedido } from './origen.decorator';
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

  // Pide el código (OTP) que llega al mail. Siempre responde lo mismo: no revela quién está en la lista.
  @Post('codigo')
  @HttpCode(202)
  codigo(@Param('slug') slug: string, @Body() dto: SolicitarCodigoDto, @Ip() ip: string) {
    return this.service.solicitarCodigo(slug, dto, ip);
  }

  @Post('iniciar')
  iniciar(@Param('slug') slug: string, @Body() dto: IniciarIntentoDto, @Ip() ip: string, @OrigenPedido() origen: Origen) {
    return this.service.iniciar(slug, dto, ip, origen);
  }

  // Retomar tras un refresh: devuelve preguntas + borrador + vencimiento del intento.
  @Get('intento')
  async intento(@Param('slug') slug: string, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.estadoIntento(intentoId, slug);
  }

  @Put('borrador')
  async borrador(@Param('slug') slug: string, @Body() dto: GuardarBorradorDto, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.guardarBorrador(intentoId, dto.respuestas);
  }

  @Post('eventos')
  @HttpCode(200)
  async evento(@Param('slug') slug: string, @Body() dto: EventoIntegridadDto, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.registrarEvento(intentoId, dto);
  }

  // Latido del navegador cada pocos segundos: devuelve la marca visible y, a veces, el pedido de una captura de pantalla.
  @Post('latido')
  @HttpCode(200)
  async latido(@Param('slug') slug: string, @Body() dto: LatidoDto, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.latido(intentoId, dto);
  }

  @Post('capturas')
  @HttpCode(200)
  async captura(@Param('slug') slug: string, @Body() dto: CapturaDto, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.subirCaptura(intentoId, dto);
  }

  @Post('entregar')
  async entregar(@Param('slug') slug: string, @Body() dto: EntregarDto, @OrigenPedido() origen: Origen, @Headers('authorization') auth?: string) {
    const intentoId = await this.service.intentoDeToken(auth, slug, origen);
    return this.service.entregar(intentoId, dto.respuestas);
  }
}
