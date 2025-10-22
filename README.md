# Telegram test bot

Node.js da yozilgan ushbu loyiha Telegram uchun test botini ishga tushiradi. Bot siz tanlagan yo'nalish bo'yicha savollarni bittalab ko'rsatadi, har bir javobni tekshiradi va yakunda natijani PDF shaklida yuboradi.

## Talablar

- Node.js 18 yoki undan yuqori versiya
- Telegram bot tokeni (`@BotFather` orqali yaratiladi)

## O'rnatish

1. Repositoryni klonlang va loyihaning ildiziga o'ting.
2. Zarur fayl va papkalar tayyorlangan. Faqat `.env` faylini yaratib, unda bot tokenini ko'rsating:

   ```bash
   echo "BOT_TOKEN=telegram_bot_tokeningiz" > .env
   ```

3. Savollar faylini `data/questions.json` ichida quyidagi formatda saqlang (kerakli qiymatlarni o'zingizga moslang):

   ```json
   {
     "categories": {
       "frontend": [
         {
           "question": "Savol matni",
           "options": ["Variant A", "Variant B", "Variant C", "Variant D"],
           "answerIndex": 1
         }
       ],
       "backend": [],
       "devops": []
     }
   }
   ```

   - `categories` ichidagi har bir kalit (masalan, `frontend`, `backend`, `devops`) Telegramda foydalanuvchi tanlay oladigan yo'nalishni bildiradi.
   - Har bir savolda kamida ikki variant bo'lishi kerak va `answerIndex` to'g'ri variantning massivdagi tartib raqamini (0 dan boshlab) ifodalaydi.

4. `data/questions.json` faylida kamida uchta yo'nalish bo'lishi shart. Zaruratga ko'ra har bir yo'nalishga xohlagancha savol qo'shishingiz mumkin.

## Ishga tushirish

```bash
npm start
```

Bot terminalda ishlashni boshlagach, Telegram ilovangizdan bot bilan suhbatlashib, /start buyrug'i orqali testni boshlashingiz mumkin. Savollar tugmalar orqali javob beriladi.

## Natijalar

- Har bir tugallangan urinish bo'yicha yakuniy statistika PDF ko'rinishida shakllantiriladi.
- PDF fayllar `reports/` papkasiga `natija_{yonalish}_{timestamp}.pdf` nomida saqlanadi va bot tomonidan foydalanuvchiga yuboriladi.

## Foydalanish bo'yicha eslatmalar

- Loyihada tashqi kutubxonalar ishlatilmagan. HTTP so'rovlari va PDF generatsiyasi Node.js ning o'rnatilgan imkoniyatlari yordamida amalga oshiriladi.
- Savollar JSON faylida o'zgartirilganda botni qayta ishga tushirish kifoya.
