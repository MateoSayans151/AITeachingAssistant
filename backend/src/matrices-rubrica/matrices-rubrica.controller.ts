import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MatricesRubricaService } from './matrices-rubrica.service';
import { CreateMatrizRubricaDto } from './dto/create-matriz-rubrica.dto';

@Controller('matrices-rubrica')
export class MatricesRubricaController {
  constructor(private readonly service: MatricesRubricaService) {}

  @Post()
  create(@Body() dto: CreateMatrizRubricaDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
