/**
 * Bazali testlar muhiti — har bir test faylidan oldin (AppModule import qilinishidan oldin). Ulanish sozlamalari
 * `.env` dan, baza esa alohida: `nyff_test` (ishlab chiqish bazasi `nyff` ga tegilmaydi).
 */
import { config } from 'dotenv';

config({ quiet: true });

process.env.TZ = 'Asia/Tashkent';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'nyff_test';
// fon ishlari (5 daqiqalik qabul muddati) testda qo'lda chaqiriladi — o'tgan sanadagi buyurtmalarga tegmasin
process.env.JOBS = 'off';
process.env.THROTTLE = 'off';
process.env.DEMO = '0';
// kassa socket sharti alohida testda yoqiladi
process.env.ONLINE_REQUIRE_KASSA = '0';
// haqiqiy Gemini va Telegram'ga so'rov ketmasin — AI testlari ularning soxtasini qo'yadi
process.env.GEMINI_API_KEY = '';
process.env.TELEGRAM = 'off';
