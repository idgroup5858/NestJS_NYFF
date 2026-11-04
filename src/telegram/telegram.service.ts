import { HttpException, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Like } from 'typeorm';
import { telegramChat, AiService } from '../ai/ai.service';
import { waitingText } from '../ai/waiting';
import { BOT_COMMANDS, COMMANDS_HELP, parseCommand } from './commands';
import { AuthService, toAuthUser } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { Branch } from '../branches/branch.entity';
import { fail } from '../common/errors';
import { newSecret } from '../common/ids';
import { Setting } from '../database/setting.entity';
import type { FaceIdRequest, FaceIdRequestMessage } from '../faceid/faceid-request.entity';
import { FaceIdService } from '../faceid/faceid.service';
import { ShiftEvents, type ShiftClosed } from '../shifts/shift-events';
import { fullName, User } from '../users/user.entity';
import { LowStockEvents, type LowStockCrossing } from '../warehouse/low-stock-events';
import { faceIdCallback, faceIdOutcomeLine, faceIdRequestText, parseFaceIdCallback } from './faceid-text';
import { loadCrossedLowStock, lowStockAlertText } from './low-stock';
import { loadShiftReport, shiftReportText } from './shift-report';
import { TelegramChat } from './telegram-chat.entity';
import {
  splitMessage,
  TelegramApi,
  TelegramApiError,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
  type TgUser,
  type TgVoice,
} from './telegram.api';

/** `settings` kalitlari: bot tokeni, bot ma'lumoti (JSON) va har adminning start link kodi. */
const TOKEN_KEY = 'telegram_bot_token';
const BOT_KEY = 'telegram_bot';
const LINK_KEY = (userId: string) => `telegram_link:${userId}`;

/** BotFather tokeni: `123456789:AA...`. URL'ga qo'yiladi — boshqa belgilar o'tkazilmaydi. */
const TOKEN_PATTERN = /^\d{5,15}:[A-Za-z0-9_-]{30,50}$/;

export interface BotInfo {
  id: number;
  username: string;
  name: string;
}

export interface TelegramChatView {
  chatId: string;
  userId: string;
  userName: string;
  username: string | null;
  name: string;
  linkedAt: Date;
}

export interface TelegramStatus {
  /** `null` — token kiritilmagan */
  bot: BotInfo | null;
  /** server botni tinglayaptimi (polling) */
  running: boolean;
  /** shu adminning start linki — bosgan Telegram chati unga bog'lanadi */
  link: string | null;
  chats: TelegramChatView[];
}

const TEXT = {
  denied:
    "Bu bot New York Fast Food rahbariyati uchun. Ulanish uchun admin paneldagi «AI → Telegram» bo'limidagi linkni oching.",
  badLink: "Link noto'g'ri yoki yangilangan. Admin paneldagi «AI → Telegram» bo'limidan yangi linkni oching.",
  linked: (name: string) =>
    `Ulandingiz, ${name}! Endi savolingizni yozing, masalan:\n` +
    "• Bugungi tushum qancha?\n• Shu haftada dostavkadan qancha tushdi?\n• Qaysi mahsulotlar kam qoldi?\n" +
    "• Hozir qaysi filiallar ishlayapti?\n\nTez savollar — pastdagi «Menu» tugmasida (/tushum, /qoldiq, /filiallar…). " +
    'Yangi suhbat — /new',
  already: (name: string) => `Siz ${name} sifatida ulangansiz. Savolingizni yozing. Yangi suhbat — /new`,
  notConfigured: "AI sozlanmagan — serverning .env faylida GEMINI_API_KEY yo'q.",
  failed: "Hozir javob bera olmadim — birozdan keyin qayta urinib ko'ring.",
  unlinked: "Bu chat NYFF tizimidan uzildi. Qayta ulanish uchun admin paneldagi linkni oching.",
  /** ovozli xabar uzun (direktor bergan ibora) */
  voiceTooLong: "Og'aaa, shuncha narsani nedan bilaman man, oddiyroq savol so'rivaring…",
  voiceUnclear: "Ovozni tushunolmadim — qaytadan yuboring yoki yozib yuboring.",
  passwordAsk: 'Admin panel uchun yangi parolni yozing (kamida 8 belgi). Bekor qilish — /bekor',
  passwordInvalid: "Parol 8 tadan 64 tagacha belgi bo'lishi kerak — qaytadan yozing. Bekor qilish — /bekor",
  passwordCancelled: "Parol o'zgarmadi.",
  passwordChanged: (email: string | null) =>
    `Parol o'zgartirildi. Admin panelga kirish: ${email ?? 'emailingiz'} va yangi parol.\n` +
    "Xavfsizlik uchun parol yozilgan xabar chatdan o'chirildi.",
};

/** Ovozli savol chegarasi — uzunrog'iga javob yo'q (so'rov va vaqt tejaladi). */
export const VOICE_MAX_SECONDS = 20;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Telegram bot: admin tokenni kiritadi, server botni long polling bilan tinglaydi (webhook ochiq HTTPS manzil talab
 * qiladi — server lokal). Start link (`t.me/<bot>?start=<kod>`) bosilgan chat shu adminga bog'lanadi va AI'dan
 * foydalanadi; boshqa chatlarga rad matni. Har xabarda xodim bazadan olinadi — bloklansa / admin bo'lmasa darhol rad.
 * Smena yopilganda ulangan admin chatlariga hisobot ketadi (filial omborida kam qolganlar bilan), filial omborida
 * mahsulot chegaradan tushsa — darhol ogohlantirish. `TELEGRAM=off` — polling o'chiq (testlar).
 */
@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Telegram');
  private polling: { abort: AbortController; done: Promise<void> } | null = null;
  /** har chat xabarlari navbat bilan — tarix tartibi buzilmasin */
  private readonly queues = new Map<string, Promise<void>>();
  /** `/parol` bosilgan chatlar — keyingi matn yangi parol (AI'ga ketmaydi); server qayta ishga tushsa unutiladi */
  private readonly awaitingPassword = new Set<string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly api: TelegramApi,
    private readonly ai: AiService,
    private readonly auth: AuthService,
    private readonly faceId: FaceIdService,
    shiftEvents: ShiftEvents,
    lowStock: LowStockEvents,
  ) {
    shiftEvents.onClosed((event) => void this.sendShiftReport(event));
    lowStock.onLow((crossings) => void this.sendLowStock(crossings));
  }

  async onApplicationBootstrap(): Promise<void> {
    const token = await this.setting(TOKEN_KEY);
    if (!token || process.env.TELEGRAM === 'off') return;
    // buyruqlar ro'yxati o'zgargan bo'lishi mumkin — har ishga tushishda yangilanadi (kutilmaydi)
    void this.registerCommands(token);
    this.startPolling(token);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stopPolling();
  }

  // ───────────────────────── admin panel ─────────────────────────

  async status(user: AuthUser): Promise<TelegramStatus> {
    const bot = await this.bot();
    const chats = await this.dataSource.manager.find(TelegramChat, { order: { linkedAt: 'ASC' } });
    const users = chats.length
      ? await this.dataSource.manager.find(User, { where: { id: In(chats.map((c) => c.userId)) } })
      : [];
    const userName = new Map(users.map((u) => [u.id, fullName(u)]));
    return {
      bot,
      running: this.polling !== null,
      link: bot ? `https://t.me/${bot.username}?start=${await this.linkCode(user.id)}` : null,
      chats: chats.map((c) => ({
        chatId: c.chatId,
        userId: c.userId,
        userName: userName.get(c.userId) ?? c.userId,
        username: c.username,
        name: c.name,
        linkedAt: c.linkedAt,
      })),
    };
  }

  /** Token tekshiriladi (`getMe`) va saqlanadi, bot qayta ishga tushadi. Boshqa bot bo'lsa — eski chatlar o'chadi. */
  async connect(token: string, user: AuthUser): Promise<TelegramStatus> {
    const clean = token.trim();
    if (!TOKEN_PATTERN.test(clean)) fail('telegram_token_invalid');
    let me: TgUser;
    try {
      me = await this.api.call<TgUser>(clean, 'getMe');
    } catch (error) {
      if (error instanceof TelegramApiError && error.status >= 400 && error.status < 500) fail('telegram_token_invalid');
      this.logger.warn(`getMe: ${(error as Error).message}`);
      fail('telegram_unreachable');
    }
    const bot: BotInfo = { id: me.id, username: me.username ?? '', name: me.first_name };
    const previous = await this.bot();
    await this.dataSource.transaction(async (em) => {
      if (previous && previous.id !== bot.id) await this.forgetChats(em);
      await em.upsert(Setting, [{ key: TOKEN_KEY, value: clean }, { key: BOT_KEY, value: JSON.stringify(bot) }], ['key']);
    });
    await this.registerCommands(clean);
    await this.stopPolling();
    this.startPolling(clean);
    return this.status(user);
  }

  /** Botni o'chirish: token, ulangan chatlar va start linklar o'chadi. */
  async disconnect(): Promise<void> {
    await this.stopPolling();
    await this.dataSource.transaction(async (em) => {
      await em.delete(Setting, { key: In([TOKEN_KEY, BOT_KEY]) });
      await this.forgetChats(em);
    });
  }

  /** Yangi start link — eskisi ishlamay qoladi, ulangan chatlar qoladi. */
  async regenerateLink(user: AuthUser): Promise<TelegramStatus> {
    if (!(await this.bot())) fail('telegram_not_connected');
    await this.dataSource.manager.upsert(Setting, { key: LINK_KEY(user.id), value: newSecret(16) }, ['key']);
    return this.status(user);
  }

  /** Chatni uzish — u endi javob olmaydi (xabar yuboriladi, yetmasa ham uziladi). */
  async unlink(chatId: string): Promise<void> {
    const result = await this.dataSource.manager.delete(TelegramChat, { chatId });
    if (!result.affected) fail('not_found', `telegram chat ${chatId}`);
    const token = await this.setting(TOKEN_KEY);
    if (token) await this.send(token, chatId, TEXT.unlinked);
  }

  // ───────────────────────── smena hisoboti ─────────────────────────

  /**
   * Smena yopildi (kassir yoki admin) — hisobot ulangan hamma admin chatlariga. Smenani yopish bunga kutmaydi: bot
   * ulanmagan, Telegram javob bermasa ham smena yopilaveradi (xato logga).
   */
  private async sendShiftReport({ shiftId, closedBy }: ShiftClosed): Promise<void> {
    try {
      const targets = await this.adminTargets();
      if (!targets) return;
      const text = shiftReportText(await loadShiftReport(this.dataSource.manager, shiftId, closedBy));
      for (const chatId of targets.chatIds) await this.send(targets.token, chatId, text);
    } catch (error) {
      this.logger.error(`Smena hisoboti ${shiftId}: ${(error as Error).message}`);
    }
  }

  // ───────────────────────── kam qoldi ─────────────────────────

  /**
   * Filial omborida mahsulot chegaradan pastga tushdi (sotuv, ko'chirish, offline sync — tranzaksiya tugagach) — darhol
   * ulangan admin chatlariga, har filialga bitta xabar. Markaziy ombor — yo'q. Sotuv botni kutmaydi; bot ulanmagan /
   * Telegram javob bermasa — faqat log.
   */
  private async sendLowStock(crossings: LowStockCrossing[]): Promise<void> {
    try {
      const targets = await this.adminTargets();
      if (!targets) return;
      for (const group of await loadCrossedLowStock(this.dataSource.manager, crossings)) {
        const text = lowStockAlertText(group);
        for (const chatId of targets.chatIds) await this.send(targets.token, chatId, text);
      }
    } catch (error) {
      this.logger.error(`Kam qoldi xabari: ${(error as Error).message}`);
    }
  }

  // ───────────────────────── admin chatlariga (zaxira nusxa) ─────────────────────────

  /** Bot ulangan va kamida bitta admin chati bor — yuborishga arziydi. */
  async hasAdminChats(): Promise<boolean> {
    return (await this.adminTargets()) !== null;
  }

  /** Matn ulangan hamma admin chatlariga (bot ulanmagan bo'lsa — hech narsa). */
  async notifyAdmins(text: string): Promise<void> {
    const targets = await this.adminTargets();
    if (!targets) return;
    for (const chatId of targets.chatIds) await this.send(targets.token, chatId, text);
  }

  /**
   * Fayllar (masalan zaxira nusxa bo'laklari) ulangan hamma admin chatlariga, tartib bilan; har biri `read()` bilan
   * yuborishdan oldin o'qiladi (xotirada bittadan). Natija — hammasini olgan chatlar soni: bitta chat xato bersa (botni
   * bloklagan), qolganlariga baribir ketadi.
   */
  async sendDocuments(documents: { filename: string; caption: string; read: () => Promise<Buffer> }[]): Promise<number> {
    const targets = await this.adminTargets();
    if (!targets) return 0;
    let delivered = 0;
    for (const chatId of targets.chatIds) {
      try {
        for (const document of documents) {
          await this.api.upload(
            targets.token,
            'sendDocument',
            { chat_id: chatId, caption: document.caption },
            {
              field: 'document',
              filename: document.filename,
              contentType: 'application/octet-stream',
              data: await document.read(),
            },
          );
        }
        delivered++;
      } catch (error) {
        this.logger.warn(`sendDocument ${chatId}: ${(error as Error).message}`);
      }
    }
    return delivered;
  }

  // ───────────────────────── FaceID ruxsati ─────────────────────────

  /**
   * Kassir terminaldan o'tolmadi — ulangan hamma admin chatlariga so'rov "Ruxsat berish" / "Rad etish" tugmalari bilan.
   * Natija — yetib borgan xabarlar (qaror qilingach tahrirlanadi); bo'sh — hech biriga yetmadi (bot yo'q / javob yo'q).
   */
  async sendFaceIdRequest(request: FaceIdRequest): Promise<FaceIdRequestMessage[]> {
    const targets = await this.adminTargets();
    if (!targets) return [];
    const text = faceIdRequestText(await this.faceIdInfo(request));
    const reply_markup = {
      inline_keyboard: [
        [
          { text: '✅ Ruxsat berish', callback_data: faceIdCallback(request.id, true) },
          { text: '❌ Rad etish', callback_data: faceIdCallback(request.id, false) },
        ],
      ],
    };
    const messages: FaceIdRequestMessage[] = [];
    for (const chatId of targets.chatIds) {
      try {
        const sent = await this.api.call<TgMessage>(targets.token, 'sendMessage', { chat_id: chatId, text, reply_markup });
        if (typeof sent?.message_id === 'number') messages.push({ chatId, messageId: sent.message_id });
      } catch (error) {
        this.logger.warn(`FaceID so'rovi ${chatId}: ${(error as Error).message}`);
      }
    }
    return messages;
  }

  /**
   * Admin tugmani bosdi: chat faol adminniki bo'lsa — qaror (birinchisi amal qiladi); so'rov xabari hamma chatlarda
   * natija bilan tahrirlanadi (tugmalar olib tashlanadi), bosgan adminga qisqa javob.
   */
  private async handleCallback(token: string, query: TgCallbackQuery): Promise<void> {
    const answer = (text?: string) =>
      this.api.call(token, 'answerCallbackQuery', { callback_query_id: query.id, ...(text && { text }) }).catch(() => {});
    const parsed = parseFaceIdCallback(query.data);
    if (!parsed) return void (await answer());
    const admin = await this.chatUser(String(query.message?.chat.id ?? query.from.id));
    if (!admin) return void (await answer(TEXT.denied));

    const result = await this.faceId.decide(parsed.requestId, parsed.approve, admin.id);
    if (!result) return void (await answer("So'rov topilmadi"));
    const { request, outcome } = result;
    await answer(
      outcome === 'expired'
        ? "So'rov muddati o'tgan"
        : outcome === 'already'
          ? 'Allaqachon hal qilingan'
          : request.status === 'approved'
            ? 'Ruxsat berildi'
            : 'Rad etildi',
    );

    const decider = request.decidedBy ? await this.dataSource.manager.findOneBy(User, { id: request.decidedBy }) : null;
    const line = faceIdOutcomeLine(
      outcome === 'expired' ? 'expired' : request.status === 'approved' ? 'approved' : 'rejected',
      decider ? fullName(decider) : null,
      request.decidedAt,
    );
    const text = `${faceIdRequestText(await this.faceIdInfo(request))}\n\n${line}`;
    for (const { chatId, messageId } of request.messages) {
      // tugmalarsiz (reply_markup berilmasa — olib tashlanadi); "o'zgarmadi" / o'chirilgan xabar — e'tiborsiz
      await this.api.call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text }).catch(() => {});
    }
  }

  private async faceIdInfo(request: FaceIdRequest) {
    const em = this.dataSource.manager;
    const [branch, cashier] = await Promise.all([
      em.findOneBy(Branch, { id: request.branchId }),
      em.findOneBy(User, { id: request.userId }),
    ]);
    return {
      branchName: branch?.name ?? request.branchId,
      cashierName: cashier ? fullName(cashier) : request.userId,
      action: request.action,
      createdAt: request.createdAt,
    };
  }

  /** Bot tokeni va ulangan chatlar — xodimi faol admin bo'lganlari; bot yoki shunday chat yo'q — `null`. */
  private async adminTargets(): Promise<{ token: string; chatIds: string[] } | null> {
    const token = await this.setting(TOKEN_KEY);
    if (!token) return null;
    const em = this.dataSource.manager;
    const chats = await em.find(TelegramChat, { order: { linkedAt: 'ASC' } });
    const users = chats.length ? await em.find(User, { where: { id: In(chats.map((c) => c.userId)) } }) : [];
    const admins = new Set(users.filter((u) => u.active && u.role === 'admin').map((u) => u.id));
    const chatIds = chats.filter((c) => admins.has(c.userId)).map((c) => c.chatId);
    return chatIds.length ? { token, chatIds } : null;
  }

  // ───────────────────────── xabarlar ─────────────────────────

  /** Bitta Telegram xabari — matn, ovoz yoki tugma bosilishi (polling va testlar shu yerdan). */
  async handleUpdate(token: string, update: TgUpdate): Promise<void> {
    if (update.callback_query) return this.handleCallback(token, update.callback_query);
    const message = update.message;
    if (!message || message.chat.type !== 'private' || (!message.text && !message.voice)) return;
    const chatId = String(message.chat.id);
    const text = message.text?.trim() ?? '';

    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start) return this.start(token, message, start[1]);

    const user = await this.chatUser(chatId);
    if (!user) {
      this.awaitingPassword.delete(chatId);
      return this.send(token, chatId, TEXT.denied);
    }

    // `/parol` dan keyingi matn — yangi parol (AI'ga ham, xotiraga ham ketmaydi); buyruq yoki ovoz — bekor qiladi
    const command = parseCommand(text);
    if (this.awaitingPassword.has(chatId)) {
      if (message.text && !text.startsWith('/')) return this.resetPassword(token, message, user);
      this.awaitingPassword.delete(chatId);
      if (command === 'bekor') return this.send(token, chatId, TEXT.passwordCancelled);
    }
    if (message.voice) return this.handleVoice(token, chatId, user, message.voice);

    // "Menu" buyrug'i — tayyor savol; noma'lum buyruq — ro'yxat
    if (command === 'parol') {
      this.awaitingPassword.add(chatId);
      return this.send(token, chatId, TEXT.passwordAsk);
    }
    if (command === 'new') {
      const greeting = await this.ai.newChat(user.id, telegramChat(chatId));
      return this.send(token, chatId, greeting.text);
    }
    let question = text;
    if (command) {
      const known = BOT_COMMANDS.find((c) => c.command === command);
      if (!known?.question) return this.send(token, chatId, COMMANDS_HELP);
      question = known.question;
    }
    await this.answer(token, chatId, user, question);
  }

  /**
   * Favqulodda parol tiklash: chat shu adminga bog'langan — joriy parol, kod, vaqt yoki urinishlar so'ralmaydi.
   * Yaroqsiz bo'lsa qayta so'raladi; o'rnatilgach parol yozilgan xabar chatdan o'chiriladi (o'chmasa ham parol o'rnatilgan).
   */
  private async resetPassword(token: string, message: TgMessage, user: AuthUser): Promise<void> {
    const chatId = String(message.chat.id);
    try {
      await this.auth.setPassword(user.id, message.text ?? '');
    } catch (error) {
      const code = error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
      if (code === 'invalid_password') return this.send(token, chatId, TEXT.passwordInvalid);
      throw error;
    }
    this.awaitingPassword.delete(chatId);
    this.logger.log(`Admin ${user.id} paroli Telegram orqali tiklandi`);
    await this.api.call(token, 'deleteMessage', { chat_id: chatId, message_id: message.message_id }).catch(() => {});
    await this.send(token, chatId, TEXT.passwordChanged(user.email));
  }

  /**
   * Ovozli savol: 20 soniyadan uzun — javob yo'q (ibora); aks holda matnga o'giriladi (direktorga ko'rsatilmaydi),
   * javob — matn bilan.
   */
  private async handleVoice(token: string, chatId: string, user: AuthUser, voice: TgVoice): Promise<void> {
    const greeting = await this.ai.greetIfDue(user.id, telegramChat(chatId));
    if (greeting) await this.send(token, chatId, greeting.text);
    if (voice.duration > VOICE_MAX_SECONDS) return this.send(token, chatId, TEXT.voiceTooLong);

    let heard: string;
    try {
      heard = await this.typingWhile(token, chatId, async () =>
        this.ai.transcribe(await this.api.download(token, voice.file_id), voice.mime_type ?? 'audio/ogg'),
      );
    } catch (error) {
      return this.send(token, chatId, this.failText(error));
    }
    // direktorga ko'rsatilmaydi — logda (noto'g'ri eshitilgan so'zni topish uchun)
    this.logger.log(`Ovoz (${voice.duration} s) → «${heard}»`);
    if (!heard) return this.send(token, chatId, TEXT.voiceUnclear);
    await this.answer(token, chatId, user, heard);
  }

  /**
   * Savolga javob: darhol salom (kunning birinchi savolida) va savolga qarab kutish xabari (chatda qoladi), keyin AI
   * javobi.
   */
  private async answer(token: string, chatId: string, user: AuthUser, question: string): Promise<void> {
    const greeting = await this.ai.greetIfDue(user.id, telegramChat(chatId));
    if (greeting) await this.send(token, chatId, greeting.text);
    await this.send(token, chatId, waitingText(question));

    let reply: string;
    try {
      const result = await this.typingWhile(token, chatId, () => this.ai.ask(user, telegramChat(chatId), question));
      reply = result.answer.text;
    } catch (error) {
      return this.send(token, chatId, this.failText(error));
    }
    await this.send(token, chatId, reply);
  }

  /** Uzoq ish paytida "yozmoqda…" (Telegram uni 5 soniyada o'chiradi — qayta yuboriladi). */
  private async typingWhile<T>(token: string, chatId: string, work: () => Promise<T>): Promise<T> {
    const show = () => void this.api.call(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    show();
    const timer = setInterval(show, 4500);
    try {
      return await work();
    } finally {
      clearInterval(timer);
    }
  }

  private failText(error: unknown): string {
    const code = error instanceof HttpException ? (error.getResponse() as { code?: string }).code : undefined;
    if (!code) this.logger.error(`AI: ${(error as Error).message}`);
    return code === 'ai_not_configured' ? TEXT.notConfigured : TEXT.failed;
  }

  /** `/start <kod>` — chat kod egasi bo'lgan adminga bog'lanadi. Kodsiz — ulangan bo'lsa salom, aks holda rad. */
  private async start(token: string, message: TgMessage, code: string | undefined): Promise<void> {
    const chatId = String(message.chat.id);
    if (!code) {
      const user = await this.chatUser(chatId);
      return this.send(token, chatId, user ? TEXT.already(fullName(user)) : TEXT.denied);
    }
    const em = this.dataSource.manager;
    const owner = await em.findOne(Setting, { where: { key: Like(`${LINK_KEY('')}%`), value: code } });
    const user = owner && (await em.findOneBy(User, { id: owner.key.slice(LINK_KEY('').length) }));
    if (!user || !user.active || user.role !== 'admin') return this.send(token, chatId, TEXT.badLink);

    const from = message.from;
    await em.upsert(
      TelegramChat,
      {
        chatId,
        userId: user.id,
        username: from?.username ?? null,
        name: [from?.first_name, from?.last_name].filter(Boolean).join(' ').slice(0, 128),
        linkedAt: new Date(),
      },
      ['chatId'],
    );
    // ulanish — yangi suhbat: salom, keyin qanday so'rash mumkinligi
    const greeting = await this.ai.newChat(user.id, telegramChat(chatId));
    await this.send(token, chatId, greeting.text);
    await this.send(token, chatId, TEXT.linked(fullName(user)));
  }

  /** "Menu" tugmasidagi buyruqlar — Telegram'ga (xato bo'lsa bot baribir ishlaydi, faqat menyu yangilanmaydi). */
  private async registerCommands(token: string): Promise<void> {
    const commands = BOT_COMMANDS.map(({ command, description }) => ({ command, description }));
    try {
      await this.api.call(token, 'setMyCommands', { commands });
    } catch (error) {
      this.logger.warn(`setMyCommands: ${(error as Error).message}`);
    }
  }

  /** Chat egasi — faqat faol admin (bloklansa yoki roli o'zgarsa bot darhol javob bermaydi). */
  private async chatUser(chatId: string): Promise<AuthUser | null> {
    const chat = await this.dataSource.manager.findOneBy(TelegramChat, { chatId });
    const user = chat && (await this.dataSource.manager.findOneBy(User, { id: chat.userId }));
    return user && user.active && user.role === 'admin' ? toAuthUser(user) : null;
  }

  private async send(token: string, chatId: string, text: string): Promise<void> {
    try {
      for (const chunk of splitMessage(text)) await this.api.call(token, 'sendMessage', { chat_id: chatId, text: chunk });
    } catch (error) {
      // masalan foydalanuvchi botni bloklagan (403)
      this.logger.warn(`sendMessage ${chatId}: ${(error as Error).message}`);
    }
  }

  // ───────────────────────── polling ─────────────────────────

  private startPolling(token: string): void {
    if (process.env.TELEGRAM === 'off') return;
    const abort = new AbortController();
    const polling = { abort, done: Promise.resolve() };
    polling.done = this.poll(token, abort.signal).finally(() => {
      if (this.polling === polling) this.polling = null;
    });
    this.polling = polling;
  }

  private async stopPolling(): Promise<void> {
    const polling = this.polling;
    this.polling = null;
    if (!polling) return;
    polling.abort.abort();
    await polling.done;
  }

  private async poll(token: string, signal: AbortSignal): Promise<void> {
    // avval webhook o'rnatilgan bo'lsa getUpdates 409 beradi
    await this.api.call(token, 'deleteWebhook', {}, signal).catch(() => {});
    this.logger.log('Bot ishga tushdi (long polling)');
    let offset = 0;
    let failures = 0;
    while (!signal.aborted) {
      try {
        const updates = await this.api.call<TgUpdate[]>(
          token,
          'getUpdates',
          { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
          signal,
        );
        failures = 0;
        for (const update of updates) {
          offset = update.update_id + 1;
          this.enqueue(token, update);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof TelegramApiError && error.status === 401) {
          this.logger.error("Bot tokeni yaroqsiz (o'chirilgan yoki almashtirilgan) — bot to'xtadi");
          break;
        }
        failures++;
        const conflict = error instanceof TelegramApiError && error.status === 409;
        this.logger.warn(
          conflict
            ? 'Shu bot boshqa joyda ham ishga tushirilgan (409) — kutilmoqda'
            : `getUpdates: ${(error as Error).message}`,
        );
        await sleep(Math.min(failures * 5, 60) * 1000, signal);
      }
    }
  }

  private enqueue(token: string, update: TgUpdate): void {
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? update.callback_query?.from.id;
    if (chatId === undefined) return;
    const key = String(chatId);
    const next = (this.queues.get(key) ?? Promise.resolve())
      .then(() => this.handleUpdate(token, update))
      .catch((error: Error) => this.logger.error(`update ${update.update_id}: ${error.message}`))
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      });
    this.queues.set(key, next);
  }

  // ───────────────────────── sozlamalar ─────────────────────────

  private async setting(key: string): Promise<string | null> {
    return (await this.dataSource.manager.findOneBy(Setting, { key }))?.value ?? null;
  }

  private async bot(): Promise<BotInfo | null> {
    const value = await this.setting(BOT_KEY);
    return value ? (JSON.parse(value) as BotInfo) : null;
  }

  /** Adminning start link kodi — birinchi so'ralganda yaratiladi (muddatsiz; bir vaqtdagi ikki so'rov — bitta kod). */
  private async linkCode(userId: string): Promise<string> {
    const key = LINK_KEY(userId);
    const existing = await this.setting(key);
    if (existing) return existing;
    await this.dataSource.manager
      .createQueryBuilder()
      .insert()
      .into(Setting)
      .values({ key, value: newSecret(16) })
      .orIgnore()
      .execute();
    return (await this.setting(key))!;
  }

  private async forgetChats(em: EntityManager): Promise<void> {
    await em.createQueryBuilder().delete().from(TelegramChat).execute();
    await em.delete(Setting, { key: Like(`${LINK_KEY('')}%`) });
  }
}
