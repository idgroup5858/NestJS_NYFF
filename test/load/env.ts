/**
 * Yuk testi muhiti — BIRINCHI import bo'lishi shart (`AppModule` baholanishidan oldin): ulanish `.env` dan, baza esa
 * alohida — `nyff_load` (ishlab chiqish bazasi `nyff` va testlar bazasi `nyff_test` ga tegilmaydi).
 */
import { config } from 'dotenv';

config({ quiet: true });

process.env.TZ = 'Asia/Tashkent';
process.env.DB_NAME = process.env.LOAD_DB_NAME || 'nyff_load';
// tarix yozilayotganda (shu jarayonda) fon ishlari, demo, Telegram va AI ishlamasin
process.env.JOBS = 'off';
process.env.DEMO = '0';
process.env.TELEGRAM = 'off';
process.env.GEMINI_API_KEY = '';
