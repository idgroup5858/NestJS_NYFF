import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { NBU_OPS, type NbuOp } from './nbu-test.service';

/** Bankka bitta so'rov: `body` — test sahifasidagi JSON (`{{orderId}}` kabi o'zgaruvchilar serverda to'ldiriladi). */
export class NbuCallDto {
  @IsIn(NBU_OPS)
  op: NbuOp;

  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}

/** Vaqtincha sozlama (xotirada, restartgacha). Bo'sh qator — `.env` dagisiga qaytadi. */
export class NbuConfigDto {
  @IsOptional() @IsString() @MaxLength(300) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(500) secretKey?: string;
  @IsOptional() @IsString() @MaxLength(200) username?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsIn(['hex', 'base64', '']) signatureEncoding?: string;
  @IsOptional() @IsIn(['sha1', 'sha256', '']) oaepHash?: string;
  @IsOptional() @IsString() @MaxLength(5000) bankPublicKey?: string;
  @IsOptional() @IsBoolean() clear?: boolean;
}

export class NbuSessionDto {
  @IsOptional() @IsString() @MaxLength(500) cardToken?: string;
  @IsOptional() @IsString() @MaxLength(100) lastOrderId?: string;
  @IsOptional() @IsString() @MaxLength(100) lastTransactionId?: string;
}
