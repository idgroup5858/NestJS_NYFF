import { readFileSync } from 'node:fs';

/**
 * Ovozli javob (sinov rejimi, 2026-10-29): Gemini TTS WAV (24 kHz, mono, 16-bit PCM) qaytaradi, Telegram ovozli xabari
 * esa faqat OGG/Opus, MP3 yoki M4A — WAV → MP3 shu yerda (`lamejs`, sof JS; serverda ffmpeg shart emas).
 */

interface Mp3Encoder {
  encodeBuffer(samples: Int16Array): Int8Array;
  flush(): Int8Array;
}

type Lame = { Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => Mp3Encoder };

let lame: Lame | null = null;

/**
 * `lamejs` ning `src/` kodida xato bor (`MPEGMode is not defined`), jamlangan `lame.all.js` esa modul emas — o'zini
 * o'zi chaqiradigan funksiya. Fayl o'qilib, shu funksiya qaytariladi (bir marta).
 */
function loadLame(): Lame {
  if (!lame) {
    const code = readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8');
    lame = new Function(`${code}\nreturn lamejs;`)() as Lame;
  }
  return lame;
}

export interface Pcm {
  sampleRate: number;
  /** mono, 16-bit */
  samples: Int16Array;
}

/** Gemini TTS standarti: sarlavhasiz L16 bo'lsa — 24 kHz mono. */
const DEFAULT_RATE = 24_000;

/** WAV (RIFF, 16-bit PCM) yoki sarlavhasiz L16 → mono namunalar (stereo bo'lsa — o'rtachasi). */
export function readPcm(audio: Buffer): Pcm {
  if (audio.subarray(0, 4).toString('latin1') !== 'RIFF') {
    return { sampleRate: DEFAULT_RATE, samples: new Int16Array(audio.buffer, audio.byteOffset, audio.length >> 1) };
  }
  let channels = 1;
  let sampleRate = DEFAULT_RATE;
  let bits = 16;
  for (let pos = 12; pos + 8 <= audio.length; ) {
    const id = audio.subarray(pos, pos + 4).toString('latin1');
    const size = audio.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      channels = audio.readUInt16LE(body + 2);
      sampleRate = audio.readUInt32LE(body + 4);
      bits = audio.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16) throw new Error(`WAV: ${bits}-bit qo'llanmaydi`);
      const end = Math.min(body + size, audio.length);
      const all = new Int16Array(audio.buffer.slice(audio.byteOffset + body, audio.byteOffset + end - ((end - body) % 2)));
      if (channels === 1) return { sampleRate, samples: all };
      const mono = new Int16Array(Math.floor(all.length / channels));
      for (let i = 0; i < mono.length; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += all[i * channels + c];
        mono[i] = Math.round(sum / channels);
      }
      return { sampleRate, samples: mono };
    }
    pos = body + size + (size % 2);
  }
  throw new Error("WAV: 'data' bo'limi topilmadi");
}

/** Mono PCM → MP3 (nutq uchun 48 kbit/s yetarli). */
export function encodeMp3({ sampleRate, samples }: Pcm, kbps = 48): Buffer {
  const encoder = new (loadLame().Mp3Encoder)(1, sampleRate, kbps);
  const parts: Buffer[] = [];
  const push = (chunk: Int8Array) => {
    if (chunk.length > 0) parts.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
  };
  for (let i = 0; i < samples.length; i += 1152) push(encoder.encodeBuffer(samples.subarray(i, i + 1152)));
  push(encoder.flush());
  return Buffer.concat(parts);
}

/** O'qish uchun matn: ro'yxat belgilari («•») ovozda aytilmasin. */
export function forSpeech(text: string): string {
  return text
    .replace(/^\s*•\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Ovozli javobning davomiyligi (soniya) — Telegram'da ko'rsatiladi. */
export const durationOf = ({ sampleRate, samples }: Pcm) => Math.max(1, Math.round(samples.length / sampleRate));
