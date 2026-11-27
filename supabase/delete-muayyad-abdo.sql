-- ============================================================================
-- سباق المعلومات — حذف حساب وبيانات «مؤيد عبدو» من قاعدة بيانات Supabase
-- الإصدار: v1.5.2
-- ============================================================================
-- ملاحظة أمنية هامة:
-- تطبيق اللعبة يعمل بمفتاح العميل العام (anon publishable key)، وسياسات الأمان
-- على مستوى الصفوف (Row Level Security - RLS) تمنع أي مستخدم عادي أو مجهول
-- من حذف صفوف أو ملفات مستخدمين آخرين لحماية خصوصية وسلامة البيانات.
-- لذلك، يتم تنفيذ هذا الاستعلام يدوياً عبر محرر SQL في لوحة تحكم Supabase
-- (Supabase SQL Editor) بصلاحية مدير المشروع (service_role / postgres).
-- ============================================================================

BEGIN;

-- 1) حذف أي نتائج مرتبطة بهذا الاسم أو المعرف في جدول results إن وُجدت
DELETE FROM public.results
WHERE player_id IN (
  SELECT id FROM public.profiles
  WHERE display_name ILIKE '%مؤيد%عبدو%'
     OR username ILIKE '%muayyad%abdo%'
     OR username ILIKE '%moayed%abdo%'
     OR REPLACE(REPLACE(display_name, ' ', ''), 'ـ', '') = 'مؤيدعبدو'
);

-- 2) حذف أي مباريات مسجلة في جدول matches إن وُجدت
DELETE FROM public.matches
WHERE player1_id IN (
  SELECT id FROM public.profiles
  WHERE display_name ILIKE '%مؤيد%عبدو%'
     OR username ILIKE '%muayyad%abdo%'
     OR username ILIKE '%moayed%abdo%'
     OR REPLACE(REPLACE(display_name, ' ', ''), 'ـ', '') = 'مؤيدعبدو'
) OR player2_id IN (
  SELECT id FROM public.profiles
  WHERE display_name ILIKE '%مؤيد%عبدو%'
     OR username ILIKE '%muayyad%abdo%'
     OR username ILIKE '%moayed%abdo%'
     OR REPLACE(REPLACE(display_name, ' ', ''), 'ـ', '') = 'مؤيدعبدو'
);

-- 3) حذف الملف الشخصي من جدول profiles
DELETE FROM public.profiles
WHERE display_name ILIKE '%مؤيد%عبدو%'
   OR username ILIKE '%muayyad%abdo%'
   OR username ILIKE '%moayed%abdo%'
   OR REPLACE(REPLACE(display_name, ' ', ''), 'ـ', '') = 'مؤيدعبدو';

COMMIT;

-- استعلام التحقق للتأكد من عدم وجود أي سجل بهذا الاسم:
SELECT id, username, display_name, created_at
FROM public.profiles
WHERE display_name ILIKE '%مؤيد%عبدو%'
   OR username ILIKE '%muayyad%abdo%'
   OR username ILIKE '%moayed%abdo%'
   OR REPLACE(REPLACE(display_name, ' ', ''), 'ـ', '') = 'مؤيدعبدو';
