# النشر من الآيباد — بدون كمبيوتر

كل الخطوات من متصفح الآيباد.

## المرحلة ١ — مشروع Firebase (من console.firebase.google.com)
1. Create a project ← اسم مثل `school-portal`.
2. Build ← **Firestore Database** ← Create database ← **Production mode**.
3. Build ← **Authentication** ← Email/Password ← فعّله، ثم Users ← Add user (بريدك + كلمة مرور). هذا حساب المعلّم.
4. أسفل القائمة ← **Upgrade to Blaze** (لازمة لاتصال الدوال بثواني). حط Budget alert بـ ٥ دولار.
5. Project settings ← Your apps ← أيقونة الويب `</>` ← سجّل التطبيق ← انسخ كتلة `firebaseConfig`.

## المرحلة ٢ — رفع الملفات على GitHub
1. افتح github.com ← New repository ← اسم مثل `school-portal` ← Public.
2. Add file ← Upload files، وارفع: `firebase.json`, `firestore.rules`, `functions/`, `public/`.
3. عدّل `public/index.html` من GitHub مباشرة (أيقونة القلم):
   - الصق قيم `firebaseConfig`.
   - غيّر `ADMIN_EMAIL` لبريدك.
4. عدّل نفس البريد في `firestore.rules` و `functions/index.js`.

## المرحلة ٣ — Cloud Shell (المتصفح)
افتح **shell.cloud.google.com** واختر مشروعك، ثم:

```bash
git clone https://github.com/USERNAME/school-portal.git
cd school-portal
firebase login --no-localhost      # اتبع الرابط والصق الرمز
firebase use PROJECT_ID

firebase functions:secrets:set THAWANI_SECRET_KEY
firebase functions:secrets:set THAWANI_PUBLISHABLE_KEY

printf 'THAWANI_MODE=uat\nADMIN_EMAIL=بريدك\n' > functions/.env

cd functions && npm install && cd ..
firebase deploy
```

`firebase deploy` ينشر الدوال والقواعد والموقع دفعة واحدة، ويعطيك رابطًا مثل
`https://PROJECT_ID.web.app` — هذا موقعك.

## المرحلة ٤ — أول تشغيل
ادخل الموقع ← "دخول المعلّم" ← بريدك وكلمة المرور ← اضبط الرمز العام والسعر بالبيسة ← احفظ.

## عند التشغيل الحقيقي
غيّر `THAWANI_MODE=uat` إلى `live` وضع المفاتيح الحقيقية، ثم `firebase deploy --only functions`.
