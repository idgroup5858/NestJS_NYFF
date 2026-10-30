import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AskDto } from './ai.dto';
import { AiService, WEB_CHAT } from './ai.service';
import { waitingText } from './waiting';

/** Admin paneldagi AI chat — har adminning o'z suhbati; tarix ko'rsatilmaydi (har ochilganda yangi suhbat). */
@Roles('admin')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /**
   * Yangi suhbat: AI sahifasi har ochilganda (yangilanganda ham) va "Yangi suhbat" tugmasida — oldingisi bazadan o'chadi.
   * `configured: false` — `.env` da `GEMINI_API_KEY` yo'q (UI ogohlantirish ko'rsatadi).
   */
  @Post('chat')
  async start(@CurrentUser() user: AuthUser) {
    return { configured: this.ai.configured, greeting: await this.ai.newChat(user.id, WEB_CHAT) };
  }

  /**
   * Kutish matni: savol turiga qarab xorazmcha ibora (ombor, qoldiq, pul; boshqasiga — tasodifiy). UI javob kutilayotgan
   * pufakchada ko'rsatadi — `POST /ai/messages` bilan bir vaqtda so'raladi (AI'ga so'rov ketmaydi, darhol).
   */
  @Post('waiting')
  @HttpCode(200)
  waiting(@Body() dto: AskDto) {
    return { text: waitingText(dto.text) };
  }

  /**
   * Savol → `{ question, greeting, answer }` (`greeting` — kunning birinchi savolida salom, aks holda `null`). Javob bir
   * necha soniya kutiladi.
   */
  @Post('messages')
  async ask(@Body() dto: AskDto, @CurrentUser() user: AuthUser) {
    const { question, greeting, answer } = await this.ai.ask(user, WEB_CHAT, dto.text);
    return { question, greeting, answer };
  }
}
