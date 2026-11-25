// مقتطفات ربط Supabase الحقيقي في app.js — تُدرجها tools/patch-app.py.
// هذا الملف لا يُحمَّل في اللعبة؛ إنه مصدر الترقيعات فقط.
// كل دالة هنا تعمل داخل نطاق app.js نفسه (نفس المتغيرات والدوال).

// ===== SECTION: SUPABASE_BLOCK =====
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

// ===== SECTION: NETWORK_ADAPTER =====
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

// ===== SECTION: OPEN_ONLINE_QUICK =====
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

// ===== SECTION: OPEN_ROOM =====
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

// ===== SECTION: JOIN_ROOM_BY_CODE =====
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

// ===== SECTION: OPEN_LEADERBOARD =====
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

// ===== SECTION: OPEN_GOOGLE_SIGNIN =====
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
