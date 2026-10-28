# NYFF backend — reja va ishlar ro'yxati

> **Holat (2026-10-27):** 0–9 bosqichlar tayyor. Testlar: bazali 89 ta (8 fayl, `npm run test:db`), bazasiz 14 ta
> (`npm test`); `nest build` toza. Web ilova ulangan va headless Chromium'da tekshirilgan: 19 ekran konsol xatosiz;
> jonli oqim — TV kod bilan ulanadi → kassada sotuv → oshxonada socket orqali paydo bo'ladi → "Tayyor" → TV da;
> mobil (GPS) dostavka → kassada «Online» → "Qabul qilish" → telefonda "Tayyorlanmoqda". Keyin (o'sha kuni) TV / kiosk
> qurilma tizimi (ulash kodi, kalit, `devices` jadvali) olib tashlandi — endi ochiq, filial kirish ekranida tanlanadi;
> testlar shu holatda (yuqoridagi sonlar). Hech narsa commit qilinmagan.
> **11 — kuryer (2026-10-27):** rol, `/courier/*`, yetkazish tartibi, `release-courier`, kassaning `GET /orders/delivery`,
> socket xonalari, migratsiya `Courier`. Testlar endi: bazali 99 ta (9 fayl), bazasiz 22 ta. API — `API.md` 12-bo'lim.
> Web: Xodimlar'da kuryer roli, kassada "Dostavka" (kuryer holati, "Kuryerdan olish"), adminda buyurtma tafsilotida.
> Keyin (o'sha kuni): kuryer **login va parol** bilan kiradi (`POST /auth/courier-login`, migratsiya `CourierLogin`),
> ochiq `/auth/staff` da kuryerlar yo'q, kassaga ismlar — `GET /users/couriers`. Testlar: bazali 101 ta, bazasiz 22 ta.
> **Yagona narx (2026-10-29):** taom narxi barcha filiallarda bir xil (`products.price`), filial bo'yicha faqat
> "vaqtincha sotilmaydi" (`products.unavailableBranchIds`); `branch_prices`, `/prices`, `copyPricesFrom` olib tashlandi
> (migratsiya `SingleMenuPrice`). Web: «Narxlar» sahifasi yo'q, Menyu'da har taom ostida filial tugmachalari.
> Testlar: bazali 101 ta, bazasiz 27 ta.
> **Keyingi qadam:** 10 (push, Click, hudud narxi summaga). Android: mijoz — `Kotlin_NYFF`, kuryer — `Kotlin_NYFF_Courier`.
> Yangi ish faqat foydalanuvchi aniq **"boshla"** deganidan keyin boshlanadi. Savollarga javob berish — boshlashga ruxsat emas.
> Har bosqich tugaganda shu fayldagi katakchalarni (`[x]`) va yuqoridagi holatni yangilang.

## 1. Maqsad

`ReactJS_NYFF` (React + localStorage demo) uchun haqiqiy server: hamma ma'lumot PostgreSQL'da, buyruqlar REST, jonli
yangilanish Socket.IO. Web ilova keyin `src/api/index.ts` ni HTTP'ga almashtiradi (sahifalar o'zgarmaydi); Android ilova
(Kotlin + Jetpack Compose, alohida sessiyada) to'g'ridan-to'g'ri shu API'ga ulanadi — hamma hisob serverda.

Asos: frontend `src/domain/types.ts` (jadvallar), `src/domain/logic/*` (qoidalar va xato kodlari), `src/data/*`
(demo), `scripts/logic-smoke.ts` (testlar), `docs/ROADMAP.md` 0–2 bo'limlar (kelishilgan qarorlar).

## 2. Kelishilgan qarorlar

| Mavzu | Qaror |
|---|---|
| Joyi | `C:\BACKEND APPS\NestJS_NYFF` (qo'shni papka: `ReactJS_X` ↔ `NestJS_X`) |
| Port, baza | **3000**; lokal PostgreSQL 18 `localhost:5432`, baza `nyff` (testlar — `nyff_test`); ulanish — NestJS_HR_System `.env` dagidek |
| Vaqt zonasi | `TZ=Asia/Tashkent` — kunlik buyurtma raqami, ish vaqti, hisobot kunlari va soatlari shunga bog'liq; SQL'da `AT TIME ZONE` |
| Stek | NestJS 11 + TypeORM 0.3 (foydalanuvchining boshqa loyihalaridek). NestJS 12 / TypeORM 1.x — yangi major, hozircha o'tilmadi. `@nestjs/schedule` 6 (12-versiya faqat ESM — Jest o'qiy olmaydi) |
| Sxema | Faqat migratsiyalar (`synchronize: false`, `migrationsRun`); migratsiyalar ro'yxati `migrations/index.ts` da (glob emas) |
| ID | Frontenddagidek: prefiks + tasodifiy (`ord_3f2a9c1b7e4d8a05`), demo id'lari (`br_chilonzor`, `burger-classic`) saqlanadi. Tartib raqami ishlatilmaydi |
| Ichki ro'yxatlar | Buyurtma qatorlari, retsept, kirim / ko'chirish qatorlari — `jsonb` (o'zgarmas surat, doim hujjat bilan o'qiladi; shakli frontend bilan bir xil). Qoldiqqa ta'siri — `stock_movements` da; hisobot — `jsonb_array_elements` |
| Raqamlar | Pul — `bigint` (so'm, butun); qoldiq va retsept — asosiy birlikda `int` (g / ml / dona); hujjatlar — odam kiritgan birlikda (kg / l / dona) |
| Tranzaksiyalar | Buyurtma raqami — `INSERT … ON CONFLICT DO UPDATE … RETURNING` (qator qulfi); qoldiq — `qty = qty + delta` upsert; holat o'zgarishi — `SELECT … FOR UPDATE`; ko'chirishda qoldiq qatorlari qulflanadi. Socket xabari — tranzaksiya tugagach |
| PIN | Bazada faqat bcrypt xeshi; 5 marta ketma-ket xato → 5 daqiqa blok (`too_many_attempts`); IP bo'yicha ham chegara (login, blokdan chiqish). Brauzerda faqat token |
| Token | JWT 24 soat; har so'rovda xodim bazadan qayta olinadi (bloklansa / roli o'zgarsa darhol kuchga kiradi); blokdan chiqishda (`/auth/unlock`) yangilanadi |
| Xodim | `cashierId`, `createdBy`, `adminId`, `userId`, `source` so'rov tanasidan o'qilmaydi — tokendan (`source` — endpointdan) |
| Huquqlar | "Tayyor" / "Qaytarish" — filialning oshpaz yordamchisi; kiosk / mobil buyurtmani qabul qilish — filial kassiri (ochiq smenasi bilan); bekor qilish — filial kassiri yoki admin; kirim — ta'minotchi yoki admin, tasdiqlash — admin; ombor bo'limi — ta'minotchi va admin |
| TV / kiosk | PINsiz va kalitsiz, filial kirish ekranida tanlanadi (2026-10-27 qaror; avvalgi ulash kodi olib tashlandi). Ochiq endpointlar, filial so'rovda: `GET /tv/queue?branchId=`, socket `{ tvBranchId }`, `POST /kiosk/orders` (`branchId` tanada, IP bo'yicha 30/daqiqa); filial yo'q / faol emas — `not_found`. TV ga faqat raqam, tur, holat |
| Kiosk | Faqat zalda / olib ketish; to'lov — karta / Click yoki `null` ("kassada to'layman"); naqd yo'q |
| Mobil buyurtma | Dostavka — koordinata (GPS) majburiy, filialni server `routeDelivery` bilan tanlaydi (ilova yuborgani e'tiborga olinmaydi); olib ketish — mijoz tanlagan filial ochiq bo'lishi shart (`branch_closed`). Javobda `trackingToken` — holatni faqat shu bilan ko'rish mumkin. Qabul qilishda to'lov — mijoz tanlagani |
| Online holat | Filial ochiq = faol + admin to'xtatmagan + ish vaqti ichida + smena ochiq + kamida bitta kassa ekrani Socket.IO'ga ulangan (uzilgach 60 s kutiladi; server qayta ishga tushganda ham 60 s). `ONLINE_REQUIRE_KASSA=0` — kassa sharti o'chiq (frontend ulanmaguncha) |
| Ish vaqti | `Branch.workHours: { open, close } \| null` (`HH:MM`, yarim tundan o'tishi mumkin); `null` — 24/7. Faqat online (mobil) buyurtmaga ta'sir qiladi |
| Qabul muddati | Mobil buyurtma 5 daqiqada qabul qilinmasa yoki filial yopilsa (fon ishi, har 30 s): dostavka — boshqa ochiq filialga, yangi raqam bilan (bir marta); olib ketish — bekor; ochiq filial yo'q — bekor. Sababi `cancelReason`: `timeout`, `branch_closed`, `no_branch` |
| Xatolar | `{ statusCode, code, message, detail? }`; kodlar frontend `errors.ts` bilan bir xil + backend'niki (`unauthorized`, `invalid_input`, `too_many_attempts`, `branch_closed`, `location_required`; `pairing_code_invalid` qurilmalar bilan olib tashlandi). DTO faqat shaklni tekshiradi — qoidalar servisda, frontend kodlari bilan |
| Socket.IO | Buyruqlar REST orqali; socket — faqat serverdan `order` xabari. Xonalar: `branch:<id>` (kassir, oshpaz yordamchisi), `tv:<id>` (TV — `{ tvBranchId }`, kalitsiz), `order:<id>` (mobil). Qayta ulanganda ro'yxat REST'dan qayta olinadi. Bir nechta server — keyin Redis adapter |
| Rasmlar | `/images/...` — hozircha web ilovaning `public/images` papkasidan (`IMAGES_DIR`). Admin (2026-10-27): `GET /images` — `products` va `categories` papkalaridagi hamma rasm (qo'lda tashlanganlari ham), `POST /images` — kompyuterdan yuklash (JPG / PNG / WEBP / AVIF, 5 MB gacha, tur fayl boshidan tekshiriladi, nom tozalanadi; xato — `invalid_image`) |
| Taomga izoh yo'q (2026-10-27) | Izoh faqat butun buyurtmaga (`Order.note`). `OrderItem.note` olib tashlandi; qatordagi `note` (eski Android) — `whitelist` jimgina tashlaydi, xato bermaydi. Eski buyurtmalarning `items` jsonb'ida `note` qolgan bo'lishi mumkin — o'qilmaydi. Demo ma'lumotdagi taom izohlari buyurtma izohiga ko'chirildi |
| Demo | `DEMO=1` — bo'sh bazaga demo ma'lumot, admin `POST /api/demo/reset`; haqiqiy ishga tushirishda `DEMO=0`. Tiklashda `settings` (JWT kaliti) tozalanmaydi — tokenlar eskirmasin. Fon ishi yoqiq serverda qabul kutayotgan demo mobil buyurtma 5 daqiqadan keyin zaxira filialga o'tadi, yana 5 daqiqadan keyin bekor bo'ladi (frontend demoda bunday emas edi) |
| HTTP shartnoma | Yaratish — `201`, amal — `200`, tanasiz — `204`; `200` javob tanasi doim obyekt (`GET /shifts/current` → `{ shift }`) — Android'da Retrofit bo'sh tanada yiqilmasin |
| Narx (2026-10-29) | Taom narxi barcha filiallarda bir xil — `products.price` (butun > 0, `invalid_price`). Filial bo'yicha faqat "vaqtincha sotilmaydi" — `products.unavailableBranchIds` (masalan, mahsuloti tugagan; nofaol filial id'lari ham saqlanadi). Yangi filial — hamma taomni sotadi (narx nusxalash yo'q). `GET /menu` shakli o'zgarmagan: `price`, `all=true` da sotilmasa — `null` (Android'ga ta'sir yo'q). Migratsiya `SingleMenuPrice`: narx — birinchi ochilgan filialdagi narx; narxi yo'q / "sotuvda yo'q" filiallar ro'yxatga yoziladi; hech qayerda narxi yo'q taom — `price = 0`, hamma filialda sotilmaydi |
| Mobil buyurtma tekshiruvi | Forma xatolari (bo'sh savat, telefon, manzil) filial tanlashdan oldin; o'tkazishda yangi filial hamma taomni sotishi shart (aks holda `no_branch`), narx / summa o'zgarmaydi; mijozga `routedAt` (qabul kutish vaqti); `POST /mobile/orders` — IP bo'yicha 20/daqiqa |
| Huquq bekor bo'lsa | Xodim bloklansa / roli yoki filiali o'zgarsa — socket darhol uziladi (`Revocations` — faqat xodim voqeasi; qurilma voqealari qurilmalar bilan olib tashlandi) |
| Ombor mahsuloti narxi | `lastPrice` mahsulot oynasida (qo'shish va tahrir) ham kiritiladi — faqat admin (ta'minotchi yuborsa `forbidden`); kirim tasdiqlanganda ham yangilanadi (2026-10-27, web ilova bilan birga) |
| Filial tahriri | `PATCH /branches/:id` da `workHours` yuborilmasa — o'zgarmaydi, `null` — 24/7 |
| Kuryer (2026-10-27) | Rol `courier`, filialsiz; istalgan filialdan mobil dostavka oladi, **bir vaqtda bitta filialdan** (`other_branch`), soni cheklanmagan; "Ishdaman" (`users.onDuty`) yoqilmasa olmaydi. Buyurtma `status` i o'zgarmaydi (`ready`) — bosqichlar alohida: `courierId`, `takenAt`, `departedAt`, `deliveredAt`, `returnedAt` (+ sabab, izoh) — hisobot, smena va TV ga tegilmaydi. Naqd: kuryer kassaga o'zidan to'laydi, mijozdan oladi (hisob o'zgarmaydi). Tartib — server, kuryer o'zgartirmaydi: mijozlar o'rtacha eng kam kutadi (`planRoute`, 12 tagacha aniq DP, keyin eng yaqini), masofa to'g'ri chiziq (bepul). "Yetkazib bo'lmadi" — filialga qaytadi, kassir / admin `release-courier` yoki bekor. Mijozga faqat holat (navbat / kuryer yo'q). Kuryer haqi va joylashuvi — hozircha yo'q. Mobil dostavkada hudud narxi `deliveryFee` da saqlanadi. Kirish — login va parol (admin "Xodimlar" da ochadi), ismlar ro'yxatisiz; kuryer qismi mijoz ilovasi ichida ("NY" ga 10 marta). Dostavka faqat online'dan |
| Frontenddan farqlar | Hisobot: mavjud bo'lmagan sana (`2026-02-30`) — `invalid_input` (frontendga bunday sana kelmagan); `createdAt` bir xil buyurtmalarda "birinchi" — `id` bo'yicha; filiallar tartibi — `createdAt, name`. Tarixdagi mobil buyurtmalarda `online.location: null` |

## 3. Bosqichlar

- [x] **0. Karkas** — NestJS 11, 3000-port, `.env`, `ensureDatabase`, global `ValidationPipe` (`invalid_input`), CORS, `/api/health`, `/images`
- [x] **1. Entity'lar + Init migratsiya** — 17 jadval, FK, qisman unique indekslar (bitta ochiq smena, qurilma kaliti / kodi). Keyin `devices` jadvali `DropDevices` migratsiyasi bilan olib tashlandi — 16 jadval
- [x] **2. Kirish** — PIN (bcrypt, urinishlar chegarasi), JWT, rollar (`@Roles`), qurilmalar (`@DeviceAccess`, `@DeviceOnly`), ulash kodi. Qurilmalar qismi 2026-10-27 da olib tashlandi (`src/devices`, `X-Device-Key`, `/devices/*`) — TV / kiosk ochiq (2-bo'lim)
- [x] **3. Mantiq** — buyurtma (kassa / kiosk / mobil, tasdiqlash, tayyor, qaytarish, bekor qilish + ombor), smena va tushum, ombor (mahsulot, chegara, kirim, ko'chirish), menyu va narxlar, filial (ish vaqti, yetkazib berish, online holat), xodimlar, chiqimlar
- [x] **4. Socket.IO va qabul muddati** — xonalar, "kassa ulanganmi", 5 daqiqalik fon ishi
- [x] **5. Hisobot** — `GET /reports/sales` (frontend `salesReport` bilan bir xil, SQL: bitta suratdan, `GROUPING SETS`), `GET /reports/overview`; frontend algoritmi porti bilan 8 oraliqda aynan solishtirilgan (17 test)
- [x] **6. Demo ma'lumot** — frontend `seed.ts` + `history.ts`, `npm run seed`, `POST /demo/reset`; frontend `createSeedDb` bilan maydonma-maydon solishtirilgan (1434 buyurtma, qoldiqlar, harakatlar — farqsiz)
- [x] **7. Bazali testlar** — `logic-smoke.ts` holatlari (44 test, parallel buyurtma / ko'chirish ham), HTTP (rollar, qurilma kaliti, mobil token, statuslar), socket (xonalar, kassa ulanganmi, huquq bekor bo'lsa uzish). Qurilma kaliti testlari keyin ochiq TV / kiosk (`branchId`, `tvBranchId`) testlariga almashtirildi
- [x] **8. API.md** — Android va web uchun; ko'rib chiqishda topilganlar tuzatildi (pastda)
- [x] **9. Web ilovani ulash** — `src/api/*` (http, kesh `useQuery` + `invalidate`, o'qish hook'lari, buyruqlar, sessiya — token, TV / kiosk kaliti, Socket.IO), localStorage bazasi / demo ma'lumot / brauzerdagi mantiq olib tashlandi; yangi xato kodlari i18n'da; "Qurilmalar" sahifasi va kod kiritish qadami; ish vaqti — Filiallar formasida; mobil prototipda GPS / xarita va kuzatish tokeni. Backend'ga shu uchun: `GET /menu?all=true` (kassa — sotilmaydiganlari `price: null`), `GET /users` ta'minotchiga ham, `GET /orders` filtrlari (to'lov, kassir, raqam) + `summary`, `GET /shifts` oraliq bilan kesishish + `summary`, harakatlarda `refNumber` / `refWarehouseId`, `overview.firstOrderDate`, tayyor UI'ni berish (`UI_DIST`). Keyin TV / kiosk kaliti, "Qurilmalar" sahifasi va kod kiritish qadami olib tashlandi — kirish ekranida "Navbat ekrani" / "Kiosk" → filial → `/tv/<branchId>`, `/kiosk/<branchId>`
- [ ] **10. Keyinroq** — FCM push (mobil ilova yopiq bo'lsa), Click (to'lov va qaytarish), hudud narxi buyurtma summasiga (ROADMAP 2), Redis adapter
- [x] **11. Kuryer** — rol va demo kuryerlar (Bobur 2222, Otabek 3333), `/courier/*` (`CourierService`), `planRoute` /
  `insertionKm` (`src/domain/courier-route.ts`), `POST /orders/:id/release-courier`, `GET /orders?courierId=`,
  `GET /orders/delivery` (kassaning "Dostavka" ro'yxati), socket `couriers` / `courier:<id>`, migratsiya `Courier`
  (`orders` ga kuryer ustunlari va `deliveryFee`, `users.onDuty`), testlar (`courier.db-spec.ts`,
  `courier-route.spec.ts`), API.md 12. Kirish — login va parol: `users.login` (unique, kichik harfda; parol xeshi
  `pinHash` da), `POST /auth/courier-login`, `GET /users/couriers`, migratsiya `CourierLogin` (mavjud kuryerlarga
  login ismidan, parol — eski PIN)
