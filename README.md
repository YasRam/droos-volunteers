# نشاط دروس التقوية — قاعدة البيانات (Supabase)

المرحلة 1 و2 من خطة التنفيذ: الجداول، والصلاحيات (RLS)، والقواعد التلقائية، ونقل الداتا من الشيت.
المواصفات الكاملة في دوك "نشاط دروس التقوية — مواصفات التطبيق".

## محتوى المشروع

```
supabase/migrations/
  20261123000001_schema.sql          الجداول والـ enums والـ indexes
  20261123000002_security.sql        دوال الأدوار، سياسات RLS، حراسة الأعمدة
  20261123000003_automation.sql      triggers، الإشعارات، اللوج، RPCs، jobs
  20261123000004_views_and_jobs.sql  views الإحصائيات وجدولة pg_cron
scripts/sheet_to_sql.py              يحوّل ملف الشيت (xlsx) لـ SQL
data/seed_data.sql                   الداتا الحالية جاهزة للتحميل (فيها بيانات شخصية: متترفعش على GitHub)
data/seed_data_report.json           اللي اتصلّح أو اتشال أثناء التحويل
tests/run_local.sh                   يشغّل كل حاجة على Postgres محلي
tests/10_roles_test.sql              اختبارات الصلاحيات لكل دور
tests/20_students_test.sql           اختبارات الطلاب: مين يشوف أنهي طالب، والحاجز حوالين حسابات الأسر
tests/30_mail_test.sql               اختبارات إيميلات الإدارة: الجديد بس، والتعديلات، ومين يبعت
```

## التشغيل على Supabase (مرة واحدة)

1. اعمل مشروع جديد على supabase.com (الباقة المجانية)، واختار منطقة قريبة (Frankfurt مثلاً).
2. **تسجيل الدخول بجوجل:**
   - في Google Cloud Console اعمل OAuth Client من نوع Web application.
   - حط Redirect URI اللي Supabase بيديهولك في Authentication → Providers → Google.
   - انسخ Client ID وSecret في Supabase وفعّل Google.
3. **ارفع الـ migrations** (محتاج Supabase CLI):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
4. **حمّل الداتا:**
   ```bash
   psql "<connection string من Project Settings → Database>" -f data/seed_data.sql
   ```
5. **ضيف نفسك أدمن** من SQL Editor:
   ```sql
   update staff_roles set role = 'admin' where email = 'your.email@gmail.com';
   ```

## الطلاب (migrations 31 و32)

بيانات الطلاب في schema لوحدها اسمها `students`. بعد `db push`:
1. Settings → API → Exposed schemas: ضيف `students` (من غيرها الموقع والنسخ الاحتياطي مش هيوصلوا للطلاب).
2. اعمل deploy تاني لدالة `backup` (بقت بتنسخ جداول الطلاب).

## إيميلات الإدارة (migration 34)

السكريبت بيرد «رد على الكل» على إيميل الإدارة، فلازم يشتغل على الحساب اللي الإدارة بتكلمه: `droosmng@gmail.com`.
1. انسخ `backup/apps-script/Code.gs` و`appsscript.json` في السكريبت على حساب droosmng (لو لسه على حساب تاني، انقله الأول وشغّل `setup` وحط كود الربط الجديد في الموقع).
2. شغّل `setupMail` مرة ووافق على صلاحيات Gmail الجديدة. بيعمل إيميل الفجر (5) وإيميل التعديلات (11 بالليل).
3. اعمل deploy جديد للـ Web app (نفس اللينك لو اخترت «Manage deployments ← Edit»)، واعمل deploy تاني لدالة `backup`.
4. من الموقع: إيميلات الإدارة ← الإعدادات: راجع العناوين وشغّل «بيتبعتوا لوحدهم».

## تحديث الداتا من الشيت قبل الإطلاق

```bash
# نزّل الشيت xlsx في data/source/sheet.xlsx
python3 scripts/sheet_to_sql.py data/source/sheet.xlsx data/seed_data.sql
```

## الاختبار محلياً

```bash
sudo service postgresql start
tests/run_local.sh tests/10_roles_test.sql tests/20_students_test.sql tests/30_mail_test.sql   # لازم يطبع ALL ... PASSED لكل واحد
tests/run_local.sh data/seed_data.sql          # تحميل الداتا الحقيقية على نسخة محلية
```

## ملاحظات

- الـ jobs اليومية بتشتغل 7:00 UTC (9 الصبح بتوقيت القاهرة في الشتا).
- أول تشغيل على الداتا الحالية هيحوّل 401 متطوع لـ "خارج المتابعة"، و27 من "اختبار" لـ "مقبول". لو عايز تراجعهم الأول، وقّف الـ job:
  `select cron.unschedule('daily-status-rules');`
- الأخطاء بتطلع بالعربي من قاعدة البيانات. الواجهة تحوّل خطأ التكرار (`participations_no_duplicate`) لرسالة "النشاط ده متسجل قبل كده".
