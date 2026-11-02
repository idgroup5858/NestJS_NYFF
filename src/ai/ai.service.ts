import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Content } from '@google/genai';
import { DataSource, MoreThanOrEqual, Not } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { fail } from '../common/errors';
import { newId } from '../common/ids';
import { dateKey, parseDateKey } from '../domain/dates';
import { AiMessage } from './ai-message.entity';
import { systemPrompt } from './ai.prompt';
import { AiTools } from './ai.tools';
import { GeminiClient, type GeminiReply } from './gemini.client';
import { plainText } from './plain-text';
import { GREETING, IDENTITY_ANSWER, rewritePrompt, transcribePrompt } from './xorazm';

/** Admin paneldagi chat. */
export const WEB_CHAT = 'web';
/** Telegram chati — har biri alohida suhbat. */
export const telegramChat = (chatId: string) => `tg:${chatId}`;

/** AI xotirasi: modelga yuboriladigan va bazada qoladigan oxirgi xabarlar (savol + javob; salom hisobga kirmaydi). */
const HISTORY_LIMIT = 20;
/** Bitta savolga tool chaqiruvi bosqichlari — model aylanib qolmasin. */
const MAX_STEPS = 6;
/** Savol uzunligi (Telegram xabari 4096 belgigacha). */
export const MAX_QUESTION = 4000;

const NO_ANSWER = "Javob olinmadi — savolni boshqacha yozib ko'ring.";

export interface AiExchange {
  question: AiMessage;
  /** shu chatda kunning birinchi savoli bo'lsa — javobdan oldingi salom, aks holda `null` */
  greeting: AiMessage | null;
  answer: AiMessage;
}

/**
 * AI yordamchi: savol + suhbat tarixi → Gemini, u so'ragan tool'lar bajariladi (bir nechtasi parallel), natija
 * qaytariladi — model yakuniy matn bermaguncha; keyin javob alohida so'rov bilan Xorazm shevasiga o'giriladi
 * (`xorazm.ts`). Savol va javob faqat muvaffaqiyatli bo'lsa saqlanadi — va faqat AI xotirasi uchun (tarix ko'rsatilmaydi,
 * bazada har chatda oxirgi [HISTORY_LIMIT] ta xabar qoladi).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AI');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gemini: GeminiClient,
    private readonly tools: AiTools,
  ) {}

  get configured(): boolean {
    return this.gemini.configured;
  }

  get model(): string {
    return this.gemini.model;
  }

  /**
   * Yangi suhbat — web chat har ochilganda / "Yangi suhbat", Telegram'da `/new` va start link bilan ulanish: oldingi
   * xabarlar o'chadi (model ularni eslamaydi) va darhol salom (shu kuni keyingi savolda takrorlanmaydi).
   */
  async newChat(userId: string, chat: string, now = new Date()): Promise<AiMessage> {
    const greeting = this.message(userId, chat, 'model', GREETING, now);
    await this.dataSource.transaction(async (em) => {
      await em.delete(AiMessage, { userId, chat });
      await em.insert(AiMessage, greeting);
    });
    return greeting;
  }

  /** Ovozli xabar → matn (adabiy tilda). Bo'sh — nutq tushunarsiz. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    if (!this.gemini.configured) fail('ai_not_configured');
    let text: string;
    try {
      text = await this.gemini.transcribe(transcribePrompt(await this.tools.vocabulary()), audio, mimeType);
    } catch (error) {
      const message = (error as Error).message ?? String(error);
      this.logger.warn(`Gemini (ovoz → matn): ${message}`);
      fail('ai_failed', message.slice(0, 200));
    }
    return plainText(text).replace(/^[«"“]+|[»"”]+$/g, '').trim();
  }

  /**
   * Telegram: kunning birinchi savolida salom darhol — kutish xabari va javobdan oldin (saqlanadi; keyingi [ask] uni
   * takrorlamaydi). Bugun salom bo'lgan bo'lsa — `null`.
   */
  async greetIfDue(userId: string, chat: string, now = new Date()): Promise<AiMessage | null> {
    if (await this.greetedToday(userId, chat, now)) return null;
    const greeting = this.message(userId, chat, 'model', GREETING, now);
    await this.dataSource.manager.insert(AiMessage, greeting);
    return greeting;
  }

  /** Savol → javob (shevada). */
  async ask(user: AuthUser, chat: string, text: string, now = new Date()): Promise<AiExchange> {
    const question = text.trim();
    if (!question || question.length > MAX_QUESTION) fail('invalid_input', 'text');
    if (!this.gemini.configured) fail('ai_not_configured');

    const greeted = await this.greetedToday(user.id, chat, now);
    const history = await this.memory(user.id, chat);
    const contents: Content[] = [
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: question }] },
    ];
    const system = systemPrompt({
      now,
      userName: user.name,
      channel: chat === WEB_CHAT ? 'web' : 'telegram',
      ...(await this.tools.directory()),
    });
    const literary = await this.complete(system, contents);
    const reply = await this.toDialect(literary);

    // tartib `createdAt` bo'yicha: savol → salom → javob
    const exchange: AiExchange = {
      question: this.message(user.id, chat, 'user', question, now),
      greeting: greeted ? null : this.message(user.id, chat, 'model', GREETING, new Date(now.getTime() + 1)),
      answer: this.message(user.id, chat, 'model', reply, new Date(Math.max(Date.now(), now.getTime() + 2))),
    };
    // xotiraga — adabiy javob: model o'z oldingi javoblarini shevada ko'rsa, keyingisini ham shevada yozib yuboradi
    await this.dataSource.manager.insert(
      AiMessage,
      [exchange.question, exchange.greeting, { ...exchange.answer, text: literary }].filter(
        (m): m is AiMessage => m !== null,
      ),
    );
    await this.prune(user.id, chat, now);
    return exchange;
  }

  /**
   * AI xotirasi: shu chatning oxirgi xabarlari, eskisi birinchi. Salom kirmaydi — u suhbatning bir qismi emas, AI uni
   * takrorlab yoki davom ettirib yubormasin.
   */
  private async memory(userId: string, chat: string): Promise<AiMessage[]> {
    const rows = await this.dataSource.manager.find(AiMessage, {
      where: { userId, chat, text: Not(GREETING) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return rows.reverse();
  }

  /**
   * Tarix yig'ilmaydi: bazada faqat AI xotirasi (oxirgi [HISTORY_LIMIT] ta xabar) va bugungi salom ("kuniga bir marta"
   * uchun) qoladi. Telegram yozishmani o'zi saqlaydi, web chat har ochilganda yangidan boshlanadi.
   */
  private async prune(userId: string, chat: string, now: Date): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM ai_messages WHERE "userId" = $1 AND chat = $2 AND (
         (text = $3 AND "createdAt" < $4)
         OR (text <> $3 AND id NOT IN (
           SELECT id FROM ai_messages WHERE "userId" = $1 AND chat = $2 AND text <> $3
           ORDER BY "createdAt" DESC, id DESC LIMIT $5)))`,
      [userId, chat, GREETING, parseDateKey(dateKey(now)), HISTORY_LIMIT],
    );
  }

  /** Salom — har chatda kuniga bir marta: Toshkent vaqti bilan kun boshidan beri salom bo'lganmi. */
  private greetedToday(userId: string, chat: string, now: Date): Promise<boolean> {
    return this.dataSource.manager.exists(AiMessage, {
      where: { userId, chat, text: GREETING, createdAt: MoreThanOrEqual(parseDateKey(dateKey(now))) },
    });
  }

  private message(userId: string, chat: string, role: AiMessage['role'], text: string, createdAt: Date): AiMessage {
    return { id: newId('aim'), userId, chat, role, text, createdAt };
  }

  /**
   * Adabiy javob → Xorazm shevasi (2-so'rov, faqat matn). Bu yerda xato bo'lsa — adabiy javob qaytadi: ma'lumot
   * tayyor, faqat sheva yo'q (savol yo'qolmasin). Kimligi haqidagi jumla o'girilmaydi — u tayyor, javob boshida qoladi
   * (ko'rsatmada eslatilganda model uni so'ralmagan javobga ham qo'shib yuborgan).
   */
  private async toDialect(text: string): Promise<string> {
    if (text === NO_ANSWER) return text;
    const identity = text.includes(IDENTITY_ANSWER);
    const rest = text.replace(IDENTITY_ANSWER, '').trim();
    let converted = rest;
    if (rest) {
      try {
        converted = plainText(await this.gemini.rewrite(rewritePrompt(), rest)) || rest;
      } catch (error) {
        this.logger.warn(`Gemini (sheva): ${(error as Error).message}`);
      }
    }
    return [identity ? IDENTITY_ANSWER : '', converted].filter(Boolean).join('\n');
  }

  private async complete(system: string, contents: Content[]): Promise<string> {
    const tools = this.tools.declarations;
    for (let step = 0; step < MAX_STEPS; step++) {
      let reply: GeminiReply;
      try {
        reply = await this.gemini.generate({ system, contents, tools });
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        this.logger.warn(`Gemini: ${message}`);
        fail('ai_failed', message.slice(0, 200));
      }
      if (reply.functionCalls.length === 0) return plainText(reply.text) || NO_ANSWER;

      // model javobi (thought signature bilan) o'zgarishsiz qaytariladi — Gemini 3 shuni talab qiladi
      contents.push(reply.content ?? { role: 'model', parts: reply.functionCalls.map((call) => ({ functionCall: call })) });
      const parts = await Promise.all(
        reply.functionCalls.map(async (call) => ({
          functionResponse: { id: call.id, name: call.name, response: await this.tools.run(call.name, call.args) },
        })),
      );
      contents.push({ role: 'user', parts });
    }
    fail('ai_failed', `more than ${MAX_STEPS} tool steps`);
  }
}
