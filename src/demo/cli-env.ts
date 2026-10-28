/**
 * CLI buyruqlari muhiti — BIRINCHI import bo'lishi shart: `AppModule` baholanishidan oldin `.env` yuklanadi va fon
 * ishlari o'chiriladi (`JOBS` modul import qilinayotganda o'qiladi).
 */
import { config } from 'dotenv';

config({ quiet: true });

// 5 daqiqalik qabul muddati kabi fon ishlari seed paytida ishlamasin
process.env.JOBS = 'off';
// seed o'zi tiklaydi — bo'sh bazada ilova ishga tushishidagi avtomatik demo yozish ikkinchi marta ishlamasin
process.env.DEMO = '0';
