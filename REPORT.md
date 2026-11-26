# تقرير تسليم — سباق المعلومات (الإصدار 1.0)


التاريخ: 26 تشرين الثاني 2026 — الوكيل رقم 7.


## الحالة


الإصدار 1.0 مكتمل ومدفوع إلى المستودع نفسه (Ali-awwww/sibaq-al-maalumat، فرع main)، ومُنشأ كإصدار GitHub v1.0 عبر GitHub Actions (بناء + حزم + إصدار تلقائي).


- مشروع Google AI Studio (بحساب aliwalead.2007@gmail.com): https://aistudio.google.com/u/1/apps/fa5c6e11-6722-49a0-87b2-f72f7bef1f6a
- الإصدار: https://github.com/Ali-awwww/sibaq-al-maalumat/releases/tag/v1.0
- رابط تحميل APK المباشر: https://github.com/Ali-awwww/sibaq-al-maalumat/releases/download/v1.0/sibaq-al-maalumat-v1.0.apk
- اللعبة المنشورة: https://ali-awwww.github.io/sibaq-al-maalumat/
- المعرض: https://apps-showcase.pages.dev (يُتحقق من ظهور اللعبة فيه بعد الإصدار)


## ما اكتمل في 1.0


- بنك الأسئلة: 100 سؤال موثّق بمصدره (36 أساسياً + 64 في questions.js) في 6 فئات، بدرجات سهل/متوسط/صعب، وبأنماط اختيار من متعدد وصح/خطأ وترتيب وإكمال آية. كل سؤال يحمل مرجعه ويظهر داخل اللعبة، ويتحقق `validateQuestionBank()` عند التشغيل من عدم تكرار الأسئلة ووجود المصدر وسلامة الإجابات.
- السباق: 10 أسئلة، 15 ثانية لكل سؤال، مضمار متحرك، الأسرع 10 نقاط وإلا 5، والإجابة الخاطئة توقف التقدّم.
- السؤال الفاصل: عند التعادل يُلعب سؤال فاصل مفاجئ (حتى 3 جولات) حتى يحسم الفائز.
- القدرات الخاصة (مرة في كل سباق): تخطّي سؤال صعب، تجميد الخصم 5 ثوانٍ، مضاعفة النقاط.
- التحدي اليومي: 5 أسئلة جديدة كل يوم تُختار ببذرة ثابتة من التاريخ، محاولة واحدة يومياً، ومكافأة +50 نقطة خبرة.
- البطولة: 3 جولات إقصائية ضد سراج وحافظ وقارئ، مع لقب «بطل البطولة» ومكافأة +100 نقطة خبرة.
- الغرف: إنشاء غرفة برمز من 6 أحرف ورابط دعوة (`?room=CODE`)، والانضمام برمز؛ المزامنة الفورية بين اللاعبين عبر Supabase Realtime (اشتراكات على `results` و`matches`).
- المطابقة العشوائية: تعمل عبر Supabase — إنشاء غرفة انتظار ومطابقة حتى 60 ثانية، وأسئلة مشتركة مبذورة من رمز الغرفة، ودفع النتيجة بعد كل إجابة.
- التقدّم: نقاط وخبرة (XP) وألقاب إسلامية (طالب علم حتى شيخ السباق) و7 إنجازات ولوحة صدارة محلية وملف لاعب بإحصاءاته، محفوظة في localStorage؛ ونتائج السباقات الأونلاين تُسجَّل في Supabase وتُقرأ لوحة الصدارة من عرض `leaderboard`.
- الدخول: زر «تسجيل الدخول بـ Google» (Gmail فقط، لا دخول برقم هاتف) عبر Supabase Auth (OAuth) مع استئناف الإجراء المعلق بعد العودة؛ `GOOGLE_CLIENT_ID` بقي فارغاً لأن الدخول يتم عبر Supabase لا عبر Google Identity Services.
- التصميم: واجهة عربية RTL بأسلوب آيفون نظيف، ذهبي وأخضر زمردي، وضع ليلي، إشعارات داخل اللعبة وإشعارات متصفح (بإذن المستخدم).
- ملف config.js يجمع إعدادات الربط: رابط مشروع Supabase والمفتاح العام الحقيقيان (لا مفاتيح سرية في الكود).


## ربط Supabase (مكتمل)


- المشروع `sibaq-al-maalumat` (المنطقة eu-west-1، الخطة Free): https://jobugefmtkuoboyfhmjq.supabase.co — لوحة التحكم: https://supabase.com/dashboard/project/jobugefmtkuoboyfhmjq
- كود الربط في `app.js` (عبر `tools/supabase-patch.js` و`tools/patch-app.py`): استيراد ديناميكي لمكتبة supabase-js، استعادة الجلسة و`onAuthStateChange`، upsert للملف في `profiles`، دخول Google عبر `signInWithOAuth` مع `redirectTo = location.origin + location.pathname`، إنشاء/انضمام غرف، مطابقة عشوائية، أسئلة مشتركة مبذورة، دفع النتيجة بعد كل إجابة، واشتراكات Realtime.
- الجداول (مخطط `public`، مع RLS مفعّل على كلها): `profiles` و`rooms` و`matches` و`questions` و`results` وعرض `leaderboard`. Realtime مفعّل على `rooms` و`matches` و`results`، و12 سياسة RLS تسمح بتدفق المطابقة (إنشاء الغرفة للمضيف، إنشاء المباراة لأحد اللاعبين، تحديث نتيجة المباراة لأي لاعب، إدخال النتيجة الخاصة، وأسئلة للقراءة فقط).
- جدول `questions` يحوي **100 سؤال** (نفس بنك اللعبة) — تحقّق بالاستعلام: `count = 100`، التوزيع: القرآن 22، السيرة 20، الفقه 17، الحديث 15، التاريخ 13، العقيدة 13؛ و5 أسئلة يومية (`is_daily = true`).
- إعدادات Auth: Site URL هو النطاق المنشور https://ali-awwww.github.io/sibaq-al-maalumat/، و4 روابط إعادة توجيه (النطاق و`/**` وhttp://localhost:3000 و`/**`).
- المصادقة: Google (Gmail) فقط؛ تطبيق OAuth في Google Cloud ما زال في حالة Testing (مستخدما الاختبار: developerabumuadh@gmail.com وxman88371@gmail.com) — يُنشر من صفحة Audience بعد توفر رابطي الصفحة الرئيسية وسياسة الخصوصية.


## أندرويد والإصدار v1.0 (مكتمل)


- التحويل بـ Capacitor: `capacitor.config.ts` بمعرّف التطبيق `com.sibaqalmaalumat.app` واسم «سباق المعلومات» ومجلد الويب `dist`؛ منصة أندرويد مثبّتة في المستودع.
- أيقونة وشاشة بداية: هلال ذهبي على خلفية زمردية (`assets/icon.svg` و`assets/splash.svg`)، مولّدة لكل كثافات الشاشة عبر `@capacitor/assets`.
- مخطط الرابط المخصص `sibaqalmaalumat` في `AndroidManifest.xml`: مرشح intent (VIEW / DEFAULT / BROWSABLE) داخل MainActivity، فيفتح زر «افتح التطبيق» في المعرض اللعبة المثبّتة، وإن لم تكن مثبّتة ينقل الزائر إلى تحميل APK.
- keystore إصدار جديد خاص بهذه اللعبة فقط (RSA 2048، الاسم المستعار `sibaq`، صالح حتى 2054-04-12)؛ بصمة الشهادة SHA-256: `FC:BA:6D:1F:EC:23:A9:D8:53:BE:64:81:4D:3D:C1:FB:9E:3A:E7:4D:92:38:2F:2B:97:0D:0F:61:C8:04:61:E0`. أسرار GitHub الأربعة محفوظة (ANDROID_KEYSTORE_BASE64 وKEYSTORE_PASSWORD وKEY_ALIAS وKEY_PASSWORD)؛ كلمات المرور محفوظة لدى المالك فقط ولا توجد في المستودع.
- سير عمل الإصدار (`.github/workflows/release.yml`): يبني الويب و`npx cap sync android` ثم `./gradlew assembleRelease` (JDK 21) موقّعاً، ويتحقق من سلامة keystore (SHA-256 للملف) ومن مطابقة بصمة شهادة APK قبل النشر.
- **الإصدار v1.0 منشور بنجاح** (26 تشرين الثاني 2026): سير العمل أخضر (التشغيل 45725376593، 1:47 دقيقة). المرفقات: `sibaq-al-maalumat-v1.0.apk` (3.17 MB) و`sibaq-al-maalumat-web-v1.0.zip` (40 KB). SHA-256 للـ APK: `1e8f95590b76b6689e591468440a1160074ce4f5c901c9ad8832945a15806b13`.


## ما لم يكتمل بعد


- بنك الأسئلة 500 سؤال: الحالي 100 سؤال موثّق. التوسعة المتبقية (400 سؤال) تحتاج مراجعة بشرية لكل سؤال قبل إضافته، ولم تُضف أسئلة غير موثّقة.
- مشاركة النتيجة كصورة غير مفعلة بعد.
- تطبيق OAuth في Google Cloud ما زال في حالة Testing (يُدخل عبره فقط مستخدما الاختبار المسجلان حتى يُنشر من صفحة Audience).
- ملاحظة: تطبيق AI Studio يحتوي ميزة «توليد سؤال بالذكاء الاصطناعي» من Gemini؛ أسئلتها المولّدة غير موثّقة ولم تُدمج في بنك المستودع.
- ملاحظة على سؤال قديم (id 12: الركن الرابع من أركان الإسلام): ترتيب الركنين الرابع والخامس يختلف بين روايتي البخاري (حديث 8) ومسلم (حديث 16)؛ يحتاج صياغة أدق بمراجعة بشرية.


## التحقق


- سير عمل الإصدار يشغّل `node --check` على `app.js` و`build.mjs` قبل البناء، وينسخ `build.mjs` كل ملفات اللعبة (بما فيها questions.js وconfig.js وfeatures.css) إلى `dist/`.
- يُتحقق من الإصدار v1.0 في صفحة Releases ومن ظهور اللعبة في معرض التطبيقات بعد إنشائه.
- تم التحقق من جدول `questions` في Supabase (100 سؤال بالتوزيع أعلاه و5 أسئلة يومية)، ومن إعدادات Auth (Site URL وروابط إعادة التوجيه)، ومن Realtime وسياسات RLS (جداول النشرة و12 سياسة)، ومن توقيع APK (بصمة الشهادة تطابق keystore الجديد، وسير عمل الإصدار أخضر).


## الملفات


- `index.html`: الهيكل والصفحات (مسارات نسبية).
- `styles.css` و`features.css`: التصميم RTL والاستجابة والحركات وأنماط الميزات الجديدة.
- `app.js`: بنك الأسئلة الأساسي ومنطق السباق والقدرات والسؤال الفاصل والتحدي اليومي والبطولة والغرف والملف والإنجازات وطبقة الشبكة (Supabase).
- `questions.js`: بنك الأسئلة الموسّع (الأسئلة 37–100).
- `config.js`: إعدادات الربط (رابط Supabase والمفتاح العام).
- `build.mjs`: بناء نسخة `dist/` الثابتة.
- `server.mjs`: خادم المعاينة.
- `tools/supabase-patch.js` و`tools/patch-app.py` و`tools/generate-seed.mjs`: أدوات ربط Supabase وتوليد بذرة الأسئلة.
- `supabase/seed-questions.sql`: بذرة الأسئلة المئة لجدول `questions`.
- `capacitor.config.ts` و`package.json` و`assets/`: إعدادات Capacitor والأيقونات.
- `android/`: منصة أندرويد (بما فيها `AndroidManifest.xml` بالمخطط المخصص و`build.gradle` بإعداد التوقيع).
- `.github/workflows/release.yml`: بناء APK موقّع ونشر الإصدار v1.0.
- `.github/workflows/android-setup.yml` و`.github/workflows/keystore-bootstrap.yml` و`.github/workflows/supabase-setup.yml`: سير عمل الإعداد (مرة واحدة).
