// سباق المعلومات — منطق اللعبة (الإصدار 1.0)
// بنك الأسئلة: 36 سؤالاً أساسياً في هذا الملف + 64 سؤالاً في questions.js = 100 سؤال موثّق بمصدره.
// يُحمَّل questions.js وconfig.js قبل هذا الملف (سكربتات عادية) ويقرأهما عبر window.
const EXTRA_QUESTIONS = window.EXTRA_QUESTIONS || [];
const ILMRACE_CONFIG = window.ILMRACE_CONFIG || {};
const SUPABASE_CONFIGURED = Boolean(ILMRACE_CONFIG.SUPABASE_URL && ILMRACE_CONFIG.SUPABASE_ANON_KEY);
const GOOGLE_CONFIGURED = Boolean(ILMRACE_CONFIG.GOOGLE_CLIENT_ID);

// ── ربط Supabase الحقيقي ──────────────────────────────────────────────
// مشروع Supabase «sibaq-al-maalumat» (eu-west-1) — الرابط والمفتاح العام
// في config.js. كل عمليات الشبكة هنا «أفضل جهد»: عند أي فشل تعود اللعبة
// إلى الوضع المحلي دون كسر اللعب. يُحمَّل عميل Supabase JS ديناميكياً
// من CDN حتى لا يتوقف تحميل اللعبة إن تعذّر الوصول إلى الشبكة.
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
let supabaseClient = null;
let supabaseUser = null;
let supabaseClientPromise = null;
let authListenerRegistered = false;
let onlineMatch = null;
let remoteQuestionsMerged = false;

function getSupabaseClient() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (!SUPABASE_CONFIGURED) return Promise.resolve(null);
  if (!supabaseClientPromise) {
    supabaseClientPromise = import(SUPABASE_JS_URL)
      .then((mod) => {
        supabaseClient = mod.createClient(ILMRACE_CONFIG.SUPABASE_URL, ILMRACE_CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        return supabaseClient;
      })
      .catch((error) => { console.warn('تعذّر تحميل مكتبة Supabase', error); return null; });
  }
  return supabaseClientPromise;
}

async function refreshSupabaseSession() {
  const client = await getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    supabaseUser = data && data.session ? data.session.user : null;
    if (supabaseUser) {
      await upsertSupabaseProfile();
      resumePendingSupabaseAction();
    }
    if (!authListenerRegistered) {
      authListenerRegistered = true;
      client.auth.onAuthStateChange(async (_event, session) => {
        supabaseUser = session ? session.user : null;
        if (supabaseUser) await upsertSupabaseProfile();
      });
    }
  } catch (error) { console.warn('تعذّر استعادة جلسة Supabase', error); }
  return supabaseUser;
}

async function resumePendingSupabaseAction() {
  let pending = null;
  try { pending = sessionStorage.getItem('ilmrace-pending-action'); sessionStorage.removeItem('ilmrace-pending-action'); } catch (error) { /* no storage */ }
  if (!pending || !supabaseUser) return;
  if (pending === 'random') openOnlineQuick();
  else if (pending === 'room') openRoom();
  else if (pending.startsWith('join:')) joinRoomByCode(pending.slice(5));
}

async function upsertSupabaseProfile() {
  if (!supabaseClient || !supabaseUser) return;
  try {
    const meta = supabaseUser.user_metadata || {};
    const name = meta.full_name || meta.name || profile.name || 'لاعب';
    const username = (supabaseUser.email || supabaseUser.id).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30) || `player_${supabaseUser.id.slice(0, 8)}`;
    await supabaseClient.from('profiles').upsert({ id: supabaseUser.id, username, display_name: name, avatar_url: meta.avatar_url || meta.picture || null }, { onConflict: 'id' });
    if (name && profile.name !== name) { profile.name = name; saveProfile(); updateHomeStats(); }
  } catch (error) { console.warn('تعذّر حفظ الملف في Supabase', error); }
}

async function signInWithGoogleSupabase() {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: 'مكتبة Supabase غير متاحة' };
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function ensureSupabaseSignedIn(pendingAction) {
  const client = await getSupabaseClient();
  if (!client) return false;
  if (!supabaseUser) await refreshSupabaseSession();
  if (supabaseUser) return true;
  const go = await openConfirm('🔐 الدخول بـ Google مطلوب', '<p>أوضاع الإنترنت (المطابقة والغرف والتحدي اليومي) تتطلب تسجيل الدخول بـ Google (Gmail فقط) عبر Supabase.</p>', 'تسجيل الدخول بـ Google', 'لاحقاً');
  if (go !== true) return false;
  try { if (pendingAction) sessionStorage.setItem('ilmrace-pending-action', pendingAction); } catch (error) { /* no storage */ }
  await signInWithGoogleSupabase();
  return false;
}

async function sbDisplayName(userId) {
  if (!userId || !supabaseClient) return 'خصم متصل';
  try {
    const { data } = await supabaseClient.from('profiles').select('display_name,username').eq('id', userId).maybeSingle();
    return (data && (data.display_name || data.username)) || 'خصم متصل';
  } catch (error) { return 'خصم متصل'; }
}

function roomSeed(code) {
  return [...code].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
}

function seededPick(seed, count) {
  const rand = mulberry32(seed);
  const pool = [...QUESTION_BANK];
  const picked = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return picked;
}

async function sbCreateRoom(mode) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: 'سجّل الدخول بـ Google أولاً' };
  const code = genRoomCode();
  const { data, error } = await client.from('rooms').insert({ code, host_id: supabaseUser.id, status: 'waiting', mode, max_players: 2 }).select().single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, room: data };
}

async function sbJoinRoom(code) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: 'سجّل الدخول بـ Google أولاً' };
  const { data, error } = await client.from('rooms').select('*').eq('code', code).eq('status', 'waiting').maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: 'لم نعثر على غرفة بهذا الرمز أو أنها بدأت بالفعل' };
  return { ok: true, room: data };
}

async function sbFindRandomRoom() {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: 'سجّل الدخول بـ Google أولاً' };
  const { data, error } = await client.from('rooms').select('*').eq('mode', 'random').eq('status', 'waiting').neq('host_id', supabaseUser.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, room: data || null };
}

async function sbCreateMatch(room, opponentId, matchType) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: 'سجّل الدخول بـ Google أولاً' };
  const isHost = room.host_id === supabaseUser.id;
  const row = { room_id: room.id, player1_id: isHost ? supabaseUser.id : room.host_id, player2_id: isHost ? opponentId : supabaseUser.id, status: 'playing', match_type: matchType || room.mode || 'random', current_question_index: 0, player1_score: 0, player2_score: 0 };
  const { data, error } = await client.from('matches').insert(row).select().single();
  if (error) return { ok: false, reason: error.message };
  try { await client.from('rooms').update({ status: 'playing', started_at: new Date().toISOString() }).eq('id', room.id); } catch (error) { /* best-effort */ }
  return { ok: true, match: data };
}

async function waitForOpponent(room, seconds) {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: 'مكتبة Supabase غير متاحة' };
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const { data } = await client.from('matches').select('*').eq('room_id', room.id).eq('status', 'playing').maybeSingle();
    if (data) return { ok: true, match: data };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ok: false, reason: 'لم ينضم خصم بعد' };
}

async function sbPushScore() {
  if (!supabaseClient || !onlineMatch || !supabaseUser) return;
  const isPlayer1 = onlineMatch.match.player1_id === supabaseUser.id;
  const column = isPlayer1 ? 'player1_score' : 'player2_score';
  try { await supabaseClient.from('matches').update({ [column]: state.playerScore, current_question_index: state.index }).eq('id', onlineMatch.match.id); } catch (error) { /* قد تمنع RLS تحديث صف المباراة — تُزامن النتيجة عبر جدول results */ }
  try {
    const duration = Math.round(state.times.reduce((sum, t) => sum + t, 0));
    const row = { score: state.playerScore, correct_answers: state.correct, wrong_answers: Math.max(0, state.index + 1 - state.correct), best_streak: state.streak, duration_seconds: duration };
    const { data: existing } = await supabaseClient.from('results').select('id').eq('match_id', onlineMatch.match.id).eq('player_id', supabaseUser.id).limit(1).maybeSingle();
    if (existing) await supabaseClient.from('results').update(row).eq('id', existing.id);
    else await supabaseClient.from('results').insert({ match_id: onlineMatch.match.id, player_id: supabaseUser.id, ...row });
  } catch (error) { /* best-effort */ }
}

function pushOnlineScore() {
  if (state.mode === 'online') sbPushScore();
}

function sbSubscribeToMatch() {
  if (!supabaseClient || !onlineMatch) return () => {};
  const matchId = onlineMatch.match.id;
  const channel = supabaseClient.channel(`match-${matchId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'results', filter: `match_id=eq.${matchId}` }, (payload) => {
      const row = payload.new || payload.old;
      if (!row || !supabaseUser || row.player_id === supabaseUser.id) return;
      state.opponentScore = row.score || 0;
      state.opponentProgress = Math.min(10, row.correct_answers || 0);
      updateScoreboard();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, (payload) => {
      const row = payload.new || {};
      if (!supabaseUser) return;
      const iAmP1 = onlineMatch.match.player1_id === supabaseUser.id;
      const oppScore = iAmP1 ? row.player2_score : row.player1_score;
      if (typeof oppScore === 'number') { state.opponentScore = oppScore; updateScoreboard(); }
    })
    .subscribe();
  onlineMatch.channel = channel;
  return () => { try { supabaseClient.removeChannel(channel); } catch (error) { /* ignore */ } };
}

async function startOnlineRace(room, match, opponentName, isHost) {
  onlineMatch = { room, match, isHost, opponentId: isHost ? match.player2_id : match.player1_id, opponentName, channel: null };
  sbSubscribeToMatch();
  const questions = seededPick(roomSeed(room.code), 10);
  startRace(opponentName, 'online', questions);
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = 'سباق مباشر عبر الإنترنت · 10 أسئلة';
  showToast('🌐 سباق مباشر — تقدّم خصمك يظهر لحظياً عبر Supabase Realtime');
}

async function sbFetchLeaderboard() {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: 'سجّل الدخول بـ Google أولاً' };
  const { data, error } = await client.from('leaderboard').select('*').limit(10);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, rows: data || [] };
}

async function sbFetchRemoteQuestions() {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: 'مكتبة Supabase غير متاحة' };
  const { data, error } = await client.from('questions').select('*').eq('is_active', true).limit(500);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, rows: data || [] };
}

function mapRemoteQuestion(row) {
  if (!row || !row.question_text || !Array.isArray(row.options) || row.options.length < 2) return null;
  if (row.correct_option === null || row.correct_option === undefined) return null;
  const correct = Number(row.correct_option);
  if (!Number.isInteger(correct) || correct < 0 || correct >= row.options.length) return null;
  const diff = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' }[row.difficulty] || 'سهل';
  const isBool = row.options.length === 2 && (row.options.includes('صحيح') || row.options.includes('خطأ'));
  return { id: `sb-${row.id}`, category: row.category, difficulty: diff, type: isBool ? 'boolean' : 'mcq', question: row.question_text, options: row.options, correct, source: row.explanation || 'جدول أسئلة Supabase' };
}

async function mergeRemoteQuestions() {
  if (remoteQuestionsMerged || !SUPABASE_CONFIGURED) return;
  remoteQuestionsMerged = true;
  try {
    const res = await sbFetchRemoteQuestions();
    if (!res.ok) return;
    const seen = new Set(QUESTION_BANK.map((q) => q.question));
    let added = 0;
    for (const row of res.rows) {
      const q = mapRemoteQuestion(row);
      if (q && !seen.has(q.question)) { QUESTION_BANK.push(q); seen.add(q.question); added += 1; }
    }
    if (added > 0) console.info(`أُضيفت ${added} أسئلة من جدول Supabase إلى بنك الأسئلة`);
  } catch (error) { console.warn('تعذّر دمج أسئلة Supabase', error); }
}

async function recordDailyChallengeOnline() {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return;
  try {
    const today = todayKey();
    const duration = Math.round(state.times.reduce((sum, t) => sum + t, 0));
    const { data: room } = await client.from('rooms').insert({ code: genRoomCode(), host_id: supabaseUser.id, status: 'finished', mode: 'daily', max_players: 1, daily_challenge_date: today, started_at: new Date().toISOString(), finished_at: new Date().toISOString() }).select().single();
    if (!room) return;
    const { data: match } = await client.from('matches').insert({ room_id: room.id, player1_id: supabaseUser.id, player2_id: null, player1_score: state.playerScore, player2_score: 0, status: 'finished', match_type: 'daily', challenge_date: today, current_question_index: state.raceTotal }).select().single();
    if (match) await client.from('results').insert({ match_id: match.id, player_id: supabaseUser.id, score: state.playerScore, correct_answers: state.correct, wrong_answers: Math.max(0, state.raceTotal - state.correct), best_streak: state.streak, duration_seconds: duration });
  } catch (error) { /* best-effort */ }
}

function recordOnlineResult() {
  if (state.mode === 'online' && onlineMatch) {
    const match = onlineMatch.match;
    const won = state.playerScore > state.opponentScore;
    if (supabaseClient && supabaseUser) {
      supabaseClient.from('matches').update({ status: 'finished', winner_id: won ? supabaseUser.id : (onlineMatch.opponentId || null) }).eq('id', match.id).then(() => {}, () => {});
      supabaseClient.from('rooms').update({ status: 'finished', finished_at: new Date().toISOString() }).eq('id', onlineMatch.room.id).then(() => {}, () => {});
      supabaseClient.from('profiles').update({ total_score: profile.xp, games_played: profile.games, games_won: profile.wins, best_streak: profile.bestStreak }).eq('id', supabaseUser.id).then(() => {}, () => {});
    }
    if (onlineMatch.channel) { try { supabaseClient.removeChannel(onlineMatch.channel); } catch (error) { /* ignore */ } }
    onlineMatch = null;
  } else if (state.mode === 'daily') {
    recordDailyChallengeOnline();
  }
}

window.ilmraceSupabase = {
  getClient: getSupabaseClient,
  refreshSession: refreshSupabaseSession,
  signInWithGoogle: signInWithGoogleSupabase,
  ensureSignedIn: ensureSupabaseSignedIn,
  createRoom: sbCreateRoom,
  joinRoom: sbJoinRoom,
  findRandomRoom: sbFindRandomRoom,
  createMatch: sbCreateMatch,
  waitForOpponent,
  fetchLeaderboard: sbFetchLeaderboard,
  fetchRemoteQuestions: sbFetchRemoteQuestions,
  mergeRemoteQuestions,
  startOnlineRace,
  get user() { return supabaseUser; },
  get match() { return onlineMatch; },
};


const BASE_QUESTIONS = [
  { id: 1, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما أول سورة في ترتيب المصحف؟', options: ['الفاتحة', 'البقرة', 'الإخلاص', 'الناس'], correct: 0, source: 'سورة الفاتحة، ترتيب المصحف' },
  { id: 2, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما أطول سورة في القرآن الكريم؟', options: ['البقرة', 'آل عمران', 'النساء', 'المائدة'], correct: 0, source: 'سورة البقرة، أطول سورة' },
  { id: 3, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'كم عدد سور القرآن الكريم؟', options: ['110 سور', '112 سورة', '114 سورة', '120 سورة'], correct: 2, source: 'المصحف الشريف، عدد السور' },
  { id: 4, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'في أي شهر أنزل القرآن؟', options: ['رجب', 'شعبان', 'رمضان', 'ذو الحجة'], correct: 2, source: 'سورة البقرة، الآية 185' },
  { id: 5, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'ما السورة التي لا تبدأ بالبسملة؟', options: ['الأنفال', 'التوبة', 'يونس', 'هود'], correct: 1, source: 'سورة التوبة، افتتاح السورة' },
  { id: 6, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'في أي سورة توجد آية الكرسي؟', options: ['آل عمران', 'طه', 'البقرة', 'الرحمن'], correct: 2, source: 'سورة البقرة، الآية 255' },
  { id: 7, category: 'الفقه', difficulty: 'سهل', type: 'boolean', question: 'الصلوات المفروضة في اليوم والليلة خمس صلوات.', options: ['صحيح', 'خطأ'], correct: 0, source: 'حديث جبريل، صحيح مسلم، حديث 8' },
  { id: 8, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'إلى أي جهة يتوجه المسلمون في الصلاة؟', options: ['إلى الكعبة المشرفة', 'إلى جبل عرفات', 'إلى المدينة المنورة', 'إلى المسجد الأقصى'], correct: 0, source: 'سورة البقرة، الآية 144' },
  { id: 9, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'ما الشهر الذي يصومه المسلمون فرضاً؟', options: ['محرم', 'رمضان', 'شوال', 'ذو القعدة'], correct: 1, source: 'سورة البقرة، الآية 185' },
  { id: 10, category: 'الفقه', difficulty: 'متوسط', type: 'boolean', question: 'صلاة الجمعة تؤدى جماعة في يوم الجمعة.', options: ['صحيح', 'خطأ'], correct: 0, source: 'سورة الجمعة، الآيات 9-10' },
  { id: 11, category: 'الفقه', difficulty: 'متوسط', type: 'mcq', question: 'ما العبادة التي تسبقها الطهارة غالبا؟', options: ['الحج', 'الصيام', 'الصلاة', 'الصدقة'], correct: 2, source: 'سورة المائدة، الآية 6' },
  { id: 12, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'ما الركن الرابع من أركان الإسلام في الحديث المشهور؟', options: ['إيتاء الزكاة', 'صوم رمضان', 'حج البيت', 'إقامة الصلاة'], correct: 1, source: 'صحيح البخاري، حديث 8؛ صحيح مسلم، حديث 16' },
  { id: 13, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'أين نزل أول الوحي على النبي محمد ﷺ؟', options: ['في غار ثور', 'في غار حراء', 'في مسجد قباء', 'في جبل عرفات'], correct: 1, source: 'كتب السيرة النبوية، حديث 3' },
  { id: 14, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'ما أول كلمة نزلت من الوحي؟', options: ['قل', 'اقرأ', 'سبح', 'استغفر'], correct: 1, source: 'سورة العلق، الآيات 1-5؛ صحيح البخاري، حديث 3' },
  { id: 15, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'في أي مدينة وُلد النبي محمد ﷺ؟', options: ['المدينة المنورة', 'الطائف', 'مكة المكرمة', 'القدس'], correct: 2, source: 'كتب السيرة النبوية، مولده' },
  { id: 16, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'إلى أي مدينة هاجر النبي ﷺ من مكة؟', options: ['إلى الطائف', 'إلى المدينة المنورة', 'إلى اليمن', 'إلى مصر'], correct: 1, source: 'سورة التوبة، الآية 40' },
  { id: 17, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'من صاحب النبي ﷺ في الهجرة؟', options: ['علي بن أبي طالب', 'عمر بن الخطاب', 'أبو بكر الصديق', 'عثمان بن عفان'], correct: 2, source: 'سورة التوبة، الآية 40' },
  { id: 18, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'ما اسم أول مسجد بناه النبي ﷺ عند قدومه إلى المدينة؟', options: ['مسجد قباء', 'المسجد الحرام', 'مسجد القبلتين', 'المسجد النبوي'], correct: 0, source: 'صحيح البخاري، كتاب الصلاة' },
  { id: 19, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'في أي غار اختبأ النبي ﷺ وأبو بكر أثناء الهجرة؟', options: ['في غار ثور', 'في غار حراء', 'في غار الكهف', 'في غار أُحد'], correct: 0, source: 'سورة التوبة، الآية 40؛ كتب السيرة النبوية' },
  { id: 20, category: 'السيرة', difficulty: 'صعب', type: 'mcq', question: 'في أي سنة هجرية كان فتح مكة؟', options: ['5 هـ', '8 هـ', '10 هـ', '2 هـ'], correct: 1, source: 'كتب السيرة النبوية، غزوة فتح مكة' },
  { id: 21, category: 'الحديث', difficulty: 'سهل', type: 'mcq', question: 'ما أول الأعمال بالنيات كما في الحديث المشهور؟', options: ['الأعمال بالنيات', 'الأعمال بالأقوال', 'الأعمال بالأموال', 'الأعمال بالعدد'], correct: 0, source: 'صحيح البخاري، حديث 1' },
  { id: 22, category: 'الحديث', difficulty: 'سهل', type: 'boolean', question: 'بُني الإسلام على خمسة أركان.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح البخاري، حديث 8؛ صحيح مسلم، حديث 16' },
  { id: 23, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'من الصحابي المعروف بكثرة رواية الحديث؟', options: ['أبو هريرة', 'زيد بن ثابت', 'سعد بن أبي وقاص', 'عبد الله بن عمر'], correct: 0, source: 'كتب التراجم، أبو هريرة' },
  { id: 24, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'من الملك الذي جاء في حديث جبريل عليه السلام؟', options: ['إسرافيل', 'جبريل', 'ميكائيل', 'ملك الموت'], correct: 1, source: 'صحيح مسلم، حديث 8' },
  { id: 25, category: 'الحديث', difficulty: 'سهل', type: 'boolean', question: 'حديث «إنما الأعمال بالنيات» رواه البخاري ومسلم.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح البخاري، حديث 1؛ صحيح مسلم، حديث 1907' },
  { id: 26, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'ما العمل الذي وُصف بأنه من الإيمان في حديث شعب الإيمان؟', options: ['إماطة الأذى عن الطريق', 'كثرة المال', 'جمع الصدقة', 'السفر'], correct: 0, source: 'صحيح مسلم، حديث 35' },
  { id: 27, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'ما الاسم القديم للمدينة المنورة؟', options: ['مكة', 'يثرب', 'بدر', 'الطائف'], correct: 1, source: 'سورة الأحزاب، الآية 13' },
  { id: 28, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'في أي سنة هجرية وقعت غزوة بدر الكبرى؟', options: ['1 هـ', '2 هـ', '3 هـ', '4 هـ'], correct: 1, source: 'كتب السيرة، التاريخ الإسلامي، غزوة بدر' },
  { id: 29, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'ماذا سُمّي المسلمون الذين هاجروا من مكة إلى المدينة؟', options: ['الأنصار', 'المهاجرون', 'التابعون', 'الأعراب'], correct: 1, source: 'سورة الحشر، الآية 8' },
  { id: 30, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'ماذا سُمّي أهل المدينة الذين نصروا النبي ﷺ؟', options: ['المهاجرون', 'الأعراب', 'الأنصار', 'الأحزاب'], correct: 2, source: 'سورة الحشر، الآية 9' },
  { id: 31, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'من أول الخلفاء الراشدين؟', options: ['عمر بن الخطاب', 'أبو بكر الصديق', 'عثمان بن عفان', 'علي بن أبي طالب'], correct: 1, source: 'التاريخ الإسلامي، الخلافة الراشدة' },
  { id: 32, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'من أول مؤذن في الإسلام؟', options: ['بلال بن رباح', 'عبد الله بن مسعود', 'زيد بن ثابت', 'خالد بن الوليد'], correct: 0, source: 'كتب السيرة النبوية' },
  { id: 33, category: 'العقيدة', difficulty: 'سهل', type: 'mcq', question: 'كم عدد أركان الإيمان المذكورة في حديث جبريل؟', options: ['أربعة أركان', 'خمسة أركان', 'ستة أركان', 'سبعة أركان'], correct: 2, source: 'صحيح مسلم، حديث 8' },
  { id: 34, category: 'العقيدة', difficulty: 'سهل', type: 'boolean', question: 'الإيمان بالملائكة أحد أركان الإيمان.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح مسلم، حديث 8' },
  { id: 35, category: 'العقيدة', difficulty: 'سهل', type: 'mcq', question: 'من خاتم الأنبياء والمرسلين؟', options: ['موسى عليه السلام', 'عيسى عليه السلام', 'محمد ﷺ', 'إبراهيم عليه السلام'], correct: 2, source: 'سورة الأحزاب، الآية 40' },
  { id: 36, category: 'العقيدة', difficulty: 'متوسط', type: 'mcq', question: 'ما السورة التي اشتهرت ببيان توحيد الله؟', options: ['الفلق', 'الإخلاص', 'الكوثر', 'الماعون'], correct: 1, source: 'سورة الإخلاص، الآيات 1-4' },
];

const QUESTION_BANK = [...BASE_QUESTIONS, ...EXTRA_QUESTIONS];

const STORAGE_KEY = 'ilmrace-profile-v1';
const HISTORY_KEY = 'ilmrace-history-v1';
const DAILY_KEY = 'ilmrace-daily-v1';
const ROOMS_KEY = 'ilmrace-rooms-v1';

const TITLES = [
  { min: 0, title: 'طالب علم' },
  { min: 100, title: 'قارئ صاعد' },
  { min: 250, title: 'حافظ' },
  { min: 500, title: 'عالم صغير' },
  { min: 1000, title: 'إمام المعرفة' },
  { min: 2000, title: 'شيخ السباق' },
];

const ACHIEVEMENTS = [
  { id: 'first-win', icon: '🏆', title: 'أول فوز', desc: 'فُز بأول سباق' },
  { id: 'streak-3', icon: '🔥', title: 'سلسلة نارية', desc: '3 إجابات صحيحة متتالية' },
  { id: 'perfect', icon: '💯', title: 'علامة كاملة', desc: 'أجب كل أسئلة السباق إجابة صحيحة' },
  { id: 'daily', icon: '📅', title: 'تحدي اليوم', desc: 'أكمل التحدي اليومي' },
  { id: 'races-10', icon: '🎖️', title: 'متسابق مخضرم', desc: 'أكمل 10 سباقات' },
  { id: 'xp-500', icon: '💎', title: 'جامع النقاط', desc: 'اجمع 500 نقطة خبرة' },
  { id: 'champion', icon: '👑', title: 'بطل البطولة', desc: 'فُز ببطولة كاملة' },
];

const TOURNAMENT_OPPONENTS = ['سراج', 'حافظ', 'قارئ'];
const BOT_ACCURACY = { 'سهل': 0.85, 'متوسط': 0.65, 'صعب': 0.45 };
const TYPE_LABELS = { mcq: 'اختيار من متعدد', boolean: 'صح أم خطأ', order: 'رتّب بالترتيب', complete: 'أكمل الآية / الحديث' };
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

const ui = {
  shell: document.querySelector('#appShell'),
  home: document.querySelector('#homeScreen'),
  race: document.querySelector('#raceScreen'),
  result: document.querySelector('#resultScreen'),
  raceEyebrow: document.querySelector('#raceEyebrow'),
  raceTitle: document.querySelector('#raceTitle'),
  questionNumber: document.querySelector('#questionNumber'),
  questionTotal: document.querySelector('#questionTotal'),
  answeredCount: document.querySelector('#answeredCount'),
  answeredTotal: document.querySelector('#answeredTotal'),
  tiebreakBanner: document.querySelector('#tiebreakBanner'),
  category: document.querySelector('#questionCategory'),
  difficulty: document.querySelector('#questionDifficulty'),
  questionType: document.querySelector('#questionType'),
  questionText: document.querySelector('#questionText'),
  answers: document.querySelector('#answersGrid'),
  feedback: document.querySelector('#answerFeedback'),
  card: document.querySelector('#questionCard'),
  timerRing: document.querySelector('#timerRing'),
  timerValue: document.querySelector('#timerValue'),
  playerRunner: document.querySelector('#playerRunner'),
  opponentRunner: document.querySelector('#opponentRunner'),
  playerScore: document.querySelector('#playerScore'),
  opponentScore: document.querySelector('#opponentScore'),
  opponentName: document.querySelector('#opponentName'),
  opponentAvatar: document.querySelector('#opponentAvatar'),
  raceStreak: document.querySelector('#raceStreak'),
  finalScore: document.querySelector('#finalScore'),
  finalCorrect: document.querySelector('#finalCorrect'),
  finalAccuracy: document.querySelector('#finalAccuracy'),
  finalSpeed: document.querySelector('#finalSpeed'),
  resultEyebrow: document.querySelector('#resultEyebrow'),
  resultTitle: document.querySelector('#resultTitle'),
  resultSubtitle: document.querySelector('#resultSubtitle'),
  toast: document.querySelector('#toast'),
  toastText: document.querySelector('#toastText'),
  modal: document.querySelector('#modalBackdrop'),
  modalTitle: document.querySelector('#modalTitle'),
  modalBody: document.querySelector('#modalBody'),
  modalPrimary: document.querySelector('.modal-primary'),
  dailyMiniText: document.querySelector('#dailyMiniText'),
};

const state = {
  screen: 'home',
  mode: 'training',
  opponentName: 'سراج',
  questions: [],
  index: 0,
  playerProgress: 0,
  opponentProgress: 0,
  playerScore: 0,
  opponentScore: 0,
  streak: 0,
  correct: 0,
  times: [],
  remaining: 15,
  timerId: null,
  botTimer: null,
  botResponded: false,
  botCorrect: false,
  locked: false,
  gameOver: false,
  currentQuestion: null,
  startedAt: 0,
  powers: { skip: 1, freeze: 1, double: 1 },
  doubleNext: false,
  frozenUntil: 0,
  tiebreakRound: 0,
  raceTotal: 10,
  orderPicked: [],
  tournament: null,
};

// واجهة أوضاع الإنترنت (Supabase Realtime) — جاهزة للربط.
// ما دامت بيانات مشروع Supabase غير متوفرة في config.js، تعيد الدوال
// سبباً واضحاً بدلاً من ادعاء اتصال غير موجود.
const networkAdapter = {
  mode: SUPABASE_CONFIGURED ? 'supabase' : 'local-training',
  status: () => (SUPABASE_CONFIGURED ? 'متصل بـ Supabase Realtime' : 'بانتظار بيانات Supabase'),
  async createRoom(mode = 'friend') {
    return sbCreateRoom(mode);
  },
  async joinRoom(code) {
    return sbJoinRoom(code);
  },
  async randomMatch() {
    if (!SUPABASE_CONFIGURED) return { ok: false, reason: 'بانتظار بيانات مشروع Supabase (الرابط والمفتاح العام)' };
    const found = await sbFindRandomRoom();
    if (!found.ok) return found;
    if (found.room) return { ok: true, room: found.room, joined: true };
    const created = await sbCreateRoom('random');
    if (!created.ok) return created;
    return { ok: true, room: created.room, joined: false };
  },
  subscribeToRaceState(onOpponent) {
    return sbSubscribeToMatch(onOpponent);
  },
};
window.ilmraceNetwork = networkAdapter;
let profile = loadProfile();
let confirmResolver = null;

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      return {
        name: saved.name || 'مؤيد عبدو',
        wins: saved.wins || 0,
        games: saved.games || 0,
        totalAnswered: saved.totalAnswered || 0,
        totalCorrect: saved.totalCorrect || 0,
        bestStreak: saved.bestStreak || 0,
        xp: saved.xp || 0,
        achievements: Array.isArray(saved.achievements) ? saved.achievements : [],
        google: saved.google || null,
      };
    }
  } catch (error) {
    console.warn('Could not load profile', error);
  }
  return { name: 'مؤيد عبدو', wins: 0, games: 0, totalAnswered: 0, totalCorrect: 0, bestStreak: 0, xp: 0, achievements: [], google: null };
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function titleFor(xp) {
  let title = TITLES[0].title;
  for (const t of TITLES) if (xp >= t.min) title = t.title;
  return title;
}

function unlockAchievement(id) {
  if (!profile.achievements.includes(id)) {
    profile.achievements.push(id);
    const ach = ACHIEVEMENTS.find((a) => a.id === id);
    if (ach) showToast(`إنجاز جديد: ${ach.icon} ${ach.title}`);
  }
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (error) { return []; }
}

function saveRaceHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-50)));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function notify(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); return; } catch (error) { /* fall through */ }
  }
  showToast(body || title);
}

function enableNotifications() {
  if (!('Notification' in window)) { showToast('هذا المتصفح لا يدعم الإشعارات'); return; }
  Notification.requestPermission().then((permission) => {
    showToast(permission === 'granted' ? 'تم تفعيل الإشعارات 🔔' : 'لم يتم تفعيل الإشعارات');
  });
}

function updateHomeStats() {
  const wins = document.querySelector('#winsValue');
  const accuracy = document.querySelector('#accuracyValue');
  const streak = document.querySelector('#streakValue');
  const xpValue = document.querySelector('#xpValue');
  const xpBar = document.querySelector('#xpBar');
  const xpCap = 250;
  if (wins) wins.textContent = profile.wins;
  if (accuracy) accuracy.textContent = `${profile.totalAnswered ? Math.round((profile.totalCorrect / profile.totalAnswered) * 100) : 0}%`;
  if (streak) streak.textContent = profile.bestStreak;
  if (xpValue) xpValue.textContent = `${profile.xp} / ${xpCap} XP`;
  if (xpBar) xpBar.style.width = `${Math.min(100, (profile.xp % xpCap) / xpCap * 100)}%`;
  const level = Math.floor(profile.xp / xpCap) + 1;
  const title = titleFor(profile.xp);
  const firstName = profile.name.trim().split(' ')[0] || 'مؤيد';
  const initial = profile.name.trim().charAt(0) || 'م';
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('miniPlayerName', firstName);
  set('miniPlayerTitle', title);
  set('profilePlayerName', profile.name);
  set('racePlayerTitle', title);
  set('miniAvatar', initial);
  set('largeAvatar', initial);
  set('playerAvatar', initial);
  const levelEl = document.getElementById('profileLevel');
  if (levelEl) levelEl.innerHTML = `${String(level).padStart(2, '0')}<small>مستوى</small>`;
  const rankEl = document.getElementById('profilePlayerTitle');
  if (rankEl) rankEl.innerHTML = `${title} <i></i>`;
  if (ui.dailyMiniText) {
    const done = localStorage.getItem(DAILY_KEY) === todayKey();
    ui.dailyMiniText.textContent = done ? 'أكملت تحدي اليوم ✓ — عُد غداً' : 'لم تُكمل تحدي اليوم بعد';
  }
}

function showScreen(name) {
  state.screen = name;
  [ui.home, ui.race, ui.result].forEach((screen) => {
    if (!screen) return;
    const active = screen.id === `${name}Screen`;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shuffle(list) {
  const items = [...list];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function validateQuestionBank() {
  const seenIds = new Set();
  const seenTexts = new Set();
  const categories = new Set();
  for (const question of QUESTION_BANK) {
    if (seenIds.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
    if (seenTexts.has(question.question)) throw new Error(`Duplicate question text: ${question.question}`);
    if (!question.source || typeof question.source !== 'string') throw new Error(`Question ${question.id} has no source`);
    if (question.correct < 0 || question.correct >= question.options.length) throw new Error(`Invalid correct index for question ${question.id}`);
    if (question.type === 'order') {
      if (!Array.isArray(question.correctOrder) || question.correctOrder.length !== question.options.length || new Set(question.correctOrder).size !== question.options.length || question.correctOrder.some((i) => i < 0 || i >= question.options.length)) throw new Error(`Invalid order for question ${question.id}`);
    }
    seenIds.add(question.id);
    seenTexts.add(question.question);
    categories.add(question.category);
  }
  if (categories.size < 6) throw new Error(`Expected 6 categories, found ${categories.size}`);
}

function resetRaceState() {
  state.index = 0;
  state.playerProgress = 0;
  state.opponentProgress = 0;
  state.playerScore = 0;
  state.opponentScore = 0;
  state.streak = 0;
  state.correct = 0;
  state.times = [];
  state.gameOver = false;
  state.locked = false;
  ui.playerScore.textContent = '0';
  ui.opponentScore.textContent = '0';
  setProgress(ui.playerRunner, 0);
  setProgress(ui.opponentRunner, 0);
}

function startRace(opponentName = 'سراج', mode = 'training', sharedQuestions = null) {
  clearRoundTimers();
  state.mode = mode;
  state.opponentName = opponentName;
  state.tiebreakRound = 0;
  state.raceTotal = 10;
  state.powers = { skip: 1, freeze: 1, double: 1 };
  state.doubleNext = false;
  state.frozenUntil = 0;
  if (mode !== 'tournament') state.tournament = null;
  const categories = ['القرآن', 'السيرة', 'الفقه', 'الحديث', 'التاريخ', 'العقيدة'];
  const picked = [];
  const pool = [...QUESTION_BANK];
  for (const category of categories) {
    const candidates = pool.filter((question) => question.category === category);
    if (candidates.length) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      picked.push(chosen);
      pool.splice(pool.indexOf(chosen), 1);
    }
  }
  while (picked.length < 10 && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  state.questions = shuffle(picked);
  if (sharedQuestions && sharedQuestions.length) state.questions = [...sharedQuestions];
  resetRaceState();
  if (ui.opponentName) ui.opponentName.textContent = opponentName;
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = opponentName.charAt(0);
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = mode === 'tournament' && state.tournament ? `بطولة الموسم · الجولة ${state.tournament.round + 1} من 3` : 'تدريب محلي · سباق جديد';
  if (ui.questionTotal) ui.questionTotal.textContent = '10';
  if (ui.answeredTotal) ui.answeredTotal.textContent = '10';
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
}

function startDaily() {
  const today = todayKey();
  if (localStorage.getItem(DAILY_KEY) === today) { showToast('لقد أكملت تحدي اليوم — عُد غداً لتحدٍّ جديد!'); return; }
  clearRoundTimers();
  const seed = [...today].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = mulberry32(seed);
  const pool = [...QUESTION_BANK];
  const picked = [];
  while (picked.length < 5 && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  state.mode = 'daily';
  state.opponentName = 'تحدي اليوم';
  state.tiebreakRound = 0;
  state.raceTotal = 5;
  state.powers = { skip: 1, freeze: 1, double: 1 };
  state.doubleNext = false;
  state.frozenUntil = 0;
  state.tournament = null;
  state.questions = picked;
  resetRaceState();
  if (ui.opponentName) ui.opponentName.textContent = 'تحدي اليوم';
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = '📅';
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = 'تحدي اليوم · 5 أسئلة · محاولة واحدة يومياً';
  if (ui.questionTotal) ui.questionTotal.textContent = '5';
  if (ui.answeredTotal) ui.answeredTotal.textContent = '5';
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
  showToast('تحدي اليوم: 5 أسئلة — بالتوفيق!');
}

function startTournament() {
  state.mode = 'tournament';
  state.tournament = { round: 0, opponents: shuffle([...TOURNAMENT_OPPONENTS]) };
  showToast('بطولة الموسم: 3 جولات إقصائية — فُز بها كلها لتصبح البطل!');
  startRace(state.tournament.opponents[0], 'tournament');
}

function startTiebreakRound() {
  state.tiebreakRound += 1;
  const usedIds = new Set(state.questions.map((q) => q.id));
  const pool = QUESTION_BANK.filter((q) => !usedIds.has(q.id));
  const question = pool[Math.floor(Math.random() * pool.length)];
  state.questions = [question];
  state.index = 0;
  state.raceTotal += 1;
  state.gameOver = false;
  state.locked = false;
  showToast(`⚡ سؤال فاصل — الجولة ${state.tiebreakRound}!`);
  showScreen('race');
  renderQuestion();
}

function renderQuestion() {
  const question = state.questions[state.index];
  state.currentQuestion = question;
  state.locked = false;
  state.botResponded = false;
  state.botCorrect = Math.random() < (BOT_ACCURACY[question.difficulty] || 0.65);
  state.startedAt = performance.now();
  state.remaining = 15;
  state.orderPicked = [];
  ui.questionNumber.textContent = state.index + 1;
  if (ui.questionTotal) ui.questionTotal.textContent = state.questions.length;
  ui.answeredCount.textContent = state.index;
  if (ui.answeredTotal) ui.answeredTotal.textContent = state.questions.length;
  ui.category.textContent = question.category;
  ui.difficulty.textContent = question.difficulty;
  ui.questionType.textContent = TYPE_LABELS[question.type] || 'اختيار من متعدد';
  ui.questionText.textContent = question.question;
  ui.feedback.textContent = '';
  ui.feedback.className = 'answer-feedback';
  ui.card.classList.remove('answer-correct', 'answer-wrong');
  ui.raceStreak.textContent = state.streak;
  if (ui.tiebreakBanner) {
    ui.tiebreakBanner.hidden = state.tiebreakRound === 0;
    if (state.tiebreakRound > 0) ui.tiebreakBanner.textContent = `⚡ سؤال فاصل — الجولة ${state.tiebreakRound} · أول من يجيب صحيحاً يحسم السباق`;
  }
  ui.answers.innerHTML = '';
  if (question.type === 'order') {
    ui.feedback.textContent = 'اضغط على الخيارات بالترتيب الصحيح، ثم اضغط «تأكيد الترتيب».';
    ui.feedback.className = 'answer-feedback';
    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-button order-button';
      button.dataset.answerIndex = index;
      button.innerHTML = `<span class="answer-letter">${LETTERS[index]}</span><span class="answer-text">${option}</span><span class="order-num"></span>`;
      ui.answers.appendChild(button);
    });
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'confirm-order-button';
    confirm.textContent = 'تأكيد الترتيب';
    confirm.disabled = true;
    confirm.dataset.action = 'confirm-order';
    ui.answers.appendChild(confirm);
  } else {
    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-button';
      button.dataset.answerIndex = index;
      button.innerHTML = `<span class="answer-letter">${LETTERS[index]}</span><span class="answer-text">${option}</span>`;
      ui.answers.appendChild(button);
    });
  }
  updatePowers();
  startTimer();
  startBot();
}

function pickOrder(index, button) {
  if (state.locked || state.orderPicked.includes(index)) return;
  state.orderPicked.push(index);
  button.classList.add('picked');
  const num = button.querySelector('.order-num');
  if (num) num.textContent = state.orderPicked.length;
  const question = state.currentQuestion;
  if (state.orderPicked.length === question.options.length) {
    const confirm = document.querySelector('.confirm-order-button');
    if (confirm) confirm.disabled = false;
  }
}

function markOrderButtons() {
  const question = state.currentQuestion;
  ui.answers.querySelectorAll('.answer-button').forEach((button) => {
    const index = Number(button.dataset.answerIndex);
    button.disabled = true;
    const pickedPos = state.orderPicked.indexOf(index);
    const correctPos = question.correctOrder.indexOf(index);
    if (pickedPos !== -1 && pickedPos === correctPos) button.classList.add('correct');
    else if (pickedPos !== -1) button.classList.add('wrong');
    const num = button.querySelector('.order-num');
    if (num) num.textContent = correctPos + 1;
  });
}

function answerOrder() {
  if (state.locked) return;
  const question = state.currentQuestion;
  if (state.orderPicked.length !== question.options.length) return;
  state.locked = true;
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.botTimer);
  markOrderButtons();
  const isCorrect = state.orderPicked.join(',') === question.correctOrder.join(',');
  const correctOrderText = question.correctOrder.map((i) => question.options[i]).join(' ← ');
  const wrongFeedback = `الترتيب الصحيح: ${correctOrderText} · المرجع: ${question.source}`;
  scoreAnswer(isCorrect, wrongFeedback);
}

function startTimer() {
  clearInterval(state.timerId);
  const start = performance.now();
  state.timerId = window.setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    state.remaining = Math.max(0, 15 - elapsed);
    updateTimer();
    if (state.remaining <= 0) {
      clearInterval(state.timerId);
      state.timerId = null;
      handleAnswer(null);
    }
  }, 50);
  updateTimer();
}

function updateTimer() {
  const value = Math.ceil(state.remaining);
  ui.timerValue.textContent = value;
  ui.timerRing.style.setProperty('--timer-progress', `${(state.remaining / 15) * 100}%`);
  ui.timerRing.classList.toggle('timer-urgent', state.remaining <= 5 && state.remaining > 0);
  ui.timerRing.classList.toggle('timer-done', state.remaining <= 0);
}

function startBot() {
  if (state.mode === 'daily' || state.mode === 'online') return;
  const delay = 2200 + Math.random() * 3900;
  state.botTimer = window.setTimeout(botRespond, delay);
}

function botRespond() {
  if (state.botResponded || state.gameOver) return;
  if (Date.now() < state.frozenUntil) {
    state.botTimer = window.setTimeout(botRespond, state.frozenUntil - Date.now() + 200);
    return;
  }
  state.botResponded = true;
  if (state.botCorrect) {
    const botFirst = !state.locked;
    state.opponentProgress = Math.min(10, state.opponentProgress + 1);
    state.opponentScore += botFirst ? 10 : 5;
    updateScoreboard();
    if (!state.locked) showToast(`⚡ ${state.opponentName} أجاب قبلك — تقدّم خطوة`);
  } else if (!state.locked) {
    showToast(`💨 ${state.opponentName} أخطأ — فرصتك الآن`);
  }
}

function applyPendingBotResult(playerWasCorrect) {
  if (state.botResponded || state.gameOver) return;
  if (Date.now() < state.frozenUntil) {
    state.botTimer = window.setTimeout(() => applyPendingBotResult(playerWasCorrect), state.frozenUntil - Date.now() + 200);
    return;
  }
  state.botResponded = true;
  if (state.botCorrect) {
    state.opponentProgress = Math.min(10, state.opponentProgress + 1);
    state.opponentScore += playerWasCorrect ? 5 : 10;
    updateScoreboard();
  }
}

function scoreAnswer(isCorrect, wrongFeedback) {
  const elapsed = Math.min(15, Math.max(0.1, (performance.now() - state.startedAt) / 1000));
  state.times.push(elapsed);
  if (isCorrect) {
    const faster = !state.botResponded;
    let points = faster ? 10 : 5;
    if (state.doubleNext) { points *= 2; state.doubleNext = false; }
    state.playerScore += points;
    state.playerProgress = Math.min(10, state.playerProgress + 1);
    state.correct += 1;
    state.streak += 1;
    if (state.streak >= 3) unlockAchievement('streak-3');
    ui.feedback.textContent = faster ? `إجابة صحيحة — +${points} نقاط، أنت الأسرع` : `إجابة صحيحة — +${points} نقاط، الخصم كان أسرع`;
    ui.feedback.className = 'answer-feedback good';
    ui.card.classList.add('answer-correct');
    burstSparkles();
  } else {
    state.streak = 0;
    ui.feedback.textContent = wrongFeedback || 'انتهى الوقت — لا تتوقف، السؤال التالي ينتظرك';
    ui.feedback.className = 'answer-feedback bad';
    ui.card.classList.add('answer-wrong');
  }
  ui.raceStreak.textContent = state.streak;
  updateScoreboard();
  if (state.mode === 'online') pushOnlineScore();
  if (!state.botResponded && state.mode !== 'online') window.setTimeout(() => applyPendingBotResult(isCorrect), 560);
  window.setTimeout(() => advanceQuestion(), 1050);
}

function handleAnswer(answerIndex) {
  if (state.locked) return;
  const question = state.currentQuestion;
  state.locked = true;
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.botTimer);
  const buttons = [...ui.answers.querySelectorAll('.answer-button')];
  if (question.type === 'order') {
    markOrderButtons();
    const isCorrect = state.orderPicked.join(',') === question.correctOrder.join(',');
    const correctOrderText = question.correctOrder.map((i) => question.options[i]).join(' ← ');
    scoreAnswer(isCorrect, `الترتيب الصحيح: ${correctOrderText} · المرجع: ${question.source}`);
    return;
  }
  buttons.forEach((button) => {
    const index = Number(button.dataset.answerIndex);
    button.disabled = true;
    if (index === question.correct) button.classList.add('correct');
    else if (index === answerIndex) button.classList.add('wrong');
  });
  const isCorrect = answerIndex !== null && answerIndex === question.correct;
  const wrongFeedback = answerIndex === null
    ? `انتهى الوقت! الإجابة الصحيحة: ${question.options[question.correct]} · المرجع: ${question.source}`
    : `ليست الإجابة الصحيحة. المرجع: ${question.source}`;
  scoreAnswer(isCorrect, wrongFeedback);
}

function advanceQuestion() {
  state.index += 1;
  if (state.index >= state.questions.length) finishRace();
  else renderQuestion();
}

function finishRace() {
  state.gameOver = true;
  clearRoundTimers();
  const playerWon = state.playerProgress > state.opponentProgress || (state.playerProgress === state.opponentProgress && state.playerScore >= state.opponentScore);
  const tie = state.playerProgress === state.opponentProgress && state.playerScore === state.opponentScore;
  if (tie && state.mode !== 'daily' && state.tiebreakRound < 3) { startTiebreakRound(); return; }
  const accuracy = state.raceTotal ? Math.round((state.correct / state.raceTotal) * 100) : 0;
  const average = state.times.length ? (state.times.reduce((sum, time) => sum + time, 0) / state.times.length).toFixed(1) : '—';
  const won = playerWon && !tie;
  profile.games += 1;
  profile.wins += won ? 1 : 0;
  profile.totalAnswered += state.raceTotal;
  profile.totalCorrect += state.correct;
  profile.bestStreak = Math.max(profile.bestStreak, state.streak);
  let xpGain = state.playerScore + (won ? 15 : 5);
  if (state.mode === 'daily') {
    xpGain += 50;
    localStorage.setItem(DAILY_KEY, todayKey());
    unlockAchievement('daily');
  }
  profile.xp += xpGain;
  if (won) unlockAchievement('first-win');
  if (state.correct === state.raceTotal && state.raceTotal > 0) unlockAchievement('perfect');
  if (profile.games >= 10) unlockAchievement('races-10');
  if (profile.xp >= 500) unlockAchievement('xp-500');
  saveProfile();
  saveRaceHistory({ date: new Date().toISOString(), mode: state.mode, score: state.playerScore, correct: state.correct, total: state.raceTotal, won });
  ui.finalScore.textContent = state.playerScore;
  ui.finalCorrect.textContent = `${state.correct}/${state.raceTotal}`;
  ui.finalAccuracy.textContent = `${accuracy}%`;
  ui.finalSpeed.textContent = average === '—' ? average : `${average}ث`;
  if (state.mode === 'daily') {
    ui.resultEyebrow.textContent = 'تحدي اليوم';
    ui.resultTitle.textContent = 'أكملت تحدي اليوم!';
    ui.resultSubtitle.textContent = `أجبت ${state.correct} من 5 إجابات صحيحة — مكافأة التحدي +50 نقطة خبرة.`;
  } else if (tie) {
    ui.resultEyebrow.textContent = 'تعادل قوي';
    ui.resultTitle.textContent = 'تعادل بعد 3 أسئلة فاصلة!';
    ui.resultSubtitle.textContent = 'تساوى الطرفان حتى بعد الأسئلة الفاصلة — سباق يستحق الإعادة.';
  } else if (playerWon) {
    ui.resultEyebrow.textContent = 'انتصار ذهبي';
    ui.resultTitle.textContent = `أحسنت يا ${profile.name.trim().split(' ')[0]}!`;
    ui.resultSubtitle.textContent = 'سرعتك صنعت الفارق. واصلت حتى النهاية.';
  } else {
    ui.resultEyebrow.textContent = 'سباق قوي';
    ui.resultTitle.textContent = `${state.opponentName} سبقك هذه المرة`;
    ui.resultSubtitle.textContent = 'راجع المصادر وحاول مرة أخرى — المعرفة تتراكم.';
  }
  if (state.tiebreakRound > 0 && !tie) ui.resultSubtitle.textContent += ' (حُسم بسؤال فاصل ⚡)';
  showScreen('result');
  updateHomeStats();
  recordOnlineResult();
  if (won) {
    createConfetti();
    notify('🏆 فزت بالسباق!', `نتيجتك ${state.playerScore} نقطة`);
  }
  if (state.mode === 'tournament') handleTournamentFinish(won);
}

async function handleTournamentFinish(won) {
  if (!state.tournament) return;
  if (won) {
    if (state.tournament.round < 2) {
      state.tournament.round += 1;
      const next = state.tournament.opponents[state.tournament.round];
      const go = await openConfirm('🎉 فزت بالجولة!', `<p>تأهلت إلى الجولة ${state.tournament.round + 1} من 3 — خصمك القادم: <b>${next}</b>.</p>`, 'ابدأ الجولة التالية', 'العودة للرئيسية');
      if (go === true) startRace(next, 'tournament'); else showScreen('home');
    } else {
      unlockAchievement('champion');
      profile.xp += 100;
      saveProfile();
      const go = await openConfirm('👑 بطل البطولة!', '<p>فزت بالبطولة كاملة! مكافأة البطل: +100 نقطة خبرة.</p>', 'العب من جديد', 'العودة للرئيسية');
      if (go === true) startRace(); else showScreen('home');
    }
  } else {
    const go = await openConfirm('💔 خرجت من البطولة', `<p>خسرت الجولة ضد <b>${state.opponentName}</b>. درّب أكثر وحاول مرة أخرى!</p>`, 'إعادة البطولة', 'العودة للرئيسية');
    if (go === true) startTournament(); else showScreen('home');
  }
}

function clearRoundTimers() {
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.botTimer);
  state.botTimer = null;
}

function setProgress(runner, progress) {
  if (!runner) return;
  runner.style.setProperty('--progress', progress);
  const track = runner.closest('.track-line');
  if (track) track.style.setProperty('--progress', `${progress * 10}%`);
}

function updateScoreboard() {
  ui.playerScore.textContent = state.playerScore;
  ui.opponentScore.textContent = state.opponentScore;
  setProgress(ui.playerRunner, state.playerProgress);
  setProgress(ui.opponentRunner, state.opponentProgress);
}

function updatePowers() {
  const map = [
    ['powerSkip', 'powerSkipCount', state.powers.skip],
    ['powerFreeze', 'powerFreezeCount', state.powers.freeze],
    ['powerDouble', 'powerDoubleCount', state.powers.double],
  ];
  for (const [btnId, countId, left] of map) {
    const btn = document.getElementById(btnId);
    const count = document.getElementById(countId);
    if (count) count.textContent = left;
    if (btn) btn.classList.toggle('disabled', left <= 0);
  }
}

function usePower(kind) {
  if (state.screen !== 'race' || state.locked || state.gameOver) return;
  if (kind === 'skip') {
    if (state.powers.skip <= 0) { showToast('استُخدم التخطّي في هذا السباق'); return; }
    state.powers.skip -= 1;
    updatePowers();
    clearRoundTimers();
    state.locked = true;
    ui.feedback.textContent = 'تم تخطّي السؤال — لا نقاط ولا تقدّم في هذا السؤال';
    ui.feedback.className = 'answer-feedback';
    window.setTimeout(() => advanceQuestion(), 900);
  } else if (kind === 'freeze') {
    if (state.powers.freeze <= 0) { showToast('استُخدم التجميد في هذا السباق'); return; }
    if (state.mode === 'daily') { showToast('لا خصم في تحدي اليوم لتجميده'); return; }
    if (state.mode === 'online') { showToast('لا يمكن تجميد خصم حقيقي — التجميد يعمل ضد الكمبيوتر فقط'); return; }
    state.powers.freeze -= 1;
    state.frozenUntil = Date.now() + 5000;
    updatePowers();
    showToast(`تم تجميد ${state.opponentName} 5 ثوانٍ ❄️`);
  } else if (kind === 'double') {
    if (state.powers.double <= 0) { showToast('استُخدمت المضاعفة في هذا السباق'); return; }
    if (state.doubleNext) { showToast('المضاعفة مفعّلة بالفعل للإجابة التالية'); return; }
    state.powers.double -= 1;
    state.doubleNext = true;
    updatePowers();
    showToast('مضاعفة النقاط مفعّلة — أجب صحيحاً لتتضاعف نقاطك ×2');
  }
}

function showToast(message) {
  ui.toastText.textContent = message;
  ui.toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => ui.toast.classList.remove('show'), 3200);
}

function openModal(title, body, symbol = 'clock') {
  ui.modalTitle.textContent = title;
  ui.modalBody.innerHTML = body;
  ui.modalPrimary.textContent = 'فهمت';
  ui.modalPrimary.dataset.action = 'close-modal';
  const secondary = ui.modal.querySelector('.modal-secondary');
  if (secondary) secondary.hidden = true;
  ui.modal.querySelector('.modal-symbol').innerHTML = symbol === 'book'
    ? '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M19 19H6a2 2 0 0 0-2 2"/></svg>'
    : symbol === 'info'
      ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>';
  ui.modal.hidden = false;
}

function closeModal(result) {
  ui.modal.hidden = true;
  ui.modalPrimary.textContent = 'فهمت';
  ui.modalPrimary.dataset.action = 'close-modal';
  const secondary = ui.modal.querySelector('.modal-secondary');
  if (secondary) secondary.hidden = true;
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(result === undefined ? false : result);
  }
}

function openConfirm(title, body, primaryLabel, secondaryLabel) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    openModal(title, body, 'info');
    ui.modalPrimary.textContent = primaryLabel;
    ui.modalPrimary.dataset.action = 'confirm-primary';
    let secondary = ui.modal.querySelector('.modal-secondary');
    if (!secondary) {
      secondary = document.createElement('button');
      secondary.className = 'ghost-button modal-secondary';
      secondary.dataset.action = 'confirm-secondary';
      ui.modal.querySelector('.modal-card').appendChild(secondary);
    }
    secondary.textContent = secondaryLabel;
    secondary.hidden = false;
  });
}

function openHowToPlay() {
  openModal('كيف تُلعب؟', `<p>سباق من 10 أسئلة. لديك 15 ثانية لكل سؤال، وكل إجابة صحيحة تحركك خطوة على المضمار.</p><ul><li>أجب قبل الخصم لتحصل على 10 نقاط، وإلا 5 نقاط.</li><li>الإجابة الخاطئة توقف تقدمك في السؤال.</li><li>عند التعادل يُلعب سؤال فاصل مفاجئ حتى يحسم الفائز.</li><li>قدراتك (مرة في كل سباق): تخطّي سؤال صعب، تجميد الخصم 5 ثوانٍ، مضاعفة النقاط.</li><li>التحدي اليومي: 5 أسئلة جديدة كل يوم بمحاولة واحدة.</li><li>المراجع ظاهرة لكل سؤال حتى تبقى المعرفة دقيقة.</li></ul>`, 'info');
}

function openSources() {
  const counts = QUESTION_BANK.reduce((acc, question) => {
    acc[question.category] = (acc[question.category] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(counts).map(([category, count]) => `<div class="source-item"><strong>${category}</strong><span>${count} سؤالاً</span></div>`).join('');
  openModal('المصادر المستخدمة', `<div class="source-list">${rows}</div><p>كل سؤال يذكر مرجعه داخل اللعبة: سورة وآية من القرآن الكريم، أو حديث من الصحيحين برقمه، أو مرجع من كتب السيرة والفقه والتاريخ. التوسعة إلى 500 سؤال تتم بإضافة مراجعة بشرية لكل سؤال قبل اعتماده.</p>`, 'book');
}

function showQuestionSource() {
  const question = state.currentQuestion;
  if (!question) return;
  openModal('مرجع السؤال', `<p><b>${question.question}</b></p><p>المرجع: ${question.source}</p><p>كل سؤال في اللعبة موثّق بمصدره، والتوسعة إلى 500 سؤال تتم بإضافة مراجعة بشرية لكل سؤال قبل اعتماده.</p>`, 'book');
}

async function openOnlineQuick() {
  if (!SUPABASE_CONFIGURED) {
    openModal('🌐 مطابقة عشوائية', '<p>جارٍ البحث عن خصم متصل…</p>', 'info');
    window.setTimeout(async () => {
      if (ui.modal.hidden) return;
      const playBot = await openConfirm('🌐 اللعب عبر الإنترنت بانتظار بيانات Supabase', '<p>لا يوجد خصم متصل بعد، واللعب عبر الإنترنت يحتاج بيانات مشروع Supabase. هل تريد اللعب ضد الكمبيوتر الآن؟</p>', 'العب ضد الكمبيوتر', 'لاحقاً');
      if (playBot === true) startRace();
    }, 2500);
    return;
  }
  const signedIn = await ensureSupabaseSignedIn('random');
  if (!signedIn) { showToast('سجّل الدخول بـ Google أولاً للمطابقة العشوائية'); return; }
  openModal('🌐 مطابقة عشوائية', '<p>جارٍ البحث عن خصم متصل عبر Supabase…</p>', 'info');
  const found = await sbFindRandomRoom();
  if (found.ok && found.room) {
    const matchRes = await sbCreateMatch(found.room, found.room.host_id, 'random');
    if (!matchRes.ok) { openModal('🌐 تعذّرت المطابقة', `<p>${matchRes.reason || 'حاول مجدداً'}</p>`, 'info'); return; }
    const hostName = await sbDisplayName(found.room.host_id);
    closeModal();
    startOnlineRace(found.room, matchRes.match, hostName, false);
    return;
  }
  if (found.ok === false) { openModal('🌐 تعذّرت المطابقة', `<p>${found.reason || 'حاول مجدداً'}</p>`, 'info'); return; }
  const created = await sbCreateRoom('random');
  if (!created.ok) { openModal('🌐 تعذّرت المطابقة', `<p>${created.reason || 'حاول مجدداً'}</p>`, 'info'); return; }
  openModal('🌐 بانتظار خصم…', '<p>أُنشئت غرفة مطابقة عشوائية. نبحث عن خصم متصل — ستبدأ المباراة فور انضمامه (حتى 60 ثانية).</p>', 'info');
  const waited = await waitForOpponent(created.room, 60);
  if (!waited.ok || !waited.match) {
    try { if (supabaseClient) await supabaseClient.from('rooms').delete().eq('id', created.room.id); } catch (error) { /* best-effort */ }
    const playBot = await openConfirm('🌐 لم ينضم خصم بعد', '<p>لم ينضم أي خصم خلال 60 ثانية. هل تريد اللعب ضد الكمبيوتر الآن؟</p>', 'العب ضد الكمبيوتر', 'لاحقاً');
    if (playBot === true) startRace();
    return;
  }
  const oppName = await sbDisplayName(waited.match.player2_id);
  closeModal();
  startOnlineRace(created.room, waited.match, oppName, true);
}
async function openRoom() {
  if (!SUPABASE_CONFIGURED) {
    const choice = await openConfirm('🚪 غرف الأصدقاء', '<p>أنشئ غرفة خاصة برمز ورابط دعوة، أو انضم إلى غرفة برمز.</p><p>ملاحظة: الغرف عبر الإنترنت تحتاج بيانات مشروع Supabase؛ هذه الغرفة محلية على هذا الجهاز فقط.</p>', 'إنشاء غرفة', 'الانضمام برمز');
    if (choice === true) {
      const code = genRoomCode();
      const rooms = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]');
      rooms.push({ code, created: Date.now() });
      localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
      const link = `${location.origin}${location.pathname}?room=${code}`;
      try { await navigator.clipboard.writeText(link); } catch (error) { /* clipboard unavailable */ }
      const copy = await openConfirm('✅ تم إنشاء الغرفة', `<p>رمز الغرفة: <b>${code}</b></p><p>رابط الدعوة: <b>${link}</b></p><p>أُرسل الرابط إلى صديقك ليفتحه في متصفحه.</p>`, 'نسخ الرابط مجدداً', 'إغلاق');
      if (copy === true) {
        try { await navigator.clipboard.writeText(link); showToast('تم نسخ رابط الدعوة'); } catch (error) { /* clipboard unavailable */ }
      }
    } else if (choice === 'secondary') {
      const code = (prompt('أدخل رمز الغرفة (6 أحرف):') || '').trim().toUpperCase();
      if (code) joinRoomByCode(code);
    }
    return;
  }
  const signedIn = await ensureSupabaseSignedIn('room');
  if (!signedIn) { showToast('سجّل الدخول بـ Google أولاً لإنشاء غرفة أو الانضمام إليها'); return; }
  const choice = await openConfirm('🚪 غرف الأصدقاء', '<p>أنشئ غرفة خاصة برمز ورابط دعوة عبر Supabase، أو انضم إلى غرفة صديق برمزها.</p>', 'إنشاء غرفة', 'الانضمام برمز');
  if (choice === true) {
    const created = await sbCreateRoom('friend');
    if (!created.ok) { openModal('🚪 تعذّر إنشاء الغرفة', `<p>${created.reason || 'حاول مجدداً'}</p>`, 'info'); return; }
    const code = created.room.code;
    const link = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(link); } catch (error) { /* clipboard unavailable */ }
    const copy = await openConfirm('✅ تم إنشاء الغرفة', `<p>رمز الغرفة: <b>${code}</b></p><p>رابط الدعوة: <b>${link}</b></p><p>أُرسل الرابط إلى صديقك. ستبدأ المباراة فور انضمامه (بانتظار حتى دقيقتين).</p>`, 'نسخ الرابط مجدداً', 'إغلاق');
    if (copy === true) {
      try { await navigator.clipboard.writeText(link); showToast('تم نسخ رابط الدعوة'); } catch (error) { /* clipboard unavailable */ }
    }
    openModal('🚪 بانتظار صديقك…', `<p>الغرفة <b>${code}</b> جاهزة. بانتظار انضمام صديقك (حتى دقيقتين)…</p>`, 'info');
    const waited = await waitForOpponent(created.room, 120);
    if (!waited.ok || !waited.match) { closeModal(); showToast('لم ينضم أحد إلى الغرفة بعد'); return; }
    const oppName = await sbDisplayName(waited.match.player2_id);
    closeModal();
    startOnlineRace(created.room, waited.match, oppName, true);
  } else if (choice === 'secondary') {
    const code = (prompt('أدخل رمز الغرفة (6 أحرف):') || '').trim().toUpperCase();
    if (code) joinRoomByCode(code);
  }
}
async function joinRoomByCode(code) {
  if (!code) return;
  if (state.mode === 'online' && state.screen === 'race') return;
  if (!SUPABASE_CONFIGURED) {
    const rooms = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]');
    const found = rooms.find((room) => room.code === code);
    if (found) openModal('🚪 الغرفة موجودة', `<p>وجدنا الغرفة <b>${code}</b> على هذا الجهاز. الانضمام الفعلي للاعبين عبر الإنترنت يحتاج بيانات مشروع Supabase.</p>`, 'info');
    else openModal('🚪 الرمز غير موجود', `<p>لم نعثر على غرفة بالرمز <b>${code}</b> على هذا الجهاز. تأكد من الرمز وحاول مجدداً.</p>`, 'info');
    return;
  }
  const signedIn = await ensureSupabaseSignedIn(`join:${code}`);
  if (!signedIn) { showToast('سجّل الدخول بـ Google أولاً للانضمام إلى غرفة'); return; }
  const res = await sbJoinRoom(code);
  if (!res.ok) { openModal('🚪 تعذّر الانضمام', `<p>${res.reason || 'تأكد من الرمز وحاول مجدداً'}</p>`, 'info'); return; }
  const matchRes = await sbCreateMatch(res.room, res.room.host_id, 'friend');
  if (!matchRes.ok) { openModal('🚪 تعذّر بدء المباراة', `<p>${matchRes.reason || 'حاول مجدداً'}</p>`, 'info'); return; }
  const hostName = await sbDisplayName(res.room.host_id);
  closeModal();
  startOnlineRace(res.room, matchRes.match, hostName, false);
}
async function openLeaderboard() {
  const localRows = () => {
    const history = loadHistory().sort((a, b) => b.score - a.score).slice(0, 5);
    return history.length
      ? history.map((h, i) => `<div class="source-item"><strong>${i + 1}. ${h.score} نقطة</strong><span>${h.mode || ''} · ${h.correct || 0} إجابة صحيحة</span></div>`).join('')
      : '<p>لا نتائج بعد — العب سباقاً لتظهر نتيجتك هنا.</p>';
  };
  if (!SUPABASE_CONFIGURED || !supabaseUser) {
    openModal('🏆 لوحة الصدارة (محلية)', `<div class="source-list">${localRows()}</div><p>لوحة الصدارة العالمية عبر Supabase تظهر بعد تسجيل الدخول بـ Google.</p>`, 'info');
    return;
  }
  openModal('🏆 لوحة الصدارة', '<p>جارٍ تحميل الصدارة العالمية…</p>', 'info');
  const res = await sbFetchLeaderboard();
  if (!res.ok) {
    openModal('🏆 لوحة الصدارة (محلية)', `<div class="source-list">${localRows()}</div><p>تعذّر تحميل الصدارة العالمية: ${res.reason || ''}</p>`, 'info');
    return;
  }
  const rows = res.rows.length
    ? res.rows.map((r) => `<div class="source-item"><strong>${r.rank_position || ''}. ${r.display_name || r.username || 'لاعب'}</strong><span>${r.total_score || 0} نقطة · ${r.games_won || 0} فوزاً · أفضل سلسلة ${r.best_streak || 0}</span></div>`).join('')
    : '<p>لا لاعبين بعد في الصدارة العالمية — كُن أولهم!</p>';
  openModal('🏆 لوحة الصدارة العالمية', `<div class="source-list">${rows}</div><p>مرتبة حسب النقاط والانتصارات من جدول profiles عبر Supabase.</p>`, 'info');
}
function openProfile() {
  const title = titleFor(profile.xp);
  const level = Math.floor(profile.xp / 250) + 1;
  const achievements = (profile.achievements || []);
  const ach = ACHIEVEMENTS.map((a) => {
    const unlocked = achievements.includes(a.id);
    return `<div class="ach-item ${unlocked ? 'unlocked' : 'locked'}"><span>${a.icon}</span><div><strong>${a.title}</strong><small>${a.desc}</small></div><b>${unlocked ? '✓' : '🔒'}</b></div>`;
  }).join('');
  openModal('👤 ملف اللاعب', `<div class="profile-sheet"><p><b>${profile.name}</b> · ${title} · المستوى ${level}</p><p>النقاط: ${profile.xp} XP · السباقات: ${profile.games} · الانتصارات: ${profile.wins} · أفضل سلسلة: ${profile.bestStreak}</p><div class="ach-grid">${ach}</div><div class="profile-actions"><button class="ghost-button" data-action="edit-name">تعديل الاسم</button><button class="ghost-button" data-action="enable-notifications">تفعيل الإشعارات</button><button class="ghost-button" data-action="google-signin">تسجيل الدخول بـ Google</button></div></div>`, 'info');
}

function loadGsi() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function handleGoogleCredential(response) {
  try {
    const payload = JSON.parse(atob(response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.name) profile.name = payload.name;
    profile.google = { email: payload.email || '', name: payload.name || '' };
    saveProfile();
    closeModal();
    updateHomeStats();
    showToast(`أهلاً ${payload.name || 'بك'}! تم تسجيل الدخول بـ Google`);
  } catch (error) {
    showToast('تعذّر إكمال تسجيل الدخول');
  }
}

async function openGoogleSignIn() {
  if (SUPABASE_CONFIGURED) {
    if (supabaseUser) {
      const out = await openConfirm('تسجيل الدخول بـ Google', `<p>أنت مسجّل الدخول بحساب <b>${supabaseUser.email || ''}</b> عبر Supabase.</p>`, 'تسجيل الخروج', 'إغلاق');
      if (out === true) {
        const client = await getSupabaseClient();
        if (client) await client.auth.signOut();
        supabaseUser = null;
        showToast('تم تسجيل الخروج');
        updateHomeStats();
      }
      return;
    }
    const res = await signInWithGoogleSupabase();
    if (!res.ok) openModal('تسجيل الدخول بـ Google', `<p>تعذّر بدء تسجيل الدخول: ${res.reason || ''}</p>`, 'info');
    return;
  }
  if (!GOOGLE_CONFIGURED) {
    openModal('تسجيل الدخول بـ Google', '<p>الدخول بـ Google (Gmail فقط، لا دخول برقم هاتف) غير مفعّل بعد — أضف بيانات Supabase في config.js أولاً.</p>', 'info');
    return;
  }
  openModal('تسجيل الدخول بـ Google', '<p>سجّل الدخول بحساب Google الخاص بك:</p><div id="gsiButton"></div>', 'info');
  loadGsi().then(() => {
    window.google.accounts.id.initialize({ client_id: ILMRACE_CONFIG.GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    window.google.accounts.id.renderButton(document.getElementById('gsiButton'), { theme: 'outline', size: 'large', width: 280 });
  }).catch(() => showToast('تعذّر تحميل خدمة Google'));
}
function createConfetti() {
  const layer = document.querySelector('#confettiLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const colors = ['#d9a441', '#0d9f74', '#f4d47c', '#7dd8b8', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${Math.random() * 100}%`);
    piece.style.setProperty('--r', `${Math.random() * 360}deg`);
    piece.style.setProperty('--d', `${(Math.random() * 0.8).toFixed(2)}s`);
    piece.style.background = colors[i % colors.length];
    layer.appendChild(piece);
  }
}

function burstSparkles() {
  const card = ui.card;
  if (!card) return;
  for (let i = 0; i < 10; i++) {
    const spark = document.createElement('span');
    spark.className = 'burst-spark';
    spark.style.setProperty('--bx', `${(Math.random() - 0.5) * 220}px`);
    spark.style.setProperty('--by', `${(Math.random() - 0.7) * 180}px`);
    card.appendChild(spark);
    window.setTimeout(() => spark.remove(), 900);
  }
}

function toggleTheme() {
  const next = ui.shell.dataset.theme === 'light' ? 'dark' : 'light';
  ui.shell.dataset.theme = next;
  localStorage.setItem('ilmrace-theme', next);
  showToast(next === 'light' ? 'تم تفعيل الوضع الفاتح' : 'تم تفعيل الوضع الليلي');
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'start-race') startRace();
      else if (action === 'start-online') openOnlineQuick();
      else if (action === 'start-room') openRoom();
      else if (action === 'start-tournament') startTournament();
      else if (action === 'start-daily') startDaily();
      else if (action === 'home') { clearRoundTimers(); showScreen('home'); }
      else if (action === 'theme') toggleTheme();
      else if (action === 'how-to-play') openHowToPlay();
      else if (action === 'open-sources') openSources();
      else if (action === 'show-question-source') showQuestionSource();
      else if (action === 'close-modal') closeModal();
      else if (action === 'confirm-primary') closeModal(true);
      else if (action === 'confirm-secondary') closeModal('secondary');
      else if (action === 'quit-race') { clearRoundTimers(); showScreen('home'); }
      else if (action === 'locked-mode') showToast('هذا النمط جزء من المرحلة الثانية — جرّب نمط التدريب الآن');
      else if (action === 'open-leaderboard') openLeaderboard();
      else if (action === 'open-profile') openProfile();
      else if (action === 'google-signin') openGoogleSignIn();
      else if (action === 'enable-notifications') enableNotifications();
      else if (action === 'edit-name') {
        const name = prompt('ما اسمك؟', profile.name);
        if (name && name.trim()) { profile.name = name.trim(); saveProfile(); updateHomeStats(); openProfile(); }
      } else if (action === 'use-power-skip') usePower('skip');
      else if (action === 'use-power-freeze') usePower('freeze');
      else if (action === 'use-power-double') usePower('double');
      else if (action === 'confirm-order') answerOrder();
    }
    const answer = event.target.closest('.answer-button');
    if (answer) {
      if (answer.classList.contains('order-button')) pickOrder(Number(answer.dataset.answerIndex), answer);
      else handleAnswer(Number(answer.dataset.answerIndex));
    }
  });
  ui.modal.addEventListener('click', (event) => {
    if (event.target === ui.modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.modal.hidden) closeModal();
  });
}

function boot() {
  validateQuestionBank();
  refreshSupabaseSession();
  mergeRemoteQuestions();
  const savedTheme = localStorage.getItem('ilmrace-theme');
  ui.shell.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
  updateHomeStats();
  bindEvents();
  showScreen('home');
  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    window.setTimeout(() => {
      showToast(`وصلتك دعوة غرفة: ${roomCode}`);
      joinRoomByCode(roomCode.toUpperCase());
    }, 600);
  }
  console.info(`سباق المعلومات جاهز — ${QUESTION_BANK.length} سؤالاً موثّقاً. حالة الشبكة: ${networkAdapter.status()}`);
}

window.ilmraceDebug = { questionBank: QUESTION_BANK, state, validateQuestionBank, network: networkAdapter };
boot();
