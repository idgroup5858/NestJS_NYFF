# New York Fast Food — backend (NestJS_NYFF)

Ko'p filialli fast-food tizimining serveri: kassa, oshxona (oshpaz yordamchisi), TV navbat ekrani, kiosk, mobil ilova
(Android), ombor va admin panel. Web ilova — `C:\BACKEND APPS\ReactJS_NYFF`, API tavsifi — [API.md](API.md), reja va
qarorlar — [PLAN.md](PLAN.md).

Stek: NestJS 11, TypeORM 0.3 + PostgreSQL 18, Socket.IO, JWT, bcrypt. Node 24.

## Ishga tushirish

```bash
npm install
cp .env.example .env     # DB_PASSWORD va boshqalarni to'ldiring
npm run start:dev        # http://localhost:3000/api  (Socket.IO — shu portda)
```

Baza (`DB_NAME`, standart `nyff`) bo'lmasa o'zi yaratiladi, migratsiyalar ishga tushganda bajariladi. `DEMO=1` bo'lsa
bo'sh bazaga demo ma'lumot (frontenddagi bilan bir xil: 2 filial, menyu, ombor, 30 kunlik savdo tarixi, bugungi
buyurtmalar) yoziladi.

```bash
npm run seed             # bazani demo holatga qaytarish (hammasi o'chadi!)
npm test                 # toza funksiyalar (bazasiz)
npm run test:db          # bazali testlar — alohida `nyff_test` bazasida
npm run build && npm run start:prod
```

Migratsiya: entity o'zgarganda `npm run migration:generate -- src/database/migrations/<Nom>`, keyin faylni
`src/database/migrations/index.ts` ro'yxatiga qo'shing.

## Demo kirish

| Rol | Filial | Xodim | PIN |
| --- | --- | --- | --- |
| Kassir | Chilonzor | Dilnoza / Sardor | 1234 / 4321 |
| Kassir | Yunusobod | Malika / Jasur | 1234 / 4321 |
| Oshpaz yordamchisi | Chilonzor / Yunusobod | Aziz / Kamola | 1111 |
| Ta'minotchi | — | Bekzod | 5555 |
| Admin | — | Admin | 0000 |

TV va kiosk — PINsiz va kalitsiz: kirish ekranida "Navbat ekrani" / "Kiosk" → filial tanlanadi (`/tv/<branchId>`,
`/kiosk/<branchId>`); API'da filial so'rovda keladi (`GET /api/tv/queue?branchId=`, `POST /api/kiosk/orders`).
Mobil ilova — PINsiz.

## Tuzilma

```
src/
  common/      xato kodlari, enum'lar, turlar, id, pagination
  domain/      toza funksiyalar (frontend mantiqidan): sana, birlik, geometriya, to'lov, ish vaqti, yetkazib berish
  database/    ulanish, migratsiyalar, hisoblagichlar (counters)
  auth/        PIN bilan kirish, JWT, global guard, rollar (`@Roles`, `@Public`), IP bo'yicha urinishlar chegarasi
  branches/    filiallar, omborlar, ish vaqti, yetkazib berish hududi, online holat
  users/       xodimlar
  menu/        kategoriya, taom (retsept, narx, filialda vaqtincha sotilmaydi), ochiq menyu
  warehouse/   ombor mahsulotlari, qoldiq, harakatlar, kirim, ko'chirish
  shifts/      kassir smenalari va tushumi
  orders/      buyurtmalar (kassa, kiosk, TV, mobil), qabul muddati (fon ishi)
  realtime/    Socket.IO: xonalar, "kassa ulanganmi"
  expenses/    kommunal chiqimlar
  reports/     sotuv hisoboti (SQL)
  demo/        demo ma'lumot, `npm run seed`
test/          bazali testlar (`*.db-spec.ts`)
```
