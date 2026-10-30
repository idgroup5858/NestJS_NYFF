import { Injectable } from '@nestjs/common';
import {
  ApiError,
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from '@google/genai';

export interface GeminiRequest {
  system: string;
  contents: Content[];
  tools: FunctionDeclaration[];
}

export interface GeminiReply {
  /** model javobi to'liq (thought signature bilan) — tool natijasidan oldin tarixga shu qo'shiladi */
  content: Content | undefined;
  functionCalls: FunctionCall[];
  /** tool chaqiruvi bo'lmasa — matn */
  text: string;
}

/** Bitta so'rov chegarasi: Gemini osilib qolsa chat ham, bot ham kutib qolmasin. */
const REQUEST_TIMEOUT_MS = 60_000;

/** Google tomonidagi vaqtinchalik xato ("model hozir band" — 503, ichki — 500): bir marta qayta uriniladi. */
const RETRY_STATUSES = new Set([500, 503]);
const RETRY_DELAY_MS = 1500;

/**
 * Gemini API (`@google/genai`). Kalit va model — `.env` (`GEMINI_API_KEY`, `GEMINI_MODEL`); kalit bo'lmasa
 * `configured = false`. Testlarda shu klass soxtasi bilan almashtiriladi — haqiqiy so'rov ketmaydi.
 */
@Injectable()
export class GeminiClient {
  readonly model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  /** ovozli javob (o'zbekcha — "Northern Uzbek") */
  readonly ttsModel = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
  /** asosiy TTS modelining limiti tugasa (429) — shu model (bepul tarifda har modelga alohida kuniga 10 ta) */
  readonly ttsFallbackModel = process.env.GEMINI_TTS_FALLBACK_MODEL || 'gemini-3.8-flash-tts';
  readonly ttsVoice = process.env.GEMINI_TTS_VOICE || 'Kore';
  private readonly ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

  get configured(): boolean {
    return this.ai !== null;
  }

  async generate(request: GeminiRequest): Promise<GeminiReply> {
    const response = await this.call({
      model: this.model,
      contents: request.contents,
      config: {
        systemInstruction: request.system,
        tools: [{ functionDeclarations: request.tools }],
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      },
    });
    const functionCalls = response.functionCalls ?? [];
    return {
      content: response.candidates?.[0]?.content,
      functionCalls,
      // tool chaqiruvi bor javobda `.text` ogohlantirish yozadi — o'qilmaydi
      text: functionCalls.length > 0 ? '' : (response.text ?? ''),
    };
  }

  /** Matnni ko'rsatma bo'yicha qayta yozish (tool'siz, tarixsiz) — javobni shevaga o'girish uchun. */
  async rewrite(system: string, text: string): Promise<string> {
    const response = await this.call({
      model: this.model,
      contents: [{ role: 'user', parts: [{ text }] }],
      config: { systemInstruction: system, httpOptions: { timeout: REQUEST_TIMEOUT_MS } },
    });
    return response.text ?? '';
  }

  /** Ovozli xabar → matn (asosiy model audio qabul qiladi). */
  async transcribe(system: string, audio: Buffer, mimeType: string): Promise<string> {
    const response = await this.call({
      model: this.model,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType, data: audio.toString('base64') } }, { text: 'Transcribe this voice message.' }],
        },
      ],
      config: { systemInstruction: system, httpOptions: { timeout: REQUEST_TIMEOUT_MS } },
    });
    return response.text ?? '';
  }

  /**
   * Matn → ovoz (TTS): WAV (24 kHz, mono, 16-bit PCM) yoki sarlavhasiz L16. Asosiy modelning limiti tugasa (429) —
   * zaxira model; u ham tugasa — xato (javob matn bilan ketadi).
   */
  async speak(text: string): Promise<{ data: Buffer; mimeType: string }> {
    const request = (model: string) =>
      this.call({
        model,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.ttsVoice } } },
          httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        },
      });
    let response: GenerateContentResponse;
    try {
      response = await request(this.ttsModel);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 429 || this.ttsFallbackModel === this.ttsModel) throw error;
      response = await request(this.ttsFallbackModel);
    }
    const audio = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new Error("TTS: javobda audio yo'q");
    return { data: Buffer.from(audio.data, 'base64'), mimeType: audio.mimeType ?? 'audio/wav' };
  }

  private async call(params: GenerateContentParameters): Promise<GenerateContentResponse> {
    if (!this.ai) throw new Error("GEMINI_API_KEY yo'q");
    try {
      return await this.ai.models.generateContent(params);
    } catch (error) {
      if (!(error instanceof ApiError) || !RETRY_STATUSES.has(error.status)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return this.ai.models.generateContent(params);
    }
  }
}
