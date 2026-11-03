# NYFF backend — API ma'lumotnomasi

NestJS 11 · PostgreSQL · Socket.IO 4. Kod bilan tekshirilgan holat: **2026-11-03**. API o'zgarsa — shu fayl ham
yangilanadi (`CLAUDE.md`).

Kimlar uchun: **Android ilova** (Kotlin + Jetpack Compose — mijoz ilovasi, [5-bo'lim](#5-mobil-ilova-oqimi-android)),
**kuryer ilovasi** (Android, [12-bo'lim](#12-kuryer-ilovasi-android)) va **web ilova** (`ReactJS_NYFF` — kassa, oshxona,
TV, kiosk, ombor, admin; [9-bo'lim](#9-web-ilovani-ulash)).

## Mundarija

1. [Server](#1-server)
2. [Kelishuvlar](#2-kelishuvlar)
3. [Xatolar](#3-xatolar)
4. [Kirish va huquqlar](#4-kirish-va-huquqlar)
5. [Mobil ilova oqimi (Android)](#5-mobil-ilova-oqimi-android)
6. [Ma'lumot turlari](#6-malumot-turlari)
7. [Endpointlar](#7-endpointlar)
8. [Socket.IO](#8-socketio)
9. [Web ilovani ulash](#9-web-ilovani-ulash)
10. [Yangi baza (birinchi ishga tushirish)](#10-yangi-baza-birinchi-ishga-tushirish)
11. [Cheklovlar va noaniq joylar](#11-cheklovlar-va-noaniq-joylar)
12. [Kuryer ilovasi (Android)](#12-kuryer-ilovasi-android)
13. [AI yordamchi va Telegram bot](#13-ai-yordamchi-va-telegram-bot)
14. [Offline kassa (internet yo'q paytda)](#14-offline-kassa-internet-yoq-paytda)

---

## 1. Server

| | |
|---|---|
| REST | `http://<server>:3000/api/...` (global prefiks `api`) |
| Rasmlar | `http://<server>:3000/images/...` — prefikssiz. Menyudagi `image` / `icon` — `/images/...` bilan boshlanadigan yo'l yoki bo'sh satr; to'liq URL = `http://<server>:3000` + yo'l. Taom va kategoriya rasmlari (`/images/products/...`, `/images/categories/...`) — backendning `uploads` papkasidan (`IMAGES_DIR`, server ishga tushganda yo'q bo'lsa yaratiladi). Kategoriya ikonkalari (`/images/icons/...`) — web ilovaning o'zida: server tayyor web ilovani bersa (`UI_DIST`) — shu manzildan (web `/shorva/` ga ko'chgach ham ildizda), aks holda yo'q (404). Admin ro'yxati va yuklash — `GET` / `POST /api/images` ([7.3](#73-menyu)) |
| Socket.IO | shu port, standart yo'l `/socket.io`, standart namespace `/` (`api` prefiksi socket'ga tegishli emas) |
| Web sahifalar (2026-11-03) | domen ildizi `/` — **alohida sahifa** (`SITE_DIR`, hozircha vaqtinchalik bosh sahifa: logo); xodimlar tizimi (kassa, oshxona, ombor, TV, kiosk, admin) — **`/shorva/...`** (`UI_BASE`; `/shorva` → `/shorva/`). Eski `/kassa`, `/admin` va boshqa ildiz yo'llari — bosh sahifa (yo'naltirilmaydi — xodimlar tizimi manzili oshkor bo'lmasin). `/api`, `/socket.io`, `/images` — ildizda, o'zgarmagan (mobil ilovalar shu bilan) |
| Tinglash | `0.0.0.0` — lokal tarmoqdagi kassa, TV, kiosk va telefonlar ulanadi |
| Tekshirish | `GET /api/health` → `{ "ok": true }` (bazani tekshirmaydi) |

Android emulyatoridan kompyuterdagi server — `http://10.0.2.2:3000`. Server `http` (TLS yo'q) — Android'da cleartext
ruxsati kerak (`android:usesCleartextTraffic="true"` yoki `network_security_config`).

### Sozlamalar (`.env`)

| O'zgaruvchi | Standart | Ma'nosi |
|---|---|---|
| `PORT` | `3000` | |
| `TZ` | `Asia/Tashkent` | kunlik buyurtma raqami, ish vaqti, hisobot kunlari va soatlari shu zonada |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | `localhost` `5432` `postgres` — `nyff` | baza bo'lmasa o'zi yaratiladi, migratsiyalar ishga tushganda bajariladi |
| `JWT_SECRET` | bo'sh | bo'sh bo'lsa birinchi ishga tushishda yaratilib bazada (`settings`) saqlanadi — qayta ishga tushganda tokenlar amal qilaveradi |
| `CORS_ORIGIN` | bo'sh — hammasi | vergul bilan ro'yxat. Socket.IO'da CORS doim ochiq |
| `ONLINE_REQUIRE_KASSA` | `1` | `0` — filial ochiqligi uchun "kassa ekrani ulangan" sharti o'chiq ([8.4](#84-kassa-ulangan-va-filial-online-holati)) |
| `JOBS` | yoqilgan | `off` — fon ishi (mobil buyurtmaning 5 daqiqalik qabul muddati) ishlamaydi |
| `THROTTLE` | yoqilgan | `off` — IP bo'yicha urinishlar chegarasi o'chiq (testlar) |
| `TRUST_PROXY` | `loopback` | proksi (Apache / nginx shu serverda) ortida mijoz IP si `X-Forwarded-For` dan — faqat shu kompyuterdan kelgan so'rovda (3000-portga to'g'ridan-to'g'ri ulangan mijoz IP sini soxtalashtira olmaydi). `off` — o'chiq; son — proksilar soni; boshqa — Express `trust proxy` (IP / tarmoqlar) |
| `IMAGES_DIR` | `uploads` | taom va kategoriya rasmlari papkasi, admin yuklaganlari ham (nisbiy — ishga tushirilgan papkaga nisbatan; git'ga kirmaydi) |
| `UI_DIST` | `../ReactJS_NYFF/dist` | tayyor web ilova (xodimlar tizimi); papka bo'lmasa — faqat API |
| `UI_BASE` | `/shorva` | xodimlar tizimi yo'li; web ilova ham shu bilan build qilinadi (`ReactJS_NYFF`: `UI_BASE=/... npm run build`, standart o'sha `/shorva`) — ikkalasi bir xil bo'lsin |
| `SITE_DIR` | `../ReactJS_NYFF/site` | domen ildizidagi sahifa papkasi (`index.html`, web loyihada — UI fayllari backendda saqlanmaydi); bo'lmasa — ildizda hech narsa (404). Serverda Apache ortida ishlatilmaydi — sahifani Apache `/var/www/newyork24` dan beradi |
| `GEMINI_API_KEY` | bo'sh | Google AI Studio kaliti; bo'sh — AI o'chiq (`ai_not_configured`, [13](#13-ai-yordamchi-va-telegram-bot)) |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Gemini modeli (javob, shevaga o'girish, ovozli savolni matnga o'girish) |
| `TELEGRAM` | yoqilgan | `off` — Telegram bot tinglanmaydi (testlar; token saqlanadi, lekin polling yo'q) |
| `PG_DUMP` | PATH dagi `pg_dump` | oylik zaxira nusxa uchun `pg_dump` yo'li; Windows'da PATH da bo'lmasa `C:\Program Files\PostgreSQL\<eng yangi>\bin\pg_dump.exe` ([13](#13-ai-yordamchi-va-telegram-bot)) |

---

## 2. Kelishuvlar

- **JSON**: so'rov va javob `application/json`, UTF-8.
- **Vaqt** (`createdAt`, `readyAt`, …): ISO-8601 UTC satr, millisoniya bilan — `"2026-10-27T05:12:33.123Z"` (Kotlin:
  `Instant.parse`). So'rovdagi oraliq filtrlari (`from`, `to`) ham ISO-8601.
- **Mahalliy sana** (`Expense.date`, hisobot `from` / `to`): `"YYYY-MM-DD"`, `Asia/Tashkent` bo'yicha.
- **Ish vaqti** (`workHours.open` / `close`): `"HH:MM"`, `Asia/Tashkent` bo'yicha.
- **Pul**: so'm, butun son (bazada `bigint`, JSON'da oddiy son; Kotlin'da `Long`).
- **Ombor miqdorlari**: qoldiq, retsept, chegara (`minQty`) va harakatlar — **asosiy birlikda**, butun son: g / ml /
  dona. Hujjatlar (kirim, ko'chirish qatorlari) va narxlar — **ombor birligida**: kg / l / dona, kasr bo'lishi mumkin
  (`12.5` kg → qoldiqqa `12500` g). Mahsulot birligi `Ingredient.unit`: `kg` → g, `l` → ml, `pcs` → dona.
- **ID**: satr, prefiks + 16 ta hex: `ord_3f2a9c1b7e4d8a05` (`br_`, `usr_`, `cat_`, `prd_`, `ing_`, `pur_`,
  `trf_`, `mov_`, `shf_`, `exp_`, `wh_`). Eski va sinov id'lari boshqacha (`br_chilonzor`, `burger-classic`) — id'ni hech qachon
  tahlil qilmang, faqat solishtiring.
- **Uch tildagi matn** — `LocalizedText = { uz: string, ru: string, en: string }`. `uz` majburiy, `ru` / `en` bo'sh
  satr bo'lishi mumkin — bo'sh bo'lsa `uz` ko'rsating.
- **Sahifalash** (ro'yxatda belgilangan joylarda): `?page=1&limit=50` (`page` ≥ 1, `limit` 1–500; standart `limit` —
  50, harakatlarda 100). Javob: `{ items: T[], total: number, page: number, limit: number }`.
- **`null`**: ixtiyoriy qiymat yo'q bo'lsa javobda `null` keladi (maydonning o'zi tushib qolmaydi).
- **Noma'lum maydonlar** so'rov tanasidan jimgina tashlanadi (xato emas). Shuning uchun `cashierId`, `createdBy`,
  `adminId`, `userId`, `decidedBy`, `source`, `status`, `number`, `total`, qatordagi `price`, kassada `branchId`
  — **yuborilsa ham e'tiborga olinmaydi**: xodim — tokendan, filial — tokendan, narx — bazadan. Kiosk va TV da esa
  filial — so'rovdagi `branchId` (majburiy; shu filialning TV / kiosk kodi bilan).
- **HTTP statuslar** — bitta qoida: yangi yozuv yaratish (`POST /orders`, `/kiosk/orders`, `/mobile/orders`,
  `/purchases`, `/transfers`, `/branches`, `/categories`, `/products`, `/ingredients`, `/users`, `/expenses`) —
  `201`; amal (`login`, `admin-login`, `courier-login`, `unlock`, `confirm` / `ready` / `reopen` / `cancel`, smenani ochish / yopish, kirimni
  tasdiqlash / rad etish) va `GET` / `PATCH` / `PUT` — `200`; tanasiz natija — `204`: `PUT /auth/pin`, `PUT /auth/password`,
  `POST /categories/:id/move`, `POST /products/:id/move`, barcha `DELETE` (`/branches`, `/categories`, `/products`,
  `/ingredients`, `/users`, `/expenses`).
- **Bo'sh tana yo'q**: `200` javobda tana doim JSON obyekt — "yo'q" qiymat ichida keladi: `GET /shifts/current` →
  `{ shift: Shift | null }` (Retrofit / Moshi bo'sh tanada yiqilmasin).

---

## 3. Xatolar

Barcha biznes xatolari bir xil ko'rinishda:

```json
{ "statusCode": 409, "code": "branch_closed", "message": "Filial hozir buyurtma qabul qilmayapti", "detail": "br_chilonzor" }
```

- `code` — UI matnni shu bo'yicha o'z tilida ko'rsatadi (asosiy maydon).
- `message` — o'zbekcha standart matn (loglar, tarjimasiz mijozlar uchun).
- `detail` — ixtiyoriy texnik izoh (qaysi taom, qaysi id, `"287s"`); foydalanuvchiga to'g'ridan-to'g'ri ko'rsatmang.
- `invalid_input` da `detail` — DTO xatolari `; ` bilan: `"items.0.qty: qty must be a number conforming to the
  specified constraints"`.

NestJS / Express'ning o'z xatolari **`code` maydonisiz** keladi — mavjud bo'lmagan yo'l (`404 { message: "Cannot GET
/api/x", error: "Not Found" }`), buzilgan JSON (`400`), kutilmagan server xatosi (`500 { message: "Internal server
error" }`). `code` bo'lmasa — umumiy "Xatolik yuz berdi" ko'rsating.

### Kodlar

"Backend" ustunida ✔ — kod faqat serverda bor, web ilova i18n'iga (`src/i18n/*` → `errors`) qo'shilishi kerak.

| `code` | HTTP | Backend | `message` | Qachon |
|---|---|---|---|---|
| `not_found` | 404 | | Topilmadi | id bo'yicha yozuv yo'q; noto'g'ri `trackingToken`; buyurtma berilgan filial faol emas (`detail`: `branch … inactive`); TV navbatida (kod to'g'ri) filial faol emas; zaxira filial filialning o'zi (`PUT /branches/:id/delivery`) |
| `wrong_pin` | 401 | | PIN noto'g'ri | login / unlock / PIN almashtirish |
| `invalid_pin` | 400 | | PIN 4 tadan 8 tagacha raqamdan iborat bo'lishi kerak | yangi PIN formati |
| `user_inactive` | 403 | | Bu xodim bloklangan | login / unlock |
| `empty_order` | 400 | | Ro'yxat bo'sh | buyurtma, kirim yoki ko'chirish qatorsiz |
| `product_unavailable` | 400 | | Bu taom hozir sotuvda yo'q | taom faol emas / shu filialda vaqtincha sotilmaydi (`detail`: productId) |
| `invalid_qty` | 400 | | Miqdor noto'g'ri | buyurtmada qty butun ≥ 1 emas; hujjatda qty ≤ 0; retseptda / chegarada butun emas |
| `invalid_price` | 400 | | Narx kiritilmagan | taom narxi butun > 0 emas; kirimni tasdiqlashda narx yo'q / manfiy |
| `invalid_status` | 409 | | Holat allaqachon o'zgargan | buyurtma holati o'tishga mos emas; mobil `dine_in` (`detail`: `mobile dine_in`) |
| `already_decided` | 409 | | Bu kirim allaqachon ko'rib chiqilgan | kirim tasdiqlangan / rad etilgan |
| `same_warehouse` | 400 | | Bir xil omborga ko'chirib bo'lmaydi | |
| `shift_not_open` | 409 | | Smena ochilmagan | kassirning shu filialda ochiq smenasi yo'q; smena allaqachon yopilgan |
| `name_required` | 400 | | Nomini kiriting | nom (o'zbekchasi) bo'sh |
| `insufficient_stock` | 409 | | Omborda yetarli mahsulot yo'q | ko'chirish qoldiqdan ko'p (`detail`: ingredientId). Sotuv qoldiqni manfiyga tushirishi mumkin — xato bermaydi |
| `branch_required` | 400 | | Filialni tanlang | admin `branchId` bermadi; kassir / oshpaz filialsiz; mobil olib ketishda `branchId` yo'q; `GET /tv/queue` da `branchId` yo'q |
| `invalid_amount` | 400 | | Summa noto'g'ri | to'lov turi yo'q; aralash to'lov noto'g'ri; summa / narx butun > 0 emas; chiqim sanasi formati (`detail`: `date`) |
| `self_action` | 403 | | O'zingizni bloklay olmaysiz va o'z rolingizni o'zgartira olmaysiz | |
| `recipe_required` | 400 | | Retseptga kamida bitta mahsulot qo'shing | |
| `phone_required` | 400 | | Telefon raqamini kiriting | mobil: telefonda 9 tadan kam raqam |
| `address_required` | 400 | | Yetkazib berish manzilini kiriting | mobil dostavkada `online.address` bo'sh |
| `zone_too_small` | 400 | | Hudud kamida 3 ta nuqtadan iborat bo'lishi kerak | |
| `invalid_location` | 400 | | Xaritadagi nuqta noto'g'ri | \|lat\| > 90 yoki \|lng\| > 180 |
| `forbidden` | 403 | | Bu amal sizning rolingiz uchun emas | rol mos emas; boshqa filial buyurtmasi; admin yoki kuryer PIN yo'lida (`/auth/login`, `/auth/unlock`, `/auth/pin`) |
| `invalid_image` | 400 | | Rasm JPG, PNG, WEBP yoki AVIF bo'lishi va 5 MB dan oshmasligi kerak | `POST /images`: fayl yo'q, turi ruxsatsiz, ichi aytilgan turga mos emas, 5 MB dan katta (20 MB dan kattasini multer o'zi `413` bilan qaytaradi — `code` siz) |
| `image_in_use` | 409 | | Bu rasm menyuda yoki kioskda ishlatilgan — avval u yerda boshqa rasmni tanlang | `DELETE /images/...`: rasm taomda, kategoriyada yoki kiosk ekranida (`detail` — qayerda) |
| `unauthorized` | 401 | ✔ | Avval tizimga kiring | token yo'q / eskirgan / xodim bloklangan |
| `invalid_input` | 400 | ✔ | So'rov ma'lumotlari noto'g'ri | DTO tekshiruvi (tur, majburiy maydon, ruxsat etilgan qiymat, uzunlik); `workHours.open = close` |
| `too_many_attempts` | 429 | ✔ | Ko'p marta xato kiritildi — birozdan keyin urinib ko'ring | PIN bloki (`detail`: qolgan soniya, `"287s"`) yoki IP chegarasi (`Retry-After` sarlavhasi, soniya). TV / kiosk kodi uchun blok yo'q ([4.4](#44-tv-va-kiosk)) |
| `branch_closed` | 409 | ✔ | Filial hozir buyurtma qabul qilmayapti | mobil: tanlangan filial yopiq (`detail`: branchId) yoki dostavka uchun ochiq filial yo'q |
| `location_required` | 400 | ✔ | Yetkazib berish joyini xaritada belgilang (GPS) | mobil dostavkada `online.location` yo'q |
| `off_duty` | 409 | ✔ | Avval «Ishdaman» ni yoqing | kuryer "Ishdaman" o'chiq holda buyurtma olmoqchi |
| `already_taken` | 409 | ✔ | Bu buyurtmani boshqa kuryer oldi | |
| `other_branch` | 409 | ✔ | Qo'lingizda boshqa filial buyurtmalari bor | kuryer bir vaqtda faqat bitta filialdan oladi (`detail`: qo'ldagi filial) |
| `courier_busy` | 409 | ✔ | Avval yo'ldagi buyurtmalarni yetkazing | yo'lga chiqqan kuryer yangi buyurtma ololmaydi |
| `not_ready` | 409 | ✔ | Hamma buyurtma hali tayyor emas | "Yo'lga chiqdim" — qo'ldagilarning biri hali tayyorlanmoqda (`detail`: raqamlar, `"12,15"`) |
| `wrong_login` | 401 | ✔ | Email yoki parol noto'g'ri | admin / kuryer kirishi: email yo'q yoki parol noto'g'ri (ikkalasida bir xil javob) |
| `wrong_password` | 401 | ✔ | Joriy parol noto'g'ri | `PUT /auth/password` — joriy parol mos emas |
| `invalid_email` | 400 | ✔ | Email noto'g'ri — masalan: ism@gmail.com | admin / kuryer qo'shish, tahrirlash, "Profil" (shakli `x@y.z`, ≤ 100) |
| `invalid_password` | 400 | ✔ | Parol 8 tadan 64 tagacha belgidan iborat bo'lishi kerak | yangi admin / kuryer, PIN'li roldan ularga o'tkazish, yangi parol |
| `email_taken` | 409 | ✔ | Bu email boshqa xodimda — boshqasini kiriting | email katta-kichik harfni farqlamaydi |
| `wrong_tv_code` | 401 | ✔ | TV kodi noto'g'ri — admin panel → Filiallar → «TV kodi» | `GET /tv/queue` va TV socket'i: kod yo'q, noto'g'ri, boshqa filialniki yoki admin yangilagan; noma'lum filial ham shu kod bilan ([4.4](#44-tv-va-kiosk)) |
| `wrong_kiosk_code` | 401 | ✔ | Kiosk kodi noto'g'ri — admin panel → Filiallar → «Kiosk kodi» | `POST /kiosk/orders`, `GET /kiosk/check`: kod yo'q, noto'g'ri, boshqa filialniki, TV kodi yoki admin yangilagan; noma'lum filial ham shu kod bilan ([4.4](#44-tv-va-kiosk)) |
| `surname_required` | 400 | ✔ | Familiyani kiriting | xodim qo'shish / tahrirlash, "Profil" |
| `in_use` | 409 | ✔ | Tizimda ishlatilgan — o'chirib bo'lmaydi, uning o'rniga faolsizlantiring | `DELETE` — yozuv ishlatilgan (`detail`: qayerda — `orders`, `shifts`, `products`, `recipes`, …; [7](#7-endpointlar)) |
| `ai_not_configured` | 503 | ✔ | AI sozlanmagan — serverning .env faylida GEMINI_API_KEY yo'q | `POST /ai/messages` |
| `ai_failed` | 502 | ✔ | AI hozir javob bera olmadi — birozdan keyin qayta urinib ko'ring | Gemini xatosi / limit / 60 s dan ortiq (`detail`: Gemini xabari) yoki model 6 bosqichdan ko'p tool chaqirdi |
| `telegram_token_invalid` | 400 | ✔ | Bot tokeni noto'g'ri — @BotFather bergan tokenni to'liq nusxalang | `PUT /telegram/token`: shakli `123456789:AA…` emas yoki Telegram rad etdi |
| `telegram_unreachable` | 502 | ✔ | Telegram serveriga ulanib bo'lmadi — internetni tekshiring | tokenni tekshirishda tarmoq xatosi |
| `telegram_not_connected` | 409 | ✔ | Avval bot tokenini kiriting | `POST /telegram/link` — bot yo'q |

---

## 4. Kirish va huquqlar

### 4.1 Uch xil mijoz

| Kim | Qanday | Sarlavha |
|---|---|---|
| Xodim (kassa, oshxona, ombor — PIN; admin, kuryer — email va parol) | kirish → JWT (24 soat) | `Authorization: Bearer <token>` |
| TV | filial so'rovda (`branchId`) + filial **TV kodi** (8 raqam, admin beradi; [4.4](#44-tv-va-kiosk)) | `X-Tv-Code: <kod>` |
| Kiosk | filial so'rovda (`branchId`) + filial **kiosk kodi** (8 raqam, admin beradi; [4.4](#44-tv-va-kiosk)); menyu — ochiq | `X-Kiosk-Code: <kod>` |
| Mobil ilova mijozi | kirishsiz; o'z buyurtmasini kuzatish tokeni bilan ko'radi | `X-Order-Token: <token>` (faqat `GET /mobile/orders/:id`) |

Guard qoidalari (`src/auth/auth.guard.ts`):

- `@Public()` endpoint (menyu, filiallar, TV navbati, kiosk va mobil buyurtma, …) — xodim tokeni tekshirilmaydi (TV
  navbati va kiosk buyurtmasida o'rniga filialning TV / kiosk kodi tekshiriladi).
- Qolganlari — Bearer token; yo'q / noto'g'ri / eskirgan / xodim bloklangan yoki o'chirilgan — `401 unauthorized`;
  rol mos emas — `403 forbidden`. Xodim har so'rovda bazadan qayta olinadi: bloklansa yoki roli o'zgarsa — darhol
  kuchga kiradi.

### 4.2 Rollar

| Rol | Filial | Nima qila oladi |
|---|---|---|
| `admin` | yo'q | hammasi, bundan tashqari: kassa buyurtmasi (`POST /orders`), qabul qilish (`/confirm`), "Tayyor" / "Qaytarish", `/shifts/current*`. Filial ro'yxatlarida `?branchId=` majburiy |
| `cashier` (kassir) | bor | o'z filialida: buyurtma yaratish, kiosk / mobil buyurtmani qabul qilish, bekor qilish, ishdagi buyurtmalar; o'z smenasi |
| `kitchen` (oshpaz yordamchisi) | bor | o'z filialida: ishdagi buyurtmalar, "Tayyor", "Qaytarish" |
| `supplier` (ta'minotchi) | yo'q | ombor bo'limi: mahsulotlar, qoldiq, chegara, harakatlar, kirim kiritish, ko'chirish (tasdiqlash / rad etish — yo'q) |
| `courier` (kuryer) | yo'q | faqat `/courier/*` ([12](#12-kuryer-ilovasi-android)): istalgan filialning mobil dostavkasini oladi — bir vaqtda bitta filialdan |

Kirgan har qanday xodim: `GET /auth/me`; PIN bilan kiradiganlar — `POST /auth/unlock`, `PUT /auth/pin`; admin —
`PUT /auth/profile`, `PUT /auth/password`.
TV (`GET /tv/queue`) va kiosk (`POST /kiosk/orders`) — rol talab qilinmaydi (xodim uchun ham tokensiz, `branchId`
majburiy); TV navbati — faqat filial TV kodi, kiosk buyurtmasi — faqat filial kiosk kodi bilan.

### 4.3 Xodim kirishi

1. `GET /api/branches` — filiallar (kirish ekranida filial tanlash).
2. `GET /api/auth/staff?branchId=br_chilonzor&role=cashier` — faol xodimlar `AuthUser[]` (PINsiz). Ta'minotchi
   (filialsiz) — `?role=supplier`, `branchId` siz. Admin va kuryerlar bu ro'yxatda **chiqmaydi** (`?role=admin`,
   `?role=courier` — `[]`): ular email va parol bilan kiradi (pastda).
3. `POST /api/auth/login` `{ "userId": "usr_cashier_c1", "pin": "1234" }` →
   `{ token, user: AuthUser, shift: Shift | null }`. Kassirga shu filialda smena ochiladi yoki ochig'i davom etadi
   (`shift`); boshqa rollarda `shift: null`.
4. Keyingi so'rovlarda `Authorization: Bearer <token>`. Token 24 soat amal qiladi; yangilash — `POST /auth/unlock`
   (kassa blokdan chiqishi; amaldagi token kerak). Token eskirsa (`401`) — qaytadan kirish.
5. Sahifa yangilanganda: `GET /api/auth/me` → `{ user, shift }` (kassirda ochiq smena yoki `null`).

**Admin** (2026-11-02) — PIN'siz, faqat email va parol: web'da `/admin` manzilida (umumiy kirish ekranida "Admin
panel" yo'q). `POST /api/auth/admin-login` `{ "email": "admin@gmail.com", "password": "123456789" }` →
`{ token, user, shift: null }`.

**Kuryer** (mijoz ilovasi ichidagi yashirin oyna — "NY" belgisiga 10 marta bosiladi): `POST /api/auth/courier-login`
`{ "email": "bobur@gmail.com", "password": "bobur2222" }` → `{ token, user, shift: null }`.

Admin va kuryerning emaili va parolini admin "Xodimlar" da ochadi (`POST /users`); email katta-kichik harfni
farqlamaydi. Email topilmasa ham, parol noto'g'ri bo'lsa ham — `wrong_login` (qaysi email borligi bilinmasin);
bloklanish va IP chegarasi PIN'dagidek. Ikkala yo'l o'z roli uchun: kuryer emaili `admin-login` da (va aksincha) —
`wrong_login`. Admin va kuryer PIN yo'llarida (`POST /auth/login`, `/auth/unlock`, `PUT /auth/pin`) — `403 forbidden`
(rol PIN'dan oldin tekshiriladi — parol PIN sifatida sinab ko'rilmaydi).

**Admin paroli unutilsa**: boshqa admin "Xodimlar" da yangisini beradi (`PATCH /users/:id`, `password`) yoki Telegram
botda `/parol` ([13](#13-ai-yordamchi-va-telegram-bot)).

**PIN / parol bloki**: bir xodimga ketma-ket 5 marta noto'g'ri PIN (parol) → 5 daqiqa blok. 5-urinishning o'zi
`too_many_attempts` qaytaradi; blok paytida to'g'ri PIN ham `too_many_attempts` (`detail`: qolgan soniya). To'g'ri PIN
hisoblagichni nollaydi. Tekshiruv tartibi: `not_found` → `user_inactive` → blok → `wrong_pin` (`wrong_login`).

**IP chegarasi** (bir IP'dan, 60 soniyada): `POST /auth/login` — 20, `POST /auth/admin-login` — 20, `POST /auth/courier-login` — 20, `PUT /auth/password` — 20, `POST /auth/unlock` — 20, `POST /kiosk/orders` —
30, `POST /mobile/orders` — 20. Oshsa — `429 too_many_attempts` + `Retry-After`. Proksi (Apache) ortida IP —
har bir mijozning o'zi (`X-Forwarded-For`, `TRUST_PROXY`), aks holda chegara hamma foydalanuvchiga birga qo'llanardi.

### 4.4 TV va kiosk

Web ilovada kirish ekranida "Navbat ekrani" / "Kiosk" → filial tanlanadi → `/tv/<branchId>` yoki `/kiosk/<branchId>`.
Menyu (`GET /api/menu?branchId=<id>`) — ochiq (mobil ilova bilan umumiy). Filial yo'q yoki faol emas — `404 not_found`.
(Avvalgi ulash kodi va `X-Device-Key` 2026-10-27 da olib tashlangan.)

**TV kodi va kiosk kodi** (2026-11-03). Har filialda ikkita alohida kod — **8 raqam** (`48217390`): TV kodi navbatni,
kiosk kodi kiosk buyurtmasini ochadi. Markaz o'zi yaratadi va bazada saqlaydi (`settings`, `tv_code:<branchId>`,
`kiosk_code:<branchId>`; `.env` da emas); admin "Filiallar" → filial → "TV kodi" / "Kiosk kodi" da ko'radi, nusxalaydi
va "Yangilash" qiladi ([7.2](#72-filiallar-va-yetkazib-berish)). Kodlar bir-biridan va offline kassa kalitidan
([14.1](#141-filial-kaliti)) **alohida**: TV kodi kioskni ochmaydi (va aksincha), birini yangilash boshqasiga tegmaydi.
Kiosk kodsiz bo'lsa — filial id'sini bilgan har kim (kiosk manzilini rasmga olgan ham) uyidan buyurtma yubora olardi.

- Ekran birinchi ochilganda kodni so'raydi, to'g'ri bo'lsa — qurilmada saqlaydi (`localStorage`, muddatsiz) va boshqa
  so'ramaydi (brauzer ma'lumoti o'chsa, yashirin rejim yoki boshqa manzil — domen, `https` — bo'lsa yana so'raydi).
- Admin "Filiallar" → "Navbat ekrani" / "Kiosk" — **kodsiz**: admin panel bosilganda joriy kodni
  (`GET /branches/:id/tv-code`, `/kiosk-code`) shu brauzerga yozib, ekranni yangi tabda ochadi (kod yangilangan bo'lsa ham).
- **TV**: `GET /api/tv/queue?branchId=<id>` + sarlavha `X-Tv-Code: <kod>`; socket — `auth: { tvBranchId, tvCode }`
  ([8.1](#81-ulanish-auth)).
- **Kiosk**: `POST /api/kiosk/orders` (`branchId` tanada) + sarlavha `X-Kiosk-Code: <kod>`; kodni tekshirish —
  `GET /api/kiosk/check?branchId=<id>` + `X-Kiosk-Code` → `200 { ok: true }`. Kiosk kodni ochilganda, har yangi mijoz
  boshlaganda va har mijozdan keyin tekshiradi — admin yangilagan bo'lsa mijoz to'lovgacha kutib qolmasin.
- Bo'sh joy va chiziqcha e'tiborga olinmaydi (`4821 7390`, `4821-7390`).
- Kod yo'q, noto'g'ri, boshqa filialniki yoki boshqa ekranniki (TV kodi kioskda), filial noma'lum — `401 wrong_tv_code` /
  `wrong_kiosk_code` (qaysi filial borligi bilinmaydi); kod to'g'ri, lekin filial faol emas — `404 not_found`. Kiosk
  buyurtmasida forma xatosi (`invalid_input`) kod tekshiruvidan oldin.
- **Yangilansa** — eski kod darhol ishlamaydi: shu filialning ulangan TV socket'lari `auth_error { code:
  "wrong_tv_code" }` bilan uziladi, keyingi so'rov — `401`. Ekran yana kod so'raydi (kioskda — keyingi tekshiruvda).
- **Noto'g'ri kod uchun blok yo'q** (2026-11-03, egasining qarori — filialning hamma qurilmalari bitta IP dan chiqadi,
  xodim adashsa ekranlar kutib qolmasin): har noto'g'ri kod — faqat `401 wrong_tv_code` / `wrong_kiosk_code`, to'g'ri
  kod darhol ishlaydi. `POST /kiosk/orders` dagi umumiy IP chegarasi (30 / 60 s) qoladi.
- Filial o'chirilsa — kodlari ham o'chadi.

---

## 5. Mobil ilova oqimi (Android)

Ilova hech narsani o'zi hisoblamaydi: filialni tanlash, narx, hudud narxi, ochiq / yopiq — hammasi serverda. Ilova
natijani ko'rsatadi. Barcha mobil endpointlar ochiq (token yo'q).

### 5.1 Filiallar

`GET /api/branches` → `Branch[]` ([6.1](#61-filial-va-yetkazib-berish)). Har birida `onlineState` (hozirgi holat) va
`workHours`.

| `onlineState` | Ma'nosi | Ko'rsatish (tavsiya) |
|---|---|---|
| `open` | buyurtma qabul qiladi | "Ochiq" |
| `off_hours` | ish vaqtidan tashqari | "Yopiq · {workHours.open} da ochiladi" (ROADMAP 2) |
| `paused` | admin vaqtincha to'xtatgan | "Hozir buyurtma qabul qilmayapti" |
| `no_shift` | ochiq smena yo'q | "Hozir yopiq" |
| `no_kassa` | smena ochiq, lekin kassa ekrani ulanmagan | "Hozir yopiq" |
| `inactive` | filial faol emas | ro'yxatda ko'rsatmang |

Tekshiruv tartibi: `inactive` → `paused` → `off_hours` → `no_shift` → `no_kassa` → `open`. `workHours: null` — 24/7
(`off_hours` bo'lmaydi). `close < open` — yarim tundan o'tadi (`18:00`–`03:00`); ochilish daqiqasi kiradi, yopilishi
kirmaydi. Holat — so'rov paytidagi surat: buyurtma berishda server yana tekshiradi.

### 5.2 Buyurtma turi va filial

**Yetkazib berish (`delivery`)** — mijoz filial tanlamaydi:

1. Joylashuv: GPS yoki xaritada pin.
2. `GET /api/delivery/route?lat=41.282&lng=69.2045` → `{ branchId, zoneBranchId, fee, redirected }`:
   - `branchId: null` — hech bir filial ochiq emas: "Hozir buyurtma qabul qilmayapmiz", rasmiylashtirishni o'chiring;
   - `fee` — son: hudud narxi (`0` — "Bepul"); `null` — hech qaysi hududga tushmadi: "Yetkazish narxini kuryer aytadi";
   - `redirected: true` — hudud egasi (`zoneBranchId`) yopiq, buyurtmani boshqa filial (`branchId`) oladi.
3. Menyu — `route.branchId` filialiniki.

Server tanlash qoidasi: (1) nuqta ochiq filial hududida — o'sha filial (hududlar ustma-ust bo'lsa eng yaqini), hudud
narxi bilan; (2) hudud egasi yopiq — uning zaxira filiali (`fallbackBranchId`), u ham yopiq bo'lsa eng yaqin ochiq
filial, narx — hudud narxi; (3) hech qaysi hududda emas — eng yaqin ochiq filial (to'g'ri chiziq bo'yicha), `fee: null`.

> **Hozircha yetkazish narxi buyurtmaga yozilmaydi**: `order.total` — faqat taomlar. `fee` ni ma'lumot sifatida
> alohida ko'rsating ("Yetkazib berish: 10 000 so'm"). Summaga qo'shish — rejada (PLAN 10, ROADMAP 2).

**Olib ketish (`takeaway`)** — mijoz filialni tanlaydi; faqat `onlineState === "open"` filialni tanlash mumkin.
Menyu — tanlangan filialniki.

**Zalda (`dine_in`)** — mobil ilovada yo'q (`409 invalid_status`).

### 5.3 Menyu

`GET /api/menu?branchId=br_chilonzor` →

```json
{
  "branchId": "br_chilonzor",
  "categories": [
    { "id": "burgers", "name": { "uz": "Burgerlar", "ru": "Бургеры", "en": "Burgers" },
      "image": "/images/categories/burgers.jpg", "icon": "/images/icons/hamburger.png", "sortOrder": 1, "active": true }
  ],
  "products": [
    { "id": "burger-classic", "categoryId": "burgers",
      "name": { "uz": "Klassik burger", "ru": "Классический бургер", "en": "Classic burger" },
      "image": "/images/products/burger-classic.jpg", "sortOrder": 1, "price": 32000,
      "composition": [ { "uz": "Burger noni", "ru": "Булочка для бургера", "en": "Burger bun" }, "…" ], "kitchen": true }
  ]
}
```

- Faqat faol kategoriyalar va shu filialda sotuvdagi faol taomlar (filialda vaqtincha sotuvdan olinganlari chiqmaydi);
  sotuvdagi taomi yo'q kategoriya chiqmaydi. Tartib — `sortOrder` bo'yicha (javobda tartiblangan).
- `composition` — tarkib (retseptdagi mahsulot nomlari; qadoq, yog', ziravor kabi guruhlarsiz). Grammlar berilmaydi.
- Narx barcha filiallarda bir xil, lekin taomlar ro'yxati filialga bog'liq (biror taom bitta filialda vaqtincha
  sotilmasligi mumkin) — filial o'zgarsa menyuni qayta oling.
- Savatdagi jami — faqat ko'rsatish uchun; haqiqiy summa — javobdagi `order.total`.

### 5.4 Buyurtma berish

`POST /api/mobile/orders` — maydonlar [7.4](#74-buyurtmalar-kassa-oshxona-kiosk-tv-mobil) da. Dostavka:

```json
{
  "type": "delivery",
  "items": [
    { "productId": "burger-classic", "qty": 2 },
    { "productId": "fries", "qty": 1 }
  ],
  "note": "Burger piyozsiz. Eshik oldida qo'ng'iroq qiling",
  "online": {
    "platform": "android",
    "name": "Aziza",
    "phone": "+998 90 123 45 67",
    "address": "Bunyodkor ko'chasi 5, 12-xonadon, mo'ljal: maktab",
    "payment": "cash",
    "location": { "lat": 41.282, "lng": 69.2045 }
  }
}
```

Olib ketish (`branchId` majburiy, `address` va `location` shart emas):

```json
{
  "type": "takeaway",
  "branchId": "br_yunusobod",
  "items": [ { "productId": "burger-cheese", "qty": 1 } ],
  "online": { "platform": "android", "name": "Aziza", "phone": "901234567", "payment": "click" }
}
```

Javob `201`:

```json
{ "order": { "id": "ord_3f2a9c1b7e4d8a05", "branchId": "br_chilonzor", "number": 17, "status": "pending", "…": "…" },
  "trackingToken": "q9Vx…(32 belgi)" }
```

- `order` — `CustomerOrder` ([6.2](#62-buyurtma)). `payment` — `null` (kassir qabul qilganda `online.payment` dan
  yoziladi).
- **`order.id` va `trackingToken` ni darhol doimiy saqlang** (DataStore / Room). Token faqat shu javobda beriladi —
  yo'qolsa buyurtmani kuzatib bo'lmaydi.
- Dostavkada filialni server tanlaydi — yuborilgan `branchId` e'tiborga olinmaydi; natija `route` ko'rsatgandan farq
  qilishi mumkin (shu orada holat o'zgargan bo'lsa). Taomlar server tanlagan filialda sotuvda bo'lishi shart.
- So'rov idempotent emas: tarmoq xatosida avtomatik qayta yubormang (ikki buyurtma bo'lishi mumkin) — foydalanuvchidan
  so'rang.
- `online.payment`: `click` — "ilovada to'langan", `cash` — kuryerga / filialda naqd. **Click hali ulanmagan** — hozir
  faqat belgi, pul olinmaydi.

Tekshiruvlar (shu tartibda; birinchi xato qaytadi):

| # | Shart | Xato |
|---|---|---|
| 1 | DTO: `type`, `items[]`, `online` (`platform`, `name`, `phone`, `payment`) turlari / uzunliklari | `400 invalid_input` |
| 2 | `items` bo'sh | `400 empty_order` |
| 3 | `type = dine_in` | `409 invalid_status` |
| 4 | telefonda 9 tadan kam raqam (faqat raqamlar sanaladi) | `400 phone_required` |
| 5 | dostavkada `address` bo'sh | `400 address_required` |
| 6 | koordinata chegaradan tashqari (\|lat\| > 90, \|lng\| > 180) | `400 invalid_location` |
| 7 | dostavka: `online.location` yo'q | `400 location_required` |
| 7 | dostavka: ochiq filial yo'q | `409 branch_closed` |
| 7 | olib ketish: `branchId` yo'q / filial topilmadi / yopiq | `400 branch_required` / `404 not_found` / `409 branch_closed` |
| 8 | har qator uchun ketma-ket: qty butun ≥ 1 emas | `400 invalid_qty` (`detail`: productId) |
| 8 | taom topilmadi | `404 not_found` |
| 8 | taom faol emas / shu filialda vaqtincha sotilmaydi | `400 product_unavailable` (`detail`: productId) |

Mijoz o'zi tuzata oladigan forma xatolari (2–6) filial tanlashdan **oldin** qaytadi.

`name` bo'sh bo'lishi mumkin (server tekshirmaydi) — ilovada o'zingiz majburiy qiling. Telefon serverda tozalanmaydi
(faqat `trim`) — qanday yuborsangiz shunday saqlanadi.

### 5.5 Holatni kuzatish

**REST**: `GET /api/mobile/orders/{id}` + sarlavha `X-Order-Token: <trackingToken>` (yoki `?token=`) →
`CustomerOrder`. Token noto'g'ri yoki yo'q — `404 not_found` (buyurtma umuman yo'qdek).

**Socket.IO** (darhol yangilanish):

```kotlin
// build.gradle.kts
implementation("io.socket:socket.io-client:2.1.0") { exclude(group = "org.json", module = "json") }

val options = IO.Options.builder()
    .setAuth(mapOf("orderId" to orderId, "orderToken" to trackingToken))
    .build()
val socket = IO.socket("http://192.168.1.10:3000", options)   // /api emas — server ildizi
socket.on(Socket.EVENT_CONNECT) { refetchOrder() }             // har ulanish va qayta ulanishda REST'dan qayta oling
socket.on("ready") { /* { rooms: ["order:ord_…"] } — obuna tasdiqlandi */ }
socket.on("order") { args -> val json = args[0] as JSONObject /* CustomerOrder */ }
socket.on("auth_error") { /* { code: "unauthorized" } — server uzadi, qayta ulanmang */ }
socket.connect()
```

- `io.socket:socket.io-client` 2.x Socket.IO v3/v4 server bilan mos (server — 4.8).
- Callback'lar asosiy oqimda emas — UI holatini `Dispatchers.Main` / `StateFlow` orqali yangilang.
- `EVENT_CONNECT` kelgani hali ruxsat degani emas — server tekshirib `ready` yoki `auth_error` yuboradi.
- Uzilish paytidagi xabarlar yo'qoladi: **har qayta ulanishda va ilova oldingi planga qaytganda `GET
  /mobile/orders/:id` bilan qayta oling**. Socket ulanmagan paytda 10–15 soniyada so'rov (polling) — zaxira (tavsiya).
- Push (FCM) hali yo'q — ilova yopiq bo'lsa xabar kelmaydi.

### 5.6 Holat → UI matni

| `status` | Shart | Matn |
|---|---|---|
| `pending` | | "Qabul kutilmoqda" |
| `pending` | `transferCount = 1` | "Qabul kutilmoqda" + "Buyurtma {filial nomi} filialiga o'tkazildi" |
| `preparing` | | "Tayyorlanmoqda" |
| `ready` | `type = delivery`, `departedAt = null` | "Tayyor — kuryer olib ketadi" |
| `ready` | `departedAt` bor | "Kuryer yo'lda" (kuryer kimligi va navbati ko'rsatilmaydi — kelishilgan) |
| `ready` | `deliveredAt` bor | "Yetkazildi" |
| `ready` | `returnedAt` bor | "Kuryer yetkaza olmadi — filial siz bilan bog'lanadi" (filial telefoni — `Branch.phone`) |
| `ready` | `type = takeaway` | "Tayyor! Filialdan oling" |
| `cancelled` | `cancelReason = null` | "Buyurtma bekor qilindi" — filial (kassir / admin) bekor qildi; filial telefoni — `Branch.phone` |
| `cancelled` | `timeout` | olib ketish: "Filial javob bermadi — boshqa filialni tanlang" (ROADMAP 2); dostavka: "Filial javob bermadi" (tavsiya) |
| `cancelled` | `branch_closed` | olib ketish: "Filial yopildi — boshqa filialni tanlang"; dostavka: "Filial yopildi" (tavsiya) |
| `cancelled` | `no_branch` | "Hozir buyurtma qabul qilmayapmiz" (ROADMAP 2) |

Oqim: `pending` → `preparing` (kassir qabul qildi) → `ready` (oshpaz yordamchisi "Tayyor" bosdi). Dostavkada `status`
`ready` da qoladi, kuryer bosqichlari — vaqt maydonlarida: `departedAt` ("Kuryer yo'lda") → `deliveredAt` ("Yetkazildi")
yoki `returnedAt` ("Yetkazib bo'lmadi"; kassir buyurtmani kuryerdan olsa — `departedAt` / `returnedAt` yana `null`,
boshqa kuryer olib ketadi). Kamdan-kam: `ready` → `preparing` (adashib bosilgan "Tayyor" qaytarildi; kuryer yo'lga
chiqqandan keyin — yo'q). `cancelled` istalgan bosqichdan (yetkazilgandan keyin — yo'q). Ekran ochiq ekan, `ready` dan
keyin ham tinglashda davom eting.

**Qabul muddati** (server fon ishi, har 30 soniyada): `pending` mobil buyurtma filialga tushganidan 5 daqiqa ichida
qabul qilinmasa (amalda 5:00–5:30) yoki shu orada filial yopilsa (holati `open` emas):

| Tur | `transferCount` | Natija |
|---|---|---|
| dostavka | 0 | boshqa ochiq filialga o'tadi (zaxira filial, u ham yopiq — eng yaqin ochiq; eski filial hisobga olinmaydi); ochiq filial yo'q — `cancelled`, `no_branch` |
| dostavka | 1 | `cancelled`, `timeout` (muddat o'tdi) yoki `branch_closed` (filial yopildi) |
| olib ketish | 0 | `cancelled`, `timeout` yoki `branch_closed` (mijoz filialni o'zi tanlagan — boshqa joyga yuborilmaydi) |

O'tkazilganda o'zgaradi: `branchId` (yangi filial), **`number` (yangi filialning navbatdagi raqami — ekrandagi raqamni
yangilang)**, `fromBranchId` (oldingi filial), `transferCount: 1`, `routedAt` (yangi 5 daqiqa shundan). Holat
`pending` qoladi. Taomlar narxi va `total` o'zgarmaydi (mijoz shu summaga rozi bo'lgan). Yangi filial buyurtmadagi
**hamma** taomni sotishi shart — sotmasa o'tkazilmaydi, `cancelled`, `no_branch`. Buyurtma ko'pi bilan 1 marta
o'tkaziladi.

Qabul kutish vaqti: `routedAt` + 5 daqiqa (masalan "Filial javobini kutyapmiz · 3:12").

---

## 6. Ma'lumot turlari

TypeScript ko'rinishida. Javobdagi maydon doim bor (`| null` — qiymati `null` bo'lishi mumkin); `?` — faqat
`PaymentSplit` kalitlarida (bo'lmasligi mumkin).

### 6.1 Filial va yetkazib berish

```ts
type LatLng = { lat: number; lng: number }            // WGS84, saqlashda 6 xonagacha yaxlitlanadi
type WorkHours = { open: string; close: string }      // "HH:MM"

interface Branch {
  id: string; name: string; address: string; phone: string
  active: boolean
  createdAt: string
  location: LatLng | null          // xaritadagi joyi (eng yaqin filialni topish uchun)
  deliveryZone: LatLng[]           // hudud poligoni; [] — chizilmagan (≥ 3 nuqta bo'lsa hisobga olinadi)
  deliveryFee: number              // hudud ichida yetkazish narxi, so'm
  fallbackBranchId: string | null  // yopiq bo'lsa hududidagi buyurtmalar shu filialga; null — eng yaqin ochiq
  onlineEnabled: boolean           // false — admin online qabulni to'xtatgan
  workHours: WorkHours | null      // online qabul vaqti; null — 24/7
  onlineState: BranchOnlineState   // faqat GET /branches va GET /branches/:id javobida
}
type BranchOnlineState = 'open' | 'inactive' | 'paused' | 'off_hours' | 'no_shift' | 'no_kassa'

interface DeliveryRoute {
  branchId: string | null      // buyurtmani oladigan filial; null — ochiq filial yo'q
  zoneBranchId: string | null  // nuqta tushgan hudud egasi; null — hech qaysi hududda emas
  fee: number | null           // hudud narxi; null — hududdan tashqarida (narxni kuryer aytadi)
  redirected: boolean          // hudud egasi yopiq — boshqa filialga yo'naltirildi
}

interface Warehouse { id: string; name: string; kind: 'central' | 'branch'; branchId: string | null }
```

### 6.2 Buyurtma

```ts
type OrderType = 'dine_in' | 'takeaway' | 'delivery'
type OrderSource = 'cashier' | 'kiosk' | 'mobile'
type OrderStatus = 'pending' | 'preparing' | 'ready' | 'cancelled'
type PaymentMethod = 'cash' | 'card' | 'click'
type PaymentSplit = { cash?: number; card?: number; click?: number }   // faqat aralash to'lovda, nolsiz qismlar
type CancelReason = 'timeout' | 'branch_closed' | 'no_branch'
type ReturnReason = 'no_answer' | 'wrong_address' | 'refused' | 'other'   // kuryer: "Yetkazib bo'lmadi" sababi

interface OrderItem {
  productId: string
  name: LocalizedText   // sotilgan paytdagi nom (surat)
  price: number         // sotilgan paytdagi 1 dona narxi
  qty: number
  // taomga izoh yo'q (2026-10-27) — izoh faqat butun buyurtmaga (`Order.note`); eski buyurtmalarda `note` qolgan bo'lishi mumkin
}

interface OnlineInfo {            // faqat mobil buyurtmada
  platform: 'android' | 'ios'
  name: string
  phone: string
  address: string                 // olib ketishda ""
  payment: 'click' | 'cash'
  location: LatLng | null         // dostavkada doim bor
}

/** Xodim ko'rinishi (REST va socket `branch:<id>`). */
interface Order {
  id: string; branchId: string
  number: number                  // filialda har kuni 1 dan (Asia/Tashkent); chek va TV da shu
  type: OrderType; source: OrderSource
  items: OrderItem[]; note: string
  total: number                   // Σ price × qty (yetkazish narxisiz)
  payment: PaymentMethod | null   // to'lanmagan kiosk / qabul qilinmagan mobil — null; aralashda — eng katta qism
  split: PaymentSplit | null
  online: OnlineInfo | null
  status: OrderStatus
  cashierId: string | null        // kassa — kassir; kiosk / mobil — qabul qilgan kassir (qabulgacha va kioskda oldindan to'langanda null)
  shiftId: string | null
  createdAt: string
  preparingAt: string | null      // to'langan / qabul qilingan
  readyAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null      // server o'zi bekor qilganda null
  cancelReason: CancelReason | null   // faqat server bekor qilganda
  routedAt: string                // shu filialga tushgan vaqt (5 daqiqa shundan)
  transferCount: number           // 0 yoki 1
  fromBranchId: string | null     // o'tkazilgan bo'lsa — oldingi filial
  deliveryFee: number | null      // mobil dostavka: buyurtma berilgandagi hudud narxi (summaga kirmaydi, kuryerga naqd); hududdan tashqarida / dostavka emas — null
  // ── kuryer (faqat mobil dostavka; `status` ready da qoladi) ──
  courierId: string | null        // olgan kuryer
  takenAt: string | null          // "Olaman"
  departedAt: string | null       // "Yo'lga chiqdim"
  deliveredAt: string | null      // "Yetkazildi"
  returnedAt: string | null       // "Yetkazib bo'lmadi" — filialga qaytadi
  returnReason: ReturnReason | null
  returnNote: string              // kuryer izohi; bo'lmasa ""
  courierSeq: number | null       // kuryer yo'lidagi navbati (1, 2, …) — server taklif qilgan tartib
  courierLegKm: number | null     // oldingi nuqtadan (filial / oldingi mijoz) shu manzilgacha, km, to'g'ri chiziq
  syncedAt: string | null         // offline kassada olingan — markazga yetib kelgan vaqti (14); oddiy buyurtmada null
}

/** Mijoz ko'rinishi (mobil va kiosk javobi, socket `order:<id>`) — xodim va kuryer ma'lumotisiz. */
type CustomerOrder = Pick<Order, 'id' | 'branchId' | 'number' | 'type' | 'items' | 'note' | 'total' | 'payment'
  | 'online' | 'status' | 'createdAt' | 'preparingAt' | 'readyAt' | 'cancelledAt' | 'cancelReason'
  | 'routedAt' | 'transferCount' | 'fromBranchId' | 'deliveryFee' | 'departedAt' | 'deliveredAt' | 'returnedAt'>

/** TV ko'rinishi (REST `GET /tv/queue` va socket `tv:<id>`) — mijoz ma'lumotisiz. */
type TvOrder = Pick<Order, 'id' | 'branchId' | 'number' | 'type' | 'status' | 'preparingAt' | 'readyAt'>
```

Holatlar: `pending` (kiosk — kassada to'lanmagan; mobil — qabul qilinmagan) → `preparing` (to'langan / qabul qilingan;
mahsulotlar filial omboridan retsept bo'yicha ayriladi) → `ready`. `cancelled` — istalgan bosqichdan; ayrilgan
mahsulotlar aynan o'sha miqdorda omborga qaytadi. Kassa buyurtmasi va kioskda karta / Click bilan to'langani darhol
`preparing`.

### 6.3 Menyu

```ts
interface Category { id: string; name: LocalizedText; image: string; icon: string; sortOrder: number; active: boolean }
interface Product {                // admin ro'yxati (retsept bilan)
  id: string; categoryId: string; name: LocalizedText; image: string
  recipe: { ingredientId: string; qty: number }[]   // bitta taomga, asosiy birlikda
  price: number                    // so'm — barcha filiallarda bir xil
  unavailableBranchIds: string[]   // taom vaqtincha sotilmaydigan filiallar; yangi filial — hamma taomni sotadi
  sortOrder: number; active: boolean
  kitchen: boolean                 // false — oshxona chekiga chiqmaydi (tayyor ichimlik: kola, suv; choy, qahva — true)
}
interface MenuProduct {            // GET /menu
  id: string; categoryId: string; name: LocalizedText; image: string; sortOrder: number
  price: number | null             // taom narxi; null — faqat `all=true` da: shu filialda vaqtincha sotilmaydi
  composition: LocalizedText[]
  kitchen: boolean                 // kassa uchun: false — oshxona chekiga chiqmaydi (mobil ilovaga kerak emas)
}
```

### 6.4 Xodim va smena

```ts
type Role = 'admin' | 'cashier' | 'kitchen' | 'supplier' | 'courier'
// ekranda — "Ism Familiya"; surname 2026-11-02 dan oldingi xodimlarda bo'sh ("") bo'lishi mumkin
// email — admin va kuryerning kirish emaili (kichik harfda); PIN bilan kiradiganlarda null
interface AuthUser { id: string; name: string; surname: string; role: Role; branchId: string | null; email: string | null }
interface User extends AuthUser { active: boolean; onDuty: boolean; createdAt: string }   // PIN / parol hech qachon qaytmaydi

interface Shift { id: string; branchId: string; cashierId: string; openedAt: string; closedAt: string | null }
interface ShiftSummary {
  orderCount: number               // to'langan (preparing / ready) buyurtmalar
  cancelledCount: number
  total: number                    // to'langanlar summasi
  byPayment: { cash: number; card: number; click: number }   // aralashda — qismlari
}
type ShiftWithSummary = Shift & { summary: ShiftSummary }
```

### 6.5 Ombor va chiqimlar

```ts
type StockUnit = 'kg' | 'l' | 'pcs'
type IngredientGroup = 'bread' | 'meat' | 'seafood' | 'dairy' | 'vegetables' | 'fruits' | 'frozen' | 'sauces'
  | 'grocery' | 'sweets' | 'drinks' | 'coffee' | 'packaging' | 'cleaning' | 'other'
interface Ingredient {
  id: string; name: LocalizedText; group: IngredientGroup
  unit: StockUnit                  // yaratilgandan keyin o'zgarmaydi
  lastPrice: number | null         // oxirgi tasdiqlangan kirimdagi 1 kg / l / dona narxi
  active: boolean
}
interface StockItem { warehouseId: string; ingredientId: string; qty: number; minQty: number }   // asosiy birlikda; qty manfiy bo'lishi mumkin
type MovementKind = 'purchase' | 'transfer_in' | 'transfer_out' | 'sale' | 'sale_cancel'
interface StockMovement {
  id: string; warehouseId: string; ingredientId: string
  qty: number                      // asosiy birlikda: + kirim, − chiqim
  kind: MovementKind
  refId: string                    // buyurtma / kirim / ko'chirish id'si
  createdAt: string
}
interface Purchase {
  id: string; number: number; warehouseId: string
  items: { ingredientId: string; qty: number; price: number | null }[]   // ombor birligida; narx — 1 birlik
  note: string; status: 'pending' | 'approved' | 'rejected'
  createdBy: string; createdAt: string; decidedBy: string | null; decidedAt: string | null
}
interface Transfer {
  id: string; number: number; fromWarehouseId: string; toWarehouseId: string
  items: { ingredientId: string; qty: number }[]   // ombor birligida
  note: string; createdBy: string; createdAt: string
}
type ExpenseKind = 'electricity' | 'gas' | 'water' | 'internet' | 'other'
interface Expense {
  id: string; branchId: string; kind: ExpenseKind; amount: number
  date: string                     // "YYYY-MM-DD"
  note: string; createdBy: string; createdAt: string
}
```

---

## 7. Endpointlar

Yo'llar `/api` siz yozilgan. "Kim" ustuni: **ochiq** — tokensiz (TV va kiosk — tokensiz, lekin filial kodi bilan); rollar — Bearer token. Hamma
joyda: DTO xatosi — `invalid_input`, tokensiz — `unauthorized`, rol mos emas — `forbidden` (alohida yozilmaydi).

### 7.1 Kirish (`/auth`)

| Metod va yo'l | Kim | So'rov | Javob | Xatolar |
|---|---|---|---|---|
| `GET /auth/staff` | ochiq | query: `branchId?`, `role?` | `AuthUser[]` (faollari, ism bo'yicha; kuryerlarsiz) | |
| `POST /auth/login` | ochiq | `{ userId: string ≤40, pin: string ≤8 }` — kassir, oshpaz yordamchisi, ta'minotchi | `200 { token, user: AuthUser, shift: Shift \| null }` | `not_found`, `user_inactive`, `wrong_pin`, `too_many_attempts`, `forbidden` (admin / kuryer) |
| `POST /auth/admin-login` | ochiq | `{ email: string ≤100, password: string ≤64 }` | `200 { token, user: AuthUser, shift: null }` | `wrong_login`, `user_inactive`, `too_many_attempts` |
| `POST /auth/courier-login` | ochiq | `{ email: string ≤100, password: string ≤64 }` | `200 { token, user: AuthUser, shift: null }` | `wrong_login`, `user_inactive`, `too_many_attempts` |
| `GET /auth/me` | xodim | | `{ user: AuthUser, shift: Shift \| null }` (`shift` — kassirning ochiq smenasi) | |
| `POST /auth/unlock` | PIN bilan kiradigan xodim | `{ pin: string ≤8 }` — shu xodimning PIN'i | `200 { token }` — yangi 24 soatlik token | `wrong_pin`, `user_inactive`, `too_many_attempts`, `forbidden` (admin / kuryer) |
| `PUT /auth/pin` | PIN bilan kiradigan xodim | `{ oldPin: string ≤8, newPin: string ≤8 }` | `204` | `wrong_pin`, `too_many_attempts`, `invalid_pin`, `forbidden` (admin / kuryer) |
| `PUT /auth/profile` | admin | `{ name: string ≤100, surname: string ≤100, email: string ≤100 }` — o'zi | `AuthUser` | `name_required`, `surname_required`, `invalid_email`, `email_taken` |
| `PUT /auth/password` | admin | `{ oldPassword: string ≤64, newPassword: string ≤64 }` — o'zi | `204` | `wrong_password`, `too_many_attempts`, `invalid_password` |

### 7.2 Filiallar va yetkazib berish

| Metod va yo'l | Kim | So'rov | Javob | Xatolar |
|---|---|---|---|---|
| `GET /branches` | ochiq | | `Branch[]` (`onlineState` bilan; yaratilgan vaqti bo'yicha) | |
| `GET /branches/:id` | ochiq | | `Branch` (`onlineState` bilan) | `not_found` |
| `POST /branches` | admin | `BranchFields` | `201 Branch` (`onlineState` siz) | `name_required`, `invalid_input` |
| `PATCH /branches/:id` | admin | `BranchFields` (`workHours` dan tashqari hammasi majburiy) | `Branch` | `not_found`, `name_required`, `invalid_input` |
| `PUT /branches/:id/delivery` | admin | `{ location: LatLng \| null, zone: LatLng[], fee: number, fallbackBranchId: string \| null, onlineEnabled: boolean }` | `Branch` | `not_found`, `zone_too_small`, `invalid_location`, `invalid_amount` (fee butun ≥ 0 emas) |
| `PUT /branches/:id/online` | admin | `{ enabled: boolean }` | `Branch` | `not_found` |
| `DELETE /branches/:id` | admin | | `204` — ombori (qoldiq yozuvlari), offline kaliti, TV va kiosk kodlari ham; boshqa filiallarning zaxirasi bo'lsa — `null` ga, taomlarning `unavailableBranchIds` idan chiqariladi | `not_found`, `in_use` — buyurtma (`orders`, o'tkazilganlari ham), smena (`shifts`), chiqim (`expenses`), xodim (`users`), omborida kirim / ko'chirish / harakat (`purchases`, `transfers`, `movements`) bor — faolsizlantiring |
| `GET /branches/:id/offline-key` | admin | | `{ key }` — filial offline kassasi (Electron ilova) kaliti `br_….<maxfiy qism>`; hali yo'q bo'lsa yaratiladi (bazada, `settings`) ([14](#14-offline-kassa-internet-yoq-paytda)) | `not_found` |
| `POST /branches/:id/offline-key` | admin | | `200 { key }` — yangi kalit, eskisi bilan kassa kompyuteri endi ulana olmaydi | `not_found` |
| `GET /branches/:id/tv-code` | admin | | `{ code }` — filial TV kodi, 8 raqam (`"48217390"`); hali yo'q bo'lsa yaratiladi (bazada, `settings`) ([4.4](#44-tv-va-kiosk)) | `not_found` |
| `POST /branches/:id/tv-code` | admin | | `200 { code }` — yangi kod; shu filialning ulangan TV lari darhol uziladi (`auth_error wrong_tv_code`), eski kod endi ishlamaydi | `not_found` |
| `GET /branches/:id/kiosk-code` | admin | | `{ code }` — filial kiosk kodi, 8 raqam; hali yo'q bo'lsa yaratiladi (TV kodidan alohida) ([4.4](#44-tv-va-kiosk)) | `not_found` |
| `POST /branches/:id/kiosk-code` | admin | | `200 { code }` — yangi kod; eskisi bilan kiosk buyurtma bera olmaydi (keyingi tekshiruvda kod so'raydi) | `not_found` |
| `GET /delivery/route` | ochiq | query: `lat: number`, `lng: number` | `DeliveryRoute` | `invalid_input`, `invalid_location` |

`BranchFields = { name: string ≤100, address: string ≤255, phone: string ≤30, active: boolean, workHours?: { open:
"HH:MM", close: "HH:MM" } | null }` — `name`, `address`, `phone`, `active` majburiy. `workHours`: `PATCH` da
yuborilmasa — **o'zgarmaydi**, `null` — 24/7 (cheklovsiz); `POST` da yuborilmasa — `null`. `open = close` —
`invalid_input`.

`POST /branches`: filial ombori (qoldiq 0) avtomatik ochiladi; menyudagi hamma faol taom darhol shu filialda ham
sotuvda (narx bir xil); `location: null`, `deliveryZone: []`, `deliveryFee: 0`, `onlineEnabled: true`. `PUT …/delivery` — to'liq almashtiradi: `location` / `fallbackBranchId` berilmasa `null` bo'ladi; `zone: []` —
hudud o'chiriladi; 1–2 nuqta — `zone_too_small`; `fallbackBranchId` filialning o'zi — `not_found`.

### 7.3 Menyu

| Metod va yo'l | Kim | So'rov | Javob | Xatolar |
|---|---|---|---|---|
| `GET /menu` | ochiq | query: `branchId` (majburiy), `all?: 'true'` — kassa uchun: shu filialda vaqtincha sotilmaydigan faol taomlar ham (`price: null`, "Sotilmaydi") va taomsiz faol kategoriyalar ham | `{ branchId, categories: Category[], products: MenuProduct[] }` ([5.3](#53-menyu)) | `not_found` (filial yo'q yoki faol emas) |
| `GET /categories` | admin | | `Category[]` (hammasi, `sortOrder` bo'yicha) | |
| `POST /categories` | admin | `{ name: LocalizedText, image: string ≤255, icon: string ≤255, active: boolean }` | `201 Category` (oxiriga qo'shiladi) | `name_required` |
| `PATCH /categories/:id` | admin | xuddi shunday (to'liq) | `Category` | `not_found`, `name_required` |
| `DELETE /categories/:id` | admin | | `204` | `not_found`, `in_use` (`products` — ichida taom bor, faol bo'lmagani ham) |
| `POST /categories/:id/move` | admin | `{ direction: -1 \| 1 }` (−1 — yuqoriga) | `204`; chetda bo'lsa o'zgarmaydi | `not_found` |
| `GET /products` | admin | | `Product[]` | |
| `POST /products` | admin | `{ categoryId, name: LocalizedText, image: string ≤255, recipe: { ingredientId, qty }[], price: number, unavailableBranchIds: string[], active: boolean, kitchen?: boolean }` (`kitchen` berilmasa — `true`) | `201 Product` | `name_required`, `invalid_price` (narx butun > 0 emas), `not_found` (kategoriya / mahsulot / filial), `invalid_qty` (qty butun ≥ 1 emas), `recipe_required` |
| `PATCH /products/:id` | admin | xuddi shunday (to'liq; `kitchen` berilmasa — o'zgarmaydi) | `Product` | xuddi shunday |
| `DELETE /products/:id` | admin | | `204` (rasm fayli qoladi — galereyada boshqasi ham ishlatishi mumkin) | `not_found`, `in_use` (`orders` — biror buyurtmada bor, bekor qilingani ham) |
| `POST /products/:id/move` | admin | `{ direction: -1 \| 1 }` — o'z kategoriyasi ichida | `204` | `not_found` |
| `GET /images` | admin | | `ImageFile[]` — `IMAGES_DIR` (`uploads`) dagi `products` va `categories` papkalaridagi rasmlar (qo'lda tashlanganlari ham), eng yangisi birinchi | |
| `POST /images` | admin | `multipart/form-data`: `file` (bitta rasm), `folder: 'products' \| 'categories'` | `201 ImageFile` — nom tozalanadi (`Cola Zero (1).PNG` → `cola-zero-1.png`), band bo'lsa `-2`, `-3`; kengaytma faylning haqiqiy turidan | `invalid_image`, `invalid_input` (`folder`) |
| `DELETE /images/:folder/:name` | admin | `folder: products \| categories`, `name` — fayl nomi (URL-kodlangan) | `204` — fayl papkadan o'chadi | `not_found` (papka / fayl yo'q, nomda `/` yoki `..`, rasm emas), `image_in_use` (taom, kategoriya — faol bo'lmagani ham — yoki kiosk ekranida; `detail`: `products: 2, categories: 1, kiosk`) |
| `GET /kiosk/images` | ochiq | | `{ images: string[] }` — kiosk bosh ekranidagi 3 ta rasm: o'rtadagi katta, tepadagi, pastdagi; admin tanlamagan bo'lsa — standart 3 ta (`uploads/products` dagi) | |
| `PUT /kiosk/images` | admin | `{ images: string[] }` — aniq 3 ta, har biri `/images/products/<fayl>`, `/images/categories/<fayl>` yoki `''` (doirada ikonka) | `{ images }` (`settings`: `kiosk_images`) | `invalid_input` |

`ImageFile`: `{ path: string, folder: 'products' | 'categories', name: string, size: number, modifiedAt: string }` —
`path` (`/images/products/cola.png`) taom / kategoriyaning `image` iga yoziladi.

`LocalizedText` da uchala kalit majburiy (≤ 200 belgi), `uz` bo'sh bo'lmasin. Retseptda bir mahsulot ikki qatorda
bo'lsa — qo'shiladi. Taom narxi barcha filiallarda bir xil; `unavailableBranchIds` — taom vaqtincha sotilmaydigan
filiallar (masalan, mahsuloti tugagan; bo'sh — hamma filialda sotuvda, takrorlari olib tashlanadi). Filial bo'yicha
alohida narx yo'q (2026-10-29 dan; oldingi `GET` / `PUT /prices` olib tashlandi).

### 7.4 Buyurtmalar (kassa, oshxona, kiosk, TV, mobil)

Umumiy qator: `OrderLine = { productId: string ≤40, qty: number }` (taomga izoh yo'q — qatordagi `note` jimgina
tashlanadi); buyurtma izohi `note?: string ≤500`. Narx, nom — bazadan (taom narxi).

| Metod va yo'l | Kim | So'rov | Javob | Xatolar |
|---|---|---|---|---|
| `POST /orders` | cashier | `{ id?: "ord_" + 16 hex, type: OrderType, items: OrderLine[], note?, payment: PaymentMethod, split?: PaymentSplit \| null }` — `id` kassa o'zi beradi: javob kelmay qolsa (internet uzildi) shu id bilan qayta yuborilgani ikkinchi marta yozilmaydi, birinchisi qaytadi | `201 Order` (`preparing`, kassir smenasiga) | `empty_order`, `invalid_amount`, `invalid_qty`, `not_found`, `product_unavailable`, `shift_not_open`, `invalid_input` (id shakli; id boshqa kassir / filial buyurtmasiniki) |
| `GET /orders/active` | cashier, kitchen, admin | query: `branchId` (faqat admin, majburiy) | `Order[]` — `pending` + `preparing`, eskisi birinchi | `branch_required` |
| `GET /orders/ready` | cashier, kitchen, admin | query: `branchId` (admin) | `Order[]` — so'nggi 5 daqiqada `ready` bo'lganlar, yangisi birinchi | `branch_required` |
| `GET /orders/delivery` | cashier, admin | query: `branchId` (admin) | `Order[]` — kuryer ishidagi mobil dostavkalar (kassaning "Dostavka" ro'yxati): `preparing` / `ready`, hali yetkazilmagan (`deliveredAt: null`), oxirgi 12 soatda yaratilgan — kuryer kutayotgan, olingan, yo'ldagi va "Yetkazib bo'lmadi" bilan qaytganlar; eskisi birinchi | `branch_required` |
| `GET /orders` | admin | query: `branchId?`, `status?`, `source?`, `type?`, `shiftId?`, `payment?` (aralash to'lovda o'sha qismi bori ham), `cashierId?`, `courierId?`, `number?`, `from?`, `to?` (ISO; `createdAt`: `from` kiradi, `to` kirmaydi), `page?`, `limit?` | `Page<Order> & { summary: { count, paid: { count, amount }, cancelled: { count, amount }, pending: { count, amount } } }` — yangisi birinchi; `summary` — filtrlangan **hamma** buyurtmalar bo'yicha (sahifadan qat'i nazar) | |
| `GET /orders/:id` | cashier, kitchen, admin | | `Order` (filial xodimi — faqat o'z filialiniki) | `not_found`, `forbidden` |
| `POST /orders/:id/confirm` | cashier | kiosk: `{ payment: PaymentMethod, split? }`; mobil: `{}` (to'lov — `online.payment`) | `200 Order` (`pending` → `preparing`) | `not_found`, `forbidden` (boshqa filial), `invalid_status`, `shift_not_open`, `invalid_amount` |
| `POST /orders/:id/ready` | kitchen (o'z filiali) | | `200 Order` (`preparing` → `ready`) | `not_found`, `forbidden`, `invalid_status` |
| `POST /orders/:id/reopen` | kitchen (o'z filiali) | | `200 Order` (`ready` → `preparing`) | `not_found`, `forbidden`, `invalid_status` |
| `POST /orders/:id/cancel` | cashier (o'z filiali), admin | | `200 Order` (`cancelled`, `cancelReason: null`) | `not_found`, `forbidden`, `invalid_status` (allaqachon bekor; kuryer yetkazgan) |
| `POST /orders/:id/release-courier` | cashier (o'z filiali), admin | | `200 Order` — kuryer maydonlari tozalanadi (`courierId`, `departedAt`, `returnedAt`, … `null`), dostavka yana kuryerlarning "Yangi" ro'yxatida. "Yetkazib bo'lmadi" bilan qaytgan yoki kuryer olib qolib ketgan buyurtma uchun | `not_found`, `forbidden`, `invalid_status` (kuryeri yo'q, yetkazilgan yoki bekor) |
| `POST /kiosk/orders` | kiosk kodi: `X-Kiosk-Code` ([4.4](#44-tv-va-kiosk)); IP: 30 / 60 s | `{ branchId: string ≤40, type: 'dine_in' \| 'takeaway', items, note?, payment?: 'card' \| 'click' \| null }` | `201 CustomerOrder` | `wrong_kiosk_code` (kod yo'q / noto'g'ri / yangilangan, filial noma'lum), `empty_order`, `invalid_qty`, `not_found` (kod to'g'ri, filial faol emas; taom), `product_unavailable`, `too_many_attempts` |
| `GET /kiosk/check` | kiosk kodi: `X-Kiosk-Code` | query: `branchId` (majburiy) | `{ ok: true }` — kod to'g'ri (kiosk kod kiritilganda va har mijozdan oldin tekshiradi) | `branch_required`, `wrong_kiosk_code` |
| `GET /tv/queue` | TV kodi: `X-Tv-Code` ([4.4](#44-tv-va-kiosk)) | query: `branchId` (majburiy) | `{ preparing: TvOrder[], ready: TvOrder[] }` | `branch_required`, `wrong_tv_code` (kod yo'q / noto'g'ri / yangilangan, filial noma'lum), `not_found` (kod to'g'ri, filial faol emas) |
| `POST /mobile/orders` | ochiq | [5.4](#54-buyurtma-berish) | `201 { order: CustomerOrder, trackingToken: string }` | [5.4](#54-buyurtma-berish) jadvali |
| `GET /mobile/orders/:id` | ochiq + `X-Order-Token` / `?token=` | | `CustomerOrder` | `not_found` |

Tafsilotlar:

- **Filial**: kassir / oshpaz — doim o'z filiali (`branchId` query e'tiborga olinmaydi); admin — `?branchId=`
  majburiy. TV — query `branchId` (hamma uchun majburiy, token bo'lsa ham); kiosk — tanadagi `branchId` (yo'q —
  `400 invalid_input`).
- **To'lov**: `payment` kassa buyurtmasida va kiosk buyurtmasini tasdiqlashda **har doim majburiy** (`split`
  berilganda ham). Aralash to'lov (`split`): kamida 2 ta nolga teng bo'lmagan qism, butun ≥ 0, yig'indisi aynan
  `total`; aks holda `invalid_amount`. Aralashda `payment` — eng katta qism (tengida `cash` → `card` → `click`
  tartibida birinchisi).
- **Kiosk**: `payment: null` / berilmasa — "kassada to'layman": `pending`, kassir `confirm` qiladi. `card` / `click` —
  darhol `preparing`, `cashierId` va `shiftId` — `null`. Naqd — yo'q.
- **Tasdiqlash**: kassirning shu filialda ochiq smenasi bo'lishi shart; buyurtma uning smenasiga yoziladi, mahsulotlar
  ombordan ayriladi.
- **TV navbati**: faqat kassa va kiosk buyurtmalari, zalda / olib ketish (mobil va dostavka TV ga chiqmaydi).
  `preparing` — `preparingAt` bo'yicha eskisi birinchi; `ready` — so'nggi 5 daqiqadagilar, yangisi birinchi. 5 daqiqa
  o'tgani haqida socket xabari kelmaydi — ekran `readyAt + 5 daqiqa` da o'zi olib tashlaydi.
- **Raqam** (`number`): filial bo'yicha har kuni (Asia/Tashkent) 1 dan.

### 7.5 Smenalar (`/shifts`)

| Metod va yo'l | Kim | So'rov | Javob | Xatolar |
|---|---|---|---|---|
| `GET /shifts/current` | cashier | | `{ shift: Shift \| null }` | |
| `POST /shifts/current` | cashier | | `200 Shift` — ochig'i bo'lsa o'sha, bo'lmasa yangi (masalan boshqa tabda topshirilgan) | |
| `POST /shifts/current/close` | cashier | | `200 ShiftWithSummary` — "Smenani topshirish" | `shift_not_open` |
| `GET /shifts` | admin | query: `branchId?`, `cashierId?`, `open?: 'true' \| 'false'`, `from?`, `to?` (ISO — oraliq bilan **kesishgan** smenalar: `to` dan oldin ochilgan va `from` dan keyin yopilgan yoki hali ochiq), `page?`, `limit?` | `Page<ShiftWithSummary> & { summary: { count, open, revenue, cash } }` — ochiqlari tepada, keyin yangisi; `summary` — filtrlangan hammasi bo'yicha | |
| `GET /shifts/:id` | admin, cashier (faqat o'ziniki) | | `ShiftWithSummary & { orders: Order[] }` | `not_found`, `forbidden` |
| `POST /shifts/:id/close` | admin | | `200 ShiftWithSummary` — kassir yopmay ketgan smena | `not_found`, `shift_not_open` (allaqachon yopilgan) |

Bitta kassirning bitta filialda bittadan ortiq ochiq smenasi bo'lmaydi. Smena yopilsa filial `no_shift` bo'lishi
mumkin (boshqa ochiq smena bo'lmasa) — mobil buyurtma olmaydi. Smena summasiga faqat shu smenaga yozilgan buyurtmalar
kiradi (kioskda karta / Click bilan to'langanlar — kirmaydi, [11](#11-cheklovlar-va-noaniq-joylar)).
Smena yopilgach (ikkala endpoint) Telegram botga hisobot ketadi — [13](#13-ai-yordamchi-va-telegram-bot); javob
uni kutmaydi.

### 7.6 Ombor

Hammasi — `admin` va `supplier`; kirimni tasdiqlash / rad etish — faqat `admin`.

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `GET /warehouses` | | `Warehouse[]` (markaziy birinchi) | |
| `GET /ingredients` | | `Ingredient[]` (guruh, id bo'yicha) | |
| `POST /ingredients` | `{ name: LocalizedText, group: IngredientGroup, unit: StockUnit, active: boolean, lastPrice?: number \| null }` | `201 Ingredient` | `name_required`, `invalid_price`, `forbidden` (ta'minotchi narx yubordi) |
| `PATCH /ingredients/:id` | `{ name, group, active, lastPrice?: number 
| `DELETE /ingredients/:id` | | `204` — qoldiq yozuvlari ham (harakatsiz — 0) | `not_found`, `in_use` — retseptda (`recipes`), kirimda (`purchases`), ko'chirishda (`transfers`), qoldiq harakatida (`movements`) |\| null }` (`unit` o'zgarmaydi — yuborilsa tashlanadi) | `Ingredient` | `not_found`, `name_required`, `invalid_price`, `forbidden` |

`lastPrice` — 1 birlik (kg / l / dona) narxi, so'm, butun ≥ 0; **faqat admin** yuboradi (ta'minotchi — `403
forbidden`, u narxsiz qo'shadi / tahrirlaydi). Yuborilmasa — o'zgarmaydi, `null` — narxsiz. Keyingi kirimga avtomatik
yoziladi va kirim tasdiqlanganda yangilanadi.
| `GET /stock` | query: `warehouseId?` | `StockItem[]` (yozuvi yo'q mahsulot — qoldiq 0) | |
| `GET /stock/low` | query: `warehouseId?` | `StockItem[]` — `minQty > 0` va `qty < minQty` | |
| `PUT /stock/:warehouseId/:ingredientId/min-qty` | `{ minQty: number }` — asosiy birlikda, butun ≥ 0 (0 — kuzatilmaydi) | `StockItem` | `not_found`, `invalid_qty` |
| `GET /movements` | query: `warehouseId?`, `ingredientId?`, `kind?`, `refId?`, `page?`, `limit?` (standart 100) | `Page<StockMovement & { refNumber: number \| null; refWarehouseId: string \| null }>` (yangisi birinchi) — `refNumber`: buyurtma / kirim / ko'chirish raqami; `refWarehouseId`: ko'chirishda ikkinchi ombor (kirimda — qayerdan, chiqimda — qayerga) | |
| `GET /purchases` | query: `status?`, `warehouseId?`, `page?`, `limit?` | `Page<Purchase>` | |
| `GET /purchases/:id` | | `Purchase` | `not_found` |
| `POST /purchases` | `{ warehouseId, items: { ingredientId, qty }[] (ombor birligida, > 0), note?: string ≤1000 }` | `201 Purchase` (`pending`; narx — `lastPrice` dan) | `empty_order`, `not_found`, `invalid_qty` |
| `POST /purchases/:id/approve` | admin: `{ prices?: { [ingredientId]: number } }` — 1 birlik narxi (so'm, butun ≥ 0); berilmagani kirimdagi narxida qoladi | `200 Purchase` (`approved`) — qoldiqqa qo'shiladi, `lastPrice` yangilanadi | `not_found`, `already_decided`, `invalid_price` |
| `POST /purchases/:id/reject` | admin | `200 Purchase` (`rejected`) | `not_found`, `already_decided` |
| `GET /transfers` | query: `warehouseId?` (chiqqan yoki kirgan), `page?`, `limit?` | `Page<Transfer>` | |
| `POST /transfers` | `{ fromWarehouseId, toWarehouseId, items: { ingredientId, qty }[] (> 0), note?: string ≤1000 }` | `201 Transfer` — bitta tranzaksiyada chiqim + kirim | `same_warehouse`, `empty_order`, `not_found`, `invalid_qty`, `insufficient_stock` |

`createdBy`, `decidedBy` — tokendan. Ko'chirish qoldiqdan oshmaydi (bir mahsulot ikki qatorda bo'lsa — jami); sotuv
esa qoldiqni manfiyga tushirishi mumkin.

### 7.7 Xodimlar (`/users`) — admin

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `GET /users` | admin, supplier (kirim / ko'chirish muallifi ismi uchun) | `User[]` (qo'shilgan vaqti bo'yicha) | |
| `GET /users/couriers` | admin, cashier (kassaning "Dostavka" ro'yxati — kuryer ismi va ishdagilar soni; admin "Xodimlar" — kuryerlar holati) | `CourierStatus[]` (bloklanganlari ham, ism bo'yicha): `{ id, name, surname, active, onDuty, orders, branchId, departed }` — `onDuty` — ilovada "Ishdaman"; `orders` — qo'ldagi (olgan, hali yetkazmagan / qaytarmagan) buyurtmalar soni; `branchId` — ular qaysi filialdan (bo'sh qo'l — `null`); `departed` — "Yo'lga chiqdim" bosgan | |
| `POST /users` | `{ name: string ≤100, surname: string ≤100, role: Role, branchId?: string \| null, pin?: string ≤8, email?: string ≤100, password?: string ≤64, active: boolean }` — admin va kuryer: `email` + `password` (PIN'siz), boshqalar: `pin` | `201 User` | `name_required`, `surname_required`, `branch_required`, `not_found` (filial), `invalid_pin`, `invalid_email`, `invalid_password`, `email_taken` |
| `PATCH /users/:id` | xuddi shunday (to'liq); `pin: ""` / `password: ""` — eskisi qoladi; PIN'li rol ↔ admin / kuryer o'tishida yangisi majburiy (eski PIN parol bo'lib qolmasin) | `User` | yuqoridagilar + `not_found`, `self_action` (o'zini bloklash / o'z rolini o'zgartirish) |
| `DELETE /users/:id` | | `204` — Telegram chatlari va AI xotirasi ham | `not_found`, `self_action` (o'zini), `in_use` — buyurtma (`orders`, `deliveries`, `cancellations`), smena (`shifts`), kirim (`purchases`), ko'chirish (`transfers`), chiqim (`expenses`) — bloklang |

`cashier` / `kitchen` uchun `branchId` majburiy; `admin` / `supplier` / `courier` da yuborilsa ham `null` saqlanadi.
PIN bilan kiradiganlarda `email` yuborilsa ham `null` saqlanadi. Izi bor xodimni o'chirib bo'lmaydi — `active: false`
(eski token darhol ishlamaydi).

### 7.8 Chiqimlar (`/expenses`) — admin

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `GET /expenses` | query: `branchId?`, `from?`, `to?` (`YYYY-MM-DD`, ikkalasi kiradi) | `Expense[]` (sahifalashsiz, sanasi bo'yicha yangisi birinchi) | |
| `POST /expenses` | `{ branchId, kind: ExpenseKind, amount: number (butun > 0), date: "YYYY-MM-DD", note?: string ≤500 }` | `201 Expense` | `not_found`, `invalid_amount` (summa yoki sana formati) |
| `DELETE /expenses/:id` | | `204` | `not_found` |

### 7.9 Hisobotlar (`/reports`) — admin

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `GET /reports/sales` | query: `from`, `to` (`YYYY-MM-DD`, majburiy, ikkalasi kiradi), `branchId?` (berilmasa / bo'sh — butun tarmoq) | `SalesReport` | `invalid_input` (format yoki mavjud bo'lmagan sana, `detail`: `from: 2026-02-30`) |
| `GET /reports/overview` | | `{ liveOrders: { branchId: string; count: number }[], lowStock: number, pendingPurchases: number, firstOrderDate: "YYYY-MM-DD" \| null }` — `firstOrderDate`: birinchi buyurtma kuni (undan oldingi davr bilan solishtirish ma'nosiz) | |

`SalesReport` — web ilovadagi `salesReport()` (`ReactJS_NYFF/src/domain/logic/reports.ts`) bilan bir xil shakl va
natija:

```ts
type Tally = { orders: number; revenue: number }
interface SalesReport extends Tally {      // orders / revenue — to'langan (preparing / ready) buyurtmalar
  cancelled: number; cancelledAmount: number
  avgCheck: number                         // round(revenue / orders), buyurtma yo'q — 0
  byPayment: { cash: number; card: number; click: number }     // aralashda — qismlari
  byType: Record<OrderType, Tally>
  bySource: Record<OrderSource, Tally>
  byHour: number[]                         // 24 ta: soat bo'yicha tushum (mahalliy)
  days: { date: string; orders: number; revenue: number; expenses: number }[]   // oraliqdagi har kun, bo'shlari 0 bilan
  topProducts: { productId: string; name: LocalizedText; qty: number; revenue: number }[]   // tushum bo'yicha kamayish
  byBranch: { branchId: string; orders: number; revenue: number; expenses: number }[]
  expenses: number
  expensesByKind: Record<ExpenseKind, number>
  net: number                              // revenue − expenses
}
```

- Kun va soat — buyurtma `createdAt` ining mahalliy (`TZ`) sanasi / soati; `pending` buyurtmalar umuman kirmaydi;
  bekor qilinganlar — faqat `cancelled` / `cancelledAmount` da. Hammasi bitta suratdan (REPEATABLE READ).
- `from > to` — xato emas, bo'sh hisobot (`days: []`, nollar). Oraliq ko'pi bilan 400 kun — undan keyingi kunlar
  kirmaydi.
- `byBranch` — barcha filiallar (faol bo'lmaganlari ham; `branchId` berilsa — faqat o'sha), yaratilgan vaqti bo'yicha.
  Noma'lum `branchId` — xato emas, bo'sh hisobot.
- `topProducts[].name` — taom birinchi uchragan buyurtmadagi nom; tushum teng bo'lsa — birinchi uchragani oldin.

`overview` (admin bosh sahifasi): `liveOrders` — faol filiallar bo'yicha `pending` + `preparing` buyurtmalar soni
(buyurtmasiz filial — `0`); `lowStock` — `minQty > 0` va `qty < minQty` bo'lgan qoldiq yozuvlari soni (barcha
omborlar); `pendingPurchases` — tasdiq kutayotgan kirimlar soni.

### 7.10 Holat

`GET /health` — ochiq → `{ "ok": true }`.

---

## 8. Socket.IO

Socket — faqat serverdan ekranlarga "o'zgardi" xabari. **Buyruqlar faqat REST orqali**; socket'ga yuborilgan
xabarlar e'tiborga olinmaydi. `pingInterval` / `pingTimeout` — 10 soniya.

### 8.1 Ulanish (`auth`)

| `auth` | Kim | Xona | Izoh |
|---|---|---|---|
| `{ token: "<JWT>" }` | `cashier`, `kitchen` | `branch:<branchId>` | `Bearer ` siz. Admin, ta'minotchi tokeni — rad etiladi |
| `{ token: "<JWT>" }` | `courier` | `couriers`, `courier:<userId>` | [12](#12-kuryer-ilovasi-android) |
| `{ tvBranchId: "<branchId>", tvCode: "<8 raqam>" }` | TV (filial TV kodi bilan, [4.4](#44-tv-va-kiosk)) | `tv:<branchId>` | kod yo'q / noto'g'ri — `auth_error { code: "wrong_tv_code" }`; kod to'g'ri, filial faol emas — `unauthorized`. Kioskka socket kerak emas |
| `{ orderId: "ord_…", orderToken: "<trackingToken>" }` | mobil ilova | `order:<orderId>` | |

Tekshiruv `auth` maydonlari shu tartibida: `token` bor bo'lsa — faqat u; keyin `tvBranchId`; keyin `orderId` +
`orderToken`.

### 8.2 Hodisalar (server → mijoz)

| Hodisa | Tana | Qachon |
|---|---|---|
| `ready` | `{ rooms: string[] }` | ulanish tasdiqlandi |
| `auth_error` | `{ code }` — `"unauthorized"`; TV da `"wrong_tv_code"` (kod noto'g'ri yoki admin yangiladi) | ruxsat yo'q — darhol keyin server uzadi (`io server disconnect`); avtomatik qayta ulanmaydi |
| `order` | `branch:` — `Order`; `tv:` — `TvOrder`; `order:` — `CustomerOrder`; `couriers` — `CourierSignal`; `courier:` — `CourierOrder` | buyurtma yaratildi yoki o'zgardi (tranzaksiya tugagach) |

`order` qaysi xonalarga boradi:

- `branch:<order.branchId>` — har doim; mobil buyurtma boshqa filialga o'tkazilganda **eski filial xonasiga ham** (yangi
  `branchId` bilan) — eski filial ekrani uni ro'yxatdan olib tashlaydi;
- `tv:<branchId>` — faqat kassa / kiosk, zalda / olib ketish buyurtmalari, **har qanday holatda** (`pending`,
  `cancelled` ham) — TV faqat `preparing` va `ready` ni ko'rsatadi, qolganini olib tashlaydi;
- `order:<id>` — faqat mobil buyurtma;
- `couriers` — har bir mobil dostavka o'zgarishi (belgi, mijoz ma'lumotisiz); `courier:<courierId>` — olgan kuryerga
  to'liq ko'rinish.

Mijoz qoidasi: kelgan buyurtmani `id` bo'yicha almashtiring / qo'shing; `branchId` boshqa bo'lsa yoki holat ro'yxatga
mos bo'lmasa — olib tashlang. Uzilish paytidagi xabarlar yo'qoladi — **har (qayta) ulanishda ro'yxatni REST'dan qayta
oling** (`/orders/active`, `/orders/ready`, `/tv/queue`, `/mobile/orders/:id`). Huquq bekor bo'lsa — xodim
bloklansa yoki roli / filiali o'zgarsa — server `auth_error` yuborib socketni **darhol uzadi**; qayta ulanmang,
foydalanuvchini kirish ekraniga qaytaring. TV ulanishi ulanish paytida tekshiriladi (kod to'g'ri, filial faol);
admin TV kodini yangilasa — shu filial TV lari `auth_error { code: "wrong_tv_code" }` bilan darhol uziladi: TV kodni
qayta so'rasin.

### 8.3 Kim nima kutadi

| Ekran | REST (boshlanishda va qayta ulanishda) | Socket |
|---|---|---|
| Kassa | `/orders/active`, `/orders/ready` | `{ token }` — kassir |
| Oshxona | `/orders/active`, `/orders/ready` | `{ token }` — oshpaz yordamchisi |
| TV | `/tv/queue?branchId=` + `X-Tv-Code` | `{ tvBranchId, tvCode }` |
| Mobil ilova | `/mobile/orders/:id` | `{ orderId, orderToken }` |
| Kuryer ilovasi | `/courier/orders/available`, `/courier/orders` | `{ token }` — kuryer |
| Kiosk, admin, ombor | sahifa ochilganda yuklanadi | yo'q |

### 8.4 "Kassa ulangan" va filial online holati

Filial `open` bo'lishi uchun (`onlineState`): faol + admin to'xtatmagan + ish vaqti ichida + kamida bitta ochiq smena
+ **kamida bitta kassa ekrani ulangan**:

- faqat **kassir** tokeni bilan ulangan socket hisoblanadi (oshxona, TV, mobil — yo'q); smenaga bog'lanmagan;
- oxirgi kassa socketi uzilgandan keyin yana **60 soniya** "ulangan" hisoblanadi (Wi-Fi bir lahza uzilishi);
- server ishga tushgandan keyingi 60 soniyada barcha filiallar "ulangan" (kassalar qayta ulanib ulgurishi uchun);
- `ONLINE_REQUIRE_KASSA=0` — shart o'chiq (web ilova socket'ga ulanmaguncha shunday ishlating);
- holat server xotirasida — bitta server uchun (bir nechta server — keyin Redis adapter).

Kassa ekrani yopilsa / uzilsa ~1 daqiqadan keyin filial `no_kassa` bo'ladi; kutayotgan mobil buyurtmalar fon ishida
(≤ 30 s) o'tkaziladi yoki bekor qilinadi ([5.6](#56-holat--ui-matni)).

---

## 9. Web ilovani ulash

**Bajarildi (2026-10-27):** web ilova shu API'ga ulangan — `ReactJS_NYFF/src/api/` (`http.ts`, `query.ts`,
`queries.ts`, `index.ts`, `session.ts`, `realtime.ts`). Quyidagi jadval — eski localStorage buyruqlari
qaysi endpointga o'tganini ko'rsatadi (tarix uchun).

**Manzil (2026-11-03):** web ilova `/shorva/` bilan build qilinadi (`vite.config.ts` — `base`, `UI_BASE`; router
`basename` va `assetUrl` shundan) — server uni `/shorva/...` dan beradi, ishlab chiqishda — `http://localhost:5173/shorva/`.
API, Socket.IO, taom / kategoriya rasmlari — ildizdan (`/api`, `/socket.io`, `/images`). "NYFF Offline" o'z build'ini
`--base /` bilan oladi (offline kassa — `http://localhost:3100/offline`); xodimlar tizimi sahifasi `noindex`.

`ReactJS_NYFF/src/api/index.ts` dagi buyruqlar → endpointlar (xodim id'lari yuborilmaydi — tokendan):

| `api.*` | Endpoint |
|---|---|
| `orders.create(input)` | `POST /orders` (kassa); kiosk — `POST /kiosk/orders` (kiosk kodi bilan, `branchId` tanada); mobil demo — `POST /mobile/orders` |
| `orders.confirm(id, cashierId, payment, split)` | `POST /orders/:id/confirm` `{ payment, split }` |
| `orders.ready(id, userId)` / `orders.reopen(id, userId)` | `POST /orders/:id/ready` / `POST /orders/:id/reopen` |
| `orders.cancel(id, userId)` | `POST /orders/:id/cancel` |
| `shifts.openOrResume(cashierId, branchId)` | `POST /shifts/current` (kirishda — `POST /auth/login` ning o'zi ochadi) |
| `shifts.close(shiftId)` | kassir — `POST /shifts/current/close`; admin — `POST /shifts/:id/close` |
| `purchases.create` / `approve(id, prices, adminId)` / `reject(id, adminId)` | `POST /purchases` / `POST /purchases/:id/approve` `{ prices }` / `POST /purchases/:id/reject` |
| `transfers.create` | `POST /transfers` |
| `ingredients.save(input)` | `POST /ingredients` (yangi) / `PATCH /ingredients/:id` |
| `ingredients.setMinQty(w, i, minQty)` | `PUT /stock/:w/:i/min-qty` |
| `users.changeOwnPin(userId, old, new)` | `PUT /auth/pin` |
| `users.save(input, actorId)` | `POST /users` / `PATCH /users/:id` |
| `branches.save(input)` | `POST /branches` / `PATCH /branches/:id` |
| `branches.saveDelivery(input)` | `PUT /branches/:id/delivery` |
| `branches.setOnline(id, enabled)` | `PUT /branches/:id/online` |
| `menu.saveCategory` / `saveProduct` | `POST` / `PATCH /categories`, `/products` |
| `menu.moveCategory` / `moveProduct` | `POST /categories/:id/move`, `POST /products/:id/move` |
| `expenses.create` / `delete` | `POST /expenses` / `DELETE /expenses/:id` |
| sessiya: `login` / `adminLogin` / `unlockSession` / `ensureCashierShift` | `POST /auth/login` / `POST /auth/admin-login` / `POST /auth/unlock` / `POST /shifts/current`; sahifa yangilanganda `GET /auth/me` |

O'qish (`useDb()` o'rniga): `GET /branches`, `/warehouses`, `/users`, `/auth/staff`, `/categories`, `/products`,
`/menu`, `/ingredients`, `/stock`, `/stock/low`, `/movements`, `/purchases`, `/transfers`, `/orders`,
`/orders/active`, `/orders/ready`, `/shifts`, `/shifts/:id`, `/expenses`, `/reports/*`.

Frontend turlaridan farqlar:

- `Order`: `split`, `online` — `undefined` emas, `null`; yangi maydonlar `cancelReason`, `routedAt`, `transferCount`,
  `fromBranchId`, `online.location`.
- `Branch`: yangi `workHours`, `onlineState`; `BranchOnlineState` ga yangi qiymatlar `off_hours`, `no_kassa`
  (`OnlinePill` va matnlar).
- `User`: `pin` yo'q (hech qachon qaytmaydi).
- `Product`: `price` va `unavailableBranchIds` (2026-10-29); `BranchPrice` va «Narxlar» sahifasi yo'q.
- Yangi: `ShiftWithSummary`. TV / kiosk — kirish ekranida filial tanlanadi (`/tv/<branchId>`, `/kiosk/<branchId>`),
  PIN yo'q (avvalgi "Qurilmalar" sahifasi va ulash oynasi 2026-10-27 da olib tashlangan). TV va kiosk — birinchi
  ochilganda filial kodi (2026-11-03, [4.4](#44-tv-va-kiosk)): `localStorage` da `nyff:tv-code:<branchId>`,
  `nyff:kiosk-code:<branchId>` (`src/store/screenCodes.ts`), kod formasi — `ScreenCodeForm`; admin "Filiallar" da —
  "TV kodi" / "Kiosk kodi" oynasi (`ScreenCodeModal`).
- i18n'ga: backend xato kodlari ([3](#3-xatolar)), `cancelReason` matnlari, yangi `onlineState` matnlari.
- Token — `sessionStorage` (har tab alohida, hozirgidek); `401` → kirish ekrani.

---

## 10. Yangi baza (birinchi ishga tushirish)

2026-11-02 dan ilovada demo ma'lumot **yo'q** (`DEMO`, `npm run seed`, `POST /demo/reset` olib tashlandi) — hamma
narsa admin panelda qo'lda kiritiladi.

- Bo'sh bazada (xodim yo'q) server ishga tushganda **bitta admin** yaratiladi: **Admin Adminov**,
  `admin@gmail.com` / `123456789` (kirgach "Profil" da — `PUT /auth/profile`, `PUT /auth/password` — almashtiring).
  Markaziy ombor bo'lmasa — **"Markaziy ombor"** ham. Ma'lumoti bor bazaga tegilmaydi (`src/setup`).
- Keyin admin: filiallar (har biriga o'z ombori o'zi ochiladi) → ombor mahsulotlari → kategoriyalar va taomlar
  (retsept bilan) → xodimlar → ta'minotchi kirim bilan boshlang'ich qoldiqni kiritadi.
- Mavjud bazani yangilash (migratsiya `StaffEmailSurname`): kuryer emaili — `<eski login>@gmail.com` (paroli
  o'zgarmaydi); email'i yo'q adminlar — `admin@gmail.com`, `admin2@gmail.com`, … (paroli `123456789`); familiya —
  bo'sh (admin "Xodimlar" da to'ldiradi).

Testlar (`npm run test:db`) o'z sinov to'plamida ishlaydi — `test/fixtures` (avvalgi demo ma'lumot: 2 filial, 10 xodim,
menyu, ombor, 30 kunlik tarix), alohida `nyff_test` bazasida.

---

## 11. Cheklovlar va noaniq joylar

Kodning hozirgi xatti-harakati (o'zgarsa — shu yer yangilanadi):

- **Yetkazish narxi** summaga qo'shilmaydi (`total` — faqat taomlar); mobil dostavkada buyurtma berilgandagi hudud
  narxi `deliveryFee` da saqlanadi (2026-10-27 dan; undan oldingilarda `null`) — mijoz kuryerga naqd beradi.
- **Kuryer**: masofalar to'g'ri chiziq bo'yicha (bepul); kuryer haqi hisoblanmaydi; kuryer joylashuvi kuzatilmaydi;
  "Yangi" ro'yxatiga faqat oxirgi 12 soatda yaratilgan mobil dostavkalar chiqadi (kassada yaratilgan dostavka — yo'q,
  unda manzil yo'q).
- **Click** ulanmagan, **FCM push** yo'q.
- Mobil buyurtma o'tkazilganda narx va `total` o'zgarmaydi; tasdiqlanganda mahsulot yangi filial omboridan ayriladi.
- Kioskda karta / Click bilan to'langan buyurtma hech bir smenaga yozilmaydi (`shiftId: null`) — smena tushumiga
  kirmaydi (sana bo'yicha hisobotga kiradi). Frontenddagidek: bu pul kassa qutisidan o'tmaydi.
- Admin va ta'minotchi socket'ga ulana olmaydi — admin sahifalari ma'lumotni so'rov bilan yangilaydi (ROADMAP 0).
- **Kioskda karta / Click** bilan kelgan buyurtma kassir tasdiqlamasdan oshxonaga ketadi (haqiqiy to'lov ulanmagan —
  10-bosqich): kiosk yonidagi mijoz "Karta" ni bosib, to'lamay ketishi mumkin. 2026-11-03 dan kiosk buyurtmasi faqat
  filial kiosk kodi bilan ([4.4](#44-tv-va-kiosk)) — uydan (kodsiz) buyurtma bo'lmaydi, lekin bu muammoni kod yopmaydi.
- To'lanmagan ("kassada to'layman") kiosk buyurtmasi o'zi bekor bo'lmaydi — kassir bekor qilmaguncha "Kiosk" ro'yxatida.
- Ba'zi xato kodlari frontend bilan bir xil bo'lishi uchun shunday: mobil `dine_in` — `invalid_status` (409);
  zaxira filial filialning o'zi — `not_found`; chiqim sanasi — `invalid_amount`.
- PIN almashtirilganda eski tokenlar 24 soat amal qilaveradi (xodim bloklansa — darhol bekor).

---

## 12. Kuryer ilovasi (Android)

Kuryer — xodim (`role: courier`, filialga bog'lanmagan). Kuryer qismi mijoz ilovasi (`Kotlin_NYFF`) ichida: "NY"
belgisiga 10 marta bosib ochiladi → email va parol (`POST /auth/courier-login`, [4.3](#43-xodim-kirishi); admin
"Xodimlar" da ochadi) → sessiya telefonda qoladi, ilova keyin to'g'ridan-to'g'ri kuryer ekranida ochiladi → "Ishdaman" →
filialni tanlab "Yangi" ro'yxatidan buyurtma olish → filialda kutish → "Yo'lga chiqdim" → server taklif qilgan tartibda
yetkazish. Kelishilgan qoidalar (2026-10-27):

- istalgan filialning **mobil dostavkasini** oladi, lekin **bir vaqtda faqat bitta filialnikini** (`other_branch`);
  soni cheklanmagan; yo'lga chiqqandan keyin yangisini ololmaydi (`courier_busy`) — hammasini tugatguncha;
- **naqd buyurtma**: kuryer pulni filialdan olayotganda **kassaga o'zidan to'laydi**, keyin mijozdan oladi (buyurtma
  summasi kassir qabul qilgan paytda uning smenasiga yozilgan); `click` — to'langan, mijozdan faqat yetkazish narxi;
- **tartib** — server taklif qiladi, kuryer o'zgartira olmaydi: mijozlar o'rtacha eng kam kutadigan tartib (har bir
  mijozga yetib borish masofalari yig'indisi eng kichigi), masofa — to'g'ri chiziq bo'yicha. Yo'lga chiqqanda — filialdan,
  har "Yetkazildi" / "Yetkazib bo'lmadi" dan keyin — shu manzildan qolganlari qayta tartiblanadi;
- **"Yetkazib bo'lmadi"** — sabab (`no_answer` mijoz javob bermadi, `wrong_address` manzil topilmadi, `refused` mijoz
  olmadi, `other`) va izoh; buyurtma filialga qaytadi, kuryer filial / admin bilan telefonda gaplashadi; kassir yoki admin
  `POST /orders/:id/release-courier` (yana "Yangi" ga) yoki `/cancel` qiladi. Kassada bular — "Dostavka" ro'yxatida
  (`GET /orders/delivery`, qaytgani tepada), adminda — buyurtma tafsilotida;
- mijozga faqat holat ("Kuryer yo'lda", "Yetkazildi") — kuryer kimligi va navbati yo'q;
- kuryer haqi hisoblanmaydi, joylashuvi kuzatilmaydi (hozircha).

```ts
/** "Yangi" ro'yxati — mijoz ismi va telefonisiz (olgandan keyin ko'rinadi). */
interface AvailableOrder {
  id: string; branchId: string; number: number
  status: 'preparing' | 'ready'
  createdAt: string; preparingAt: string | null; readyAt: string | null
  items: OrderItem[]; total: number
  payment: 'cash' | 'click' | null   // mijoz tanlagani
  deliveryFee: number | null         // hudud narxi; null — narxni kuryer aytadi
  address: string; location: LatLng | null
  distanceKm: number | null          // filialdan mijozgacha (to'g'ri chiziq)
  extraKm: number | null             // qo'ldagi buyurtmalar yo'liga qo'shilsa yo'l qancha uzayadi; qo'l bo'sh — null
  blocked: 'off_duty' | 'courier_busy' | 'other_branch' | null   // nega olib bo'lmaydi; null — olsa bo'ladi
}

/** Kuryer olgan buyurtma (REST va socket `courier:<id>`). */
type CourierOrder = Pick<Order, 'id' | 'branchId' | 'number' | 'items' | 'note' | 'total' | 'online' | 'status'
  | 'createdAt' | 'preparingAt' | 'readyAt' | 'cancelledAt' | 'deliveryFee' | 'courierId' | 'takenAt' | 'departedAt'
  | 'deliveredAt' | 'returnedAt' | 'returnReason' | 'returnNote' | 'courierSeq' | 'courierLegKm'>

/** Socket `couriers` xonasiga — faqat belgi: ro'yxatlarni REST'dan qayta oling. */
type CourierSignal = { id: string; branchId: string; number: number; status: OrderStatus; courierId: string | null }

/** Kuryerning buyurtmalari: qo'ldagilar (yo'lda — `courierSeq` bo'yicha, aks holda olingan vaqti) va bugun tugatganlari. */
type CourierOrders = { active: CourierOrder[]; done: CourierOrder[] }

type CourierState = { user: AuthUser; onDuty: boolean; branchId: string | null; departed: boolean }
```

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `GET /courier/me` | | `CourierState` (`branchId` — qo'ldagi buyurtmalar filiali, `departed` — yo'ldami) | |
| `PUT /courier/duty` | `{ onDuty: boolean }` | `CourierState` | |
| `GET /courier/orders/available` | | `AvailableOrder[]` — hali hech kim olmagan (`preparing` / `ready`) mobil dostavkalar, oxirgi 12 soatdagi, eskisi birinchi | |
| `GET /courier/orders` | | `CourierOrders` | |
| `POST /courier/orders/:id/take` | | `200 CourierOrders`; o'zi olgan bo'lsa — takroriy bosish xato emas | `off_duty`, `already_taken`, `courier_busy`, `other_branch`, `invalid_status` (dostavka emas / tayyorlanmagan / bekor), `not_found` |
| `POST /courier/orders/:id/release` | | `200 CourierOrders` — yo'lga chiqmasdan qaytarib berish | `forbidden` (o'ziniki emas), `invalid_status` (yo'lga chiqqan) |
| `POST /courier/depart` | | `200 CourierOrders` — hammasi `departedAt`, `courierSeq` 1… , `courierLegKm` (filialdan) | `empty_order` (qo'l bo'sh), `not_ready` (`detail`: raqamlar) |
| `POST /courier/orders/:id/deliver` | | `200 CourierOrders` — `deliveredAt`; qolganlari shu manzildan qayta tartiblanadi (`courierSeq` davom etadi) | `forbidden`, `invalid_status` (yo'lga chiqmagan / tugagan / bekor) |
| `POST /courier/orders/:id/return` | `{ reason: ReturnReason, note?: string ≤300 }` | `200 CourierOrders` — `returnedAt`, sabab; qolganlari qayta tartiblanadi | `forbidden`, `invalid_status`, `invalid_input` |

Hamma `/courier/*` — faqat `courier` roli (boshqa xodimga `403 forbidden`). Kuryer ro'yxatidan buyurtma tushadi: yetkazilsa,
qaytarilsa yoki bekor qilinsa (`status: cancelled`).

**Xarita havolalari** (bepul, kalitsiz — ilova `CourierOrder.online.location` dan yasaydi; boshlanish — telefonning joriy
joyi):

- bitta manzil: `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=driving`,
  `https://yandex.uz/maps/?rtext=~<lat>,<lng>&rtt=auto`;
- hammasi tartib bilan: Google — `https://www.google.com/maps/dir//<lat1>,<lng1>/<lat2>,<lng2>/…` (boshida bo'sh —
  joriy joy; `api=1&waypoints=` formati Android'dagi Google Maps ilovasida oraliq nuqtalarni tashlab yuboradi —
  emulyatorda tekshirilgan); Yandex — `https://yandex.uz/maps/?rtext=~<lat1>,<lng1>~<lat2>,<lng2>~…&rtt=auto`.

**Socket** ([8](#8-socketio)): `auth: { token }` → `couriers` (har mobil dostavka o'zgarganda `CourierSignal`) va
`courier:<userId>` (o'z buyurtmasi — `CourierOrder`). Har xabarda va qayta ulanishda ro'yxatlarni REST'dan qayta oling.

---

## 13. AI yordamchi va Telegram bot

Faqat **admin** (direktor) uchun (2026-10-29). Direktor savol yozadi ("Bugungi tushum qancha?", "Shu haftada dostavkadan
qancha tushdi?", "Qaysi mahsulotlar kam qoldi?", "Hozir qaysi filiallar ishlayapti?") — server Gemini'ga (`@google/genai`,
model — `GEMINI_MODEL`) yuboradi, model kerakli ma'lumotni **tool**'lar orqali so'raydi, server ularni bajaradi va natija
asosida model javob yozadi. Ikki kanal: admin paneldagi chat va Telegram bot — ikkalasi bitta `AiService`.

- **Tool'lar faqat o'qiydi** (hech narsani o'zgartirmaydi): `sales_report` (davr tushumi, to'lov / buyurtma turi / manba
  bo'yicha, kommunal chiqimlar va sof, filiallar, har taom sotuvi va sotilmaganlar, gavjum soatlar, kunlar yoki oylar),
  `current_status` (filiallar: ishlayaptimi — ochiq smena, kassirlar, faol buyurtmalar, online holati; ishdagi kuryerlar),
  `shifts` (smena jami — butun smena uchun, bir necha kunga cho'zilishi mumkin), `expenses`, `purchases` (masalliq xaridlari),
  `stock` (qoldiq, kam qolganlar — o'z birligida; filial ombori — filialning hozirgi nomi bilan), `orders`, `menu`
  (kategoriyalar tartibida taomlar va narxlar, filialda sotilmaydiganlari, o'chirilganlari).
- Modelga **mijoz ismi, telefoni va manzili yuborilmaydi**; filial, kassir, mahsulot — nomi bilan.
- Javob — **oddiy matn** (Markdown belgilari olib tashlanadi, ro'yxat «•»), **doim Xorazm shevasida** (savol adabiy,
  shevada, ruscha yoki inglizcha bo'lishi mumkin). Ikki so'rov: tool'lar bilan adabiy javob → alohida so'rov uni direktor
  lug'ati (`src/ai/xorazm.ts`) bo'yicha shevaga o'giradi; o'girish xato bersa — adabiy javob. Bitta savol ≈ 3 ta Gemini
  so'rovi (bepul tarifda 15 ta / daqiqa).
- **Tarix saqlanmaydi va ko'rsatilmaydi** (2026-10-29): web chat har ochilganda (yangilanganda ham) yangi suhbat —
  oldingisi bazadan o'chadi, xabarlar faqat sahifada; Telegram'da yozishmani Telegram o'zi saqlaydi. Bazada
  (`ai_messages`) faqat AI xotirasi — har chatda oxirgi 20 ta xabar (suhbat ichida "kecha-chi?" kabi savollar uchun) va
  bugungi salom; eskilari har savoldan keyin o'chadi. Har adminning web chati va har Telegram chati alohida. Gemini xato
  bersa savol ham saqlanmaydi.
- **Salom** — "Assalomu aleykum og'a! Yaxshimisiz, sog'liqlariz yaxshimi? Nagapla?" (AI yozmaydi, doim shu matn): har
  chatda kunning birinchi savolida (Toshkent vaqti) javobdan oldin alohida xabar va yangi suhbat boshlanganda darhol
  (web'da — sahifa har ochilganda). Modelga yuborilmaydi.

```ts
interface AiMessage {
  id: string; userId: string
  chat: string            // 'web' | 'tg:<chatId>'
  role: 'user' | 'model'  // savol | javob
  text: string; createdAt: string
}

interface TelegramStatus {
  bot: { id: number; username: string; name: string } | null   // null — token kiritilmagan
  running: boolean        // server botni tinglayaptimi
  link: string | null     // shu adminning start linki: https://t.me/<bot>?start=<kod>
  chats: { chatId: string; userId: string; userName: string; username: string | null; name: string; linkedAt: string }[]
}
```

| Metod va yo'l | So'rov | Javob | Xatolar |
|---|---|---|---|
| `POST /ai/chat` | | `201 { configured: boolean, greeting: AiMessage }` — yangi web suhbat: sahifa har ochilganda va "Yangi suhbat" da; oldingisi o'chadi. `configured: false` — `GEMINI_API_KEY` yo'q | |
| `POST /ai/messages` | `{ text: string ≤4000 }` | `201 { question: AiMessage, greeting: AiMessage \| null, answer: AiMessage }` — odatda 2–5 s; `greeting` — shu chatda kunning birinchi savoli bo'lsa salom (alohida xabar, javobdan oldin) | `invalid_input` (bo'sh), `ai_not_configured`, `ai_failed` |
| `POST /ai/waiting` | `{ text: string ≤4000 }` | `200 { text: string }` — javob kutilayotganda ko'rsatiladigan xorazmcha ibora, savol turiga qarab (`src/ai/waiting.ts`: qoldiq → "Hozir og'a, sklata borib sonabarin…", ombor → "Hozir og'a, omborni qorabarin…", pul / tushum → "Hozir yisoplabarin og'a, ozg'ona sabr ating…", boshqasi — umumiy iboralardan tasodifiy). Kalit so'zlar bilan, darhol (AI'ga so'rov yo'q); UI `POST /ai/messages` bilan bir vaqtda so'raydi | `invalid_input` |
| `GET /telegram` | | `TelegramStatus` | |
| `PUT /telegram/token` | `{ token: string }` | `TelegramStatus` — token `getMe` bilan tekshiriladi, saqlanadi, bot qayta ishga tushadi. Boshqa bot bo'lsa ulangan chatlar va linklar o'chadi | `telegram_token_invalid`, `telegram_unreachable` |
| `DELETE /telegram/token` | | `204` — bot to'xtaydi, token, chatlar va linklar o'chadi | |
| `POST /telegram/link` | | `200 TelegramStatus` — yangi start link; eskisi ishlamaydi, ulangan chatlar qoladi | `telegram_not_connected` |
| `DELETE /telegram/chats/:chatId` | | `204` — chat uziladi (unga xabar boradi) | `not_found` |

Hamma endpoint — faqat `admin` (boshqa rolga `403 forbidden`). Token javobda hech qachon qaytmaydi.

**Telegram oqimi.** Admin @BotFather'da bot ochadi → tokenni "AI → Telegram" ga kiritadi → panelda start link (QR bilan)
chiqadi, muddati yo'q → direktor linkni ochib "Start" bosadi → bot `/start <kod>` oladi va chatni shu adminga bog'laydi →
keyin istalgan savol yozadi. Server botni **long polling** bilan tinglaydi (`getUpdates`; webhook ochiq HTTPS manzil
talab qiladi). Faqat shaxsiy chatlar; guruh xabarlari e'tiborsiz.

| Xabar | Bot javobi |
|---|---|
| `/start <to'g'ri kod>` | salom, keyin "Ulandingiz, <ism>!" va savol namunalari (yangi suhbat) |
| `/start` (kodsiz) | ulangan bo'lsa — salom, aks holda rad matni |
| `/start <noto'g'ri / eski kod>` | "Link noto'g'ri yoki yangilangan…" |
| `/new` | yangi suhbat (tarix o'chadi) — salom |
| `/parol` | **admin panel parolini favqulodda tiklash** (2026-11-02): bot "yangi parolni yozing" deydi, keyingi matn (buyruq emas) — shu chat egasi adminning yangi paroli (8–64 belgi; joriy parol, kod, vaqt va urinishlar hisobi yo'q — chat adminga bog'langanining o'zi tasdiq). Yaroqsiz — qayta so'raydi; o'rnatilgach parol yozilgan xabar chatdan o'chiriladi (`deleteMessage`) va "Parol o'zgartirildi. Admin panelga kirish: <email>…". Parol AI'ga ham, xotiraga ham ketmaydi. `/bekor` — bekor; boshqa buyruq yoki ovoz ham kutishni bekor qiladi. Kutish holati xotirada — server qayta ishga tushsa unutiladi |
| `/tushum`, `/kecha`, `/hafta`, `/oy`, `/qoldiq`, `/filiallar`, `/smenalar`, `/dostavka`, `/menyu` | «Menu» tugmasidagi tez savollar (`src/telegram/commands.ts`, token kiritilganda va server ishga tushganda `setMyCommands` bilan yuboriladi): buyruq tayyor savolni AI'ga yuboradi — keyin oddiy savoldagidek. `/buyruq@bot_nomi` ham |
| noma'lum buyruq (`/yordam` va h.k.) | buyruqlar ro'yxati |
| ovozli xabar | 20 soniyadan uzun — "Og'aaa, shuncha narsani nedan bilaman man, oddiyroq savol so'rivaring…". Aks holda Gemini matnga o'giradi (sheva → adabiy; direktorga ko'rsatilmaydi), kutish iborasi, keyin javob **matn** bilan (shevada; ovozli javob yo'q). Tushunarsiz — qayta yuborishni so'raydi. Bitta ovozli savol ≈ 4 ta Gemini so'rovi |
| boshqa matn | ulangan chat va xodim **faol admin** bo'lsa — darhol: salom (kunning birinchi savolida) va savolga qarab kutish xabari (`POST /ai/waiting` dagi ibora, chatda qoladi), keyin "yozmoqda…" va AI javobi; aks holda rad matni. Xodim bloklansa yoki roli o'zgarsa bot darhol javob bermay qo'yadi |

**Smena hisoboti.** Smena yopilganda (kassir "Smenani topshirish" yoki admin `POST /shifts/:id/close`) bot ulangan
hamma chatlarga (xodimi faol admin bo'lsa) oddiy matnli xabar yuboradi — AI'siz, adabiy tilda, AI xotirasiga yozilmaydi
(`src/telegram/shift-report.ts`): filial, kassir, admin yopgan bo'lsa — uning ismi, ochilgan va yopilgan vaqt (davomiyligi
bilan), to'langan buyurtmalar soni, tushum va to'lov turlari (kassadagi `ShiftWithSummary.summary` bilan bir xil), o'rtacha
chek, bekor qilinganlar (soni va summasi), buyurtma turi (soni va summa) va manba bo'yicha, eng ko'p sotilgan 5 taom.
Nol qatorlar chiqmaydi. Bot ulanmagan yoki Telegram javob bermasa smena baribir yopiladi (xato logga).

**Oylik zaxira nusxa** (`src/backup`). Har oyning oxirgi kuni 23:00 dan keyin (fon ishi har 10 daqiqada tekshiradi)
bazaning to'liq nusxasi (`pg_dump -Fc`) bot ulangan hamma admin chatlariga fayl bo'lib yuboriladi, keyin serverdan
o'chadi — serverda nusxa saqlanmaydi, kunlik nusxa yo'q. Nusxa butun baza (boshidan shu kungacha), faqat shu oyniki emas.
Fayl — `nyff-2026-11.dump`; Bot API 50 MB dan katta fayl qabul qilmaydi — kattasi 45 MB lik bo'laklarga:
`nyff-2026-11.dump.001`, `.002`, … (izohida "1/3-qism"). Yuborilgan oy — `settings.backup_sent_month`. Bot ulanmagan,
`pg_dump` ishlamasa yoki Telegram javob bermasa — har soatda qayta (birinchi xatoda adminlarga bir marta ogohlantirish
matni); server o'sha paytda o'chiq bo'lsa — yoqilgach (nusxa o'sha paytdagi holat, izohda "Olingan: …"). Birinchi ishga
tushishda o'tgan oylar yuborilmaydi. `JOBS=off` — ishlamaydi.

Tiklash: hamma qismlar yuklab olinadi va bitta faylga birlashtiriladi (bitta fayl bo'lsa — kerak emas) — Windows
`copy /b nyff-2026-11.dump.001 + nyff-2026-11.dump.002 nyff-2026-11.dump`, Linux `cat nyff-2026-11.dump.* > nyff-2026-11.dump`;
keyin server to'xtatilib, bo'sh bazaga: `createdb -U postgres nyff` va
`pg_restore -U postgres -d nyff --no-owner nyff-2026-11.dump` (`pg_restore` — `pg_dump` yonida). Rasmlar (`uploads`)
nusxaga kirmaydi.

Bitta botni bir vaqtda faqat bitta server tinglay oladi — ikkinchisi ishga tushsa Telegram `409` beradi (logda
ogohlantirish, bot kutadi).


---


## 14. Offline kassa (internet yo'q paytda)

2026-11-03. Faqat **kassa**: internet (markaziy server) yo'q paytda kassir savdoni davom ettiradi, chek chiqadi, "Tayyor"
ni kassirning o'zi bosadi (oshxona ekrani, TV, kiosk, mobil buyurtma offline'da ishlamaydi). Internet qaytgach buyurtmalar
markazga o'zi yuboriladi. Online kassaning ishlashi o'zgarmagan — ustiga "Internet yo'q" oynasi qo'shilgan.

```
 online kassa (brauzer, markaziy sayt) ──"Internet yo'q"──▶ http://localhost:3100/offline (shu kompyuter)
                                                               │  "NYFF Offline" — Electron ilova (C:\BACKEND APPS\ElectronJS_NYFF),
                                                               │  fonda, tray'da; baza — kassa kompyuteridagi PostgreSQL (nyff)
 markaziy server  ◀── /api/sync/* (internet qaytgach) ─────────┘
```

Kassa kompyuteridagi qism — alohida loyiha `ElectronJS_NYFF` (o'rnatish, sozlash, offline kassa API —
o'sha loyihaning README'sida). Bu bo'limda — markaz tomoni.

### 14.1 Filial kaliti

Har filialning offline kassasi markazga **filial kaliti** bilan ulanadi: `br_….<maxfiy qism>` (filial id'si + tasodifiy
32 belgi). Markaz o'zi yaratadi va bazada saqlaydi (`settings`: `offline_key:<filial>`), `.env` da emas. Admin —
"Filiallar" → filial → **"Offline kalit"**: ko'rish va nusxalash, **"Yangilash"** (eskisi darhol ishlamay qoladi —
yangisini "NYFF Offline" sozlamalariga kiritish kerak). Filial o'chirilsa kaliti ham o'chadi. Filial id'sining o'zi
kalit bo'la olmaydi — u ochiq (TV manzili, kiosk, mobil ilova, kirish ekrani).

| Metod va yo'l | Kim | Javob |
|---|---|---|
| `GET /branches/:id/offline-key` | admin | `{ key }` — hali yo'q bo'lsa yaratiladi |
| `POST /branches/:id/offline-key` | admin | `200 { key }` — yangi kalit |

### 14.2 Sinxronlash (`/api/sync/*`)

Xodim tokeni emas — sarlavha `x-offline-key: br_….<maxfiy qism>`. Kalit yo'q / noto'g'ri / yangilangan — `401
unauthorized`. Kalit qaysi filialniki bo'lsa — so'rov o'sha filial nomidan.

| Metod va yo'l | So'rov | Javob |
|---|---|---|
| `GET /sync/snapshot` | query: `since?` (oldingi `version`) | `{ version, unchanged: false, branch: { id, name }, cashiers: { id, name, surname, pinHash }[], menu: Menu (kassa menyusi, `all=true`), images: { path, size, modifiedAt }[], uiBase: '/shorva/' (xodimlar tizimi yo'li — offline kassadan "Online rejimga qaytish" online kassadan o'tilmagan bo'lsa `<markaz><uiBase>kassa` ga), counter: { date, value } }`; `since` = joriy versiya bo'lsa — `{ version, unchanged: true, counter }` |
| `POST /sync/orders` | `{ orders: SyncOrder[] }` (≤ 200) | `200 { accepted: string[], rejected: { id, code, detail? }[] }` |

```ts
interface SyncOrder {
  id: string                        // "ord_" + 16 hex (offline kassa beradi)
  number: number                    // offline berilgan raqam
  type: OrderType
  items: OrderItem[]                // sotilgan paytdagi nom va narx (offline menyudan)
  note: string
  total: number                     // server qaytadan hisoblaydi
  payment: PaymentMethod
  split: PaymentSplit | null
  status: 'preparing' | 'ready' | 'cancelled'
  cashierId: string
  createdAt: string                 // ISO; kelajakdagi vaqt (kassa soati oldinda) — hozirgi vaqt
  readyAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
}
```

`cashiers` — shu filialning faol kassirlari, PIN **xeshi** bilan (offline kassa PIN'ni shu bilan tekshiradi); `counter`
— filialning bugungi buyurtma raqami. `version` — kassirlar, menyu va rasmlar xeshi: o'zgarmagan bo'lsa ular qayta
yuborilmaydi. Offline kassa nusxani ishga tushganda va internet qaytib buyurtmalar yuborilgandan keyin oladi — internet
bor va hamma narsa yuborilgan paytda markazga so'rov ketmaydi.

Har buyurtma alohida tranzaksiyada:

- **takrorlanmaydi** — shu id bor bo'lsa, faqat holati oldinga siljiydi (tayyorlanmoqda → tayyor; istalgani → bekor,
  ombor qaytadi); markazda ilgarilab ketgan bo'lsa — markazniki qoladi. Ikkala holda ham `accepted`;
- `source: 'cashier'`, `syncedAt` — qabul qilingan vaqt ([6.2](#62-buyurtma)); narx va summa offline'dagidek (pul
  olingan — menyu keyin o'zgargan bo'lsa ham);
- **smena** — kassirning buyurtma vaqtida ochiq bo'lgan smenasi; topilmasa — hozir ochig'i; u ham yo'q — `null`;
- **ombor** — retsept bo'yicha buyurtma vaqti bilan ayriladi (bekor qilingani — tegmaydi);
- **raqam hisoblagichi** — o'sha kun uchun offline raqamlardan orqada qolmaydi (`GREATEST`);
- ma'lumot xatosi (`invalid_amount`, `invalid_qty`, `empty_order`, boshqa filial id'si — `forbidden`) — shu buyurtma
  `rejected`, qolganlari yoziladi; offline kassa uni qayta yubormaydi.

### 14.3 Web ilova

- **Online kassa** (`/shorva/kassa`): "Sozlamalar" → "Internet uzilsa offline rejimga o'tish" (shu kompyuter uchun, manzil
  standart `http://localhost:3100`). Jonli ulanish 5 soniyadan ko'p uzilsa — "Internet yo'q" oynasi, 10 soniyadan keyin
  (yoki tugma bilan) offline kassaga o'tadi; manzilning `#` qismida: kassir, oxirgi raqam, ochiq cheklar, menyu, qaytish
  manzili. Kassa bloklangan bo'lsa — offline'da PIN so'raladi. Ochiq cheklar brauzerda saqlanadi (sahifa yangilansa ham
  qoladi), to'lovdagi buyurtmaga kassa o'zi `id` beradi (`POST /orders`).
- **Offline kassa** (`/offline` — web ilovaning bir sahifasi, "NYFF Offline" uni o'z build'idan beradi): online
  kassadagidek menyu, savat, cheklar, to'lov va chek; tepada qizil "Offline" va holat qatori; "Buyurtmalar" — "Tayyor",
  chek, bekor qilish; internet qaytib hammasi yuborilgach — "Online rejimga qaytish" (ochiq cheklar bilan) — online
  kassadan o'tilgan bo'lsa o'sha sahifaga (`…/shorva/kassa`), aks holda `<markaz manzili><uiBase>kassa` (nusxadagi
  `uiBase`, 14.2). `/offline` so'rov va rasmlarni doim o'zi ochilgan serverdan oladi (`VITE_API_URL` e'tiborga olinmaydi).
- **Admin** — "Filiallar" → "Offline kalit" (14.1).
