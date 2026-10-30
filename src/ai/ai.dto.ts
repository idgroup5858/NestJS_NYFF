import { IsString, MaxLength } from 'class-validator';
import { MAX_QUESTION } from './ai.service';

export class AskDto {
  /** bo'sh — servisda `invalid_input` */
  @IsString()
  @MaxLength(MAX_QUESTION)
  text: string;
}
