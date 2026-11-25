// توليد supabase/seed-questions.sql من بنك الأسئلة الموثق في app.js وquestions.js.
// يُشغَّل من GitHub Actions (node tools/generate-seed.mjs).
// لا يُدخل الأسئلة في Supabase مباشرة (جدول questions قراءة فقط للاعبين)؛
// الملف الناتج يُنفَّذ من محرر SQL في لوحة تحكم Supabase (مالك المشروع).
import fs from 'node:fs';
import vm from 'node:vm';

const DAILY_IDS = new Set([1, 8, 15, 22, 27]);
const DIFF = { 'سهل': 'easy', 'متوسط': 'medium', 'صعب': 'hard' };

function extractArray(src, marker) {
  const mi = src.indexOf(marker);
  if (mi < 0) throw new Error(`marker not found: ${marker}`);
  const bi = src.indexOf('[', mi);
  const ei = src.indexOf('\n];', bi);
  if (ei < 0) throw new Error(`array end not found after ${marker}`);
  const text = src.slice(bi, ei + 2);
  return vm.runInNewContext(text);
}

function sqlStr(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  const appJs = fs.readFileSync('app.js', 'utf8');
  const qJs = fs.readFileSync('questions.js', 'utf8');
  const base = extractArray(appJs, 'const BASE_QUESTIONS = [');
  const extra = extractArray(qJs, 'EXTRA_QUESTIONS = [');
  const all = [...base, ...extra];
  const seen = new Set();
  for (const q of all) {
    if (seen.has(q.id)) throw new Error(`duplicate id ${q.id}`);
    seen.add(q.id);
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) throw new Error(`bad question ${q.id}`);
    if (!q.source) throw new Error(`question ${q.id} has no source`);
  }
  const lines = [];
  lines.push('-- بذرة أسئلة سباق المعلومات — تُنفَّذ من محرر SQL في لوحة تحكم Supabase (مالك المشروع).');
  lines.push('-- المصدر: بنك الأسئلة الموثق في app.js (36 سؤالاً) + questions.js (64 سؤالاً) = 100 سؤال موثق بمصدره.');
  lines.push('-- أسئلة الترتيب/الإكمال التي بلا correct رقمي تُدرج بـ correct_option NULL وتُلعب من البنك المحلي في اللعبة.');
  lines.push('INSERT INTO public.questions (category, difficulty, question_text, options, correct_option, explanation, is_daily, is_active) VALUES');
  const rows = all.map((q) => {
    const diff = DIFF[q.difficulty] || 'easy';
    const correct = (typeof q.correct === 'number') ? String(q.correct) : 'NULL';
    const options = JSON.stringify(q.options);
    const daily = DAILY_IDS.has(q.id) ? 'true' : 'false';
    return `  (${sqlStr(q.category)}, '${diff}', ${sqlStr(q.question)}, ${sqlStr(options)}::jsonb, ${correct}, ${sqlStr(q.source)}, ${daily}, true)`;
  });
  lines.push(rows.join(',\n') + ';');
  lines.push('');
  lines.push('-- تحقق من العدد بعد التنفيذ:');
  lines.push('SELECT count(*) AS questions_count FROM public.questions;');
  fs.mkdirSync('supabase', { recursive: true });
  fs.writeFileSync('supabase/seed-questions.sql', lines.join('\n') + '\n', 'utf8');
  const noCorrect = all.filter((q) => typeof q.correct !== 'number').map((q) => q.id);
  console.log(`seed OK: ${all.length} questions (${base.length} base + ${extra.length} extra); no numeric correct: [${noCorrect.join(', ')}]`);
}

main();
