import { IsString, MaxLength } from 'class-validator';

export class ConnectBotDto {
  /** @BotFather tokeni (`123456789:AA...`) — shakli va o'zi servisda tekshiriladi (`telegram_token_invalid`) */
  @IsString()
  @MaxLength(100)
  token: string;
}
