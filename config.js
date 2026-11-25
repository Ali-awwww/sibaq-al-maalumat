// إعدادات الربط الخارجي — سباق المعلومات
//
// هذه القيم تُملأ فقط عندما تتوفر بيانات حقيقية:
// - مشروع Supabase «sibaq-al-maalumat»: الرابط (URL) والمفتاح العام (anon key)
//   من لوحة تحكم Supabase، ويجهّزها وكيل آخر بشكل منفصل.
// - معرّف عميل Google (Google OAuth Client ID) من Google Cloud Console
//   لزر «تسجيل الدخول بـ Google» (Google Identity Services).
// لا تضع هنا أي رابط أو مفتاح مخترع أو تجريبي؛ القيم الفارغة تعني أن
// اللعبة تعمل بالوضع المحلي، وتظهر أوضاع الإنترنت رسالة «بانتظار بيانات Supabase».

export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  GOOGLE_CLIENT_ID: '',
};

export const SUPABASE_CONFIGURED = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
export const GOOGLE_CONFIGURED = Boolean(CONFIG.GOOGLE_CLIENT_ID);
