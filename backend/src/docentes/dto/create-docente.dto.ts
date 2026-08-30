import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateDocenteDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsEmail()
  email: string;
}
