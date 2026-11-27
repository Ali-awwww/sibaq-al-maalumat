// سباق المعلومات — منطق اللعبة (الإصدار 1.0)
// بنك الأسئلة: 36 سؤالاً أساسياً في هذا الملف + 64 سؤالاً في questions.js = 100 سؤال موثّق بمصدره.
// يُحمَّل questions.js وconfig.js قبل هذا الملف (سكربتات عادية) ويقرأهما عبر window.
const EXTRA_QUESTIONS = window.EXTRA_QUESTIONS || [];
const SIBAQ_CONFIG = window.SIBAQ_CONFIG || {};
const SUPABASE_CONFIGURED = Boolean(SIBAQ_CONFIG.SUPABASE_URL && SIBAQ_CONFIG.SUPABASE_ANON_KEY);
const GOOGLE_CONFIGURED = Boolean(SIBAQ_CONFIG.GOOGLE_CLIENT_ID);
// Migrate legacy ilmrace storage keys to the new sibaq keys on first run, so existing players keep their profile and settings.
function migrateLegacyKey(s, k, o) { try { if (s.getItem(k) === null) { const v = s.getItem(o); if (v !== null) s.setItem(k, v); } } catch (e) {} }
migrateLegacyKey(localStorage, 'sibaq-profile-v1', 'ilmrace-profile-v1');
migrateLegacyKey(localStorage, 'sibaq-theme', 'ilmrace-theme');
migrateLegacyKey(sessionStorage, 'sibaq-pending-action', 'ilmrace-pending-action');

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

const CACHED_QUESTIONS_KEY = 'sibaq-cached-questions-v1';
const GUEST_LINK_KEY = 'sibaq-guest-link-v1';
const LANG_KEY = 'sibaq-lang-v1';

function loadLang() {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar';
  } catch (error) {
    return 'ar';
  }
}

let currentLang = loadLang();
function isEn() { return currentLang === 'en'; }
function tr(ar, en) { return isEn() ? en : ar; }
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAppOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

function showOfflineRequiredMessage() {
  openModal(
    tr('📡 وضع غير متاح دون اتصال', '📡 Offline Unavailable'),
    tr('<p>هذا الوضع يحتاج اتصالاً بالإنترنت.</p>', '<p>This mode requires an internet connection.</p>'),
    'info',
  );
}

function isLinkedGoogleAccount() {
  return Boolean((supabaseUser && !supabaseUser.is_anonymous) || (profile && profile.google && profile.google.email));
}

function updateConnectionStatus() {
  if (ui.homeEyebrow) {
    ui.homeEyebrow.innerHTML = isAppOnline()
      ? tr('<span class="live-dot"></span>الموسم الأول · متصل وجاهز', '<span class="live-dot"></span>Season 1 · Online & Ready')
      : tr('<span class="live-dot"></span>وضع عدم الاتصال · التدريب والتحدي اليومي جاهزان', '<span class="live-dot"></span>Offline Mode · Practice & Daily Ready');
  }
}

function getSupabaseClient() {
  if (supabaseClient) return Promise.resolve(supabaseClient);
  if (!SUPABASE_CONFIGURED || !isAppOnline()) return Promise.resolve(null);
  if (!supabaseClientPromise) {
    supabaseClientPromise = import(SUPABASE_JS_URL)
      .then((mod) => {
        supabaseClient = mod.createClient(SIBAQ_CONFIG.SUPABASE_URL, SIBAQ_CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        return supabaseClient;
      })
      .catch((error) => {
        console.warn('تعذّر تحميل مكتبة Supabase', error);
        supabaseClientPromise = null;
        return null;
      });
  }
  return supabaseClientPromise;
}

async function refreshSupabaseSession() {
  const client = await getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    supabaseUser = data && data.session ? data.session.user : null;
    if (supabaseUser && !supabaseUser.is_anonymous) {
      await upsertSupabaseProfile();
      resumePendingSupabaseAction();
    }
    if (!authListenerRegistered) {
      authListenerRegistered = true;
      client.auth.onAuthStateChange(async (_event, session) => {
        supabaseUser = session ? session.user : null;
        if (supabaseUser && !supabaseUser.is_anonymous) await upsertSupabaseProfile();
      });
    }
  } catch (error) { console.warn('تعذّر استعادة جلسة Supabase', error); }
  return supabaseUser;
}

async function resumePendingSupabaseAction() {
  let pending = null;
  try { pending = sessionStorage.getItem('sibaq-pending-action'); sessionStorage.removeItem('sibaq-pending-action'); } catch (error) { /* no storage */ }
  if (!pending || !supabaseUser || supabaseUser.is_anonymous) return;
  if (pending === 'random') openOnlineQuick();
  else if (pending === 'room') openRoom();
  else if (pending === 'link-gmail') showToast(tr('تم ربط حساب Gmail وحفظ تقدّمك بنجاح ✓', 'Gmail account linked & progress saved ✓'));
  else if (pending.startsWith('join:')) joinRoomByCode(pending.slice(5));
}

async function upsertSupabaseProfile() {
  if (!supabaseClient || !supabaseUser || supabaseUser.is_anonymous) return;
  try {
    const meta = supabaseUser.user_metadata || {};
    const name = meta.full_name || meta.name || (profile.name && profile.name !== 'ضيف' ? profile.name : 'لاعب');
    const username = (supabaseUser.email || supabaseUser.id).split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30) || `player_${supabaseUser.id.slice(0, 8)}`;

    let guestSnapshot = null;
    try {
      const rawGuest = localStorage.getItem(GUEST_LINK_KEY);
      if (rawGuest) {
        guestSnapshot = JSON.parse(rawGuest);
        localStorage.removeItem(GUEST_LINK_KEY);
      }
    } catch (error) { /* ignore */ }

    let remote = null;
    try {
      const { data } = await supabaseClient.from('profiles').select('total_score,games_played,games_won,best_streak').eq('id', supabaseUser.id).maybeSingle();
      remote = data || null;
    } catch (error) { /* ignore */ }

    if (guestSnapshot) {
      profile.xp = (remote ? (remote.total_score || 0) : 0) + (guestSnapshot.xp || 0);
      profile.games = (remote ? (remote.games_played || 0) : 0) + (guestSnapshot.games || 0);
      profile.wins = (remote ? (remote.games_won || 0) : 0) + (guestSnapshot.wins || 0);
      profile.totalAnswered = Math.max(profile.totalAnswered || 0, guestSnapshot.totalAnswered || 0);
      profile.totalCorrect = Math.max(profile.totalCorrect || 0, guestSnapshot.totalCorrect || 0);
      profile.bestStreak = Math.max(remote ? (remote.best_streak || 0) : 0, guestSnapshot.bestStreak || 0, profile.bestStreak || 0);
      if (Array.isArray(guestSnapshot.achievements)) {
        const mergedAch = new Set([...(profile.achievements || []), ...guestSnapshot.achievements]);
        profile.achievements = [...mergedAch];
      }
      if (guestSnapshot.campaign) campaignState = mergeCampaignData(campaignState, guestSnapshot.campaign);
      if (guestSnapshot.league) leagueState = mergeLeagueData(leagueState, guestSnapshot.league);
    } else if (remote) {
      profile.xp = Math.max(profile.xp || 0, remote.total_score || 0);
      profile.games = Math.max(profile.games || 0, remote.games_played || 0);
      profile.wins = Math.max(profile.wins || 0, remote.games_won || 0);
      profile.bestStreak = Math.max(profile.bestStreak || 0, remote.best_streak || 0);
    }

    if (meta.sibaq_campaign) campaignState = mergeCampaignData(campaignState, meta.sibaq_campaign);
    if (meta.sibaq_league) leagueState = mergeLeagueData(leagueState, meta.sibaq_league);
    saveCampaign();
    saveLeague();

    profile.isGuest = false;
    profile.google = { email: supabaseUser.email || '', name };
    if (name) profile.name = name;

    await supabaseClient.from('profiles').upsert({
      id: supabaseUser.id,
      username,
      display_name: profile.name,
      avatar_url: meta.avatar_url || meta.picture || null,
      total_score: profile.xp,
      games_played: profile.games,
      games_won: profile.wins,
      best_streak: profile.bestStreak,
    }, { onConflict: 'id' });

    syncProgressToSupabaseMetadata();
    saveProfile();
    updateHomeStats();
    if (state.screen === 'campaign') renderCampaignScreen();
  } catch (error) { console.warn('تعذّر حفظ الملف في Supabase', error); }
}

async function trySupabaseAnonymousSignIn() {
  if (!SUPABASE_CONFIGURED || !isAppOnline() || supabaseUser) return false;
  try {
    const client = await getSupabaseClient();
    if (!client || !client.auth || typeof client.auth.signInAnonymously !== 'function') return false;
    const { data, error } = await client.auth.signInAnonymously();
    if (!error && data && data.user) {
      supabaseUser = data.user;
      return true;
    }
  } catch (error) {
    /* Supabase قد يعطّل الدخول المجهول — نستخدم ملف الضيف المحلي بصمت */
  }
  return false;
}

async function signInWithGoogleSupabase() {
  if (!isAppOnline()) return { ok: false, reason: tr('هذا الوضع يحتاج اتصالاً بالإنترنت', 'This mode requires an internet connection') };
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: tr('مكتبة Supabase غير متاحة', 'Supabase library unavailable') };
  const redirectTo = `${location.origin}${location.pathname}`;
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

async function ensureSupabaseSignedIn(pendingAction) {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return false;
  }
  const client = await getSupabaseClient();
  if (!client) {
    showOfflineRequiredMessage();
    return false;
  }
  if (!supabaseUser) await refreshSupabaseSession();
  if (supabaseUser && !supabaseUser.is_anonymous) return true;
  const go = await openConfirm(
    tr('🔐 الدخول بـ Google مطلوب', '🔐 Google Sign-In Required'),
    tr('<p>أوضاع الإنترنت (المطابقة والغرف) تتطلب تسجيل الدخول بـ Google (Gmail فقط) عبر Supabase.</p>', '<p>Online modes (Random Match and Friends Rooms) require Google Sign-In (Gmail only) via Supabase.</p>'),
    tr('تسجيل الدخول بـ Google', 'Sign in with Google'),
    tr('لاحقاً', 'Later'),
  );
  if (go !== true) return false;
  try { if (pendingAction) sessionStorage.setItem('sibaq-pending-action', pendingAction); } catch (error) { /* no storage */ }
  await signInWithGoogleSupabase();
  return false;
}

async function sbDisplayName(userId) {
  if (!userId || !supabaseClient) return tr('خصم متصل', 'Online Opponent');
  try {
    const { data } = await supabaseClient.from('profiles').select('display_name,username').eq('id', userId).maybeSingle();
    return (data && (data.display_name || data.username)) || tr('خصم متصل', 'Online Opponent');
  } catch (error) { return tr('خصم متصل', 'Online Opponent'); }
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
  if (!client || !supabaseUser) return { ok: false, reason: tr('سجّل الدخول بـ Google أولاً', 'Sign in with Google first') };
  const code = genRoomCode();
  const { data, error } = await client.from('rooms').insert({ code, host_id: supabaseUser.id, status: 'waiting', mode, max_players: 2 }).select().single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, room: data };
}

async function sbJoinRoom(code) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: tr('سجّل الدخول بـ Google أولاً', 'Sign in with Google first') };
  const { data, error } = await client.from('rooms').select('*').eq('code', code).eq('status', 'waiting').maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: tr('لم نعثر على غرفة بهذا الرمز أو أنها بدأت بالفعل', 'Room not found with that code or it has already started') };
  return { ok: true, room: data };
}

async function sbFindRandomRoom() {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: tr('سجّل الدخول بـ Google أولاً', 'Sign in with Google first') };
  const { data, error } = await client.from('rooms').select('*').eq('mode', 'random').eq('status', 'waiting').neq('host_id', supabaseUser.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, room: data || null };
}

async function sbCreateMatch(room, opponentId, matchType) {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: tr('سجّل الدخول بـ Google أولاً', 'Sign in with Google first') };
  const isHost = room.host_id === supabaseUser.id;
  const row = { room_id: room.id, player1_id: isHost ? supabaseUser.id : room.host_id, player2_id: isHost ? opponentId : supabaseUser.id, status: 'playing', match_type: matchType || room.mode || 'random', current_question_index: 0, player1_score: 0, player2_score: 0 };
  const { data, error } = await client.from('matches').insert(row).select().single();
  if (error) return { ok: false, reason: error.message };
  try { await client.from('rooms').update({ status: 'playing', started_at: new Date().toISOString() }).eq('id', room.id); } catch (error) { /* best-effort */ }
  return { ok: true, match: data };
}

async function waitForOpponent(room, seconds) {
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: tr('مكتبة Supabase غير متاحة', 'Supabase library unavailable') };
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const { data } = await client.from('matches').select('*').eq('room_id', room.id).eq('status', 'playing').maybeSingle();
    if (data) return { ok: true, match: data };
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ok: false, reason: tr('لم ينضم خصم بعد', 'No opponent joined yet') };
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
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr('سباق مباشر عبر الإنترنت · 10 أسئلة', 'Live Online Race · 10 Questions');
  showToast(tr('🌐 سباق مباشر — تقدّم خصمك يظهر لحظياً عبر Supabase Realtime', '🌐 Live Race — Opponent progress updates live via Supabase Realtime'));
}

async function sbFetchLeaderboard() {
  const client = await getSupabaseClient();
  if (!client || !supabaseUser) return { ok: false, reason: tr('سجّل الدخول بـ Google أولاً', 'Sign in with Google first') };
  const { data, error } = await client.from('leaderboard').select('*').limit(10);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, rows: data || [] };
}

async function sbFetchRemoteQuestions() {
  if (!isAppOnline()) return { ok: false, reason: tr('هذا الوضع يحتاج اتصالاً بالإنترنت', 'This mode requires an internet connection') };
  const client = await getSupabaseClient();
  if (!client) return { ok: false, reason: tr('مكتبة Supabase غير متاحة', 'Supabase library unavailable') };
  const { data, error } = await client.from('questions').select('*').eq('is_active', true).limit(1000);
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
  const rawExp = (row.explanation || '').trim();
  let explanation = '';
  let source = rawExp || 'جدول أسئلة Supabase';
  const match = rawExp.match(/^(.*?)\s*\(المصدر:\s*(.+?)\)\s*$/);
  if (match) {
    explanation = match[1].trim();
    source = match[2].trim();
  }
  const q = { id: `sb-${row.id}`, category: row.category, difficulty: diff, type: isBool ? 'boolean' : 'mcq', question: row.question_text, options: row.options, correct, source };
  if (explanation) q.explanation = explanation;
  return q;
}

function loadCachedRemoteQuestions() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHED_QUESTIONS_KEY) || '[]');
    if (!Array.isArray(cached) || !cached.length) return;
    const seen = new Set(QUESTION_BANK.map((q) => q.question));
    for (const row of cached) {
      const q = mapRemoteQuestion(row);
      if (q && !seen.has(q.question)) { QUESTION_BANK.push(q); seen.add(q.question); }
    }
  } catch (error) { /* ignore invalid cache */ }
}

async function mergeRemoteQuestions() {
  if (remoteQuestionsMerged || !SUPABASE_CONFIGURED || !isAppOnline()) return;
  remoteQuestionsMerged = true;
  try {
    const res = await sbFetchRemoteQuestions();
    if (!res.ok) return;
    try { localStorage.setItem(CACHED_QUESTIONS_KEY, JSON.stringify(res.rows)); } catch (error) { /* quota */ }
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
  if (!isAppOnline()) return;
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
    if (isAppOnline() && supabaseClient && supabaseUser) {
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

window.sibaqSupabase = {
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

const EN_BASE_TRANSLATIONS = {
  1: { question: 'Which is the first Surah in the order of the Mushaf?', options: ['Al-Fatihah', 'Al-Baqarah', 'Al-Ikhlas', 'An-Nas'], explanation: 'Surah Al-Fatihah is the opening chapter of the Noble Quran.' },
  2: { question: 'Which is the longest Surah in the Noble Quran?', options: ['Al-Baqarah', 'Ali \'Imran', 'An-Nisa', 'Al-Ma\'idah'], explanation: 'Surah Al-Baqarah is the longest Surah with 286 verses.' },
  3: { question: 'How many Surahs are in the Noble Quran?', options: ['110 Surahs', '112 Surahs', '114 Surahs', '120 Surahs'], explanation: 'The Noble Quran contains 114 Surahs.' },
  4: { question: 'In which month was the Quran revealed?', options: ['Rajab', 'Sha\'ban', 'Ramadan', 'Dhul-Hijjah'], explanation: 'Allah says: "The month of Ramadan in which was revealed the Quran."' },
  5: { question: 'Which Surah does not begin with the Basmalah?', options: ['Al-Anfal', 'At-Tawbah', 'Yunus', 'Hud'], explanation: 'Surah At-Tawbah (Bara\'ah) begins without Bismillah ir-Rahman ir-Rahim.' },
  6: { question: 'In which Surah is Ayat al-Kursi located?', options: ['Ali \'Imran', 'Ta-Ha', 'Al-Baqarah', 'Ar-Rahman'], explanation: 'Ayat al-Kursi is verse 255 of Surah Al-Baqarah.' },
  7: { question: 'The obligatory prayers in a day and night are five prayers.', options: ['True', 'False'], explanation: 'Fajr, Dhuhr, Asr, Maghrib, and Isha are the five daily obligatory prayers.' },
  8: { question: 'In which direction do Muslims face during prayer?', options: ['Toward the Noble Ka\'bah', 'Toward Mount Arafat', 'Toward Al-Madinah', 'Toward Al-Aqsa Mosque'], explanation: 'Muslims face the Qiblah — the Noble Ka\'bah in Makkah.' },
  9: { question: 'Which month do Muslims fast as an obligation?', options: ['Muharram', 'Ramadan', 'Shawwal', 'Dhul-Qi\'dah'], explanation: 'Fasting the month of Ramadan is the fourth pillar of Islam.' },
  10: { question: 'Friday (Jumu\'ah) prayer is performed in congregation on Friday.', options: ['True', 'False'], explanation: 'Jumu\'ah prayer is an obligatory congregational prayer on Friday.' },
  11: { question: 'Which act of worship is generally preceded by ritual purification (Taharah/Wudu)?', options: ['Hajj', 'Fasting', 'Prayer (Salah)', 'Charity'], explanation: 'Ritual purity (Wudu) is a condition for the validity of prayer.' },
  12: { question: 'What is the fourth pillar of Islam in the famous hadith?', options: ['Giving Zakah', 'Fasting Ramadan', 'Pilgrimage (Hajj)', 'Establishing Prayer'], explanation: 'In the hadith of Ibn Umar: testimony, prayer, Zakah, fasting Ramadan, and Hajj.' },
  13: { question: 'Where did the first revelation descend upon Prophet Muhammad ﷺ?', options: ['In Cave Thawr', 'In Cave Hira', 'In Quba Mosque', 'On Mount Arafat'], explanation: 'The first revelation came to the Prophet ﷺ in Cave Hira on Jabal an-Nur.' },
  14: { question: 'What was the first word revealed from the revelation?', options: ['Say (Qul)', 'Read (Iqra\')', 'Glorify (Sabbih)', 'Seek forgiveness'], explanation: 'The first word revealed was "Iqra\'" (Read) from Surah Al-Alaq.' },
  15: { question: 'In which city was Prophet Muhammad ﷺ born?', options: ['Al-Madinah al-Munawwarah', 'Ta\'if', 'Makkah al-Mukarramah', 'Jerusalem'], explanation: 'Prophet Muhammad ﷺ was born in Makkah al-Mukarramah.' },
  16: { question: 'To which city did the Prophet ﷺ migrate from Makkah?', options: ['To Ta\'if', 'To Al-Madinah al-Munawwarah', 'To Yemen', 'To Egypt'], explanation: 'The Prophet ﷺ migrated from Makkah to Al-Madinah al-Munawwarah (Yathrib).' },
  17: { question: 'Who accompanied the Prophet ﷺ during the Hijrah (migration)?', options: ['Ali ibn Abi Talib', 'Umar ibn al-Khattab', 'Abu Bakr as-Siddiq', 'Uthman ibn Affan'], explanation: 'Abu Bakr as-Siddiq (may Allah be pleased with him) was the Prophet\'s companion in the cave.' },
  18: { question: 'What is the name of the first mosque the Prophet ﷺ built upon arriving in Al-Madinah?', options: ['Quba Mosque', 'Al-Masjid al-Haram', 'Masjid al-Qiblatayn', 'The Prophet\'s Mosque'], explanation: 'Quba Mosque was the first mosque built upon the Prophet\'s ﷺ arrival in Al-Madinah.' },
  19: { question: 'In which cave did the Prophet ﷺ and Abu Bakr take shelter during the Hijrah?', options: ['In Cave Thawr', 'In Cave Hira', 'In Cave of the Kahf', 'In Cave Uhud'], explanation: 'They stayed in Cave Thawr south of Makkah for three nights.' },
  20: { question: 'In which Hijri year did the Conquest of Makkah take place?', options: ['5 AH', '8 AH', '10 AH', '2 AH'], explanation: 'The Conquest of Makkah took place in Ramadan of 8 AH.' },
  21: { question: 'What comes first in the famous hadith about deeds?', options: ['Actions are judged by intentions', 'Actions are by speech', 'Actions are by wealth', 'Actions are by count'], explanation: 'The hadith opens with: "Actions are judged only by intentions."' },
  22: { question: 'Islam is built upon five pillars.', options: ['True', 'False'], explanation: 'Yes: the two testimonies, prayer, Zakah, fasting Ramadan, and Hajj.' },
  23: { question: 'Which Companion is famous for narrating the largest number of hadiths?', options: ['Abu Hurayrah', 'Zayd ibn Thabit', 'Sa\'d ibn Abi Waqqas', 'Abdullah ibn Umar'], explanation: 'Abu Hurayrah (may Allah be pleased with him) is the most prolific narrator of hadith.' },
  24: { question: 'Which angel appeared in the Hadith of Jibril (peace be upon him)?', options: ['Israfil', 'Jibril (Gabriel)', 'Mika\'il', 'Angel of Death'], explanation: 'Angel Jibril came in human form to teach the Companions Islam, Iman, and Ihsan.' },
  25: { question: 'The hadith "Actions are judged by intentions" was narrated by Al-Bukhari and Muslim.', options: ['True', 'False'], explanation: 'It is agreed upon (Muttafaqun Alayh) by Al-Bukhari and Muslim.' },
  26: { question: 'Which act is described as a branch of Iman in the hadith of Branches of Faith?', options: ['Removing a harmful object from the road', 'Abundance of wealth', 'Collecting charity', 'Traveling'], explanation: 'The Prophet ﷺ mentioned removing harm from the road as the lowest branch of Iman.' },
  27: { question: 'What was the ancient name of Al-Madinah al-Munawwarah?', options: ['Makkah', 'Yathrib', 'Badr', 'Ta\'if'], explanation: 'Before the Hijrah, Al-Madinah was known as Yathrib.' },
  28: { question: 'In which Hijri year did the Great Battle of Badr occur?', options: ['1 AH', '2 AH', '3 AH', '4 AH'], explanation: 'The Battle of Badr took place in 2 AH on the 17th of Ramadan.' },
  29: { question: 'What were the Muslims who migrated from Makkah to Al-Madinah called?', options: ['Al-Ansar', 'Al-Muhajirun', 'At-Tabi\'un', 'Al-A\'rab'], explanation: 'Al-Muhajirun are those who migrated from Makkah to Al-Madinah for the sake of Allah.' },
  30: { question: 'What were the people of Al-Madinah who supported the Prophet ﷺ called?', options: ['Al-Muhajirun', 'Al-A\'rab', 'Al-Ansar', 'Al-Ahzab'], explanation: 'Al-Ansar (the Helpers) are the people of Al-Madinah who welcomed and aided the Prophet ﷺ.' },
  31: { question: 'Who was the first of the Rightly Guided Caliphs?', options: ['Umar ibn al-Khattab', 'Abu Bakr as-Siddiq', 'Uthman ibn Affan', 'Ali ibn Abi Talib'], explanation: 'Abu Bakr as-Siddiq (may Allah be pleased with him) was the first Caliph (11–13 AH).' },
  32: { question: 'Who was the first Mu\'adhdhin (caller to prayer) in Islam?', options: ['Bilal ibn Rabah', 'Abdullah ibn Mas\'ud', 'Zayd ibn Thabit', 'Khalid ibn al-Walid'], explanation: 'Bilal ibn Rabah (may Allah be pleased with him) was the first to call the Adhan in Islam.' },
  33: { question: 'How many pillars of Iman (faith) are mentioned in the Hadith of Jibril?', options: ['Four pillars', 'Five pillars', 'Six pillars', 'Seven pillars'], explanation: 'The six pillars: Allah, His angels, His books, His messengers, the Last Day, and Qadar.' },
  34: { question: 'Belief in the angels is one of the pillars of Iman.', options: ['True', 'False'], explanation: 'Yes, belief in the angels is the second pillar of Iman.' },
  35: { question: 'Who is the Seal of the Prophets and Messengers?', options: ['Musa (peace be upon him)', 'Isa (peace be upon him)', 'Muhammad ﷺ', 'Ibrahim (peace be upon him)'], explanation: 'Prophet Muhammad ﷺ is the Seal of the Prophets (Surah Al-Ahzab, 40).' },
  36: { question: 'Which Surah is renowned for affirming the Oneness of Allah?', options: ['Al-Falaq', 'Al-Ikhlas', 'Al-Kawthar', 'Al-Ma\'un'], explanation: 'Surah Al-Ikhlas purely affirms the Oneness (Tawhid) of Allah.' },
};

for (const q of BASE_QUESTIONS) {
  if (EN_BASE_TRANSLATIONS[q.id]) {
    q.en = EN_BASE_TRANSLATIONS[q.id];
  }
}

const QUESTION_BANK = [...BASE_QUESTIONS, ...EXTRA_QUESTIONS];

function countEnglishQuestions() {
  return QUESTION_BANK.filter((q) => Boolean(q && q.en && q.en.question)).length;
}

const STORAGE_KEY = 'sibaq-profile-v1';
const HISTORY_KEY = 'sibaq-history-v1';
const DAILY_KEY = 'sibaq-daily-v1';
const ROOMS_KEY = 'sibaq-rooms-v1';
const CAMPAIGN_KEY = 'sibaq-campaign-v1';
const LEAGUE_KEY = 'sibaq-league-v1';
const HIFZ_KEY = 'sibaq-hifz-v1';
const KIDS_KEY = 'sibaq-kids-v1';
const QUESTS_KEY = 'sibaq-quests-v1';
const TEAM_KEY = 'sibaq-team-v1';
const TEAMS_DIR_KEY = 'sibaq-teams-dir-v1';
const DISCOVER_KEY = 'sibaq-discover-v1';
const DISCOVER_LB_CACHE_KEY = 'sibaq-discover-lb-cache-v1';
const TEACHER_KEY = 'sibaq-teacher-v1';
const TEACHER_SESSIONS_KEY = 'sibaq-teacher-sessions-v1';
const CAMPAIGN_TOTAL_LEVELS = 50;

const RIVAL_TEAMS = [
  { id: 'dawn', ar: 'فرسان الفجر', en: 'Dawn Knights', icon: '🛡️', baseMembers: [{ name: 'خالد', score: 30 }, { name: 'عمر', score: 25 }] },
  { id: 'seerah', ar: 'نخبة السيرة', en: 'Seerah Elite', icon: '🦁', baseMembers: [{ name: 'سارة', score: 35 }, { name: 'يوسف', score: 20 }] },
  { id: 'knowledge', ar: 'حماة المعرفة', en: 'Knowledge Guardians', icon: '🦅', baseMembers: [{ name: 'مريم', score: 28 }, { name: 'أنس', score: 27 }] },
];

const AVATARS = [
  { id: 'default', icon: null, ar: 'الحرف الأول', en: 'Initial', bg: 'linear-gradient(135deg, #d9a441, #0d9f74)' },
  { id: 'lion', icon: '🦁', ar: 'الأسد', en: 'Lion', bg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
  { id: 'falcon', icon: '🦅', ar: 'الصقر', en: 'Falcon', bg: 'linear-gradient(135deg, #06b6d4, #0e7490)' },
  { id: 'crescent', icon: '🌙', ar: 'الهلال', en: 'Crescent', bg: 'linear-gradient(135deg, #6366f1, #312e81)' },
  { id: 'book', icon: '📖', ar: 'المصحف', en: 'Book', bg: 'linear-gradient(135deg, #10b981, #065f46)' },
  { id: 'star', icon: '⭐', ar: 'النجم', en: 'Star', bg: 'linear-gradient(135deg, #fbbf24, #d97706)' },
  { id: 'lantern', icon: '🏮', ar: 'الفانوس', en: 'Lantern', bg: 'linear-gradient(135deg, #f43f5e, #9f1239)' },
  { id: 'shield', icon: '🛡️', ar: 'الدرع', en: 'Shield', bg: 'linear-gradient(135deg, #8b5cf6, #4c1d95)' },
];

const COMPANIONS = [
  {
    id: 'siraj', icon: '🌟', ar: 'سراج', en: 'Siraj',
    cheersAr: ['أحسنت! خطوة واثقة نحو القمة!', 'ما شاء الله! سرعة وتركيز رائع!', 'أبدعت! واصل هذا التألق!'],
    cheersEn: ['Well done! A confident step forward!', 'Great focus and speed!', 'Awesome! Keep shining!'],
    winAr: 'مبارك الفوز! سراج فخور بأدائك الرائع!',
    winEn: 'Victory is yours! Siraj is proud of you!',
  },
  {
    id: 'noor', icon: '💡', ar: 'نور', en: 'Noor',
    cheersAr: ['إجابة منيرة! علمك يتألق!', 'رائع! ذكاء وسرعة بديهة!', 'بارك الله في فهمك!'],
    cheersEn: ['Bright answer! Your knowledge shines!', 'Brilliant and quick!', 'Keep that light glowing!'],
    winAr: 'انتصار مشرق! أحسنت يا نجم المعرفة!',
    winEn: 'A shining victory! Well played!',
  },
  {
    id: 'hakeem', icon: '🦉', ar: 'حكيم', en: 'Hakeem',
    cheersAr: ['اختيار حكيم ومتقن!', 'تثبت في إجابتك — ممتاز!', 'علم راسخ وإجابة موفقة!'],
    cheersEn: ['A wise and steady choice!', 'Spot-on reasoning!', 'Solid knowledge!'],
    winAr: 'فوز مستحق بحكمتك وتركيزك!',
    winEn: 'A well-earned victory through wisdom!',
  },
  {
    id: 'badr', icon: '🌙', ar: 'بدر', en: 'Badr',
    cheersAr: ['ممتاز! مضيء كالبدر!', 'رائع جداً، إلى الأمام!', 'إصابة دقيقة ما شاء الله!'],
    cheersEn: ['Shining bright like the full moon!', 'Spot on, keep going!', 'Amazing accuracy!'],
    winAr: 'مبارك! أتممت السباق كالبدر في كماله!',
    winEn: 'Congratulations! You completed the race brightly!',
  },
];

const HIFZ_SURAH_TRACKER = [
  { id: 'fatihah', ar: 'سورة الفاتحة', en: 'Al-Fatihah', meta: '7 آيات' },
  { id: 'ikhlas', ar: 'سورة الإخلاص', en: 'Al-Ikhlas', meta: '4 آيات' },
  { id: 'falaq', ar: 'سورة الفلق', en: 'Al-Falaq', meta: '5 آيات' },
  { id: 'nas', ar: 'سورة الناس', en: 'An-Nas', meta: '6 آيات' },
  { id: 'kawthar', ar: 'سورة الكوثر', en: 'Al-Kawthar', meta: '3 آيات' },
  { id: 'asr', ar: 'سورة العصر', en: 'Al-Asr', meta: '3 آيات' },
  { id: 'nasr', ar: 'سورة النصر', en: 'An-Nasr', meta: '3 آيات' },
  { id: 'kafirun', ar: 'سورة الكافرون', en: 'Al-Kafirun', meta: '6 آيات' },
  { id: 'quraysh', ar: 'سورة قريش', en: 'Quraysh', meta: '4 آيات' },
  { id: 'maun', ar: 'سورة الماعون', en: 'Al-Ma’un', meta: '7 آيات' },
  { id: 'duha', ar: 'سورة الضحى', en: 'Ad-Duha', meta: '11 آية' },
  { id: 'juz-amma', ar: 'جزء عمّ (مراجعة)', en: 'Juz Amma Review', meta: 'الجزء 30' },
];

const HIFZ_TRAINING_MODES = [
  { id: 'complete-ayah', icon: '✍️', ar: 'أكمل الآية', en: 'Complete Verse', descAr: 'أكمل الكلمة الناقصة في الآيات القصيرة', descEn: 'Finish the missing word in short verses' },
  { id: 'order-ayat', icon: '🔢', ar: 'رتّب الآيات', en: 'Order Verses', descAr: 'رتّب آيات السورة القصيرة بالتسلسل الصحيح', descEn: 'Put short Surah verses in sequence' },
  { id: 'mutashabihat', icon: '🔎', ar: 'الآيات المتشابهة', en: 'Similar Verses', descAr: 'ميّز بين نهايات ومطالع الآيات المتشابهة', descEn: 'Distinguish similar verse openings & endings' },
  { id: 'identify-surah', icon: '📖', ar: 'حدّد السورة', en: 'Identify Surah', descAr: 'تعرّف على السورة التي وردت فيها الآية', descEn: 'Identify which Surah contains the verse' },
];

const HIFZ_QUESTIONS = [
  { id: 9001, hifzType: 'complete-ayah', category: 'القرآن', difficulty: 'سهل', type: 'complete', question: 'أكمل الآية: «قُلْ هُوَ اللَّهُ أَحَدٌ * اللَّهُ ...»', options: ['الصَّمَدُ', 'الْعَزِيزُ', 'الْغَفُورُ', 'الرَّحِيمُ'], correct: 0, source: 'سورة الإخلاص، الآية 2', explanation: 'الآية الثانية من سورة الإخلاص: «اللَّهُ الصَّمَدُ».', en: { question: 'Complete the verse: “Qul Huwa Allahu Ahad * Allahu ...”', options: ['As-Samad', 'Al-Aziz', 'Al-Ghafur', 'Ar-Rahim'] } },
  { id: 9002, hifzType: 'complete-ayah', category: 'القرآن', difficulty: 'سهل', type: 'complete', question: 'أكمل الآية: «وَالْعَصْرِ * إِنَّ الْإِنسَانَ لَفِي ...»', options: ['نِعْمَةٍ', 'خُسْرٍ', 'سَعَادَةٍ', 'غَفْلَةٍ'], correct: 1, source: 'سورة العصر، الآية 2', explanation: 'الآية الثانية من سورة العصر: «إِنَّ الْإِنسَانَ لَفِي خُسْرٍ».', en: { question: 'Complete the verse: “Wal-Asr * Innal-insana lafi ...”', options: ['Ni’matin', 'Khusrin', 'Sa’adatin', 'Ghaflatin'] } },
  { id: 9003, hifzType: 'complete-ayah', category: 'القرآن', difficulty: 'سهل', type: 'complete', question: 'أكمل الآية: «إِذَا جَاءَ نَصْرُ اللَّهِ وَ...»', options: ['الْبَرَكَةُ', 'النُّورُ', 'الْفَتْحُ', 'الْيُسْرُ'], correct: 2, source: 'سورة النصر، الآية 1', explanation: 'مطلع سورة النصر: «إِذَا جَاءَ نَصْرُ اللَّهِ وَالْفَتْحُ».', en: { question: 'Complete the verse: “Idha ja’a nasrullahi wal- ...”', options: ['Barakah', 'Nur', 'Fath', 'Yusr'] } },
  { id: 9004, hifzType: 'complete-ayah', category: 'القرآن', difficulty: 'سهل', type: 'complete', question: 'أكمل الآية: «قُلْ أَعُوذُ بِرَبِّ النَّاسِ * مَلِكِ ...»', options: ['السَّمَاءِ', 'الْمُلْكِ', 'الْخَلْقِ', 'النَّاسِ'], correct: 3, source: 'سورة الناس، الآية 2', explanation: 'الآية الثانية من سورة الناس: «مَلِكِ النَّاسِ».', en: { question: 'Complete the verse: “Qul a’udhu bi-Rabbin-nas * Maliki ...”', options: ['As-Sama’', 'Al-Mulk', 'Al-Khalq', 'An-Nas'] } },
  { id: 9005, hifzType: 'complete-ayah', category: 'القرآن', difficulty: 'سهل', type: 'complete', question: 'أكمل الآية: «تَبَّتْ يَدَا أَبِي لَهَبٍ وَ...»', options: ['تَبَّ', 'خَسِرَ', 'ذَهَبَ', 'نَدِمَ'], correct: 0, source: 'سورة المسد، الآية 1', explanation: 'الآية الأولى من سورة المسد: «تَبَّتْ يَدَا أَبِي لَهَبٍ وَتَبَّ».', en: { question: 'Complete the verse: “Tabbat yada Abi Lahabin wa ...”', options: ['Tabb', 'Khasira', 'Dhahaba', 'Nadima'] } },

  { id: 9006, hifzType: 'order-ayat', category: 'القرآن', difficulty: 'سهل', type: 'order', question: 'رتّب آيات سورة الإخلاص من الآية 1 إلى الآية 4:', options: ['«لَمْ يَلِدْ وَلَمْ يُولَدْ»', '«قُلْ هُوَ اللَّهُ أَحَدٌ»', '«وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ»', '«اللَّهُ الصَّمَدُ»'], correct: 0, correctOrder: [1, 3, 0, 2], source: 'سورة الإخلاص، الآيات 1–4', explanation: 'ترتيب سورة الإخلاص: قُلْ هُوَ اللَّهُ أَحَدٌ ← اللَّهُ الصَّمَدُ ← لَمْ يَلِدْ وَلَمْ يُولَدْ ← وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ.', en: { question: 'Order the verses of Surah Al-Ikhlas from verse 1 to 4:', options: ['Lam yalid wa lam yulad', 'Qul Huwa Allahu Ahad', 'Wa lam yakun lahu kufuwan ahad', 'Allahu as-Samad'] } },
  { id: 9007, hifzType: 'order-ayat', category: 'القرآن', difficulty: 'سهل', type: 'order', question: 'رتّب آيات سورة قريش من الآية 1 إلى الآية 4:', options: ['«فَلْيَعْبُدُوا رَبَّ هَٰذَا الْبَيْتِ»', '«لِإِيلَافِ قُرَيْشٍ»', '«الَّذِي أَطْعَمَهُم مِّن جُوعٍ وَآمَنَهُم مِّنْ خَوْفٍ»', '«إِيلَافِهِمْ رِحْلَةَ الشِّتَاءِ وَالصَّيْفِ»'], correct: 0, correctOrder: [1, 3, 0, 2], source: 'سورة قريش، الآيات 1–4', explanation: 'ترتيب سورة قريش: لإيلاف قريش ← إيلافهم رحلة الشتاء والصيف ← فليعبدوا رب هذا البيت ← الذي أطعمهم من جوع وآمنهم من خوف.', en: { question: 'Order the verses of Surah Quraysh from verse 1 to 4:', options: ['Fal-ya’budu Rabba hadhal-bayt', 'Li-ilafi Quraysh', 'Alladhi at’amahum min ju’in...', 'Ilafihim rihlatash-shita’i was-sayf'] } },
  { id: 9008, hifzType: 'order-ayat', category: 'القرآن', difficulty: 'سهل', type: 'order', question: 'رتّب آيات سورة العصر من الأولى إلى الثالثة:', options: ['«إِلَّا الَّذِينَ آمَنُوا وَعَمِلُوا الصَّالِحَاتِ وَتَوَاصَوْا بِالْحَقِّ وَتَوَاصَوْا بِالصَّبْرِ»', '«وَالْعَصْرِ»', '«إِنَّ الْإِنسَانَ لَفِي خُسْرٍ»'], correct: 0, correctOrder: [1, 2, 0], source: 'سورة العصر، الآيات 1–3', explanation: 'سورة العصر ثلاث آيات تبدأ بالقسم بالعصر ثم بيان خسران الإنسان إلا أهل الإيمان والعمل الصالح والتواصي.', en: { question: 'Order the three verses of Surah Al-Asr (1 to 3):', options: ['Illal-ladhina amanu wa amilus-salihat...', 'Wal-Asr', 'Innal-insana lafi khusr'] } },
  { id: 9009, hifzType: 'order-ayat', category: 'القرآن', difficulty: 'متوسط', type: 'order', question: 'رتّب أول أربع آيات من سورة التين (من الآية 1 إلى 4):', options: ['«وَهَٰذَا الْبَلَدِ الْأَمِينِ»', '«وَالتِّينِ وَالزَّيْتُونِ»', '«لَقَدْ خَلَقْنَا الْإِنسَانَ فِي أَحْسَنِ تَقْوِيمٍ»', '«وَطُورِ سِينِينَ»'], correct: 0, correctOrder: [1, 3, 0, 2], source: 'سورة التين، الآيات 1–4', explanation: 'أول أربع آيات: والتين والزيتون ← وطور سينين ← وهذا البلد الأمين ← لقد خلقنا الإنسان في أحسن تقويم.', en: { question: 'Order the first 4 verses of Surah At-Tin (1 to 4):', options: ['Wa hadhal-baladil-amin', 'Wat-tini waz-zaytun', 'Laqad khalaqnal-insana fi ahsani taqwim', 'Wa turi sinin'] } },
  { id: 9010, hifzType: 'order-ayat', category: 'القرآن', difficulty: 'سهل', type: 'order', question: 'رتّب آيات سورة النصر من الأولى إلى الثالثة:', options: ['«فَسَبِّحْ بِحَمْدِ رَبِّكَ وَاسْتَغْفِرْهُ ۚ إِنَّهُ كَانَ تَوَّابًا»', '«إِذَا جَاءَ نَصْرُ اللَّهِ وَالْفَتْحُ»', '«وَرَأَيْتَ النَّاسَ يَدْخُلُونَ فِي دِينِ اللَّهِ أَفْوَاجًا»'], correct: 0, correctOrder: [1, 2, 0], source: 'سورة النصر، الآيات 1–3', explanation: 'ترتيب سورة النصر يبدأ بمجيء نصر الله والفتح، ثم دخول الناس أفواجاً، ثم الأمر بالتسبيح والاستغفار.', en: { question: 'Order the three verses of Surah An-Nasr (1 to 3):', options: ['Fa-sabbih bihamdi Rabbika wastaghfirh...', 'Idha ja’a nasrullahi wal-fath', 'Wa ra’aytan-nasa yadkhuluna fi dinillahi afwaja'] } },

  { id: 9011, hifzType: 'mutashabihat', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما الختام الصحيح للآية الأخيرة في سورة الكافرون: «لَكُمْ دِينُكُمْ...»؟', options: ['وَلِيَ دِينِ', 'وَلَنَا دِينُنَا', 'وَلَكُمْ أَعْمَالُكُمْ', 'وَاللَّهُ يَحْكُمُ بَيْنَنَا'], correct: 0, source: 'سورة الكافرون، الآية 6', explanation: 'ختام سورة الكافرون في الآية 6: «لَكُمْ دِينُكُمْ وَلِيَ دِينِ».', en: { question: 'What is the exact ending of the last verse of Surah Al-Kafirun: “Lakum dinukum...”?', options: ['Wa liya din', 'Wa lana dinuna', 'Wa lakum a’malukum', 'Wallahu yahkumu baynana'] } },
  { id: 9012, hifzType: 'mutashabihat', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'في أي سورة قصيرة ورد قوله تعالى: «فَصَلِّ لِرَبِّكَ وَانْحَرْ»؟', options: ['سورة الماعون', 'سورة الكوثر', 'سورة الضحى', 'سورة الشرح'], correct: 1, source: 'سورة الكوثر، الآية 2', explanation: 'وردت الآية الكريمة «فَصَلِّ لِرَبِّكَ وَانْحَرْ» في سورة الكوثر، الآية 2.', en: { question: 'In which short Surah does the verse “Fa-salli li-Rabbika wanhar” appear?', options: ['Surah Al-Ma’un', 'Surah Al-Kawthar', 'Surah Ad-Duha', 'Surah Ash-Sharh'] } },
  { id: 9013, hifzType: 'mutashabihat', category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'في المتشابهات: كم مرة وردت آية «وَلَا أَنتُمْ عَابِدُونَ مَا أَعْبُدُ» بلفظها في سورة الكافرون؟', options: ['مرة واحدة', 'مرتين', 'ثلاث مرات', 'أربع مرات'], correct: 1, source: 'سورة الكافرون، الآيتان 3 و5', explanation: 'تكررت هذه الآية مرتين في سورة الكافرون في الموضعين 3 و5.', en: { question: 'In Al-Kafirun, how many times is “Wa la antum abiduna ma a’bud” repeated?', options: ['Once', 'Twice', 'Three times', 'Four times'] } },
  { id: 9014, hifzType: 'mutashabihat', category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'ورد «أَلَمْ تَرَ كَيْفَ فَعَلَ رَبُّكَ بِأَصْحَابِ الْفِيلِ» في سورة الفيل؛ فأي سورة ورد فيها «أَلَمْ تَرَ كَيْفَ فَعَلَ رَبُّكَ بِعَادٍ»؟', options: ['سورة القارعة', 'سورة العاديات', 'سورة الفجر', 'سورة الغاشية'], correct: 2, source: 'سورة الفجر، الآية 6', explanation: 'ورد قوله تعالى «أَلَمْ تَرَ كَيْفَ فَعَلَ رَبُّكَ بِعَادٍ» في سورة الفجر، الآية 6.', en: { question: '“Alam tara kayfa fa’ala Rabbuka bi-Adin” appears in which Surah (distinct from Surah Al-Fil)?', options: ['Surah Al-Qari’ah', 'Surah Al-Adiyat', 'Surah Al-Fajr', 'Surah Al-Ghashiyah'] } },
  { id: 9015, hifzType: 'mutashabihat', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما الكلمة الأخيرة في سورة الشرح: «فَإِذَا فَرَغْتَ فَانصَبْ * وَإِلَىٰ رَبِّكَ...»؟', options: ['فَاشْكُرْ', 'فَاسْجُدْ', 'فَارْجِعْ', 'فَارْغَبْ'], correct: 3, source: 'سورة الشرح، الآيتان 7–8', explanation: 'ختام سورة الشرح: «وَإِلَىٰ رَبِّكَ فَارْغَب».', en: { question: 'What is the final word in Surah Ash-Sharh: “Wa ila Rabbika...”?', options: ['Fashkur', 'Fasjud', 'Farji’', 'Farghab'] } },

  { id: 9016, hifzType: 'identify-surah', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'حدّد السورة التي ورد فيها قوله تعالى: «فَوَيْلٌ لِّلْمُصَلِّينَ * الَّذِينَ هُمْ عَن صَلَاتِهِمْ سَاهُونَ»:', options: ['سورة الماعون', 'سورة الكوثر', 'سورة العصر', 'سورة الهمزة'], correct: 0, source: 'سورة الماعون، الآيتان 4–5', explanation: 'وردت الآيتان في سورة الماعون (الآيتان 4 و5).', en: { question: 'Identify the Surah containing: “Fawaylun lil-musallin * Alladhina hum an salatihim sahun”:', options: ['Surah Al-Ma’un', 'Surah Al-Kawthar', 'Surah Al-Asr', 'Surah Al-Humazah'] } },
  { id: 9017, hifzType: 'identify-surah', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'حدّد السورة التي ورد فيها قوله تعالى: «أَلَمْ يَجِدْكَ يَتِيمًا فَآوَىٰ»:', options: ['سورة الشرح', 'سورة الضحى', 'سورة التين', 'سورة العلق'], correct: 1, source: 'سورة الضحى، الآية 6', explanation: 'وردت هذه الآية في سورة الضحى، الآية 6.', en: { question: 'Identify the Surah containing: “Alam yajidka yatiman fa-awa”:', options: ['Surah Ash-Sharh', 'Surah Ad-Duha', 'Surah At-Tin', 'Surah Al-Alaq'] } },
  { id: 9018, hifzType: 'identify-surah', category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'حدّد السورة التي تبدأ بقوله تعالى: «لَا أُقْسِمُ بِهَٰذَا الْبَلَدِ»:', options: ['سورة الفجر', 'سورة الشمس', 'سورة البلد', 'سورة الليل'], correct: 2, source: 'سورة البلد، الآية 1', explanation: 'مطلع سورة البلد: «لَا أُقْسِمُ بِهَٰذَا الْبَلَدِ» أي مكة المكرمة.', en: { question: 'Identify the Surah that begins with: “La uqsimu bi-hadhal-balad”:', options: ['Surah Al-Fajr', 'Surah Ash-Shams', 'Surah Al-Balad', 'Surah Al-Layl'] } },
  { id: 9019, hifzType: 'identify-surah', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'حدّد السورة التي ورد فيها قوله تعالى: «فَأَمَّا مَن ثَقُلَتْ مَوَازِينُهُ * فَهُوَ فِي عِيشَةٍ رَّاضِيَةٍ»:', options: ['سورة الزلزلة', 'سورة العاديات', 'سورة التكاثر', 'سورة القارعة'], correct: 3, source: 'سورة القارعة، الآيتان 6–7', explanation: 'وردتا في سورة القارعة، الآيتان 6 و7.', en: { question: 'Identify the Surah containing: “Fa-amma man thaqulat mawazinuhu * Fahuwa fi \'ishatin radiyah”:', options: ['Surah Az-Zalzalah', 'Surah Al-Adiyat', 'Surah At-Takathur', 'Surah Al-Qari’ah'] } },
  { id: 9020, hifzType: 'identify-surah', category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'حدّد السورة التي تبدأ بقوله تعالى: «أَلْهَاكُمُ التَّكَاثُرُ * حَتَّىٰ زُرْتُمُ الْمَقَابِرَ»:', options: ['سورة التكاثر', 'سورة العصر', 'سورة الهمزة', 'سورة الفيل'], correct: 0, source: 'سورة التكاثر، الآيتان 1–2', explanation: 'مطلع سورة التكاثر: «أَلْهَاكُمُ التَّكَاثُرُ * حَتَّىٰ زُرْتُمُ الْمَقَابِرَ».', en: { question: 'Identify the Surah that begins with: “Alhakumut-takathur * Hatta zurtumul-maqabir”:', options: ['Surah At-Takathur', 'Surah Al-Asr', 'Surah Al-Humazah', 'Surah Al-Fil'] } },
];

const DAILY_QUESTS = [
  { id: 'play1', target: 1, rewardXp: 30, ar: 'العب سباقاً واحداً اليوم', en: 'Play 1 race today' },
  { id: 'correct10', target: 10, rewardXp: 50, ar: 'أجب 10 إجابات صحيحة اليوم', en: 'Answer 10 questions correctly today' },
  { id: 'daily1', target: 1, rewardXp: 60, ar: 'أكمل تحدي اليوم', en: 'Complete today’s Daily Challenge' },
];

const WHEEL_SEGMENTS = [
  { id: 'xp25', type: 'xp', value: 25, ar: '+25 نقطة خبرة', en: '+25 XP' },
  { id: 'xp50', type: 'xp', value: 50, ar: '+50 نقطة خبرة', en: '+50 XP' },
  { id: 'skip1', type: 'power', key: 'skip', value: 1, ar: 'تعزيز تخطّ +1 ↷', en: '+1 Skip Booster ↷' },
  { id: 'xp100', type: 'xp', value: 100, ar: '+100 نقطة خبرة', en: '+100 XP' },
  { id: 'freeze1', type: 'power', key: 'freeze', value: 1, ar: 'تعزيز تجميد +1 ❄️', en: '+1 Freeze Booster ❄️' },
  { id: 'double1', type: 'power', key: 'double', value: 1, ar: 'تعزيز مضاعفة +1 ×2', en: '+1 Double Booster ×2' },
];

const CAMPAIGN_CHAPTERS = [
  { id: 1, from: 1, to: 10, title: 'الفصل 1: بدايات طالب العلم', difficulty: 'سهل', badgeClass: '', questionCount: 5, passRatio: 0.6 },
  { id: 2, from: 11, to: 20, title: 'الفصل 2: نور المعرفة', difficulty: 'سهل إلى متوسط', badgeClass: '', questionCount: 6, passRatio: 0.65 },
  { id: 3, from: 21, to: 30, title: 'الفصل 3: مضمار الحفّاظ', difficulty: 'متوسط', badgeClass: 'medium', questionCount: 7, passRatio: 0.7 },
  { id: 4, from: 31, to: 40, title: 'الفصل 4: تحدي العلماء', difficulty: 'متوسط متقدّم', badgeClass: 'medium', questionCount: 8, passRatio: 0.75 },
  { id: 5, from: 41, to: 50, title: 'الفصل 5: قمة الأبطال', difficulty: 'صعب', badgeClass: 'hard', questionCount: 10, passRatio: 0.8 },
];

const LEAGUES = [
  { id: 'iron', name: 'حديد', en: 'Iron', icon: '🔩', promoteAt: 100, safeAt: 0 },
  { id: 'bronze', name: 'برونز', en: 'Bronze', icon: '🥉', promoteAt: 140, safeAt: 40 },
  { id: 'silver', name: 'فضة', en: 'Silver', icon: '🥈', promoteAt: 180, safeAt: 60 },
  { id: 'gold', name: 'ذهب', en: 'Gold', icon: '🥇', promoteAt: 220, safeAt: 80 },
  { id: 'platinum', name: 'بلاتين', en: 'Platinum', icon: '💠', promoteAt: 260, safeAt: 100 },
  { id: 'diamond', name: 'ماسي', en: 'Diamond', icon: '💎', promoteAt: 320, safeAt: 130 },
  { id: 'master', name: 'أستاذ', en: 'Master', icon: '🎖️', promoteAt: 400, safeAt: 160 },
  { id: 'champion', name: 'بطل', en: 'Champion', icon: '👑', promoteAt: null, safeAt: 200 },
];

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
const OPPONENT_EN = { 'سراج': 'Siraj', 'حافظ': 'Hafiz', 'قارئ': 'Qari', 'تحدي اليوم': 'Daily Challenge' };
const BOT_ACCURACY = { 'سهل': 0.85, 'متوسط': 0.65, 'صعب': 0.45 };
const TYPE_LABELS = { mcq: 'اختيار من متعدد', boolean: 'صح أم خطأ', order: 'رتّب بالترتيب', complete: 'أكمل الآية / الحديث' };
const TYPE_EN = { mcq: 'Multiple Choice', boolean: 'True / False', order: 'Put in Order', complete: 'Complete Verse / Hadith' };
const CAT_EN = { 'القرآن': 'Quran', 'الفقه': 'Fiqh', 'السيرة': 'Seerah', 'الحديث': 'Hadith', 'التاريخ': 'History', 'العقيدة': 'Aqeedah' };
const DIFF_EN = { 'سهل': 'Easy', 'متوسط': 'Medium', 'صعب': 'Hard', 'سهل إلى متوسط': 'Easy to Medium', 'متوسط متقدّم': 'Upper Medium' };
const TITLE_EN = {
  'طالب علم': 'Seeker of Knowledge',
  'قارئ صاعد': 'Rising Reader',
  'حافظ': 'Hafiz',
  'عالم صغير': 'Young Scholar',
  'إمام المعرفة': 'Knowledge Leader',
  'شيخ السباق': 'Master of the Race',
};
const ACH_EN = {
  'first-win': { title: 'First Victory', desc: 'Win your first race' },
  'streak-3': { title: 'Hot Streak', desc: '3 correct answers in a row' },
  'perfect': { title: 'Perfect Score', desc: 'Answer all race questions correctly' },
  'daily': { title: 'Daily Challenge', desc: 'Complete the Daily Challenge' },
  'races-10': { title: 'Veteran Racer', desc: 'Complete 10 races' },
  'xp-500': { title: 'XP Collector', desc: 'Collect 500 experience points' },
  'champion': { title: 'Tournament Champion', desc: 'Win a full tournament' },
};
const CHAPTER_EN = {
  1: 'Chapter 1: Foundations of Knowledge',
  2: 'Chapter 2: Light of Understanding',
  3: 'Chapter 3: Track of Memorizers',
  4: 'Chapter 4: Scholars’ Challenge',
  5: 'Chapter 5: Champions’ Summit',
};
const LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const LETTERS_EN = ['A', 'B', 'C', 'D', 'E', 'F'];

const I18N = {
  ar: {
    brandName: 'سباق المعلومات',
    brandTag: 'المعرفة أسرع مما تتوقع',
    heroTitle: 'كل إجابة صحيحة<br /><span>خطوة إلى الأمام.</span>',
    heroDesc: 'اختبر معلوماتك الإسلامية في سباق سريع ضد الكمبيوتر. أجب بثقة، راقب مضمارك، واصل إلى الراية قبل منافسك.',
    startRace: 'ابدأ السباق',
    playGuest: 'العب كضيف',
    howToPlay: 'كيف تُلعب؟',
    questionsLabel: 'أسئلة',
    secondsLabel: 'ثانية',
    quickProfile: 'ملفك السريع',
    xpLabel: 'الخبرة',
    winsLabel: 'انتصارات',
    accuracyLabel: 'دقة الإجابة',
    bestStreakLabel: 'أفضل سلسلة',
    ourApps: '📱 تطبيقاتنا',
    chooseMode: 'اختر نمط اللعب',
    modeSectionNote: 'الحملة الفردية والتدريب والتحدي اليومي تعمل دون إنترنت — وأوضاع الأونلاين متاحة عند الاتصال',
    modeReady: 'جاهز',
    modeTrainingTitle: 'تدريب ضد الكمبيوتر',
    modeTrainingDesc: 'سباق 10 أسئلة ضد سراج، كل سؤال 15 ثانية.',
    modePlayNow: 'العب الآن <b>←</b>',
    modeCampaignTitle: 'الحملة الفردية',
    modeOpenMap: 'افتح الخريطة <b>←</b>',
    modeOnlineStatus: 'مطابقة عشوائية',
    modeOnlineTitle: 'سباق سريع عبر الإنترنت',
    modeOnlineDesc: 'ابحث عن منافس عشوائي والعب ضده لحظياً (يعمل عند ربط Supabase).',
    modeFindMatch: 'ابحث عن منافس <b>←</b>',
    modeTourneyStatus: '3 جولات',
    modeTourneyTitle: 'بطولة الموسم',
    modeTourneyDesc: 'ثلاث جولات إقصائية ضد سراج وحافظ وقارئ — فُز بها كلها لتصبح البطل.',
    modeStartTourney: 'ابدأ البطولة <b>←</b>',
    modeHifzTitle: 'اختبر حفظك',
    modeHifzDesc: 'أكمل الآية، رتّب الآيات، المتشابهات، وحدّد السورة — مع تتبّع السور المحفوظة.',
    modeStartHifz: 'ابدأ الحفظ <b>←</b>',
    modeRoomStatus: 'رمز ورابط دعوة',
    modeRoomTitle: 'غرفة الأصدقاء',
    modeRoomDesc: 'أنشئ غرفة خاصة برمز ورابط دعوة، أو انضم إلى غرفة صديقك.',
    modeOpenRoom: 'إنشاء / انضمام <b>←</b>',
    didYouKnow: 'هل تعلم؟',
    insightText: 'أول ما نزل من القرآن: ﴿اقْرَأْ بِاسْمِ رَبِّكَ الَّذِي خَلَقَ﴾ — سورة العلق، الآيات 1-5.',
    usedSources: 'المصادر المستخدمة',
    backHome: 'العودة للرئيسية',
    campaignEyebrow: 'مسار التعلّم المتدرج · يعمل دون إنترنت',
    campaignTitle: 'الحملة الفردية — 50 مستوى',
    hifzEyebrow: 'قرآن كريم · تدريب حفظ دون إنترنت',
    hifzTitle: 'اختبر حفظك — 4 أنواع تدريب',
    hifzMixedBtn: 'تدريب شامل ←',
    hifzTrackerTitle: 'تتبّع الأجزاء والسور القصيرة المحفوظة',
    hifzTrackerNote: 'اضغط على أي سورة أو جزء لتعليمها بعلامة «محفوظ ✓» وحفظ تقدّمك محلياً.',
    hifzBackBtn: 'اختبر حفظك',
    endRace: 'إنهاء السباق',
    questionWord: 'السؤال',
    ofWord: 'من',
    completedWord: 'مكتملة',
    opponentRole: 'الخصم',
    youLabel: 'أنت',
    sourceBtn: 'المصدر',
    correctAnswerLabel: 'الإجابة الصحيحة',
    explanationLabel: 'الشرح',
    sourceLabel: 'المصدر',
    boostersLabel: 'تعزيزاتك',
    oncePerRace: 'مرة واحدة في كل سباق',
    boosterSkip: 'تخطّ',
    boosterFreeze: 'تجميد',
    boosterDouble: 'مضاعفة',
    raceTip: 'أجب قبل الخصم لتحصل على 10 نقاط بدلاً من 5.',
    pointsLabel: 'النقاط',
    correctAnswersLabel: 'إجابات صحيحة',
    avgTimeLabel: 'متوسط زمن الإجابة',
    campaignMapBtn: 'خريطة الحملة',
    shareResultBtn: 'شارك النتيجة',
    navHome: 'الرئيسية',
    navRace: 'السباق',
    navStart: 'ابدأ',
    navRanks: 'الترتيب',
    navProfile: 'ملفي',
    modalGotIt: 'فهمت',
    spectateBtn: '👁️ مشاهدة',
    modeTeamsTitle: 'الفرق والتحالفات',
    modeTeamsDesc: 'أنشئ فريقك بشعار خاص أو انضم برمز، وخض معركة فريق ضد فريق.',
    modeOpenTeams: 'إدارة الفريق <b>←</b>',
    modeTeacherStatus: 'رمز 5 أرقام',
    modeTeacherTitle: 'وضع المعلم',
    modeTeacherDesc: 'أنشئ جلسة حية برمز من 5 أرقام لطلابك وتابع إجاباتهم مباشرة.',
    modeOpenTeacher: 'افتح الجلسة <b>←</b>',
    discoverEyebrow: 'تفاعلات الأسبوع',
    discoverTitle: 'اكتشف Discover',
    discoverAllRanks: 'لوحة المتصدرين',
    discoverTopPlayersTitle: '🌟 أفضل لاعبي الأسبوع',
    discoverTrendingTitle: '🔥 المواضيع الرائجة',
    teacherEyebrow: 'فصل تفاعلي · محلي ومتزامن',
    teacherTitle: 'وضع المعلم — الجلسة الحية',
    teacherRoleHost: 'لوحة المعلم',
    teacherRoleStudent: 'انضمام طالب',
  },
  en: {
    brandName: 'Knowledge Race',
    brandTag: 'Knowledge faster than you expect',
    heroTitle: 'Every right answer<br /><span>is a step forward.</span>',
    heroDesc: 'Test your Islamic knowledge in a fast-paced trivia race against the computer. Answer with confidence, watch your track, and cross the finish line first.',
    startRace: 'Start Race',
    playGuest: 'Play as Guest',
    howToPlay: 'How to Play',
    questionsLabel: 'Questions',
    secondsLabel: 'Seconds',
    quickProfile: 'Quick Profile',
    xpLabel: 'Experience',
    winsLabel: 'Wins',
    accuracyLabel: 'Accuracy',
    bestStreakLabel: 'Best Streak',
    ourApps: '📱 Our Apps',
    chooseMode: 'Choose Game Mode',
    modeSectionNote: 'Solo Campaign, Practice, and Daily Challenge work offline — Online modes unlock when connected',
    modeReady: 'Ready',
    modeTrainingTitle: 'Practice vs Computer',
    modeTrainingDesc: 'A 10-question race against Siraj, 15 seconds per question.',
    modePlayNow: 'Play Now <b>→</b>',
    modeCampaignTitle: 'Solo Campaign',
    modeOpenMap: 'Open Map <b>→</b>',
    modeOnlineStatus: 'Random Match',
    modeOnlineTitle: 'Quick Online Race',
    modeOnlineDesc: 'Find a random opponent and race live in real time (powered by Supabase).',
    modeFindMatch: 'Find Match <b>→</b>',
    modeTourneyStatus: '3 Rounds',
    modeTourneyTitle: 'Season Tournament',
    modeTourneyDesc: 'Three knockout rounds against Siraj, Hafiz, and Qari — win them all to become champion.',
    modeStartTourney: 'Start Tournament <b>→</b>',
    modeHifzTitle: 'Test Your Hifz',
    modeHifzDesc: 'Complete verse, order verses, similar verses, and identify the Surah — with saved Surah tracking.',
    modeStartHifz: 'Start Hifz <b>→</b>',
    modeRoomStatus: 'Code & Invite Link',
    modeRoomTitle: 'Friends Room',
    modeRoomDesc: 'Create a private room with a code and invite link, or join a friend’s room.',
    modeOpenRoom: 'Create / Join <b>→</b>',
    didYouKnow: 'Did You Know?',
    insightText: 'The first verses revealed of the Quran: “Read in the name of your Lord who created” — Surah Al-Alaq, 1–5.',
    usedSources: 'Sources Used',
    backHome: 'Back to Home',
    campaignEyebrow: 'Progressive Learning Path · Works Offline',
    campaignTitle: 'Solo Campaign — 50 Levels',
    hifzEyebrow: 'Noble Quran · Offline Memorization Drill',
    hifzTitle: 'Test Your Hifz — 4 Practice Modes',
    hifzMixedBtn: 'Mixed Practice →',
    hifzTrackerTitle: 'Track Memorized Juz & Short Surahs',
    hifzTrackerNote: 'Tap any Surah or Juz to mark it as “Memorized ✓” and save locally.',
    hifzBackBtn: 'Test Your Hifz',
    endRace: 'End Race',
    questionWord: 'Question',
    ofWord: 'of',
    completedWord: 'done',
    opponentRole: 'Opponent',
    youLabel: 'You',
    sourceBtn: 'Source',
    correctAnswerLabel: 'Correct Answer',
    explanationLabel: 'Explanation',
    sourceLabel: 'Source',
    boostersLabel: 'Boosters',
    oncePerRace: 'Once per race',
    boosterSkip: 'Skip',
    boosterFreeze: 'Freeze',
    boosterDouble: 'Double',
    raceTip: 'Answer before your opponent to earn 10 points instead of 5.',
    pointsLabel: 'Score',
    correctAnswersLabel: 'Correct Answers',
    avgTimeLabel: 'Avg. Response',
    campaignMapBtn: 'Campaign Map',
    shareResultBtn: 'Share Result',
    navHome: 'Home',
    navRace: 'Race',
    navStart: 'Start',
    navRanks: 'Ranks',
    navProfile: 'Profile',
    modalGotIt: 'Got it',
    spectateBtn: '👁️ Watch',
    modeTeamsTitle: 'Teams & Clans',
    modeTeamsDesc: 'Create a team with an avatar emblem or join by code, and play Team vs Team battles.',
    modeOpenTeams: 'Manage Team <b>→</b>',
    modeTeacherStatus: '5-Digit Code',
    modeTeacherTitle: 'Teacher Mode',
    modeTeacherDesc: 'Host a live 5-digit classroom session and track student answers live.',
    modeOpenTeacher: 'Open Session <b>→</b>',
    discoverEyebrow: 'Weekly Highlights',
    discoverTitle: 'Discover',
    discoverAllRanks: 'Leaderboard',
    discoverTopPlayersTitle: '🌟 Top Players This Week',
    discoverTrendingTitle: '🔥 Trending Topics',
    teacherEyebrow: 'Interactive Class · Local & Synced',
    teacherTitle: 'Teacher Mode — Live Session',
    teacherRoleHost: 'Teacher Host',
    teacherRoleStudent: 'Join as Student',
  },
};

const ui = {
  shell: document.querySelector('#appShell'),
  home: document.querySelector('#homeScreen'),
  campaign: document.querySelector('#campaignScreen'),
  hifz: document.querySelector('#hifzScreen'),
  teacher: document.querySelector('#teacherScreen'),
  race: document.querySelector('#raceScreen'),
  result: document.querySelector('#resultScreen'),
  campaignChapters: document.querySelector('#campaignChapters'),
  campaignSummaryBar: document.querySelector('#campaignSummaryBar'),
  playNextCampaignBtn: document.querySelector('#playNextCampaignBtn'),
  hifzModesGrid: document.querySelector('#hifzModesGrid'),
  hifzTrackerGrid: document.querySelector('#hifzTrackerGrid'),
  hifzSavedCounter: document.querySelector('#hifzSavedCounter'),
  teacherHostPanel: document.querySelector('#teacherHostPanel'),
  teacherStudentPanel: document.querySelector('#teacherStudentPanel'),
  teacherRoleHostBtn: document.querySelector('#teacherRoleHostBtn'),
  teacherRoleStudentBtn: document.querySelector('#teacherRoleStudentBtn'),
  discoverTopPlayers: document.querySelector('#discoverTopPlayers'),
  discoverTrendingTopics: document.querySelector('#discoverTrendingTopics'),
  resultPrimaryBtn: document.querySelector('#resultPrimaryBtn'),
  resultCampaignBtn: document.querySelector('#resultCampaignBtn'),
  resultHifzBtn: document.querySelector('#resultHifzBtn'),
  kidsModeBanner: document.querySelector('#kidsModeBanner'),
  spectatorBanner: document.querySelector('#spectatorBanner'),
  teamBattleBanner: document.querySelector('#teamBattleBanner'),
  companionBubble: document.querySelector('#companionBubble'),
  resultCompanionBubble: document.querySelector('#resultCompanionBubble'),
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
  questionTranslationNotice: document.querySelector('#questionTranslationNotice'),
  questionArabicCompanion: document.querySelector('#questionArabicCompanion'),
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
  homeEyebrow: document.querySelector('#homeEyebrow'),
  explanationCard: document.querySelector('#answerExplanationCard'),
  explanationCorrect: document.querySelector('#explanationCorrect'),
  explanationText: document.querySelector('#explanationText'),
  explanationSource: document.querySelector('#explanationSource'),
  explanationArabicRow: document.querySelector('#explanationArabicRow'),
  explanationArabicCompanion: document.querySelector('#explanationArabicCompanion'),
  nextQuestionBtn: document.querySelector('#nextQuestionBtn'),
  googleSignInTopBtn: document.querySelector('.topbar .google-button'),
  langSwitch: document.querySelector('#langSwitch'),
};

function applyLanguageToDOM() {
  const dict = I18N[currentLang] || I18N.ar;
  if (document.documentElement) {
    document.documentElement.lang = isEn() ? 'en' : 'ar';
    document.documentElement.dir = isEn() ? 'ltr' : 'rtl';
  }
  document.title = isEn() ? 'Knowledge Race · Sibaq Al-Maalumat' : 'سباق المعلومات';
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && typeof metaDesc.setAttribute === 'function') {
    metaDesc.setAttribute(
      'content',
      isEn()
        ? 'Knowledge Race — A fast and engaging Islamic trivia racing game'
        : 'سباق المعلومات — لعبة أسئلة إسلامية سريعة وممتعة',
    );
  }
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    if (key && dict[key] !== undefined) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.dataset.i18nHtml;
    if (key && dict[key] !== undefined) el.innerHTML = dict[key];
  });
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    const active = btn.dataset.lang === currentLang;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const expArLabel = document.querySelector('#explanationArabicRow .explanation-label');
  if (expArLabel) {
    expArLabel.textContent = tr('النص والمصدر العربي الأصلي', 'Original Arabic Text & Source');
  }
  const verFooter = document.getElementById('appVersionFooter');
  if (verFooter) {
    verFooter.textContent = tr('سباق المعلومات · v1.5.0', 'Knowledge Race · v1.5.0');
  }
  updateHomeStats();
  applyKidsMode();
  if (state.screen === 'campaign') renderCampaignScreen();
  if (state.screen === 'hifz') renderHifzScreen();
  if (state.screen === 'teacher') renderTeacherScreen();
  if (ui.spectatorBanner && !ui.spectatorBanner.hidden) {
    ui.spectatorBanner.textContent = tr('👁️ وضع المشاهدة المباشر — تتابع السباق دون مشاركة في الإجابة', '👁️ Live Spectator Mode — Watching race without answering');
  }
  if (state.teamBattle) updateTeamBattleBanner();
  if (state.screen === 'race' && state.currentQuestion && !state.gameOver) refreshRaceLanguage();
  if (state.screen === 'result' && ui.resultPrimaryBtn) {
    const act = ui.resultPrimaryBtn.dataset.action;
    if (act === 'start-race') ui.resultPrimaryBtn.textContent = tr('إعادة المباراة', 'Play Again');
    else if (act === 'replay-hifz') ui.resultPrimaryBtn.textContent = tr('أعد التدريب', 'Practice Again');
    else if (act === 'replay-team-battle') ui.resultPrimaryBtn.textContent = tr('أعد معركة الفريق', 'Rematch Team Battle');
    else if (act === 'replay-campaign-level') ui.resultPrimaryBtn.textContent = tr('إعادة المستوى', 'Replay Level');
    else if (act === 'next-campaign-level' && state.campaignLevel) {
      ui.resultPrimaryBtn.textContent = tr(`المستوى ${state.campaignLevel + 1} ←`, `Level ${state.campaignLevel + 1} →`);
    }
  }
}

function setLanguage(lang) {
  const next = lang === 'en' ? 'en' : 'ar';
  if (next === currentLang) return;
  currentLang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch (error) { /* ignore */ }
  applyLanguageToDOM();
  showToast(next === 'en' ? 'Switched to English (LTR)' : 'تم التبديل إلى العربية');
}

const state = {
  screen: 'home',
  mode: 'training',
  campaignLevel: null,
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
  pendingBotTimer: null,
  nextTimer: null,
  nextCountdownTimer: null,
  lastPlayerCorrect: false,
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
  hifzType: 'all',
  spectating: false,
  spectatorTimer: null,
  spectatorChannel: null,
  teamBattle: null,
  categoryFilter: null,
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
window.sibaqNetwork = networkAdapter;
let profile = loadProfile();
let campaignState = loadCampaign();
let leagueState = loadLeague();
let hifzState = loadHifz();
let kidsMode = loadKidsMode();
let questsState = loadQuests();
let teamState = loadTeam();
let discoverStats = loadDiscoverStats();
let teacherState = loadTeacherState();
let confirmResolver = null;

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved) {
      return {
        name: saved.name || 'ضيف',
        isGuest: saved.isGuest !== undefined ? Boolean(saved.isGuest) : !saved.google,
        wins: saved.wins || 0,
        games: saved.games || 0,
        totalAnswered: saved.totalAnswered || 0,
        totalCorrect: saved.totalCorrect || 0,
        bestStreak: saved.bestStreak || 0,
        xp: saved.xp || 0,
        achievements: Array.isArray(saved.achievements) ? saved.achievements : [],
        google: saved.google || null,
        avatarId: saved.avatarId || 'default',
        companionId: saved.companionId || 'siraj',
      };
    }
  } catch (error) {
    console.warn('Could not load profile', error);
  }
  return { name: 'ضيف', isGuest: true, wins: 0, games: 0, totalAnswered: 0, totalCorrect: 0, bestStreak: 0, xp: 0, achievements: [], google: null, avatarId: 'default', companionId: 'siraj' };
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function loadHifz() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIFZ_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { memorized: Array.isArray(saved.memorized) ? saved.memorized : [] };
    }
  } catch (error) { /* ignore */ }
  return { memorized: [] };
}

function saveHifz() {
  try { localStorage.setItem(HIFZ_KEY, JSON.stringify(hifzState)); } catch (error) { /* ignore */ }
}

function loadKidsMode() {
  try { return localStorage.getItem(KIDS_KEY) === 'true'; } catch (error) { return false; }
}

function saveKidsMode() {
  try { localStorage.setItem(KIDS_KEY, kidsMode ? 'true' : 'false'); } catch (error) { /* ignore */ }
}

function loadQuests() {
  const today = todayKey();
  const base = {
    date: today,
    racesPlayed: 0,
    correctToday: 0,
    dailyDone: 0,
    claimed: {},
    streakDays: 0,
    lastActiveDate: null,
    streakRewardDate: null,
    lastSpinDate: null,
    lastSpinPrize: null,
    bonusPowers: { skip: 0, freeze: 0, double: 0 },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(QUESTS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const sameDay = saved.date === today;
      return {
        ...base,
        streakDays: Number(saved.streakDays) || 0,
        lastActiveDate: saved.lastActiveDate || null,
        streakRewardDate: saved.streakRewardDate || null,
        lastSpinDate: saved.lastSpinDate || null,
        lastSpinPrize: saved.lastSpinPrize || null,
        bonusPowers: {
          skip: Number(saved.bonusPowers && saved.bonusPowers.skip) || 0,
          freeze: Number(saved.bonusPowers && saved.bonusPowers.freeze) || 0,
          double: Number(saved.bonusPowers && saved.bonusPowers.double) || 0,
        },
        ...(sameDay ? {
          racesPlayed: Number(saved.racesPlayed) || 0,
          correctToday: Number(saved.correctToday) || 0,
          dailyDone: Number(saved.dailyDone) || 0,
          claimed: saved.claimed && typeof saved.claimed === 'object' ? saved.claimed : {},
        } : {}),
      };
    }
  } catch (error) { /* ignore */ }
  return base;
}

function saveQuests() {
  try { localStorage.setItem(QUESTS_KEY, JSON.stringify(questsState)); } catch (error) { /* ignore */ }
}

function ensureQuestsToday() {
  const today = todayKey();
  if (questsState.date !== today) {
    questsState.date = today;
    questsState.racesPlayed = 0;
    questsState.correctToday = 0;
    questsState.dailyDone = 0;
    questsState.claimed = {};
    saveQuests();
  }
}

function currentSeasonId(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function loadCampaign() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const unlocked = Math.min(CAMPAIGN_TOTAL_LEVELS, Math.max(1, Number(saved.unlockedLevel) || 1));
      const completed = saved.completed && typeof saved.completed === 'object' ? saved.completed : {};
      return { unlockedLevel: unlocked, completed };
    }
  } catch (error) { /* ignore */ }
  return { unlockedLevel: 1, completed: {} };
}

function saveCampaign() {
  try { localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaignState)); } catch (error) { /* ignore */ }
}

function mergeCampaignData(localData, remoteData) {
  const a = localData || { unlockedLevel: 1, completed: {} };
  const b = remoteData || { unlockedLevel: 1, completed: {} };
  const completed = { ...(a.completed || {}) };
  for (const [lvl, entry] of Object.entries(b.completed || {})) {
    if (!entry) continue;
    const prev = completed[lvl];
    if (!prev) {
      completed[lvl] = entry;
    } else {
      completed[lvl] = {
        stars: Math.max(prev.stars || 0, entry.stars || 0),
        bestCorrect: Math.max(prev.bestCorrect || 0, entry.bestCorrect || 0),
        total: Math.max(prev.total || 0, entry.total || 0),
        bestScore: Math.max(prev.bestScore || 0, entry.bestScore || 0),
      };
    }
  }
  const unlockedLevel = Math.min(CAMPAIGN_TOTAL_LEVELS, Math.max(1, Number(a.unlockedLevel) || 1, Number(b.unlockedLevel) || 1));
  return { unlockedLevel, completed };
}

function loadLeague() {
  const sid = currentSeasonId();
  try {
    const saved = JSON.parse(localStorage.getItem(LEAGUE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        seasonId: saved.seasonId || sid,
        leagueIndex: Math.min(LEAGUES.length - 1, Math.max(0, Number(saved.leagueIndex) || 0)),
        points: Math.max(0, Number(saved.points) || 0),
        seasonRaces: Math.max(0, Number(saved.seasonRaces) || 0),
        seasonWins: Math.max(0, Number(saved.seasonWins) || 0),
        lastEvaluation: saved.lastEvaluation || null,
      };
    }
  } catch (error) { /* ignore */ }
  return { seasonId: sid, leagueIndex: 0, points: 0, seasonRaces: 0, seasonWins: 0, lastEvaluation: null };
}

function saveLeague() {
  try { localStorage.setItem(LEAGUE_KEY, JSON.stringify(leagueState)); } catch (error) { /* ignore */ }
}

function mergeLeagueData(localData, remoteData) {
  const a = localData || loadLeague();
  const b = remoteData || null;
  if (!b) return a;
  const pickRemote = (b.leagueIndex || 0) > (a.leagueIndex || 0) || ((b.leagueIndex || 0) === (a.leagueIndex || 0) && (b.points || 0) > (a.points || 0));
  const best = pickRemote ? b : a;
  return {
    seasonId: currentSeasonId(),
    leagueIndex: Math.min(LEAGUES.length - 1, Math.max(0, Number(best.leagueIndex) || 0)),
    points: Math.max(0, Number(best.points) || 0),
    seasonRaces: Math.max(a.seasonRaces || 0, b.seasonRaces || 0),
    seasonWins: Math.max(a.seasonWins || 0, b.seasonWins || 0),
    lastEvaluation: best.lastEvaluation || a.lastEvaluation || b.lastEvaluation || null,
  };
}

function syncProgressToSupabaseMetadata() {
  if (!isAppOnline() || !supabaseClient || !supabaseUser || supabaseUser.is_anonymous) return;
  try {
    supabaseClient.auth.updateUser({
      data: { sibaq_campaign: campaignState, sibaq_league: leagueState, sibaq_team: teamState },
    }).catch(() => {});
  } catch (error) { /* best-effort */ }
}

function titleFor(xp) {
  let title = TITLES[0].title;
  for (const t of TITLES) if (xp >= t.min) title = t.title;
  return title;
}

function displayTitle(arTitle) {
  return isEn() ? (TITLE_EN[arTitle] || arTitle) : arTitle;
}

function displayOpponent(name) {
  if (!name) return tr('المنافس', 'Opponent');
  if (!isEn()) return name;
  return OPPONENT_EN[name] || name;
}

function unlockAchievement(id) {
  if (!profile.achievements.includes(id)) {
    profile.achievements.push(id);
    const ach = ACHIEVEMENTS.find((a) => a.id === id);
    if (ach) {
      const label = isEn() && ACH_EN[id] ? ACH_EN[id].title : ach.title;
      showToast(tr(`إنجاز جديد: ${ach.icon} ${label}`, `New Achievement: ${ach.icon} ${label}`));
    }
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
  if (!('Notification' in window)) { showToast(tr('هذا المتصفح لا يدعم الإشعارات', 'This browser does not support notifications')); return; }
  Notification.requestPermission().then((permission) => {
    showToast(permission === 'granted' ? tr('تم تفعيل الإشعارات 🔔', 'Notifications enabled 🔔') : tr('لم يتم تفعيل الإشعارات', 'Notifications not enabled'));
  });
}

function displayProfileName() {
  if (profile.name === 'ضيف' && isEn()) return 'Guest';
  return profile.name || tr('ضيف', 'Guest');
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
  const title = displayTitle(titleFor(profile.xp));
  const shownName = displayProfileName();
  const firstName = shownName.trim().split(' ')[0] || tr('ضيف', 'Guest');
  const initial = firstName.charAt(0).toUpperCase() || tr('ض', 'G');
  const avatarCfg = AVATARS.find((a) => a.id === profile.avatarId) || AVATARS[0];
  const avatarSymbol = avatarCfg.icon || initial;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('miniPlayerName', firstName);
  set('miniPlayerTitle', title);
  set('profilePlayerName', shownName);
  set('racePlayerTitle', title);
  ['miniAvatar', 'largeAvatar', 'playerAvatar'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = avatarSymbol;
    el.style.background = avatarCfg.bg;
  });
  const levelEl = document.getElementById('profileLevel');
  if (levelEl) levelEl.innerHTML = `${String(level).padStart(2, '0')}<small>${tr('مستوى', 'LVL')}</small>`;
  const rankEl = document.getElementById('profilePlayerTitle');
  if (rankEl) rankEl.innerHTML = `${title} <i></i>`;
  if (ui.dailyMiniText) {
    const done = localStorage.getItem(DAILY_KEY) === todayKey();
    ui.dailyMiniText.textContent = done
      ? tr('أكملت تحدي اليوم ✓ — عُد غداً', 'Daily Challenge done ✓ — Come back tomorrow')
      : tr('لم تُكمل تحدي اليوم بعد', 'Daily Challenge ready — Play now');
  }
  if (ui.googleSignInTopBtn) {
    ui.googleSignInTopBtn.textContent = isLinkedGoogleAccount()
      ? tr('حساب Gmail ✓', 'Gmail Linked ✓')
      : tr('تسجيل الدخول بـ Google', 'Sign in with Google');
  }
  updateLeagueHomeUI();
  updateCampaignHomeUI();
  updatePhase5HomeUI();
  updateTeamsHomeUI();
  renderDiscoverSection();
  updateConnectionStatus();
}

function getLeagueStatus() {
  const index = Math.min(LEAGUES.length - 1, Math.max(0, leagueState.leagueIndex || 0));
  const league = LEAGUES[index];
  const nextLeague = index + 1 < LEAGUES.length ? LEAGUES[index + 1] : null;
  const points = leagueState.points || 0;
  let zone = 'safe';
  let zoneLabel = tr('منطقة الثبات', 'Safe Zone');
  if (nextLeague && points >= league.promoteAt) {
    zone = 'promote';
    zoneLabel = tr(`منطقة الترقية إلى ${nextLeague.name}`, `Promotion Zone → ${nextLeague.en}`);
  } else if (index > 0 && points < league.safeAt) {
    zone = 'relegate';
    zoneLabel = tr(`منطقة الهبوط (الحد الآمن ${league.safeAt})`, `Relegation Zone (Safe: ${league.safeAt})`);
  } else if (index === LEAGUES.length - 1 && points >= league.safeAt) {
    zone = 'promote';
    zoneLabel = tr('قمة الأبطال · ثبات مضمون', 'Champion Summit · Secured');
  }
  const target = nextLeague ? league.promoteAt : league.safeAt;
  const progressPct = target ? Math.min(100, Math.round((points / target) * 100)) : 100;
  const nextText = nextLeague
    ? tr(`${points} / ${league.promoteAt} نقطة نحو ${nextLeague.name}`, `${points} / ${league.promoteAt} pts toward ${nextLeague.en}`)
    : tr(`${points} نقطة · القمة (${league.name})`, `${points} pts · Summit (${league.en})`);
  return { league, nextLeague, index, points, seasonRaces: leagueState.seasonRaces || 0, seasonWins: leagueState.seasonWins || 0, zone, zoneLabel, progressPct, nextText };
}

function updateLeagueHomeUI() {
  const info = getLeagueStatus();
  const iconEl = document.getElementById('homeLeagueIcon');
  const nameEl = document.getElementById('homeLeagueName');
  const nextEl = document.getElementById('homeLeagueProgressText');
  const barEl = document.getElementById('homeLeagueBar');
  const zoneEl = document.getElementById('homeLeagueZone');
  if (iconEl) iconEl.textContent = info.league.icon;
  if (nameEl) nameEl.textContent = tr(`دوري ${info.league.name} (${info.league.en})`, `${info.league.en} League`);
  if (nextEl) nextEl.textContent = info.nextText;
  if (barEl) barEl.style.width = `${info.progressPct}%`;
  if (zoneEl) zoneEl.textContent = tr(`${info.zoneLabel} · عرض الدوريات الـ 8 ›`, `${info.zoneLabel} · View 8 Leagues ›`);
}

function updateCampaignHomeUI() {
  const completedCount = Object.keys(campaignState.completed || {}).length;
  const badgeEl = document.getElementById('campaignHomeBadge');
  const descEl = document.getElementById('campaignHomeDesc');
  if (badgeEl) badgeEl.textContent = tr(`${completedCount}/${CAMPAIGN_TOTAL_LEVELS} مستوى · أوفلاين`, `${completedCount}/${CAMPAIGN_TOTAL_LEVELS} Levels · Offline`);
  if (descEl) descEl.textContent = tr(`المستوى المتاح الآن: ${campaignState.unlockedLevel} من ${CAMPAIGN_TOTAL_LEVELS} — صعوبة تصاعدية وتعمل دون إنترنت.`, `Unlocked now: Level ${campaignState.unlockedLevel} of ${CAMPAIGN_TOTAL_LEVELS} — rising difficulty, works offline.`);
}

function getQuestProgress(quest) {
  ensureQuestsToday();
  if (quest.id === 'play1') return Math.min(quest.target, questsState.racesPlayed || 0);
  if (quest.id === 'correct10') return Math.min(quest.target, questsState.correctToday || 0);
  if (quest.id === 'daily1') return Math.min(quest.target, questsState.dailyDone || 0);
  return 0;
}

function updatePhase5HomeUI() {
  ensureQuestsToday();
  const hifzCount = (hifzState.memorized || []).length;
  const hifzBadge = document.getElementById('hifzHomeBadge');
  if (hifzBadge) {
    hifzBadge.textContent = tr(`${hifzCount}/${HIFZ_SURAH_TRACKER.length} محفوظ · أوفلاين`, `${hifzCount}/${HIFZ_SURAH_TRACKER.length} Memorized · Offline`);
  }
  const kidsBtn = document.getElementById('kidsToggleBtn');
  const kidsLbl = document.getElementById('kidsToggleLabel');
  if (kidsBtn) {
    kidsBtn.classList.toggle('active', kidsMode);
    kidsBtn.setAttribute('aria-pressed', kidsMode ? 'true' : 'false');
  }
  if (kidsLbl) {
    kidsLbl.textContent = kidsMode
      ? tr('وضع الأطفال: مفعّل', 'Kids Mode: ON')
      : tr('وضع الأطفال: إيقاف', 'Kids Mode: OFF');
  }
  const doneQuests = DAILY_QUESTS.filter((q) => getQuestProgress(q) >= q.target).length;
  const qMini = document.getElementById('questsMiniText');
  if (qMini) qMini.textContent = tr(`المهام: ${doneQuests}/${DAILY_QUESTS.length}`, `Quests: ${doneQuests}/${DAILY_QUESTS.length}`);
  const spinAvailable = questsState.lastSpinDate !== todayKey();
  const wBtn = document.getElementById('openWheelBtn');
  const wLbl = document.getElementById('wheelMiniText');
  if (wBtn) wBtn.classList.toggle('has-spin', spinAvailable);
  if (wLbl) {
    wLbl.textContent = spinAvailable
      ? tr('عجلة الحظ (مجاني)', 'Spin Wheel (Free)')
      : tr('عجلة الحظ ✓', 'Spin Wheel ✓');
  }
}

function applyKidsMode() {
  if (document.documentElement) document.documentElement.dataset.kids = kidsMode ? 'true' : 'false';
  if (ui.shell) ui.shell.dataset.kids = kidsMode ? 'true' : 'false';
  if (ui.kidsModeBanner) {
    ui.kidsModeBanner.hidden = !kidsMode;
    ui.kidsModeBanner.textContent = tr('🧸 وضع الأطفال نشط — أسئلة سهلة ومبسطة مع تشجيع مستمر', '🧸 Kids Mode Active — Simple easy questions & cheerful guidance');
  }
  updatePhase5HomeUI();
}

function toggleKidsMode() {
  kidsMode = !kidsMode;
  saveKidsMode();
  applyKidsMode();
  showToast(kidsMode
    ? tr('🧸 تم تفعيل وضع الأطفال — أسئلة سهلة وخط أكبر', '🧸 Kids Mode ON — Easy questions & larger text')
    : tr('تم إيقاف وضع الأطفال', 'Kids Mode turned OFF'));
}

function getCurrentCompanion() {
  return COMPANIONS.find((c) => c.id === profile.companionId) || COMPANIONS[0];
}

function showCompanionMessage(kind = 'correct', kidsCustom = '') {
  const comp = getCurrentCompanion();
  const compName = tr(comp.ar, comp.en);
  let text = '';
  if (kind === 'win') {
    text = `${comp.icon} ${compName}: ${tr(comp.winAr, comp.winEn)}`;
  } else if (kind === 'kids-encourage') {
    text = `${comp.icon} ${compName}: ${kidsCustom}`;
  } else {
    const list = isEn() ? comp.cheersEn : comp.cheersAr;
    const msg = list[Math.floor(Math.random() * list.length)];
    text = `${comp.icon} ${compName}: ${msg}`;
  }
  if (kind === 'win' && ui.resultCompanionBubble) {
    ui.resultCompanionBubble.textContent = text;
    ui.resultCompanionBubble.hidden = false;
  } else if (ui.companionBubble) {
    ui.companionBubble.textContent = text;
    ui.companionBubble.hidden = false;
  }
}

function renderHifzScreen() {
  if (ui.hifzModesGrid) {
    ui.hifzModesGrid.innerHTML = HIFZ_TRAINING_MODES.map((m) => `
      <button type="button" class="hifz-mode-btn" data-action="start-hifz" data-hifz-type="${m.id}">
        <strong>${m.icon} ${tr(m.ar, m.en)}</strong>
        <small>${tr(m.descAr, m.descEn)}</small>
      </button>
    `).join('');
  }
  const savedSet = new Set(hifzState.memorized || []);
  if (ui.hifzSavedCounter) {
    ui.hifzSavedCounter.textContent = tr(`${savedSet.size} / ${HIFZ_SURAH_TRACKER.length} محفوظ`, `${savedSet.size} / ${HIFZ_SURAH_TRACKER.length} Memorized`);
  }
  if (ui.hifzTrackerGrid) {
    ui.hifzTrackerGrid.innerHTML = HIFZ_SURAH_TRACKER.map((item) => {
      const isSaved = savedSet.has(item.id);
      return `
        <button type="button" class="hifz-surah-chip ${isSaved ? 'saved' : ''}" data-action="toggle-hifz-surah" data-surah-id="${item.id}">
          <span><b>${tr(item.ar, item.en)}</b><small>${item.meta}</small></span>
          <span class="hifz-mark">${isSaved ? tr('محفوظ ✓', 'Memorized ✓') : tr('علّم كمحفوظ', 'Mark')}</span>
        </button>
      `;
    }).join('');
  }
}

function openHifz() {
  clearRoundTimers();
  renderHifzScreen();
  showScreen('hifz');
}

function toggleHifzSurah(surahId) {
  if (!surahId) return;
  const list = new Set(hifzState.memorized || []);
  if (list.has(surahId)) {
    list.delete(surahId);
  } else {
    list.add(surahId);
    showToast(tr('📖 أحسنت! تم حفظ التقدّم: محفوظ ✓', '📖 Well done! Marked as Memorized ✓'));
  }
  hifzState.memorized = [...list];
  saveHifz();
  renderHifzScreen();
  updatePhase5HomeUI();
}

function startHifzPractice(hifzType = 'all') {
  clearRoundTimers();
  const pool = hifzType === 'all'
    ? [...HIFZ_QUESTIONS]
    : HIFZ_QUESTIONS.filter((q) => q.hifzType === hifzType);
  const picked = shuffle(pool).slice(0, hifzType === 'all' ? 8 : pool.length);
  state.mode = 'hifz';
  state.hifzType = hifzType;
  state.campaignLevel = null;
  state.opponentName = 'اختبر حفظك';
  state.tiebreakRound = 0;
  state.raceTotal = picked.length;
  state.powers = applyWheelBonusPowers({ skip: 1, freeze: 1, double: 1 });
  state.doubleNext = false;
  state.frozenUntil = 0;
  state.tournament = null;
  state.questions = picked;
  resetRaceState();
  const modeMeta = HIFZ_TRAINING_MODES.find((m) => m.id === hifzType);
  const modeLabel = modeMeta ? tr(modeMeta.ar, modeMeta.en) : tr('تدريب شامل', 'Mixed Practice');
  if (ui.opponentName) ui.opponentName.textContent = tr('الحفظ القرآني', 'Quran Hifz');
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = '📖';
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`اختبر حفظك · ${modeLabel}`, `Test Your Hifz · ${modeLabel}`);
  if (ui.questionTotal) ui.questionTotal.textContent = String(picked.length);
  if (ui.answeredTotal) ui.answeredTotal.textContent = String(picked.length);
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
}

function applyWheelBonusPowers(basePowers) {
  const b = questsState.bonusPowers || { skip: 0, freeze: 0, double: 0 };
  const merged = {
    skip: basePowers.skip + (b.skip || 0),
    freeze: basePowers.freeze + (b.freeze || 0),
    double: basePowers.double + (b.double || 0),
  };
  if (b.skip || b.freeze || b.double) {
    questsState.bonusPowers = { skip: 0, freeze: 0, double: 0 };
    saveQuests();
  }
  return merged;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function awardDailyStreakBonus() {
  ensureQuestsToday();
  const today = todayKey();
  if (questsState.streakRewardDate === today) return 0;
  const yest = yesterdayKey();
  if (questsState.lastActiveDate === yest) {
    questsState.streakDays = (questsState.streakDays || 0) + 1;
  } else if (questsState.lastActiveDate !== today) {
    questsState.streakDays = 1;
  }
  questsState.lastActiveDate = today;
  questsState.streakRewardDate = today;
  const bonus = 15 * Math.min(7, Math.max(1, questsState.streakDays));
  profile.xp += bonus;
  saveProfile();
  saveQuests();
  showToast(tr(`🔥 مكافأة سلسلة ${questsState.streakDays} يوم: +${bonus} XP!`, `🔥 ${questsState.streakDays}-Day Streak Bonus: +${bonus} XP!`));
  return bonus;
}

function recordDailyActivity({ raceCompleted = false, correctAdded = 0, dailyCompleted = false } = {}) {
  ensureQuestsToday();
  awardDailyStreakBonus();
  if (raceCompleted) questsState.racesPlayed = (questsState.racesPlayed || 0) + 1;
  if (correctAdded > 0) questsState.correctToday = (questsState.correctToday || 0) + correctAdded;
  if (dailyCompleted) questsState.dailyDone = 1;
  saveQuests();
  updatePhase5HomeUI();
}

function claimQuest(questId) {
  ensureQuestsToday();
  const quest = DAILY_QUESTS.find((q) => q.id === questId);
  if (!quest) return;
  if (questsState.claimed && questsState.claimed[questId]) return;
  if (getQuestProgress(quest) < quest.target) {
    showToast(tr('أكمل المهمة أولاً لاستلام المكافأة', 'Complete the quest first to claim reward'));
    return;
  }
  questsState.claimed[questId] = true;
  profile.xp += quest.rewardXp;
  saveProfile();
  saveQuests();
  updateHomeStats();
  showToast(tr(`🎁 استلمت +${quest.rewardXp} نقطة خبرة!`, `🎁 Claimed +${quest.rewardXp} XP!`));
  openQuestsModal();
}

function openQuestsModal() {
  ensureQuestsToday();
  const rows = DAILY_QUESTS.map((q) => {
    const progress = getQuestProgress(q);
    const completed = progress >= q.target;
    const claimed = Boolean(questsState.claimed && questsState.claimed[q.id]);
    const actionBtn = claimed
      ? `<span class="quest-done-pill">✓ ${tr('مُستَلَمة', 'Claimed')}</span>`
      : completed
        ? `<button type="button" class="primary-button" data-action="claim-quest" data-quest-id="${q.id}">${tr(`استلم +${q.rewardXp} XP`, `Claim +${q.rewardXp} XP`)}</button>`
        : `<small>${progress}/${q.target}</small>`;
    return `
      <div class="quest-row ${completed ? 'done' : ''}">
        <div class="quest-row-info">
          <strong>${tr(q.ar, q.en)}</strong>
          <small>${tr(`التقدم: ${progress} / ${q.target} · المكافأة: +${q.rewardXp} XP`, `Progress: ${progress} / ${q.target} · Reward: +${q.rewardXp} XP`)}</small>
        </div>
        <div>${actionBtn}</div>
      </div>
    `;
  }).join('');
  openModal(
    tr('🎯 المهام اليومية وسلسلة الأيام', '🎯 Daily Quests & Day Streak'),
    `
      <div class="streak-banner-box">
        <span>🔥 <b>${tr(`سلسلة الأيام المتتالية: ${questsState.streakDays || 0} يوم`, `Day Streak: ${questsState.streakDays || 0} days`)}</b></span>
        <small>${tr('مكافأة يومية تلقائية حتى +105 XP', 'Auto daily bonus up to +105 XP')}</small>
      </div>
      <div class="quests-list">${rows}</div>
      <button type="button" class="ghost-button modal-secondary" data-action="open-wheel">${tr('🎡 افتح عجلة الحظ اليومية', '🎡 Open Daily Spin Wheel')}</button>
    `,
    'info',
  );
}

function openSpinWheelModal() {
  ensureQuestsToday();
  const canSpin = questsState.lastSpinDate !== todayKey();
  const legend = WHEEL_SEGMENTS.map((seg) => `<div class="wheel-prize-pill">${tr(seg.ar, seg.en)}</div>`).join('');
  const lastPrizeText = questsState.lastSpinPrize
    ? `<p id="wheelStatusText">🎉 ${tr('جائزة اليوم:', 'Today’s prize:')} <b>${questsState.lastSpinPrize}</b></p>`
    : `<p id="wheelStatusText">${tr('لك دوران واحد مجاني كل يوم!', 'You get 1 free spin every day!')}</p>`;
  openModal(
    tr('🎡 عجلة الحظ اليومية', '🎡 Daily Spin Wheel'),
    `
      <div class="wheel-stage">
        <div class="wheel-pointer">🔻</div>
        <div class="wheel-disc" id="wheelDisc"><div class="wheel-center">★</div></div>
      </div>
      ${lastPrizeText}
      <div class="wheel-prizes-legend">${legend}</div>
      <button type="button" class="primary-button" id="spinWheelBtn" data-action="spin-wheel" ${canSpin ? '' : 'disabled'}>${canSpin ? tr('أدر العجلة مجاناً!', 'Spin Free Now!') : tr('استخدمت دوران اليوم ✓ — عُد غداً', 'Used Today’s Spin ✓ — Come back tomorrow')}</button>
    `,
    'info',
  );
}

function spinDailyWheel() {
  ensureQuestsToday();
  const today = todayKey();
  if (questsState.lastSpinDate === today) {
    showToast(tr('استخدمت دوران اليوم — عُد غداً!', 'Already spun today — come back tomorrow!'));
    return;
  }
  const idx = Math.floor(Math.random() * WHEEL_SEGMENTS.length);
  const seg = WHEEL_SEGMENTS[idx];
  const disc = document.getElementById('wheelDisc');
  const btn = document.getElementById('spinWheelBtn');
  if (btn) btn.disabled = true;
  if (disc) {
    const angle = 1080 + (360 - idx * 60 - 30);
    disc.style.transform = `rotate(${angle}deg)`;
  }
  const label = tr(seg.ar, seg.en);
  questsState.lastSpinDate = today;
  questsState.lastSpinPrize = label;
  if (seg.type === 'xp') {
    profile.xp += seg.value;
    saveProfile();
  } else if (seg.type === 'power') {
    questsState.bonusPowers = questsState.bonusPowers || { skip: 0, freeze: 0, double: 0 };
    questsState.bonusPowers[seg.key] = (questsState.bonusPowers[seg.key] || 0) + seg.value;
  }
  saveQuests();
  updateHomeStats();
  window.setTimeout(() => {
    const status = document.getElementById('wheelStatusText');
    if (status) status.innerHTML = `🎉 ${tr('مبروك! ربحت:', 'Congrats! You won:')} <b>${label}</b>`;
    if (btn) btn.textContent = tr('تم السحب ✓ — عُد غداً', 'Spun ✓ — Come back tomorrow');
    showToast(`🎡 ${tr('ربحت:', 'Won:')} ${label}`);
  }, 600);
}

function selectAvatar(avatarId) {
  if (!AVATARS.some((a) => a.id === avatarId)) return;
  profile.avatarId = avatarId;
  saveProfile();
  updateHomeStats();
  openProfile();
}

function selectCompanion(companionId) {
  const comp = COMPANIONS.find((c) => c.id === companionId);
  if (!comp) return;
  profile.companionId = companionId;
  saveProfile();
  showToast(tr(`رفيقك الآن: ${comp.icon} ${comp.ar}`, `Your companion is now: ${comp.icon} ${comp.en}`));
  openProfile();
}

// ===== المرحلة 6: الفرق/التحالفات، اكتشف، وضع المعلم، المشاهدة =====
let selectedTeamAvatarId = 'shield';
let teacherBroadcast = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sibaq-teacher-sync') : null;
let teacherRealtimeChannel = null;

function loadTeamsDirectory() {
  try {
    const dir = JSON.parse(localStorage.getItem(TEAMS_DIR_KEY) || '{}');
    return dir && typeof dir === 'object' ? dir : {};
  } catch (error) { return {}; }
}

function saveTeamsDirectory(dir) {
  try { localStorage.setItem(TEAMS_DIR_KEY, JSON.stringify(dir)); } catch (error) { /* ignore */ }
}

function loadTeam() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEAM_KEY) || 'null');
    if (saved && saved.code && saved.name) return saved;
  } catch (error) { /* ignore */ }
  return null;
}

function saveTeam() {
  try {
    if (teamState) {
      localStorage.setItem(TEAM_KEY, JSON.stringify(teamState));
      const dir = loadTeamsDirectory();
      dir[teamState.code] = teamState;
      saveTeamsDirectory(dir);
    } else {
      localStorage.removeItem(TEAM_KEY);
    }
  } catch (error) { /* ignore */ }
}

function getTeamTotalPoints(team = teamState) {
  if (!team || !Array.isArray(team.members)) return 0;
  return team.members.reduce((sum, m) => sum + (Number(m.score) || 0), 0);
}

function updateTeamsHomeUI() {
  const badge = document.getElementById('teamsHomeBadge');
  const desc = document.getElementById('teamsHomeDesc');
  if (teamState) {
    const total = getTeamTotalPoints(teamState);
    if (badge) badge.textContent = `${teamState.icon || '🛡️'} ${teamState.name}`;
    if (desc) desc.textContent = tr(
      `الرمز: ${teamState.code} · الأعضاء: ${teamState.members.length} · مجموع النقاط: ${total}`,
      `Code: ${teamState.code} · Members: ${teamState.members.length} · Total: ${total} pts`,
    );
  } else {
    if (badge) badge.textContent = tr('بلا فريق', 'No Team');
    if (desc) desc.textContent = tr('أنشئ فريقك بشعار خاص أو انضم برمز، وخض معركة فريق ضد فريق.', 'Create a team with an avatar emblem or join by code, and play Team vs Team battles.');
  }
}

function createTeam(nameInput, avatarIdInput) {
  const cleanName = String(nameInput || '').trim();
  if (!cleanName) {
    showToast(tr('اكتب اسم الفريق أولاً', 'Enter a team name first'));
    return;
  }
  const av = AVATARS.find((a) => a.id === (avatarIdInput || selectedTeamAvatarId)) || AVATARS[7];
  const code = genRoomCode();
  const pName = displayProfileName();
  const pAv = AVATARS.find((a) => a.id === profile.avatarId) || AVATARS[0];
  teamState = {
    code,
    name: cleanName,
    avatarId: av.id,
    icon: av.icon || '🛡️',
    bg: av.bg,
    wins: 0,
    matches: 0,
    members: [
      { id: 'me', name: pName, icon: pAv.icon || pName.charAt(0), score: Math.max(0, profile.xp || 0), isPlayer: true },
      { id: 'ally-1', name: tr('طارق', 'Tariq'), icon: '⭐', score: 65, isPlayer: false },
      { id: 'ally-2', name: tr('زينب', 'Zaynab'), icon: '🌙', score: 55, isPlayer: false },
    ],
  };
  saveTeam();
  syncProgressToSupabaseMetadata();
  updateTeamsHomeUI();
  showToast(tr(`🛡️ تم إنشاء فريق «${cleanName}» برمز ${code}`, `🛡️ Created team "${cleanName}" (${code})`));
  openTeamsModal();
}

function joinTeamByCode(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code || code.length < 4) {
    showToast(tr('أدخل رمز الفريق الصحيح', 'Enter a valid team code'));
    return;
  }
  const dir = loadTeamsDirectory();
  const existing = dir[code];
  const pName = displayProfileName();
  const pAv = AVATARS.find((a) => a.id === profile.avatarId) || AVATARS[0];
  if (existing) {
    const members = Array.isArray(existing.members) ? [...existing.members] : [];
    if (!members.some((m) => m.isPlayer)) {
      members.unshift({ id: 'me', name: pName, icon: pAv.icon || pName.charAt(0), score: Math.max(0, profile.xp || 0), isPlayer: true });
    }
    teamState = { ...existing, members };
  } else {
    const seed = roomSeed(code);
    const av = AVATARS[1 + (seed % (AVATARS.length - 1))];
    teamState = {
      code,
      name: tr(`تحالف ${code}`, `Alliance ${code}`),
      avatarId: av.id,
      icon: av.icon || '🛡️',
      bg: av.bg,
      wins: 0,
      matches: 0,
      members: [
        { id: 'me', name: pName, icon: pAv.icon || pName.charAt(0), score: Math.max(0, profile.xp || 0), isPlayer: true },
        { id: 'ally-1', name: tr('سلمان', 'Salman'), icon: '🦁', score: 80 + (seed % 40), isPlayer: false },
        { id: 'ally-2', name: tr('حفصة', 'Hafsah'), icon: '📖', score: 65 + (seed % 35), isPlayer: false },
      ],
    };
  }
  saveTeam();
  syncProgressToSupabaseMetadata();
  updateTeamsHomeUI();
  showToast(tr(`🛡️ انضممت إلى فريق «${teamState.name}»`, `🛡️ Joined team "${teamState.name}"`));
  openTeamsModal();
}

function addLocalTeamMember(memberName) {
  if (!teamState) return;
  const clean = String(memberName || '').trim();
  if (!clean) return;
  const icon = AVATARS[1 + (teamState.members.length % (AVATARS.length - 1))].icon || '⭐';
  teamState.members.push({ id: `m-${Date.now()}`, name: clean, icon, score: 40, isPlayer: false });
  saveTeam();
  updateTeamsHomeUI();
  showToast(tr(`تمت إضافة ${clean} إلى الفريق`, `Added ${clean} to team`));
  openTeamsModal();
}

function leaveTeam() {
  teamState = null;
  saveTeam();
  syncProgressToSupabaseMetadata();
  updateTeamsHomeUI();
  showToast(tr('غادرت الفريق', 'Left team'));
  openTeamsModal();
}

function updateTeamBattleBanner() {
  if (!ui.teamBattleBanner) return;
  if (state.mode !== 'team' || !state.teamBattle) {
    ui.teamBattleBanner.hidden = true;
    return;
  }
  const b = state.teamBattle;
  ui.teamBattleBanner.hidden = false;
  ui.teamBattleBanner.textContent = tr(
    `🛡️ معركة الفرق · فريقك «${b.teamName}»: ${state.playerScore} ن (مساهمة الفريق +${b.allyPoints}) ⚔️ ${b.rivalName}: ${state.opponentScore} ن`,
    `🛡️ Team Battle · "${b.teamName}": ${state.playerScore} pts (Team +${b.allyPoints}) ⚔️ ${b.rivalName}: ${state.opponentScore} pts`,
  );
}

function startTeamBattle() {
  if (!teamState) {
    showToast(tr('أنشئ فريقاً أو انضم برمز أولاً', 'Create or join a team first'));
    return;
  }
  closeModal();
  const rival = RIVAL_TEAMS[Math.floor(Math.random() * RIVAL_TEAMS.length)];
  const rivalName = tr(rival.ar, rival.en);
  const allyContributors = Math.max(1, teamState.members.length - 1);
  const allyBonusPerCorrect = Math.min(8, allyContributors * 2);
  state.teamBattle = {
    teamName: teamState.name,
    teamIcon: teamState.icon || '🛡️',
    rivalName,
    rivalIcon: rival.icon,
    allyPoints: allyBonusPerCorrect * 2,
  };
  startRace(rivalName, 'team');
  state.playerScore = state.teamBattle.allyPoints;
  state.opponentScore = 10;
  updateScoreboard();
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = rival.icon;
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`معركة الفرق · ${teamState.icon} ${teamState.name}`, `Team Battle · ${teamState.icon} ${teamState.name}`);
  updateTeamBattleBanner();
}

function openTeamsModal() {
  if (teamState) {
    const total = getTeamTotalPoints(teamState);
    const membersHtml = teamState.members.map((m) => `
      <div class="team-member-row">
        <span>${m.icon || '👤'} <b>${escapeHtml(m.name)}</b> ${m.isPlayer ? tr('(أنت)', '(You)') : ''}</span>
        <b>${m.score || 0} ${tr('نقطة', 'pts')}</b>
      </div>
    `).join('');
    openModal(
      tr('🛡️ فريقك والتحالف', '🛡️ Your Team & Alliance'),
      `<div class="team-modal-box">
        <div class="team-header-card">
          <div class="team-emblem" style="background: ${teamState.bg || AVATARS[7].bg}">${teamState.icon || '🛡️'}</div>
          <div>
            <strong>${escapeHtml(teamState.name)}</strong>
            <div><span class="team-code-pill">${tr('الرمز:', 'Code:')} ${teamState.code}</span></div>
            <small>${tr(`مجموع نقاط الفريق: ${total} · انتصارات: ${teamState.wins || 0}`, `Total Team Points: ${total} · Wins: ${teamState.wins || 0}`)}</small>
          </div>
        </div>
        <div class="team-members-list">${membersHtml}</div>
        <div class="team-actions-row">
          <button type="button" class="primary-button" data-action="start-team-battle">⚔️ ${tr('معركة فريق ضد فريق', 'Team vs Team Battle')}</button>
          <button type="button" class="ghost-button" data-action="add-team-member">➕ ${tr('أضف عضواً محلياً', 'Add Member')}</button>
        </div>
        <div class="team-actions-row">
          <button type="button" class="ghost-button" data-action="copy-team-code">📋 ${tr('نسخ الرمز', 'Copy Code')}</button>
          <button type="button" class="ghost-button" data-action="leave-team">${tr('مغادرة الفريق', 'Leave Team')}</button>
        </div>
      </div>`,
      'info',
    );
    return;
  }
  const avatarChoices = AVATARS.filter((a) => a.icon).map((a) => `
    <button type="button" class="avatar-option ${selectedTeamAvatarId === a.id ? 'active' : ''}" data-action="pick-team-avatar" data-avatar-id="${a.id}">
      <span class="avatar-dot" style="background: ${a.bg}">${a.icon}</span>
      <span>${tr(a.ar, a.en)}</span>
    </button>
  `).join('');
  openModal(
    tr('🛡️ الفرق والتحالفات', '🛡️ Teams & Alliances'),
    `<div class="team-modal-box">
      <div class="team-form">
        <strong>${tr('إنشاء فريق جديد', 'Create a New Team')}</strong>
        <input type="text" id="teamNameInput" class="team-input" maxlength="24" placeholder="${tr('اسم الفريق (مثلاً: فرسان القرآن)', 'Team name')}" />
        <div class="avatar-grid">${avatarChoices}</div>
        <button type="button" class="primary-button" data-action="create-team">${tr('إنشاء الفريق', 'Create Team')}</button>
      </div>
      <div class="team-form">
        <strong>${tr('أو انضم لفريق برمز', 'Or Join a Team by Code')}</strong>
        <input type="text" id="teamCodeInput" class="team-input" maxlength="8" placeholder="${tr('أدخل رمز الفريق (6 أحرف)', 'Enter 6-char team code')}" />
        <button type="button" class="ghost-button" data-action="join-team">${tr('انضمام للفريق', 'Join Team')}</button>
      </div>
    </div>`,
    'info',
  );
}

// 2) بطاقة «اكتشف Discover»
function defaultDiscoverStats(seasonId) {
  return {
    seasonId,
    categories: { 'القرآن': 14, 'السيرة': 11, 'الفقه': 9, 'الحديث': 10, 'التاريخ': 7, 'العقيدة': 8 },
  };
}

function loadDiscoverStats() {
  const sid = currentSeasonId();
  try {
    const saved = JSON.parse(localStorage.getItem(DISCOVER_KEY) || 'null');
    if (saved && saved.seasonId === sid && saved.categories) return saved;
  } catch (error) { /* ignore */ }
  return defaultDiscoverStats(sid);
}

function saveDiscoverStats() {
  try { localStorage.setItem(DISCOVER_KEY, JSON.stringify(discoverStats)); } catch (error) { /* ignore */ }
}

function recordCategoryPlay(category) {
  if (!category) return;
  const sid = currentSeasonId();
  if (discoverStats.seasonId !== sid) discoverStats = defaultDiscoverStats(sid);
  discoverStats.categories[category] = (discoverStats.categories[category] || 0) + 1;
  saveDiscoverStats();
}

function renderDiscoverSection() {
  if (ui.discoverTopPlayers) {
    let cachedGlobal = [];
    try { cachedGlobal = JSON.parse(localStorage.getItem(DISCOVER_LB_CACHE_KEY) || '[]'); } catch (error) { cachedGlobal = []; }
    const weeklyLocal = loadHistory()
      .slice(-10)
      .map((h, idx) => ({
        name: displayProfileName(),
        score: h.score || 0,
        wins: h.won ? 1 : 0,
        tag: idx,
      }));
    const playerEntry = {
      name: displayProfileName(),
      score: Math.max(profile.xp || 0, weeklyLocal.reduce((mx, r) => Math.max(mx, r.score), 0)),
      wins: profile.wins || 0,
      isYou: true,
    };
    const combined = [
      playerEntry,
      ...cachedGlobal.map((r) => ({ name: r.display_name || r.username || tr('متسابق', 'Racer'), score: Number(r.total_score) || 0, wins: Number(r.games_won) || 0 })),
      { name: tr('سراج (حافظ)', 'Siraj'), score: 420, wins: 6 },
      { name: tr('حفصة القارئة', 'Hafsah'), score: 340, wins: 5 },
      { name: tr('طارق المتسابق', 'Tariq'), score: 260, wins: 4 },
    ];
    const deduped = [];
    const seenNames = new Set();
    for (const row of combined) {
      if (seenNames.has(row.name)) continue;
      seenNames.add(row.name);
      deduped.push(row);
    }
    deduped.sort((a, b) => b.score - a.score);
    ui.discoverTopPlayers.innerHTML = deduped.slice(0, 4).map((p, idx) => `
      <div class="discover-row">
        <span class="discover-row-main"><span class="discover-rank">${idx + 1}</span><b>${escapeHtml(p.name)} ${p.isYou ? tr('(أنت)', '(You)') : ''}</b></span>
        <small>${p.score} ${tr('نقطة', 'pts')} · ${p.wins} ${tr('فوز', 'W')}</small>
      </div>
    `).join('');
  }
  if (ui.discoverTrendingTopics) {
    const entries = Object.entries(discoverStats.categories || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    ui.discoverTrendingTopics.innerHTML = entries.map(([cat, count], idx) => `
      <button type="button" class="discover-row discover-topic-btn" data-action="play-category" data-category="${cat}">
        <span class="discover-row-main"><span class="discover-rank">#${idx + 1}</span><b>${isEn() ? (CAT_EN[cat] || cat) : cat}</b></span>
        <small>${count} ${tr('مشاركة · العب ←', 'plays · Play →')}</small>
      </button>
    `).join('');
  }
}

// 3) وضع المعلم Teacher (5 أرقام + متابعة إجابات المنضمين)
function genTeacherCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function loadTeacherSessions() {
  try {
    const map = JSON.parse(localStorage.getItem(TEACHER_SESSIONS_KEY) || '{}');
    return map && typeof map === 'object' ? map : {};
  } catch (error) { return {}; }
}

function saveTeacherSessionRecord(session) {
  if (!session || !session.code) return;
  try {
    const map = loadTeacherSessions();
    map[session.code] = session;
    localStorage.setItem(TEACHER_SESSIONS_KEY, JSON.stringify(map));
  } catch (error) { /* ignore */ }
}

function loadTeacherState() {
  try {
    const saved = JSON.parse(localStorage.getItem(TEACHER_KEY) || 'null');
    if (saved && typeof saved === 'object') return saved;
  } catch (error) { /* ignore */ }
  return { role: 'host', hostCode: null, questionIndex: 0, studentCode: null, studentName: '', studentAnsweredKey: null };
}

function saveTeacherState() {
  try { localStorage.setItem(TEACHER_KEY, JSON.stringify(teacherState)); } catch (error) { /* ignore */ }
}

function broadcastTeacherUpdate(session) {
  if (!session || !session.code) return;
  saveTeacherSessionRecord(session);
  if (teacherBroadcast) {
    try { teacherBroadcast.postMessage({ type: 'teacher-session', session }); } catch (error) { /* ignore */ }
  }
  if (teacherRealtimeChannel && supabaseClient && isAppOnline()) {
    try {
      teacherRealtimeChannel.send({ type: 'broadcast', event: 'session', payload: session });
    } catch (error) { /* ignore */ }
  }
}

function connectTeacherRealtime(code) {
  if (!code || !supabaseClient || !isAppOnline()) return;
  if (teacherRealtimeChannel && teacherRealtimeChannel._teacherCode === code) return;
  if (teacherRealtimeChannel) {
    try { supabaseClient.removeChannel(teacherRealtimeChannel); } catch (error) { /* ignore */ }
    teacherRealtimeChannel = null;
  }
  try {
    const ch = supabaseClient.channel(`teacher-${code}`);
    ch._teacherCode = code;
    ch.on('broadcast', { event: 'session' }, ({ payload }) => {
      if (payload && payload.code === code) {
        saveTeacherSessionRecord(payload);
        if (state.screen === 'teacher') renderTeacherScreen();
      }
    }).subscribe();
    teacherRealtimeChannel = ch;
  } catch (error) { /* ignore */ }
}

function createTeacherSession() {
  const code = genTeacherCode();
  const q = QUESTION_BANK[Math.floor(Math.random() * QUESTION_BANK.length)];
  const session = {
    code,
    hostName: displayProfileName(),
    questionId: q.id,
    round: 1,
    students: [],
    updatedAt: Date.now(),
  };
  teacherState.role = 'host';
  teacherState.hostCode = code;
  saveTeacherState();
  broadcastTeacherUpdate(session);
  connectTeacherRealtime(code);
  showToast(tr(`🏫 تم إنشاء جلسة المعلم برمز: ${code}`, `🏫 Teacher session created: ${code}`));
  renderTeacherScreen();
}

function nextTeacherQuestion() {
  const sessions = loadTeacherSessions();
  const session = teacherState.hostCode && sessions[teacherState.hostCode];
  if (!session) { createTeacherSession(); return; }
  const pool = isEn() ? QUESTION_BANK.filter((q) => Boolean(q.en && q.en.question)) : QUESTION_BANK;
  const q = pool[Math.floor(Math.random() * pool.length)];
  session.questionId = q.id;
  session.round = (session.round || 1) + 1;
  session.students = (session.students || []).map((st) => ({ ...st, lastAnswerIndex: null, lastCorrect: null }));
  session.updatedAt = Date.now();
  broadcastTeacherUpdate(session);
  showToast(tr(`📢 تم عرض السؤال #${session.round} للطلاب`, `📢 Question #${session.round} pushed to students`));
  renderTeacherScreen();
}

function joinTeacherSession(rawCode, rawName) {
  const code = String(rawCode || '').trim();
  if (!/^\d{5}$/.test(code)) {
    showToast(tr('أدخل رمز الجلسة المكوّن من 5 أرقام', 'Enter the 5-digit session code'));
    return;
  }
  const sName = String(rawName || displayProfileName()).trim() || tr('طالب', 'Student');
  const sessions = loadTeacherSessions();
  let session = sessions[code];
  if (!session) {
    // Allow cross-device/tab join using deterministic seed if Supabase broadcast hasn't synced yet
    const seed = Number(code) || 10000;
    const q = QUESTION_BANK[seed % QUESTION_BANK.length];
    session = { code, hostName: tr('المعلم', 'Teacher'), questionId: q.id, round: 1, students: [], updatedAt: Date.now() };
  }
  if (!session.students.some((s) => s.name === sName)) {
    session.students.push({ name: sName, score: 0, lastAnswerIndex: null, lastCorrect: null });
  }
  teacherState.role = 'student';
  teacherState.studentCode = code;
  teacherState.studentName = sName;
  saveTeacherState();
  broadcastTeacherUpdate(session);
  connectTeacherRealtime(code);
  showToast(tr(`🎓 انضممت إلى الجلسة ${code}`, `🎓 Joined session ${code}`));
  renderTeacherScreen();
}

function submitStudentAnswer(answerIdx) {
  const sessions = loadTeacherSessions();
  const session = teacherState.studentCode && sessions[teacherState.studentCode];
  if (!session) return;
  const q = QUESTION_BANK.find((item) => item.id === session.questionId) || QUESTION_BANK[0];
  const sName = teacherState.studentName || displayProfileName();
  const isCorrect = answerIdx === q.correct;
  const student = (session.students || []).find((s) => s.name === sName);
  const roundKey = `${session.code}-${session.round}`;
  if (teacherState.studentAnsweredKey === roundKey) return;
  teacherState.studentAnsweredKey = roundKey;
  saveTeacherState();
  if (student) {
    student.lastAnswerIndex = answerIdx;
    student.lastCorrect = isCorrect;
    if (isCorrect) student.score = (student.score || 0) + 10;
  } else {
    session.students.push({ name: sName, score: isCorrect ? 10 : 0, lastAnswerIndex: answerIdx, lastCorrect: isCorrect });
  }
  session.updatedAt = Date.now();
  broadcastTeacherUpdate(session);
  showToast(isCorrect ? tr('✓ إجابة صحيحة (+10 نقاط)', '✓ Correct (+10 pts)') : tr('✕ إجابة غير صحيحة', '✕ Incorrect'));
  renderTeacherScreen();
}

function switchTeacherRole(role) {
  teacherState.role = role === 'student' ? 'student' : 'host';
  saveTeacherState();
  renderTeacherScreen();
}

function renderTeacherScreen() {
  const isHost = teacherState.role !== 'student';
  if (ui.teacherRoleHostBtn) ui.teacherRoleHostBtn.classList.toggle('active', isHost);
  if (ui.teacherRoleStudentBtn) ui.teacherRoleStudentBtn.classList.toggle('active', !isHost);
  if (ui.teacherHostPanel) ui.teacherHostPanel.hidden = !isHost;
  if (ui.teacherStudentPanel) ui.teacherStudentPanel.hidden = isHost;

  const sessions = loadTeacherSessions();
  const letters = isEn() ? LETTERS_EN : LETTERS;

  if (ui.teacherHostPanel && isHost) {
    const session = teacherState.hostCode ? sessions[teacherState.hostCode] : null;
    if (!session) {
      ui.teacherHostPanel.innerHTML = `
        <article class="glass-card teacher-card">
          <h2>${tr('🏫 ابدأ جلسة معلم حية', '🏫 Start a Live Teacher Session')}</h2>
          <p>${tr('أنشئ رمزاً من 5 أرقام ليتمكن طلابك من الانضمام، ثم اعرض لهم الأسئلة وتابع إجاباتهم مباشرة.', 'Generate a 5-digit code for your students, display questions, and track their live answers.')}</p>
          <button type="button" class="primary-button" data-action="create-teacher-session">${tr('إنشاء جلسة برمز 5 أرقام ←', 'Create 5-Digit Session →')}</button>
        </article>
      `;
    } else {
      const q = QUESTION_BANK.find((item) => item.id === session.questionId) || QUESTION_BANK[0];
      const qText = isEn() && q.en && q.en.question ? q.en.question : q.question;
      const qOpts = isEn() && q.en && Array.isArray(q.en.options) ? q.en.options : q.options;
      const students = session.students || [];
      const studentsHtml = students.length
        ? students.map((st) => {
          const cls = st.lastCorrect === true ? 'ok' : st.lastCorrect === false ? 'bad' : '';
          const ansLabel = st.lastAnswerIndex !== null && st.lastAnswerIndex !== undefined
            ? `${letters[st.lastAnswerIndex] || ''} ${st.lastCorrect ? '✓' : '✕'}`
            : tr('بانتظار الإجابة…', 'Waiting…');
          return `<div class="teacher-student-row ${cls}"><div><b>${escapeHtml(st.name)}</b><div><small>${ansLabel}</small></div></div><strong>${st.score || 0} ${tr('ن', 'pts')}</strong></div>`;
        }).join('')
        : `<p><small>${tr('لم ينضم طلاب بعد — شارك الرمز 5 أرقام أو جرّب تبويب «انضمام طالب».', 'No students yet — share the 5-digit code or test via the Student tab.')}</small></p>`;
      ui.teacherHostPanel.innerHTML = `
        <article class="glass-card teacher-card">
          <div class="teacher-code-box">
            <div>
              <small>${tr('رمز الجلسة الحية (5 أرقام)', 'Live Session Code (5 digits)')}</small>
              <div class="teacher-code-digits" id="teacherLiveCode">${session.code}</div>
            </div>
            <div class="team-actions-row">
              <button type="button" class="ghost-button" data-action="copy-teacher-code">📋 ${tr('نسخ الرمز', 'Copy')}</button>
              <button type="button" class="primary-button" data-action="next-teacher-question">${tr('السؤال التالي للطلاب ←', 'Next Question →')}</button>
            </div>
          </div>
          <div class="teacher-q-preview">
            <small>${tr(`السؤال المعروض الآن (جولة #${session.round || 1}) · ${q.category}`, `Live Question (Round #${session.round || 1}) · ${CAT_EN[q.category] || q.category}`)}</small>
            <h3>${escapeHtml(qText)}</h3>
            <div class="teacher-opts-preview">${qOpts.map((opt, idx) => `<div class="teacher-opt-chip ${idx === q.correct ? 'is-correct' : ''}">${letters[idx]}: ${escapeHtml(opt)}</div>`).join('')}</div>
          </div>
          <div>
            <strong>${tr(`إجابات المنضمين (${students.length})`, `Joined Students (${students.length})`)}</strong>
            <div class="teacher-students-list" id="teacherStudentsList">${studentsHtml}</div>
          </div>
        </article>
      `;
    }
  }

  if (ui.teacherStudentPanel && !isHost) {
    const activeSession = teacherState.studentCode ? sessions[teacherState.studentCode] : null;
    if (!activeSession) {
      ui.teacherStudentPanel.innerHTML = `
        <article class="glass-card teacher-card student-join-box">
          <h2>${tr('🎓 انضمام طالب برمز المعلم', '🎓 Join Session as Student')}</h2>
          <input type="text" id="teacherStudentNameInput" class="team-input" maxlength="24" value="${escapeHtml(displayProfileName())}" placeholder="${tr('اسم الطالب', 'Student name')}" />
          <input type="text" id="teacherJoinCodeInput" class="team-input" maxlength="5" inputmode="numeric" value="${teacherState.hostCode || ''}" placeholder="${tr('رمز المعلم (5 أرقام)', '5-digit teacher code')}" />
          <button type="button" class="primary-button" data-action="join-teacher-session">${tr('انضم للجلسة ←', 'Join Session →')}</button>
        </article>
      `;
    } else {
      const q = QUESTION_BANK.find((item) => item.id === activeSession.questionId) || QUESTION_BANK[0];
      const qText = isEn() && q.en && q.en.question ? q.en.question : q.question;
      const qOpts = isEn() && q.en && Array.isArray(q.en.options) ? q.en.options : q.options;
      const roundKey = `${activeSession.code}-${activeSession.round}`;
      const alreadyAnswered = teacherState.studentAnsweredKey === roundKey;
      const me = (activeSession.students || []).find((s) => s.name === (teacherState.studentName || displayProfileName()));
      ui.teacherStudentPanel.innerHTML = `
        <article class="glass-card teacher-card" id="studentQuestionBox">
          <div class="card-heading"><span>${tr(`جلسة ${activeSession.code} · جولة #${activeSession.round || 1}`, `Session ${activeSession.code} · Round #${activeSession.round || 1}`)}</span><strong>${tr('نقاطك:', 'Score:')} ${me ? me.score : 0}</strong></div>
          <h3>${escapeHtml(qText)}</h3>
          <div class="answers-grid">${qOpts.map((opt, idx) => `
            <button type="button" class="answer-button ${alreadyAnswered && idx === q.correct ? 'correct' : alreadyAnswered && me && me.lastAnswerIndex === idx && !me.lastCorrect ? 'wrong' : ''}" data-action="answer-teacher-question" data-answer-index="${idx}" ${alreadyAnswered ? 'disabled' : ''}>
              <span class="answer-letter">${letters[idx]}</span><span class="answer-text">${escapeHtml(opt)}</span>
            </button>
          `).join('')}</div>
          ${alreadyAnswered ? `<p><small>${tr('تم إرسال إجابتك للمعلم — بانتظار السؤال التالي…', 'Answer sent to teacher — waiting for next question…')}</small></p>` : ''}
        </article>
      `;
    }
  }
}

function openTeacherScreen() {
  clearRoundTimers();
  renderTeacherScreen();
  showScreen('teacher');
}

// 4) وضع المشاهدة Spectator (عرض مباشر لمسار السباق دون مشاركة)
function startSpectatorMode(roomCode = '') {
  const rooms = (() => { try { return JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]'); } catch (e) { return []; } })();
  const code = (roomCode || (rooms.length ? rooms[rooms.length - 1].code : 'LIVE01')).toUpperCase();
  clearRoundTimers();
  state.mode = 'spectator';
  state.spectating = true;
  state.campaignLevel = null;
  state.teamBattle = null;
  state.opponentName = tr('المتسابق ٢', 'Racer B');
  state.tiebreakRound = 0;
  state.raceTotal = 10;
  state.powers = { skip: 0, freeze: 0, double: 0 };
  state.doubleNext = false;
  state.frozenUntil = 0;
  state.tournament = null;
  state.questions = seededPick(roomSeed(code), 10);
  resetRaceState();
  state.locked = true;
  if (ui.race) ui.race.classList.add('is-spectating');
  if (ui.spectatorBanner) {
    ui.spectatorBanner.hidden = false;
    ui.spectatorBanner.textContent = tr(`👁️ وضع المشاهدة المباشر (غرفة ${code}) — تتابع السباق دون مشاركة في الإجابة`, `👁️ Live Spectator Mode (Room ${code}) — Watching without answering`);
  }
  if (ui.opponentName) ui.opponentName.textContent = tr('المتسابق ٢', 'Racer B');
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = '٢';
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`مشاهدة حية · غرفة ${code}`, `Live Spectate · Room ${code}`);
  if (ui.questionTotal) ui.questionTotal.textContent = '10';
  if (ui.answeredTotal) ui.answeredTotal.textContent = '10';
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();

  // Read-only live tick advancing both racers on the track until finish (unless live Supabase updates arrive)
  state.spectatorTimer = window.setInterval(() => {
    if (!state.spectating || state.gameOver || state.screen !== 'race') {
      clearInterval(state.spectatorTimer);
      state.spectatorTimer = null;
      return;
    }
    const pHit = Math.random() < 0.72;
    const oHit = Math.random() < 0.68;
    if (pHit) {
      state.playerProgress = Math.min(10, state.playerProgress + 1);
      state.playerScore += 10;
    }
    if (oHit) {
      state.opponentProgress = Math.min(10, state.opponentProgress + 1);
      state.opponentScore += 10;
    }
    updateScoreboard();
    state.index += 1;
    if (state.index >= state.questions.length) {
      finishRace();
    } else {
      renderQuestion();
    }
  }, 2600);

  if (SUPABASE_CONFIGURED && isAppOnline() && supabaseClient) {
    (async () => {
      try {
        const { data: room } = await supabaseClient.from('rooms').select('*').eq('code', code).maybeSingle();
        if (!room || !state.spectating) return;
        const { data: match } = await supabaseClient.from('matches').select('*').eq('room_id', room.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!match || !state.spectating) return;
        clearInterval(state.spectatorTimer);
        state.spectatorTimer = null;
        const ch = supabaseClient.channel(`spectate-${match.id}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${match.id}` }, (payload) => {
            const row = payload.new || {};
            if (!state.spectating) return;
            if (typeof row.player1_score === 'number') state.playerScore = row.player1_score;
            if (typeof row.player2_score === 'number') state.opponentScore = row.player2_score;
            if (typeof row.current_question_index === 'number') {
              state.index = Math.min(state.questions.length - 1, row.current_question_index);
              state.playerProgress = Math.min(10, state.index + 1);
              state.opponentProgress = Math.min(10, state.index + 1);
              renderQuestion();
            }
            updateScoreboard();
            if (row.status === 'finished') finishRace();
          })
          .subscribe();
        state.spectatorChannel = ch;
      } catch (error) { /* fall back cleanly to local track simulation */ }
    })();
  }
}

async function openSpectatorModal() {
  const rooms = (() => { try { return JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]'); } catch (e) { return []; } })();
  const suggested = rooms.length ? rooms[rooms.length - 1].code : 'LIVE01';
  const raw = await openPrompt(
    tr('👁️ مشاهدة سباق مباشر', '👁️ Watch a Live Race'),
    tr('أدخل رمز الغرفة للمشاهدة المباشرة:', 'Enter room code to watch live:'),
    suggested,
    'LIVE01',
    tr('مشاهدة الآن', 'Watch Now'),
  );
  const code = (raw || '').trim().toUpperCase();
  if (!code) return;
  closeModal();
  startSpectatorMode(code);
}

function awardLeaguePoints({ won = false, tie = false, campaignPassed = false, stars = 0 } = {}) {
  let gain = 8;
  if (state.mode === 'campaign') {
    gain = campaignPassed ? (20 + stars * 5) : 6;
  } else if (state.mode === 'daily') {
    gain = 25;
  } else if (won) {
    const accuracy = state.raceTotal ? Math.round((state.correct / state.raceTotal) * 100) : 0;
    gain = 35 + (accuracy >= 80 ? 10 : 0);
  } else if (tie) {
    gain = 15;
  }
  leagueState.points = (leagueState.points || 0) + gain;
  leagueState.seasonRaces = (leagueState.seasonRaces || 0) + 1;
  if (won || campaignPassed) leagueState.seasonWins = (leagueState.seasonWins || 0) + 1;
  saveLeague();
  return gain;
}

function evaluateSeasonSettlement(manual = false) {
  const idx = Math.min(LEAGUES.length - 1, Math.max(0, leagueState.leagueIndex || 0));
  const cur = LEAGUES[idx];
  const points = leagueState.points || 0;
  let outcome = 'stay';
  let nextIdx = idx;
  if (cur.promoteAt !== null && points >= cur.promoteAt && idx < LEAGUES.length - 1) {
    outcome = 'promoted';
    nextIdx = idx + 1;
  } else if (idx > 0 && points < cur.safeAt) {
    outcome = 'relegated';
    nextIdx = idx - 1;
  }
  const summary = {
    seasonId: leagueState.seasonId,
    fromLeague: cur.name,
    fromLeagueEn: cur.en,
    toLeague: LEAGUES[nextIdx].name,
    toLeagueEn: LEAGUES[nextIdx].en,
    toIcon: LEAGUES[nextIdx].icon,
    points,
    outcome,
    evaluatedAt: new Date().toISOString(),
  };
  leagueState.leagueIndex = nextIdx;
  leagueState.points = 0;
  leagueState.seasonRaces = 0;
  leagueState.seasonWins = 0;
  leagueState.seasonId = currentSeasonId();
  leagueState.lastEvaluation = summary;
  saveLeague();
  syncProgressToSupabaseMetadata();
  updateHomeStats();
  if (manual) {
    const toName = tr(summary.toLeague, summary.toLeagueEn);
    const headline = outcome === 'promoted'
      ? tr(`🎉 مبروك الترقية إلى دوري ${summary.toIcon} ${toName}!`, `🎉 Promoted to ${summary.toIcon} ${toName} League!`)
      : outcome === 'relegated'
        ? tr(`📉 هبوط موسمي إلى دوري ${summary.toIcon} ${toName}`, `📉 Seasonal relegation to ${summary.toIcon} ${toName} League`)
        : tr(`🛡️ ثبات في دوري ${summary.toIcon} ${toName}`, `🛡️ Stayed in ${summary.toIcon} ${toName} League`);
    openModal(
      tr('📊 نتيجة تقييم نهاية الموسم', '📊 Season Settlement Result'),
      tr(
        `<p><b>${headline}</b></p><p>أنهيت الموسم برصيد <b>${summary.points}</b> نقطة دوري. بدأ موسم جديد من الصفر — اجمع النقاط للترقية التالية!</p>`,
        `<p><b>${headline}</b></p><p>You finished the season with <b>${summary.points}</b> league points. A new season has begun from 0 — earn points toward your next promotion!</p>`,
      ),
      'info',
    );
  }
  return summary;
}

function checkSeasonRolloverOnBoot() {
  const sid = currentSeasonId();
  if (leagueState.seasonId === sid) return;
  if ((leagueState.seasonRaces || 0) > 0) {
    const summary = evaluateSeasonSettlement(false);
    const toName = tr(summary.toLeague, summary.toLeagueEn || summary.toLeague);
    const msg = summary.outcome === 'promoted'
      ? tr(`موسم جديد: ترقيت إلى دوري ${toName}!`, `New season: Promoted to ${toName} League!`)
      : summary.outcome === 'relegated'
        ? tr(`موسم جديد: هبوط إلى دوري ${toName}`, `New season: Relegated to ${toName} League`)
        : tr(`بدأ موسم جديد في دوري ${toName}`, `New season started in ${toName} League`);
    window.setTimeout(() => showToast(msg), 700);
  } else {
    leagueState.seasonId = sid;
    saveLeague();
  }
}

function getCampaignChapter(level) {
  return CAMPAIGN_CHAPTERS.find((ch) => level >= ch.from && level <= ch.to) || CAMPAIGN_CHAPTERS[CAMPAIGN_CHAPTERS.length - 1];
}

function getCampaignLevelConfig(level) {
  const lvl = Math.min(CAMPAIGN_TOTAL_LEVELS, Math.max(1, Number(level) || 1));
  const chapter = getCampaignChapter(lvl);
  const passCount = Math.max(1, Math.ceil(chapter.questionCount * chapter.passRatio));
  return { level: lvl, chapter, questionCount: chapter.questionCount, passCount, difficulty: chapter.difficulty };
}

function getCampaignLevelQuestions(level) {
  const cfg = getCampaignLevelConfig(level);
  const rand = mulberry32(cfg.level * 977 + 131);
  const pickOneGroup = (candidates, count, seen) => {
    const copy = [...candidates];
    const chosen = [];
    while (chosen.length < count && copy.length) {
      const idx = Math.floor(rand() * copy.length);
      const q = copy.splice(idx, 1)[0];
      seen.add(q.id);
      chosen.push(q);
    }
    return chosen;
  };
  const pickFrom = (pool, count, seen) => {
    const avail = pool.filter((q) => !seen.has(q.id));
    if (!isEn()) return pickOneGroup(avail, count, seen);
    const translated = avail.filter((q) => Boolean(q.en && q.en.question));
    const chosen = pickOneGroup(translated, count, seen);
    if (chosen.length < count) {
      const rest = avail.filter((q) => !seen.has(q.id));
      chosen.push(...pickOneGroup(rest, count - chosen.length, seen));
    }
    return chosen;
  };
  const easyPool = QUESTION_BANK.filter((q) => q.difficulty === 'سهل');
  const medPool = QUESTION_BANK.filter((q) => q.difficulty === 'متوسط');
  const hardPool = QUESTION_BANK.filter((q) => q.difficulty === 'صعب');
  const seen = new Set();
  let selected = [];
  if (cfg.level <= 10) {
    selected = pickFrom(easyPool, cfg.questionCount, seen);
  } else if (cfg.level <= 20) {
    const easyCount = Math.ceil(cfg.questionCount * 0.6);
    selected = [...pickFrom(easyPool, easyCount, seen), ...pickFrom(medPool, cfg.questionCount - easyCount, seen)];
  } else if (cfg.level <= 30) {
    selected = pickFrom(medPool, cfg.questionCount, seen);
  } else if (cfg.level <= 40) {
    const hardPick = pickFrom(hardPool, 1, seen);
    selected = [...hardPick, ...pickFrom(medPool, cfg.questionCount - hardPick.length, seen)];
  } else {
    const hardPick = pickFrom(hardPool, Math.min(2, hardPool.length), seen);
    selected = [...hardPick, ...pickFrom(medPool, cfg.questionCount - hardPick.length, seen)];
  }
  if (selected.length < cfg.questionCount) {
    selected = [...selected, ...pickFrom(QUESTION_BANK, cfg.questionCount - selected.length, seen)];
  }
  return selected;
}

function renderCampaignScreen() {
  if (!ui.campaignChapters || !ui.campaignSummaryBar) return;
  const completedMap = campaignState.completed || {};
  const completedCount = Object.keys(completedMap).length;
  const totalStars = Object.values(completedMap).reduce((sum, item) => sum + (item.stars || 0), 0);
  const maxStars = CAMPAIGN_TOTAL_LEVELS * 3;
  ui.campaignSummaryBar.innerHTML = `
    <div class="campaign-stat-box"><strong>${completedCount} / ${CAMPAIGN_TOTAL_LEVELS}</strong><span>${tr('مستويات مكتملة', 'Levels Completed')}</span></div>
    <div class="campaign-stat-box"><strong>${campaignState.unlockedLevel}</strong><span>${tr('المستوى المتاح', 'Unlocked Level')}</span></div>
    <div class="campaign-stat-box"><strong>${totalStars} / ${maxStars} ★</strong><span>${tr('مجموع النجوم', 'Total Stars')}</span></div>
    <div class="campaign-stat-box"><strong>${isLinkedGoogleAccount() ? tr('متزامن ✓', 'Synced ✓') : tr('محلي + أوفلاين', 'Local + Offline')}</strong><span>${tr('حالة الحفظ', 'Save Status')}</span></div>
  `;
  if (ui.playNextCampaignBtn) {
    ui.playNextCampaignBtn.textContent = tr(`العب المستوى ${campaignState.unlockedLevel} ←`, `Play Level ${campaignState.unlockedLevel} →`);
  }
  ui.campaignChapters.innerHTML = CAMPAIGN_CHAPTERS.map((ch) => {
    const nodes = [];
    for (let lvl = ch.from; lvl <= ch.to; lvl += 1) {
      const done = completedMap[lvl];
      const unlocked = lvl <= campaignState.unlockedLevel;
      const isCurrent = lvl === campaignState.unlockedLevel && !done;
      const statusClass = done ? 'completed' : isCurrent ? 'current' : unlocked ? '' : 'locked';
      const starsStr = done ? `${'★'.repeat(done.stars || 1)}${'☆'.repeat(Math.max(0, 3 - (done.stars || 1)))}` : (unlocked ? tr('جاهز', 'Ready') : '🔒');
      nodes.push(`
        <button type="button" class="campaign-level-node ${statusClass}" data-action="play-campaign-level" data-level="${lvl}" aria-label="${tr('المستوى', 'Level')} ${lvl}">
          <span class="campaign-level-num">${lvl}</span>
          <span class="campaign-level-stars">${starsStr}</span>
          <span class="campaign-level-info">${ch.questionCount} ${tr('أسئلة', 'Qs')}</span>
        </button>
      `);
    }
    const chCompleted = Array.from({ length: ch.to - ch.from + 1 }, (_, i) => ch.from + i).filter((l) => completedMap[l]).length;
    const chTitle = isEn() ? (CHAPTER_EN[ch.id] || ch.title) : ch.title;
    const chDiff = isEn() ? (DIFF_EN[ch.difficulty] || ch.difficulty) : ch.difficulty;
    return `
      <article class="campaign-chapter-card glass-card">
        <div class="campaign-chapter-head">
          <h2>${chTitle}</h2>
          <div class="campaign-chapter-meta">
            <span class="chapter-diff-pill ${ch.badgeClass}">${chDiff}</span>
            <span>${chCompleted} / 10 ${tr('مكتمل', 'done')}</span>
          </div>
        </div>
        <div class="campaign-levels-grid">${nodes.join('')}</div>
      </article>
    `;
  }).join('');
}

function openCampaign() {
  clearRoundTimers();
  renderCampaignScreen();
  showScreen('campaign');
}

function startCampaignLevel(level) {
  const lvl = Number(level) || 1;
  if (lvl > campaignState.unlockedLevel) {
    showToast(tr(`أكمل المستوى ${campaignState.unlockedLevel} أولاً لفتح المستوى ${lvl}`, `Complete Level ${campaignState.unlockedLevel} first to unlock Level ${lvl}`));
    return;
  }
  clearRoundTimers();
  const cfg = getCampaignLevelConfig(lvl);
  state.mode = 'campaign';
  state.campaignLevel = lvl;
  state.opponentName = tr(`هدف المستوى ${lvl}`, `Level ${lvl} Target`);
  state.tiebreakRound = 0;
  state.raceTotal = cfg.questionCount;
  state.powers = applyWheelBonusPowers({ skip: 1, freeze: 1, double: 1 });
  state.doubleNext = false;
  state.frozenUntil = 0;
  state.tournament = null;
  state.questions = getCampaignLevelQuestions(lvl);
  resetRaceState();
  state.opponentScore = cfg.passCount;
  state.opponentProgress = Math.min(10, (cfg.passCount / cfg.questionCount) * 10);
  updateScoreboard();
  if (ui.opponentName) ui.opponentName.textContent = tr(`الهدف (${cfg.passCount}/${cfg.questionCount})`, `Target (${cfg.passCount}/${cfg.questionCount})`);
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = '🎯';
  const diffLabel = isEn() ? (DIFF_EN[cfg.difficulty] || cfg.difficulty) : cfg.difficulty;
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`الحملة الفردية · المستوى ${lvl} من ${CAMPAIGN_TOTAL_LEVELS} (${diffLabel})`, `Solo Campaign · Level ${lvl} of ${CAMPAIGN_TOTAL_LEVELS} (${diffLabel})`);
  if (ui.questionTotal) ui.questionTotal.textContent = String(cfg.questionCount);
  if (ui.answeredTotal) ui.answeredTotal.textContent = String(cfg.questionCount);
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
  showToast(tr(`المستوى ${lvl}: أجب ${cfg.passCount} من ${cfg.questionCount} إجابة صحيحة للنجاح`, `Level ${lvl}: Answer ${cfg.passCount} of ${cfg.questionCount} correctly to pass`));
}

function openLeaguesModal() {
  const info = getLeagueStatus();
  const rows = LEAGUES.map((lg, i) => {
    const isCurrent = i === info.index;
    const isPassed = i < info.index;
    const reqText = lg.promoteAt ? tr(`ترقية: ${lg.promoteAt} ن`, `Promote: ${lg.promoteAt} pts`) : tr('أعلى دوري', 'Top League');
    const safeText = lg.safeAt > 0 ? tr(`ثبات: ${lg.safeAt} ن`, `Safe: ${lg.safeAt} pts`) : tr('بداية', 'Start');
    return `
      <div class="league-row ${isCurrent ? 'current' : isPassed ? 'passed' : ''}">
        <div class="league-row-title"><span>${lg.icon}</span><div><b>${tr(lg.name, lg.en)}</b><small>${tr(lg.en, lg.name)}</small></div></div>
        <div class="league-row-meta">${safeText} · ${reqText}${isCurrent ? tr(' · <b>أنت هنا</b>', ' · <b>You</b>') : ''}</div>
      </div>
    `;
  }).join('');
  const evalDisabled = info.seasonRaces < 3;
  const lastEvalHtml = leagueState.lastEvaluation
    ? `<p><small>${tr(
      `آخر تقييم موسمي (${leagueState.lastEvaluation.seasonId}): ${leagueState.lastEvaluation.fromLeague} ← ${leagueState.lastEvaluation.toLeague} (${leagueState.lastEvaluation.points} نقطة)`,
      `Last settlement (${leagueState.lastEvaluation.seasonId}): ${leagueState.lastEvaluation.fromLeagueEn || leagueState.lastEvaluation.fromLeague} → ${leagueState.lastEvaluation.toLeagueEn || leagueState.lastEvaluation.toLeague} (${leagueState.lastEvaluation.points} pts)`,
    )}</small></p>`
    : '';
  openModal(tr('🏅 نظام الدوريات (8 دوريات)', '🏅 League System (8 Leagues)'), `
    <div class="profile-league-box">
      <div class="profile-league-head">
        <strong>${info.league.icon} ${tr(`دوري ${info.league.name} (${info.league.en})`, `${info.league.en} League`)}</strong>
        <span class="league-zone-chip ${info.zone}">${info.zoneLabel}</span>
      </div>
      <div class="xp-row"><div><span>${tr('نقاط الموسم', 'Season Points')} (${leagueState.seasonId})</span><b>${info.nextText}</b></div><div class="progress-track league-track"><span style="width: ${info.progressPct}%"></span></div></div>
      <small>${tr(`سباقات الموسم: ${info.seasonRaces} · انتصارات الموسم: ${info.seasonWins}`, `Season Races: ${info.seasonRaces} · Season Wins: ${info.seasonWins}`)}</small>
    </div>
    <div class="leagues-list">${rows}</div>
    <div class="season-eval-box">
      <small>${evalDisabled
        ? tr(`تحتاج ${3 - info.seasonRaces} سباقات إضافية في هذا الموسم لتقييم نهاية الموسم يدوياً (أو يُقيَّم تلقائياً بنهاية الأسبوع).`, `Play ${3 - info.seasonRaces} more races this season to settle manually (or wait for weekly auto-settlement).`)
        : tr('يمكنك إنهاء الموسم وتطبيق الترقية أو الهبوط الآن:', 'You can settle this season and apply promotion or relegation now:')}</small>
      <button type="button" class="primary-button" data-action="settle-season" ${evalDisabled ? 'disabled' : ''}>${tr('تقييم نهاية الموسم الآن', 'Settle Season Now')}</button>
      ${lastEvalHtml}
    </div>
  `, 'info');
}

function showScreen(name) {
  state.screen = name;
  [ui.home, ui.campaign, ui.hifz, ui.teacher, ui.race, ui.result].forEach((screen) => {
    if (!screen) return;
    const active = screen.id === `${name}Screen`;
    screen.classList.toggle('active', active);
    screen.hidden = !active;
  });
  document.querySelectorAll('.bottom-nav .nav-item[data-nav]').forEach((item) => {
    item.classList.toggle('active', item.dataset.nav === name);
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
  // A single bad question must never kill the whole app again (v1.4.2 bug:
  // a duplicated question text threw here, boot() died before bindEvents(),
  // and no button worked). Skip invalid questions with a warning instead.
  const seenIds = new Set();
  const seenTexts = new Set();
  const categories = new Set();
  const invalid = [];
  for (const question of QUESTION_BANK) {
    let reason = null;
    if (seenIds.has(question.id)) reason = `Duplicate question id: ${question.id}`;
    else if (seenTexts.has(question.question)) reason = `Duplicate question text: ${question.question}`;
    else if (!question.source || typeof question.source !== 'string') reason = `Question ${question.id} has no source`;
    else if (!Array.isArray(question.options) || question.correct < 0 || question.correct >= question.options.length) reason = `Invalid correct index for question ${question.id}`;
    else if (question.type === 'order' && (!Array.isArray(question.correctOrder) || question.correctOrder.length !== question.options.length || new Set(question.correctOrder).size !== question.options.length || question.correctOrder.some((i) => i < 0 || i >= question.options.length))) reason = `Invalid order for question ${question.id}`;
    if (reason) {
      console.warn(`تخطَّى سؤالاً غير صالح في بنك الأسئلة: ${reason}`);
      invalid.push(question);
      continue;
    }
    seenIds.add(question.id);
    seenTexts.add(question.question);
    categories.add(question.category);
  }
  if (invalid.length) {
    for (let i = QUESTION_BANK.length - 1; i >= 0; i--) {
      if (invalid.includes(QUESTION_BANK[i])) QUESTION_BANK.splice(i, 1);
    }
  }
  if (QUESTION_BANK.length < 10) throw new Error(`Question bank too small after validation: ${QUESTION_BANK.length} questions`);
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

function getModeQuestionSource() {
  if (!kidsMode) return [...QUESTION_BANK];
  const easy = QUESTION_BANK.filter((q) => q.difficulty === 'سهل');
  const shortEasy = easy.filter((q) => q.question.length <= 78);
  return shortEasy.length >= 15 ? shortEasy : easy;
}

function startRace(opponentName = 'سراج', mode = 'training', sharedQuestions = null, categoryFilter = null) {
  clearRoundTimers();
  state.mode = mode;
  state.spectating = false;
  state.categoryFilter = categoryFilter;
  if (mode !== 'team') state.teamBattle = null;
  if (ui.race) ui.race.classList.remove('is-spectating');
  if (ui.spectatorBanner) ui.spectatorBanner.hidden = true;
  if (ui.teamBattleBanner) ui.teamBattleBanner.hidden = mode !== 'team';
  state.campaignLevel = null;
  state.opponentName = opponentName;
  state.tiebreakRound = 0;
  state.raceTotal = 10;
  state.powers = applyWheelBonusPowers({ skip: 1, freeze: 1, double: 1 });
  state.doubleNext = false;
  state.frozenUntil = 0;
  if (mode !== 'tournament') state.tournament = null;
  const categories = ['القرآن', 'السيرة', 'الفقه', 'الحديث', 'التاريخ', 'العقيدة'];
  const picked = [];
  const baseSource = getModeQuestionSource();
  const filteredSource = categoryFilter ? baseSource.filter((q) => q.category === categoryFilter) : baseSource;
  const effectiveSource = filteredSource.length >= 10 ? filteredSource : baseSource;
  const pool = isEn() ? effectiveSource.filter((q) => Boolean(q.en && q.en.question)) : [...effectiveSource];
  const fallbackPool = effectiveSource.filter((q) => !pool.includes(q));
  if (!categoryFilter) {
    for (const category of categories) {
      const candidates = pool.filter((question) => question.category === category);
      if (candidates.length) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        picked.push(chosen);
        pool.splice(pool.indexOf(chosen), 1);
      }
    }
  }
  while (picked.length < 10 && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  while (picked.length < 10 && fallbackPool.length) {
    picked.push(fallbackPool.splice(Math.floor(Math.random() * fallbackPool.length), 1)[0]);
  }
  state.questions = shuffle(picked);
  if (sharedQuestions && sharedQuestions.length) state.questions = [...sharedQuestions];
  resetRaceState();
  const shownOpp = displayOpponent(opponentName);
  if (ui.opponentName) ui.opponentName.textContent = shownOpp;
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = shownOpp.charAt(0);
  if (ui.raceEyebrow) {
    ui.raceEyebrow.textContent = mode === 'tournament' && state.tournament
      ? tr(`بطولة الموسم · الجولة ${state.tournament.round + 1} من 3`, `Season Tournament · Round ${state.tournament.round + 1} of 3`)
      : categoryFilter
        ? tr(`اكتشف · سباق ${categoryFilter}`, `Discover · ${CAT_EN[categoryFilter] || categoryFilter} Race`)
        : kidsMode
          ? tr('🧸 وضع الأطفال · أسئلة سهلة ومبسطة', '🧸 Kids Mode · Easy Questions')
          : tr('تدريب محلي · سباق جديد', 'Local Practice · New Race');
  }
  if (ui.questionTotal) ui.questionTotal.textContent = '10';
  if (ui.answeredTotal) ui.answeredTotal.textContent = '10';
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
}

function startDaily() {
  const today = todayKey();
  if (localStorage.getItem(DAILY_KEY) === today) {
    showToast(tr('لقد أكملت تحدي اليوم — عُد غداً لتحدٍّ جديد!', 'You already completed today’s challenge — come back tomorrow!'));
    return;
  }
  clearRoundTimers();
  const seed = [...today].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = mulberry32(seed);
  const baseSource = getModeQuestionSource();
  const enPool = baseSource.filter((q) => Boolean(q.en && q.en.question));
  const pool = isEn() && enPool.length >= 5 ? [...enPool] : [...baseSource];
  const picked = [];
  while (picked.length < 5 && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  state.mode = 'daily';
  state.campaignLevel = null;
  state.opponentName = 'تحدي اليوم';
  state.tiebreakRound = 0;
  state.raceTotal = 5;
  state.powers = applyWheelBonusPowers({ skip: 1, freeze: 1, double: 1 });
  state.doubleNext = false;
  state.frozenUntil = 0;
  state.tournament = null;
  state.questions = picked;
  resetRaceState();
  if (ui.opponentName) ui.opponentName.textContent = tr('تحدي اليوم', 'Daily Challenge');
  if (ui.opponentAvatar) ui.opponentAvatar.textContent = '📅';
  if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr('تحدي اليوم · 5 أسئلة · محاولة واحدة يومياً', 'Daily Challenge · 5 Questions · Once a day');
  if (ui.questionTotal) ui.questionTotal.textContent = '5';
  if (ui.answeredTotal) ui.answeredTotal.textContent = '5';
  if (ui.tiebreakBanner) ui.tiebreakBanner.hidden = true;
  showScreen('race');
  renderQuestion();
  showToast(tr('تحدي اليوم: 5 أسئلة — بالتوفيق!', 'Daily Challenge: 5 questions — Good luck!'));
}

function startTournament() {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  state.mode = 'tournament';
  state.tournament = { round: 0, opponents: shuffle([...TOURNAMENT_OPPONENTS]) };
  showToast(tr('بطولة الموسم: 3 جولات إقصائية — فُز بها كلها لتصبح البطل!', 'Season Tournament: 3 knockout rounds — win all to become Champion!'));
  startRace(state.tournament.opponents[0], 'tournament');
}

function startTiebreakRound() {
  state.tiebreakRound += 1;
  const usedIds = new Set(state.questions.map((q) => q.id));
  const baseSource = getModeQuestionSource();
  const unused = baseSource.filter((q) => !usedIds.has(q.id));
  const enUnused = unused.filter((q) => Boolean(q.en && q.en.question));
  const pool = isEn() && enUnused.length ? enUnused : unused;
  const question = pool[Math.floor(Math.random() * pool.length)];
  state.questions = [question];
  state.index = 0;
  state.raceTotal += 1;
  state.gameOver = false;
  state.locked = false;
  showToast(tr(`⚡ سؤال فاصل — الجولة ${state.tiebreakRound}!`, `⚡ Tiebreaker — Round ${state.tiebreakRound}!`));
  showScreen('race');
  renderQuestion();
}

function renderQuestionContent(question) {
  if (!question) return;
  const enData = question.en && question.en.question ? question.en : null;
  const useEn = isEn() && Boolean(enData);
  const letters = isEn() ? LETTERS_EN : LETTERS;

  ui.category.textContent = isEn() ? (CAT_EN[question.category] || question.category) : question.category;
  ui.difficulty.textContent = isEn() ? (DIFF_EN[question.difficulty] || question.difficulty) : question.difficulty;
  ui.questionType.textContent = isEn() ? (TYPE_EN[question.type] || 'Multiple Choice') : (TYPE_LABELS[question.type] || 'اختيار من متعدد');

  if (ui.questionTranslationNotice) {
    if (isEn() && !enData) {
      ui.questionTranslationNotice.textContent = 'Notice: This question is not yet translated and appears in Arabic — it will be translated later. · ملاحظة: هذا السؤال بالعربية وسيُترجم لاحقاً.';
      ui.questionTranslationNotice.hidden = false;
    } else {
      ui.questionTranslationNotice.hidden = true;
      ui.questionTranslationNotice.textContent = '';
    }
  }

  if (useEn) {
    ui.questionText.innerHTML = `${escapeHtml(enData.question)} <span class="translation-badge" title="ترجمة مساعدة وليست بديلاً عن النص العربي الموثّق">Translation · ترجمة</span>`;
    if (ui.questionArabicCompanion) {
      ui.questionArabicCompanion.textContent = `النص العربي الأصلي: ${question.question}`;
      ui.questionArabicCompanion.hidden = false;
    }
  } else {
    ui.questionText.textContent = question.question;
    if (ui.questionArabicCompanion) {
      ui.questionArabicCompanion.textContent = '';
      ui.questionArabicCompanion.hidden = true;
    }
  }

  if (ui.tiebreakBanner) {
    ui.tiebreakBanner.hidden = state.tiebreakRound === 0;
    if (state.tiebreakRound > 0) {
      ui.tiebreakBanner.textContent = tr(
        `⚡ سؤال فاصل — الجولة ${state.tiebreakRound} · أول من يجيب صحيحاً يحسم السباق`,
        `⚡ Tiebreaker — Round ${state.tiebreakRound} · First right answer wins`,
      );
    }
  }

  ui.answers.innerHTML = '';
  const renderOptInner = (index, arOption) => {
    const enOption = useEn && Array.isArray(enData.options) ? enData.options[index] : null;
    if (useEn && enOption) {
      return `<span class="answer-letter">${letters[index]}</span><span class="answer-option-stack"><span class="answer-text">${escapeHtml(enOption)}</span><small class="answer-ar-sub">${escapeHtml(arOption)}</small></span>`;
    }
    return `<span class="answer-letter">${letters[index]}</span><span class="answer-text">${escapeHtml(arOption)}</span>`;
  };

  if (question.type === 'order') {
    if (!state.locked) {
      ui.feedback.textContent = tr('اضغط على الخيارات بالترتيب الصحيح، ثم اضغط «تأكيد الترتيب».', 'Tap the options in order, then press “Confirm Order”.');
      ui.feedback.className = 'answer-feedback';
    }
    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-button order-button';
      button.dataset.answerIndex = index;
      const pickedIndex = state.orderPicked.indexOf(index);
      if (pickedIndex !== -1) button.classList.add('picked');
      button.innerHTML = `${renderOptInner(index, option)}<span class="order-num">${pickedIndex !== -1 ? pickedIndex + 1 : ''}</span>`;
      ui.answers.appendChild(button);
    });
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'confirm-order-button';
    confirm.textContent = tr('تأكيد الترتيب', 'Confirm Order');
    confirm.disabled = state.spectating || state.locked || state.orderPicked.length !== question.options.length;
    confirm.dataset.action = 'confirm-order';
    ui.answers.appendChild(confirm);
  } else {
    question.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-button';
      button.dataset.answerIndex = index;
      if (state.spectating) button.disabled = true;
      button.innerHTML = renderOptInner(index, option);
      ui.answers.appendChild(button);
    });
  }
}

function refreshRaceLanguage() {
  if (!state.currentQuestion) return;
  if (state.mode === 'campaign' && state.campaignLevel) {
    const cfg = getCampaignLevelConfig(state.campaignLevel);
    const diffLabel = isEn() ? (DIFF_EN[cfg.difficulty] || cfg.difficulty) : cfg.difficulty;
    if (ui.opponentName) ui.opponentName.textContent = tr(`الهدف (${cfg.passCount}/${cfg.questionCount})`, `Target (${cfg.passCount}/${cfg.questionCount})`);
    if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`الحملة الفردية · المستوى ${cfg.level} من ${CAMPAIGN_TOTAL_LEVELS} (${diffLabel})`, `Solo Campaign · Level ${cfg.level} of ${CAMPAIGN_TOTAL_LEVELS} (${diffLabel})`);
  } else if (state.mode === 'hifz') {
    const modeMeta = HIFZ_TRAINING_MODES.find((m) => m.id === state.hifzType);
    const modeLabel = modeMeta ? tr(modeMeta.ar, modeMeta.en) : tr('تدريب شامل', 'Mixed Practice');
    if (ui.opponentName) ui.opponentName.textContent = tr('الحفظ القرآني', 'Quran Hifz');
    if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr(`اختبر حفظك · ${modeLabel}`, `Test Your Hifz · ${modeLabel}`);
  } else if (state.mode === 'daily') {
    if (ui.opponentName) ui.opponentName.textContent = tr('تحدي اليوم', 'Daily Challenge');
    if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr('تحدي اليوم · 5 أسئلة · محاولة واحدة يومياً', 'Daily Challenge · 5 Questions · Once a day');
  } else if (state.mode === 'online') {
    if (ui.opponentName) ui.opponentName.textContent = displayOpponent(state.opponentName);
    if (ui.raceEyebrow) ui.raceEyebrow.textContent = tr('سباق مباشر عبر الإنترنت · 10 أسئلة', 'Live Online Race · 10 Questions');
  } else {
    if (ui.opponentName) ui.opponentName.textContent = displayOpponent(state.opponentName);
    if (ui.raceEyebrow) {
      ui.raceEyebrow.textContent = state.mode === 'tournament' && state.tournament
        ? tr(`بطولة الموسم · الجولة ${state.tournament.round + 1} من 3`, `Season Tournament · Round ${state.tournament.round + 1} of 3`)
        : kidsMode
          ? tr('🧸 وضع الأطفال · أسئلة سهلة ومبسطة', '🧸 Kids Mode · Easy Questions')
          : tr('تدريب محلي · سباق جديد', 'Local Practice · New Race');
    }
  }
  renderQuestionContent(state.currentQuestion);
  if (state.locked) {
    const q = state.currentQuestion;
    if (q.type === 'order') {
      markOrderButtons();
    } else {
      ui.answers.querySelectorAll('.answer-button').forEach((button) => {
        const index = Number(button.dataset.answerIndex);
        button.disabled = true;
        if (index === q.correct) button.classList.add('correct');
      });
    }
    if (ui.explanationCard && !ui.explanationCard.hidden) {
      updateExplanationCardBody(q);
    }
  }
}

function renderQuestion() {
  clearTimeout(state.nextTimer);
  state.nextTimer = null;
  clearInterval(state.nextCountdownTimer);
  state.nextCountdownTimer = null;
  clearTimeout(state.pendingBotTimer);
  state.pendingBotTimer = null;
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
  ui.feedback.textContent = '';
  ui.feedback.className = 'answer-feedback';
  if (ui.companionBubble) ui.companionBubble.hidden = true;
  if (ui.explanationCard) ui.explanationCard.hidden = true;
  if (ui.explanationArabicRow) ui.explanationArabicRow.hidden = true;
  ui.card.classList.remove('answer-correct', 'answer-wrong');
  ui.raceStreak.textContent = state.streak;
  ui.answers.innerHTML = '';
  renderQuestionContent(question);
  if (state.spectating) {
    state.locked = true;
    updatePowers();
    return;
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
  const useEn = isEn() && question.en && Array.isArray(question.en.options);
  const correctOrderText = question.correctOrder
    .map((i) => (useEn ? question.en.options[i] : question.options[i]))
    .join(isEn() ? ' → ' : ' ← ');
  const wrongFeedback = tr(
    `الترتيب الصحيح: ${correctOrderText} · المرجع: ${question.source}`,
    `Correct order: ${correctOrderText} · Source: ${question.source}`,
  );
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
  if (state.mode === 'daily' || state.mode === 'online' || state.mode === 'campaign' || state.mode === 'hifz') return;
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
  const opp = displayOpponent(state.opponentName);
  if (state.botCorrect) {
    const botFirst = !state.locked;
    state.opponentProgress = Math.min(10, state.opponentProgress + 1);
    state.opponentScore += botFirst ? 10 : 5;
    updateScoreboard();
    if (!state.locked) showToast(tr(`⚡ ${opp} أجاب قبلك — تقدّم خطوة`, `⚡ ${opp} answered first — moved ahead`));
  } else if (!state.locked) {
    showToast(tr(`💨 ${opp} أخطأ — فرصتك الآن`, `💨 ${opp} missed — your chance!`));
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

function formatCorrectAnswerText(question, forceArabic = false) {
  if (!question) return '';
  const useEn = !forceArabic && isEn() && question.en && Array.isArray(question.en.options);
  const opts = useEn ? question.en.options : question.options;
  if (question.type === 'order' && Array.isArray(question.correctOrder)) {
    return question.correctOrder.map((i) => opts[i]).join(forceArabic || !isEn() ? ' ← ' : ' → ');
  }
  return opts && opts[question.correct] !== undefined ? opts[question.correct] : '';
}

function getQuestionExplanation(question, correctText) {
  if (isEn() && question && question.en) {
    if (question.en.explanation && question.en.explanation.trim()) {
      return question.en.explanation.trim();
    }
    const cat = CAT_EN[question.category] || question.category;
    return `In ${cat}, the confirmed answer is “${correctText}” (Translation · ترجمة).`;
  }
  if (question && question.explanation && question.explanation.trim()) {
    return question.explanation.trim();
  }
  return `الإجابة المعتمدة في باب ${question.category} هي: «${correctText}».`;
}

function updateExplanationCardBody(question) {
  if (!ui.explanationCard || !question) return;
  const correctText = formatCorrectAnswerText(question);
  const arCorrectText = formatCorrectAnswerText(question, true);
  if (ui.explanationCorrect) ui.explanationCorrect.textContent = correctText;
  if (ui.explanationText) ui.explanationText.textContent = getQuestionExplanation(question, correctText);
  if (ui.explanationSource) ui.explanationSource.textContent = question.source || tr('بنك الأسئلة الموثّق', 'Question Bank');
  if (ui.explanationArabicRow && ui.explanationArabicCompanion) {
    if (isEn()) {
      const arExp = question.explanation && question.explanation.trim() ? ` · ${question.explanation.trim()}` : '';
      ui.explanationArabicCompanion.textContent = `${question.question} — الإجابة: ${arCorrectText}${arExp} (المصدر: ${question.source})`;
      ui.explanationArabicRow.hidden = false;
    } else {
      ui.explanationArabicCompanion.textContent = '';
      ui.explanationArabicRow.hidden = true;
    }
  }
}

function showAnswerExplanationCard(question) {
  if (!ui.explanationCard || !question) return;
  updateExplanationCardBody(question);
  ui.explanationCard.hidden = false;
  window.requestAnimationFrame(() => {
    if (!ui.explanationCard || ui.explanationCard.hidden) return;
    const rect = ui.explanationCard.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 92) {
      ui.explanationCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  const isLast = state.index + 1 >= state.questions.length;
  const baseLabel = isLast ? tr('عرض النتيجة ←', 'View Results →') : tr('السؤال التالي ←', 'Next Question →');
  let secondsLeft = 5;
  if (ui.nextQuestionBtn) ui.nextQuestionBtn.textContent = `${baseLabel} (${secondsLeft})`;
  clearInterval(state.nextCountdownTimer);
  state.nextCountdownTimer = window.setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(state.nextCountdownTimer);
      state.nextCountdownTimer = null;
      return;
    }
    if (ui.nextQuestionBtn) ui.nextQuestionBtn.textContent = `${baseLabel} (${secondsLeft})`;
  }, 1000);
}

function scoreAnswer(isCorrect, wrongFeedback) {
  if (state.spectating) return;
  const elapsed = Math.min(15, Math.max(0.1, (performance.now() - state.startedAt) / 1000));
  state.times.push(elapsed);
  if (state.currentQuestion && state.currentQuestion.category) recordCategoryPlay(state.currentQuestion.category);
  state.lastPlayerCorrect = isCorrect;
  const hasOpponent = state.mode !== 'daily' && state.mode !== 'campaign' && state.mode !== 'hifz';
  if (isCorrect) {
    const faster = !hasOpponent || !state.botResponded;
    let points = faster ? 10 : 5;
    if (state.doubleNext) { points *= 2; state.doubleNext = false; }
    if (state.mode === 'team' && state.teamBattle) {
      const allyBoost = 3;
      points += allyBoost;
      state.teamBattle.allyPoints += allyBoost;
    }
    state.playerScore += points;
    state.correct += 1;
    state.playerProgress = state.raceTotal ? Math.min(10, (state.correct / state.raceTotal) * 10) : Math.min(10, state.playerProgress + 1);
    state.streak += 1;
    if (state.streak >= 3) unlockAchievement('streak-3');
    ui.feedback.textContent = kidsMode
      ? tr(`🌟 رائع يا بطل! إجابة صحيحة +${points} نقاط!`, `🌟 Awesome job! Correct answer +${points} pts!`)
      : !hasOpponent
        ? tr(`إجابة صحيحة — +${points} نقاط ✓`, `Correct answer — +${points} pts ✓`)
        : faster
          ? tr(`إجابة صحيحة — +${points} نقاط، أنت الأسرع`, `Correct answer — +${points} pts, you were faster!`)
          : tr(`إجابة صحيحة — +${points} نقاط، الخصم كان أسرع`, `Correct answer — +${points} pts, opponent was faster`);
    ui.feedback.className = 'answer-feedback good';
    ui.card.classList.add('answer-correct');
    burstSparkles();
    showCompanionMessage('correct');
  } else {
    state.streak = 0;
    ui.feedback.textContent = kidsMode
      ? tr('💛 محاولة جميلة! ستصيب الإجابة في السؤال القادم بإذن الله!', '💛 Good try! You will get the next one!')
      : (wrongFeedback || tr('انتهى الوقت — لا تتوقف، السؤال التالي ينتظرك', 'Time is up — keep going!'));
    ui.feedback.className = 'answer-feedback bad';
    ui.card.classList.add('answer-wrong');
    if (kidsMode) showCompanionMessage('kids-encourage', tr('لا بأس يا بطل، التعلّم خطوة بخطوة!', 'Keep trying, learning happens step by step!'));
  }
  ui.raceStreak.textContent = state.streak;
  updateScoreboard();
  updateTeamBattleBanner();
  if (state.mode === 'online') pushOnlineScore();
  if (hasOpponent && !state.botResponded && state.mode !== 'online') {
    clearTimeout(state.pendingBotTimer);
    state.pendingBotTimer = window.setTimeout(() => {
      state.pendingBotTimer = null;
      applyPendingBotResult(isCorrect);
    }, 560);
  }
  showAnswerExplanationCard(state.currentQuestion);
  clearTimeout(state.nextTimer);
  state.nextTimer = window.setTimeout(() => advanceQuestion(), 5000);
}

function handleAnswer(answerIndex) {
  if (state.locked || state.spectating) return;
  const question = state.currentQuestion;
  state.locked = true;
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.botTimer);
  const buttons = [...ui.answers.querySelectorAll('.answer-button')];
  if (question.type === 'order') {
    markOrderButtons();
    const isCorrect = state.orderPicked.join(',') === question.correctOrder.join(',');
    const correctOrderText = formatCorrectAnswerText(question);
    scoreAnswer(isCorrect, tr(`الترتيب الصحيح: ${correctOrderText} · المرجع: ${question.source}`, `Correct order: ${correctOrderText} · Source: ${question.source}`));
    return;
  }
  buttons.forEach((button) => {
    const index = Number(button.dataset.answerIndex);
    button.disabled = true;
    if (index === question.correct) button.classList.add('correct');
    else if (index === answerIndex) button.classList.add('wrong');
  });
  const isCorrect = answerIndex !== null && answerIndex === question.correct;
  const correctOpt = formatCorrectAnswerText(question);
  const wrongFeedback = answerIndex === null
    ? tr(`انتهى الوقت! الإجابة الصحيحة: ${correctOpt} · المرجع: ${question.source}`, `Time up! Correct answer: ${correctOpt} · Source: ${question.source}`)
    : tr(`ليست الإجابة الصحيحة. المرجع: ${question.source}`, `Incorrect. Source: ${question.source}`);
  scoreAnswer(isCorrect, wrongFeedback);
}

function advanceQuestion() {
  if (state.gameOver || state.screen !== 'race') return;
  clearTimeout(state.nextTimer);
  state.nextTimer = null;
  clearInterval(state.nextCountdownTimer);
  state.nextCountdownTimer = null;
  if (state.pendingBotTimer) {
    clearTimeout(state.pendingBotTimer);
    state.pendingBotTimer = null;
    applyPendingBotResult(state.lastPlayerCorrect);
  }
  state.index += 1;
  if (state.index >= state.questions.length) finishRace();
  else renderQuestion();
}

function finishRace() {
  state.gameOver = true;
  clearRoundTimers();
  const accuracy = state.raceTotal ? Math.round((state.correct / state.raceTotal) * 100) : 0;
  const average = state.times.length ? (state.times.reduce((sum, time) => sum + time, 0) / state.times.length).toFixed(1) : '—';
  const speedSuffix = tr('ث', 's');
  if (ui.resultCompanionBubble) ui.resultCompanionBubble.hidden = true;
  if (ui.resultHifzBtn) ui.resultHifzBtn.hidden = state.mode !== 'hifz';
  if (ui.race) ui.race.classList.remove('is-spectating');
  if (ui.spectatorBanner) ui.spectatorBanner.hidden = true;
  if (ui.teamBattleBanner) ui.teamBattleBanner.hidden = true;

  if (state.mode === 'spectator' || state.spectating) {
    state.spectating = false;
    ui.finalScore.textContent = state.playerScore;
    ui.finalCorrect.textContent = `${state.playerProgress}/10`;
    ui.finalAccuracy.textContent = `${Math.round((state.playerProgress / 10) * 100)}%`;
    ui.finalSpeed.textContent = '—';
    ui.resultEyebrow.textContent = tr('وضع المشاهدة المباشر', 'Live Spectator Mode');
    ui.resultTitle.textContent = tr('👁️ انتهت متابعة السباق', '👁️ Race Watch Finished');
    ui.resultSubtitle.textContent = tr(
      `النتيجة النهائية: ${state.playerScore} مقابل ${state.opponentScore} نقطة.`,
      `Final scoreboard: ${state.playerScore} vs ${state.opponentScore} pts.`,
    );
    if (ui.resultPrimaryBtn) {
      ui.resultPrimaryBtn.textContent = tr('ابدأ سباقك الآن', 'Play Your Own Race');
      ui.resultPrimaryBtn.dataset.action = 'start-race';
    }
    if (ui.resultCampaignBtn) ui.resultCampaignBtn.hidden = true;
    showScreen('result');
    return;
  }

  if (state.mode === 'hifz') {
    const passed = accuracy >= 60;
    profile.games += 1;
    profile.wins += passed ? 1 : 0;
    profile.totalAnswered += state.raceTotal;
    profile.totalCorrect += state.correct;
    profile.bestStreak = Math.max(profile.bestStreak, state.streak);
    profile.xp += state.playerScore + (passed ? 25 : 8);
    if (state.correct === state.raceTotal && state.raceTotal > 0) unlockAchievement('perfect');
    saveProfile();
    recordDailyActivity({ raceCompleted: true, correctAdded: state.correct });
    const lpGain = awardLeaguePoints({ won: passed });
    ui.finalScore.textContent = state.playerScore;
    ui.finalCorrect.textContent = `${state.correct}/${state.raceTotal}`;
    ui.finalAccuracy.textContent = `${accuracy}%`;
    ui.finalSpeed.textContent = average === '—' ? average : `${average}${speedSuffix}`;
    ui.resultEyebrow.textContent = tr('اختبر حفظك · القرآن الكريم', 'Test Your Hifz · Noble Quran');
    ui.resultTitle.textContent = passed ? tr('📖 حفظ متقن ومبارك!', '📖 Great Hifz Session!') : tr('📖 واصل المراجعة والتثبيت!', '📖 Keep Reviewing!');
    ui.resultSubtitle.textContent = tr(
      `أجبت ${state.correct} من ${state.raceTotal} إجابات صحيحة في الحفظ (+${lpGain} نقطة دوري).`,
      `You answered ${state.correct} of ${state.raceTotal} correctly in Hifz (+${lpGain} League pts).`,
    );
    if (ui.resultPrimaryBtn) {
      ui.resultPrimaryBtn.textContent = tr('أعد التدريب', 'Practice Again');
      ui.resultPrimaryBtn.dataset.action = 'replay-hifz';
    }
    if (ui.resultCampaignBtn) ui.resultCampaignBtn.hidden = true;
    showScreen('result');
    if (passed) { createConfetti(); showCompanionMessage('win'); }
    updateHomeStats();
    return;
  }

  if (state.mode === 'campaign' && state.campaignLevel) {
    const cfg = getCampaignLevelConfig(state.campaignLevel);
    const passed = state.correct >= cfg.passCount;
    const stars = !passed ? 0 : state.correct === cfg.questionCount ? 3 : state.correct >= Math.ceil(cfg.questionCount * 0.8) ? 2 : 1;
    if (passed) {
      const prev = campaignState.completed[cfg.level] || {};
      campaignState.completed[cfg.level] = {
        stars: Math.max(prev.stars || 0, stars),
        bestCorrect: Math.max(prev.bestCorrect || 0, state.correct),
        total: cfg.questionCount,
        bestScore: Math.max(prev.bestScore || 0, state.playerScore),
      };
      if (cfg.level >= campaignState.unlockedLevel && cfg.level < CAMPAIGN_TOTAL_LEVELS) {
        campaignState.unlockedLevel = cfg.level + 1;
      }
      saveCampaign();
    }
    profile.games += 1;
    profile.wins += passed ? 1 : 0;
    profile.totalAnswered += state.raceTotal;
    profile.totalCorrect += state.correct;
    profile.bestStreak = Math.max(profile.bestStreak, state.streak);
    const xpGain = state.playerScore + (passed ? 30 + stars * 10 : 8);
    profile.xp += xpGain;
    if (passed) unlockAchievement('first-win');
    if (state.correct === state.raceTotal && state.raceTotal > 0) unlockAchievement('perfect');
    if (profile.games >= 10) unlockAchievement('races-10');
    if (profile.xp >= 500) unlockAchievement('xp-500');
    saveProfile();
    recordDailyActivity({ raceCompleted: true, correctAdded: state.correct });
    const lpGain = awardLeaguePoints({ campaignPassed: passed, stars });
    syncProgressToSupabaseMetadata();
    saveRaceHistory({ date: new Date().toISOString(), mode: `campaign-${cfg.level}`, score: state.playerScore, correct: state.correct, total: state.raceTotal, won: passed });

    ui.finalScore.textContent = state.playerScore;
    ui.finalCorrect.textContent = `${state.correct}/${state.raceTotal}`;
    ui.finalAccuracy.textContent = `${accuracy}%`;
    ui.finalSpeed.textContent = average === '—' ? average : `${average}${speedSuffix}`;
    if (passed) {
      const unlockedMsg = cfg.level < CAMPAIGN_TOTAL_LEVELS
        ? tr(` وفُتح المستوى ${cfg.level + 1}!`, ` and Level ${cfg.level + 1} is now unlocked!`)
        : tr(' وأتممت جميع مستويات الحملة الـ 50!', ' and you completed all 50 campaign levels!');
      ui.resultEyebrow.textContent = tr(`الحملة الفردية · المستوى ${cfg.level}`, `Solo Campaign · Level ${cfg.level}`);
      ui.resultTitle.textContent = tr(`🎉 اجتزت المستوى ${cfg.level}! (${'★'.repeat(stars)})`, `🎉 Passed Level ${cfg.level}! (${'★'.repeat(stars)})`);
      ui.resultSubtitle.textContent = tr(
        `حققت ${state.correct}/${cfg.questionCount} إجابات صحيحة${unlockedMsg} (+${lpGain} نقطة دوري)`,
        `You scored ${state.correct}/${cfg.questionCount} correct${unlockedMsg} (+${lpGain} League pts)`,
      );
      if (ui.resultPrimaryBtn) {
        if (cfg.level < CAMPAIGN_TOTAL_LEVELS) {
          ui.resultPrimaryBtn.textContent = tr(`المستوى ${cfg.level + 1} ←`, `Level ${cfg.level + 1} →`);
          ui.resultPrimaryBtn.dataset.action = 'next-campaign-level';
        } else {
          ui.resultPrimaryBtn.textContent = tr('إعادة المستوى', 'Replay Level');
          ui.resultPrimaryBtn.dataset.action = 'replay-campaign-level';
        }
      }
    } else {
      ui.resultEyebrow.textContent = tr(`الحملة الفردية · المستوى ${cfg.level}`, `Solo Campaign · Level ${cfg.level}`);
      ui.resultTitle.textContent = tr('لم تجتز المستوى بعد', 'Level Not Passed Yet');
      ui.resultSubtitle.textContent = tr(
        `تحتاج ${cfg.passCount} من ${cfg.questionCount} إجابات صحيحة لفتح المستوى التالي (+${lpGain} نقطة دوري).`,
        `You need ${cfg.passCount} of ${cfg.questionCount} correct answers to unlock the next level (+${lpGain} League pts).`,
      );
      if (ui.resultPrimaryBtn) {
        ui.resultPrimaryBtn.textContent = tr('إعادة المستوى', 'Replay Level');
        ui.resultPrimaryBtn.dataset.action = 'replay-campaign-level';
      }
    }
    if (ui.resultCampaignBtn) ui.resultCampaignBtn.hidden = false;
    showScreen('result');
    updateHomeStats();
    if (passed) {
      createConfetti();
      showCompanionMessage('win');
      notify(tr(`🏆 اجتزت المستوى ${cfg.level}!`, `🏆 Passed Level ${cfg.level}!`), tr(`حصلت على ${stars} نجوم و+${lpGain} نقطة دوري`, `Earned ${stars} stars & +${lpGain} League pts`));
    }
    return;
  }

  if (ui.resultPrimaryBtn) {
    ui.resultPrimaryBtn.textContent = tr('إعادة المباراة', 'Play Again');
    ui.resultPrimaryBtn.dataset.action = 'start-race';
  }
  if (ui.resultCampaignBtn) ui.resultCampaignBtn.hidden = true;

  const playerWon = state.playerProgress > state.opponentProgress || (state.playerProgress === state.opponentProgress && state.playerScore >= state.opponentScore);
  const tie = state.playerProgress === state.opponentProgress && state.playerScore === state.opponentScore;
  if (tie && state.mode !== 'daily' && state.tiebreakRound < 3) { startTiebreakRound(); return; }
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
  recordDailyActivity({ raceCompleted: true, correctAdded: state.correct, dailyCompleted: state.mode === 'daily' });
  const lpGain = awardLeaguePoints({ won, tie });
  if (state.mode === 'team' && teamState) {
    const meMember = teamState.members.find((m) => m.isPlayer);
    if (meMember) meMember.score = (meMember.score || 0) + state.playerScore;
    teamState.matches = (teamState.matches || 0) + 1;
    if (won) teamState.wins = (teamState.wins || 0) + 1;
    saveTeam();
    updateTeamsHomeUI();
  }
  syncProgressToSupabaseMetadata();
  saveRaceHistory({ date: new Date().toISOString(), mode: state.mode, score: state.playerScore, correct: state.correct, total: state.raceTotal, won });
  ui.finalScore.textContent = state.playerScore;
  ui.finalCorrect.textContent = `${state.correct}/${state.raceTotal}`;
  ui.finalAccuracy.textContent = `${accuracy}%`;
  ui.finalSpeed.textContent = average === '—' ? average : `${average}${speedSuffix}`;
  const opp = displayOpponent(state.opponentName);
  const pFirst = displayProfileName().trim().split(' ')[0];
  if (state.mode === 'team' && state.teamBattle) {
    if (ui.resultPrimaryBtn) {
      ui.resultPrimaryBtn.textContent = tr('أعد معركة الفريق', 'Rematch Team Battle');
      ui.resultPrimaryBtn.dataset.action = 'replay-team-battle';
    }
    ui.resultEyebrow.textContent = tr(`معركة الفرق · ${state.teamBattle.teamIcon} ${state.teamBattle.teamName}`, `Team Battle · ${state.teamBattle.teamIcon} ${state.teamBattle.teamName}`);
    ui.resultTitle.textContent = won
      ? tr(`🛡️ انتصار فريق «${state.teamBattle.teamName}»!`, `🛡️ Victory for "${state.teamBattle.teamName}"!`)
      : tr(`تقدّم «${state.teamBattle.rivalName}» هذه المرة`, `"${state.teamBattle.rivalName}" edged ahead`);
    ui.resultSubtitle.textContent = tr(
      `مجموع فريقك: ${state.playerScore} مقابل ${state.opponentScore} نقطة (+${lpGain} نقطة دوري).`,
      `Your team total: ${state.playerScore} vs ${state.opponentScore} pts (+${lpGain} League pts).`,
    );
  } else if (state.mode === 'daily') {
    ui.resultEyebrow.textContent = tr('تحدي اليوم', 'Daily Challenge');
    ui.resultTitle.textContent = tr('أكملت تحدي اليوم!', 'Daily Challenge Completed!');
    ui.resultSubtitle.textContent = tr(
      `أجبت ${state.correct} من 5 إجابات صحيحة — مكافأة التحدي +50 XP و+${lpGain} نقطة دوري.`,
      `You answered ${state.correct} of 5 correctly — Bonus +50 XP & +${lpGain} League pts.`,
    );
  } else if (tie) {
    ui.resultEyebrow.textContent = tr('تعادل قوي', 'Close Tie');
    ui.resultTitle.textContent = tr('تعادل بعد 3 أسئلة فاصلة!', 'Tied After 3 Tiebreakers!');
    ui.resultSubtitle.textContent = tr(`تساوى الطرفان حتى بعد الأسئلة الفاصلة — +${lpGain} نقطة دوري.`, `Both sides tied even after tiebreakers — +${lpGain} League pts.`);
  } else if (playerWon) {
    ui.resultEyebrow.textContent = tr('انتصار ذهبي', 'Golden Victory');
    ui.resultTitle.textContent = tr(`أحسنت يا ${pFirst}!`, `Well done, ${pFirst}!`);
    ui.resultSubtitle.textContent = tr(`سرعتك صنعت الفارق. واصلت حتى النهاية (+${lpGain} نقطة دوري).`, `Your speed made the difference (+${lpGain} League pts).`);
  } else {
    ui.resultEyebrow.textContent = tr('سباق قوي', 'Tough Race');
    ui.resultTitle.textContent = tr(`${opp} سبقك هذه المرة`, `${opp} finished ahead this time`);
    ui.resultSubtitle.textContent = tr(`راجع المصادر وحاول مرة أخرى — +${lpGain} نقطة دوري.`, `Review the sources and try again — +${lpGain} League pts.`);
  }
  if (state.tiebreakRound > 0 && !tie) ui.resultSubtitle.textContent += tr(' (حُسم بسؤال فاصل ⚡)', ' (Decided by tiebreaker ⚡)');
  showScreen('result');
  updateHomeStats();
  recordOnlineResult();
  if (won) {
    createConfetti();
    showCompanionMessage('win');
    notify(tr('🏆 فزت بالسباق!', '🏆 You won the race!'), tr(`نتيجتك ${state.playerScore} نقطة`, `Your score: ${state.playerScore} pts`));
  }
  if (state.mode === 'tournament') handleTournamentFinish(won);
}

async function handleTournamentFinish(won) {
  if (!state.tournament) return;
  if (won) {
    if (state.tournament.round < 2) {
      state.tournament.round += 1;
      const next = state.tournament.opponents[state.tournament.round];
      const nextName = displayOpponent(next);
      const go = await openConfirm(
        tr('🎉 فزت بالجولة!', '🎉 Round Won!'),
        tr(`<p>تأهلت إلى الجولة ${state.tournament.round + 1} من 3 — خصمك القادم: <b>${nextName}</b>.</p>`, `<p>You advanced to Round ${state.tournament.round + 1} of 3 — Next opponent: <b>${nextName}</b>.</p>`),
        tr('ابدأ الجولة التالية', 'Start Next Round'),
        tr('العودة للرئيسية', 'Back to Home'),
      );
      if (go === true) startRace(next, 'tournament'); else showScreen('home');
    } else {
      unlockAchievement('champion');
      profile.xp += 100;
      saveProfile();
      const go = await openConfirm(
        tr('👑 بطل البطولة!', '👑 Tournament Champion!'),
        tr('<p>فزت بالبطولة كاملة! مكافأة البطل: +100 نقطة خبرة.</p>', '<p>You won the entire tournament! Champion reward: +100 XP.</p>'),
        tr('العب من جديد', 'Play Again'),
        tr('العودة للرئيسية', 'Back to Home'),
      );
      if (go === true) startRace(); else showScreen('home');
    }
  } else {
    const opp = displayOpponent(state.opponentName);
    const go = await openConfirm(
      tr('💔 خرجت من البطولة', '💔 Eliminated from Tournament'),
      tr(`<p>خسرت الجولة ضد <b>${opp}</b>. درّب أكثر وحاول مرة أخرى!</p>`, `<p>You lost this round against <b>${opp}</b>. Practice more and try again!</p>`),
      tr('إعادة البطولة', 'Retry Tournament'),
      tr('العودة للرئيسية', 'Back to Home'),
    );
    if (go === true) startTournament(); else showScreen('home');
  }
}

function clearRoundTimers() {
  clearInterval(state.timerId);
  state.timerId = null;
  clearTimeout(state.botTimer);
  state.botTimer = null;
  clearTimeout(state.pendingBotTimer);
  state.pendingBotTimer = null;
  clearTimeout(state.nextTimer);
  state.nextTimer = null;
  clearInterval(state.nextCountdownTimer);
  state.nextCountdownTimer = null;
  clearInterval(state.spectatorTimer);
  state.spectatorTimer = null;
  if (state.spectatorChannel && supabaseClient) {
    try { supabaseClient.removeChannel(state.spectatorChannel); } catch (error) { /* ignore */ }
    state.spectatorChannel = null;
  }
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
    if (state.powers.skip <= 0) { showToast(tr('استُخدم التخطّي في هذا السباق', 'Skip already used this race')); return; }
    state.powers.skip -= 1;
    updatePowers();
    clearRoundTimers();
    state.locked = true;
    ui.feedback.textContent = tr('تم تخطّي السؤال — لا نقاط ولا تقدّم في هذا السؤال', 'Question skipped — no points or progress');
    ui.feedback.className = 'answer-feedback';
    window.setTimeout(() => advanceQuestion(), 900);
  } else if (kind === 'freeze') {
    if (state.powers.freeze <= 0) { showToast(tr('استُخدم التجميد في هذا السباق', 'Freeze already used this race')); return; }
    if (state.mode === 'daily') { showToast(tr('لا خصم في تحدي اليوم لتجميده', 'No opponent to freeze in Daily Challenge')); return; }
    if (state.mode === 'campaign') { showToast(tr('لا خصم في الحملة الفردية لتجميده', 'No opponent to freeze in Solo Campaign')); return; }
    if (state.mode === 'online') { showToast(tr('لا يمكن تجميد خصم حقيقي — التجميد يعمل ضد الكمبيوتر فقط', 'Cannot freeze a live opponent — only works vs Computer')); return; }
    state.powers.freeze -= 1;
    state.frozenUntil = Date.now() + 5000;
    updatePowers();
    showToast(tr(`تم تجميد ${displayOpponent(state.opponentName)} 5 ثوانٍ ❄️`, `Froze ${displayOpponent(state.opponentName)} for 5s ❄️`));
  } else if (kind === 'double') {
    if (state.powers.double <= 0) { showToast(tr('استُخدمت المضاعفة في هذا السباق', 'Double already used this race')); return; }
    if (state.doubleNext) { showToast(tr('المضاعفة مفعّلة بالفعل للإجابة التالية', 'Double Points is already active')); return; }
    state.powers.double -= 1;
    state.doubleNext = true;
    updatePowers();
    showToast(tr('مضاعفة النقاط مفعّلة — أجب صحيحاً لتتضاعف نقاطك ×2', 'Double Points active — next correct answer scores ×2!'));
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
  ui.modalPrimary.textContent = tr('فهمت', 'Got it');
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
  ui.modalPrimary.textContent = tr('فهمت', 'Got it');
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
      secondary.type = 'button';
      secondary.className = 'ghost-button modal-secondary';
      secondary.dataset.action = 'confirm-secondary';
      ui.modal.querySelector('.modal-card').appendChild(secondary);
    }
    secondary.textContent = secondaryLabel;
    secondary.hidden = false;
  });
}

function openPrompt(title, message, defaultValue = '', placeholder = '', confirmLabel = '') {
  return new Promise((resolve) => {
    confirmResolver = (confirmed) => {
      if (confirmed !== true) {
        resolve(null);
        return;
      }
      const input = document.getElementById('modalPromptInput');
      resolve(input ? input.value : '');
    };
    const body = `
      <div class="modal-prompt-wrap">
        <p>${escapeHtml(message)}</p>
        <input type="text" id="modalPromptInput" class="modal-prompt-input" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}" />
      </div>
    `;
    openModal(title, body, 'info');
    ui.modalPrimary.textContent = confirmLabel || tr('تأكيد', 'Confirm');
    ui.modalPrimary.dataset.action = 'confirm-primary';
    let secondary = ui.modal.querySelector('.modal-secondary');
    if (!secondary) {
      secondary = document.createElement('button');
      secondary.type = 'button';
      secondary.className = 'ghost-button modal-secondary';
      secondary.dataset.action = 'confirm-secondary';
      ui.modal.querySelector('.modal-card').appendChild(secondary);
    }
    secondary.textContent = tr('إلغاء', 'Cancel');
    secondary.hidden = false;
    window.setTimeout(() => {
      const input = document.getElementById('modalPromptInput');
      if (input) {
        input.focus();
        input.select();
        input.onkeydown = (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            closeModal(true);
          }
        };
      }
    }, 30);
  });
}

function openHowToPlay() {
  openModal(
    tr('كيف تُلعب؟', 'How to Play'),
    tr(
      `<p>سباق من 10 أسئلة. لديك 15 ثانية لكل سؤال، وكل إجابة صحيحة تحركك خطوة على المضمار.</p><ul><li>أجب قبل الخصم لتحصل على 10 نقاط، وإلا 5 نقاط.</li><li>الإجابة الخاطئة توقف تقدمك في السؤال.</li><li>عند التعادل يُلعب سؤال فاصل مفاجئ حتى يحسم الفائز.</li><li>قدراتك (مرة في كل سباق): تخطّي سؤال صعب، تجميد الخصم 5 ثوانٍ، مضاعفة النقاط.</li><li>التحدي اليومي: 5 أسئلة جديدة كل يوم بمحاولة واحدة.</li><li>المراجع ظاهرة لكل سؤال حتى تبقى المعرفة دقيقة.</li></ul>`,
      `<p>A 10-question race with 15 seconds per question. Every right answer moves you forward on the track.</p><ul><li>Answer before your opponent to earn 10 points, otherwise 5 points.</li><li>A wrong answer pauses your progress on that question.</li><li>Ties trigger sudden-death tiebreaker rounds until a winner emerges.</li><li>Boosters (once per race): Skip question, Freeze opponent for 5s, Double points.</li><li>Daily Challenge: 5 fresh questions each day with one attempt.</li><li>Authentic Arabic sources remain visible for every question.</li></ul>`,
    ),
    'info',
  );
}

function openSources() {
  const counts = QUESTION_BANK.reduce((acc, question) => {
    acc[question.category] = (acc[question.category] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(counts).map(([category, count]) => `<div class="source-item"><strong>${isEn() ? (CAT_EN[category] || category) : category}</strong><span>${count} ${tr('سؤالاً', 'questions')}</span></div>`).join('');
  openModal(
    tr('المصادر المستخدمة', 'Sources Used'),
    tr(
      `<div class="source-list">${rows}</div><p>كل سؤال يذكر مرجعه داخل اللعبة: سورة وآية من القرآن الكريم، أو حديث من الصحيحين برقمه، أو مرجع من كتب السيرة والفقه والتاريخ.</p>`,
      `<div class="source-list">${rows}</div><p>Every question cites its Arabic reference inside the game: Quranic Surah & Ayah, numbered Hadith from Sahihayn, or established Seerah, Fiqh, and History works. (${countEnglishQuestions()} of ${QUESTION_BANK.length} questions currently include English translations.)</p>`,
    ),
    'book',
  );
}

function showQuestionSource() {
  const question = state.currentQuestion;
  if (!question) return;
  const enQ = isEn() && question.en && question.en.question
    ? `<p><b>${escapeHtml(question.en.question)}</b> <span class="translation-badge">Translation · ترجمة</span></p>`
    : '';
  openModal(
    tr('مرجع السؤال', 'Question Source'),
    `${enQ}<p dir="rtl"><b>${escapeHtml(question.question)}</b></p><p dir="rtl">${tr('المرجع', 'Source')}: ${escapeHtml(question.source)}</p><p>${tr('كل سؤال في اللعبة موثّق بمصدره العربي الأصلي.', 'Every question is documented with its original Arabic reference.')}</p>`,
    'book',
  );
}

async function openOnlineQuick() {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  if (!SUPABASE_CONFIGURED) {
    openModal(tr('🌐 مطابقة عشوائية', '🌐 Random Match'), `<div class="modal-loading"><span class="modal-spinner" aria-hidden="true"></span><p>${tr('جارٍ البحث عن خصم متصل…', 'Searching for an online opponent…')}</p></div>`, 'info');
    window.setTimeout(async () => {
      if (ui.modal.hidden) return;
      const playBot = await openConfirm(
        tr('🌐 اللعب عبر الإنترنت بانتظار بيانات Supabase', '🌐 Online Mode Awaiting Supabase'),
        tr('<p>لا يوجد خصم متصل بعد، واللعب عبر الإنترنت يحتاج بيانات مشروع Supabase. هل تريد اللعب ضد الكمبيوتر الآن؟</p>', '<p>No online opponent found yet, and online play requires Supabase project credentials. Play vs Computer now?</p>'),
        tr('العب ضد الكمبيوتر', 'Play vs Computer'),
        tr('لاحقاً', 'Later'),
      );
      if (playBot === true) startRace();
    }, 2500);
    return;
  }
  const client = await getSupabaseClient();
  if (!client) {
    showOfflineRequiredMessage();
    return;
  }
  const signedIn = await ensureSupabaseSignedIn('random');
  if (!signedIn) { showToast(tr('سجّل الدخول بـ Google أولاً للمطابقة العشوائية', 'Sign in with Google first for random matchmaking')); return; }
  openModal(tr('🌐 مطابقة عشوائية', '🌐 Random Match'), `<div class="modal-loading"><span class="modal-spinner" aria-hidden="true"></span><p>${tr('جارٍ البحث عن خصم متصل عبر Supabase…', 'Searching for an online opponent via Supabase…')}</p></div>`, 'info');
  const found = await sbFindRandomRoom();
  if (found.ok && found.room) {
    const matchRes = await sbCreateMatch(found.room, found.room.host_id, 'random');
    if (!matchRes.ok) { openModal(tr('🌐 تعذّرت المطابقة', '🌐 Match Failed'), `<p>${matchRes.reason || tr('حاول مجدداً', 'Try again')}</p>`, 'info'); return; }
    const hostName = await sbDisplayName(found.room.host_id);
    closeModal();
    startOnlineRace(found.room, matchRes.match, hostName, false);
    return;
  }
  if (found.ok === false) { openModal(tr('🌐 تعذّرت المطابقة', '🌐 Match Failed'), `<p>${found.reason || tr('حاول مجدداً', 'Try again')}</p>`, 'info'); return; }
  const created = await sbCreateRoom('random');
  if (!created.ok) { openModal(tr('🌐 تعذّرت المطابقة', '🌐 Match Failed'), `<p>${created.reason || tr('حاول مجدداً', 'Try again')}</p>`, 'info'); return; }
  openModal(
    tr('🌐 بانتظار خصم…', '🌐 Waiting for Opponent…'),
    tr('<p>أُنشئت غرفة مطابقة عشوائية. نبحث عن خصم متصل — ستبدأ المباراة فور انضمامه (حتى 60 ثانية).</p>', '<p>Matchmaking room created. Searching for an online opponent — race starts automatically when they join (up to 60s).</p>'),
    'info',
  );
  const waited = await waitForOpponent(created.room, 60);
  if (!waited.ok || !waited.match) {
    try { if (supabaseClient) await supabaseClient.from('rooms').delete().eq('id', created.room.id); } catch (error) { /* best-effort */ }
    const playBot = await openConfirm(
      tr('🌐 لم ينضم خصم بعد', '🌐 No Opponent Joined'),
      tr('<p>لم ينضم أي خصم خلال 60 ثانية. هل تريد اللعب ضد الكمبيوتر الآن؟</p>', '<p>No opponent joined within 60 seconds. Play against the computer instead?</p>'),
      tr('العب ضد الكمبيوتر', 'Play vs Computer'),
      tr('لاحقاً', 'Later'),
    );
    if (playBot === true) startRace();
    return;
  }
  const oppName = await sbDisplayName(waited.match.player2_id);
  closeModal();
  startOnlineRace(created.room, waited.match, oppName, true);
}
async function openRoom() {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  if (!SUPABASE_CONFIGURED) {
    const choice = await openConfirm(
      tr('🚪 غرف الأصدقاء', '🚪 Friends Rooms'),
      tr('<p>أنشئ غرفة خاصة برمز ورابط دعوة، أو انضم إلى غرفة برمز.</p><p>ملاحظة: الغرف عبر الإنترنت تحتاج بيانات مشروع Supabase؛ هذه الغرفة محلية على هذا الجهاز فقط.</p>', '<p>Create a private room with a code & invite link, or join with a code.</p><p>Note: Cross-device online rooms require Supabase credentials; this room is local to this device.</p>'),
      tr('إنشاء غرفة', 'Create Room'),
      tr('الانضمام برمز', 'Join with Code'),
    );
    if (choice === true) {
      const code = genRoomCode();
      const rooms = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]');
      rooms.push({ code, created: Date.now() });
      localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
      const link = `${location.origin}${location.pathname}?room=${code}`;
      try { await navigator.clipboard.writeText(link); } catch (error) { /* clipboard unavailable */ }
      const copy = await openConfirm(
        tr('✅ تم إنشاء الغرفة', '✅ Room Created'),
        tr(`<p>رمز الغرفة: <b>${code}</b></p><p>رابط الدعوة: <b>${link}</b></p><p>أُرسل الرابط إلى صديقك ليفتحه في متصفحه.</p>`, `<p>Room Code: <b>${code}</b></p><p>Invite Link: <b>${link}</b></p><p>Share this link with your friend.</p>`),
        tr('نسخ الرابط مجدداً', 'Copy Link Again'),
        tr('👁️ مشاهدة الغرفة', '👁️ Watch Room'),
      );
      if (copy === true) {
        try { await navigator.clipboard.writeText(link); showToast(tr('تم نسخ رابط الدعوة', 'Invite link copied')); } catch (error) { /* clipboard unavailable */ }
      } else if (copy === 'secondary') {
        startSpectatorMode(code);
      }
    } else if (choice === 'secondary') {
      const rawCode = await openPrompt(
        tr('🚪 الانضمام إلى غرفة', '🚪 Join a Room'),
        tr('أدخل رمز الغرفة (6 أحرف):', 'Enter 6-character room code:'),
        '',
        'ABC123',
        tr('انضمام', 'Join'),
      );
      const code = (rawCode || '').trim().toUpperCase();
      if (code) joinRoomByCode(code);
    }
    return;
  }
  const client = await getSupabaseClient();
  if (!client) {
    showOfflineRequiredMessage();
    return;
  }
  const signedIn = await ensureSupabaseSignedIn('room');
  if (!signedIn) { showToast(tr('سجّل الدخول بـ Google أولاً لإنشاء غرفة أو الانضمام إليها', 'Sign in with Google first to create or join a room')); return; }
  const choice = await openConfirm(
    tr('🚪 غرف الأصدقاء', '🚪 Friends Rooms'),
    `${tr('<p>أنشئ غرفة خاصة برمز ورابط دعوة عبر Supabase، أو انضم إلى غرفة صديق برمزها.</p>', '<p>Create a private room with a code & invite link via Supabase, or join a friend’s room.</p>')}<div style="margin-top:8px"><button type="button" class="ghost-button" data-action="spectate-room">👁️ ${tr('مشاهدة سباق مباشر', 'Watch a Live Race')}</button></div>`,
    tr('إنشاء غرفة', 'Create Room'),
    tr('الانضمام برمز', 'Join with Code'),
  );
  if (choice === true) {
    const created = await sbCreateRoom('friend');
    if (!created.ok) { openModal(tr('🚪 تعذّر إنشاء الغرفة', '🚪 Room Creation Failed'), `<p>${created.reason || tr('حاول مجدداً', 'Try again')}</p>`, 'info'); return; }
    const code = created.room.code;
    const link = `${location.origin}${location.pathname}?room=${code}`;
    try { await navigator.clipboard.writeText(link); } catch (error) { /* clipboard unavailable */ }
    const copy = await openConfirm(
      tr('✅ تم إنشاء الغرفة', '✅ Room Created'),
      tr(`<p>رمز الغرفة: <b>${code}</b></p><p>رابط الدعوة: <b>${link}</b></p><p>أُرسل الرابط إلى صديقك. ستبدأ المباراة فور انضمامه (بانتظار حتى دقيقتين).</p>`, `<p>Room Code: <b>${code}</b></p><p>Invite Link: <b>${link}</b></p><p>Share the link with your friend. The race starts once they join (waiting up to 2 minutes).</p>`),
      tr('نسخ الرابط مجدداً', 'Copy Link Again'),
      tr('إغلاق', 'Close'),
    );
    if (copy === true) {
      try { await navigator.clipboard.writeText(link); showToast(tr('تم نسخ رابط الدعوة', 'Invite link copied')); } catch (error) { /* clipboard unavailable */ }
    }
    openModal(tr('🚪 بانتظار صديقك…', '🚪 Waiting for Friend…'), `<div class="modal-loading"><span class="modal-spinner" aria-hidden="true"></span><p>${tr(`الغرفة <b>${code}</b> جاهزة. بانتظار انضمام صديقك (حتى دقيقتين)…`, `Room <b>${code}</b> is ready. Waiting for your friend to join (up to 2 min)…`)}</p></div>`, 'info');
    const waited = await waitForOpponent(created.room, 120);
    if (!waited.ok || !waited.match) { closeModal(); showToast(tr('لم ينضم أحد إلى الغرفة بعد', 'No one joined the room yet')); return; }
    const oppName = await sbDisplayName(waited.match.player2_id);
    closeModal();
    startOnlineRace(created.room, waited.match, oppName, true);
  } else if (choice === 'secondary') {
    const rawCode = await openPrompt(
      tr('🚪 الانضمام إلى غرفة', '🚪 Join a Room'),
      tr('أدخل رمز الغرفة (6 أحرف):', 'Enter 6-character room code:'),
      '',
      'ABC123',
      tr('انضمام', 'Join'),
    );
    const code = (rawCode || '').trim().toUpperCase();
    if (code) joinRoomByCode(code);
  }
}
async function joinRoomByCode(code) {
  if (!code) return;
  if (state.mode === 'online' && state.screen === 'race') return;
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  if (!SUPABASE_CONFIGURED) {
    const rooms = JSON.parse(localStorage.getItem(ROOMS_KEY) || '[]');
    const found = rooms.find((room) => room.code === code);
    if (found) openModal(tr('🚪 الغرفة موجودة', '🚪 Room Found'), tr(`<p>وجدنا الغرفة <b>${code}</b> على هذا الجهاز. الانضمام الفعلي للاعبين عبر الإنترنت يحتاج بيانات مشروع Supabase.</p>`, `<p>Found room <b>${code}</b> on this device. Online multiplayer requires Supabase project configuration.</p>`), 'info');
    else openModal(tr('🚪 الرمز غير موجود', '🚪 Room Not Found'), tr(`<p>لم نعثر على غرفة بالرمز <b>${code}</b> على هذا الجهاز. تأكد من الرمز وحاول مجدداً.</p>`, `<p>No room found with code <b>${code}</b> on this device. Please check the code.</p>`), 'info');
    return;
  }
  const client = await getSupabaseClient();
  if (!client) {
    showOfflineRequiredMessage();
    return;
  }
  const signedIn = await ensureSupabaseSignedIn(`join:${code}`);
  if (!signedIn) { showToast(tr('سجّل الدخول بـ Google أولاً للانضمام إلى غرفة', 'Sign in with Google first to join a room')); return; }
  const res = await sbJoinRoom(code);
  if (!res.ok) { openModal(tr('🚪 تعذّر الانضمام', '🚪 Join Failed'), `<p>${res.reason || tr('تأكد من الرمز وحاول مجدداً', 'Check the code and try again')}</p>`, 'info'); return; }
  const matchRes = await sbCreateMatch(res.room, res.room.host_id, 'friend');
  if (!matchRes.ok) { openModal(tr('🚪 تعذّر بدء المباراة', '🚪 Match Failed to Start'), `<p>${matchRes.reason || tr('حاول مجدداً', 'Try again')}</p>`, 'info'); return; }
  const hostName = await sbDisplayName(res.room.host_id);
  closeModal();
  startOnlineRace(res.room, matchRes.match, hostName, false);
}
async function openLeaderboard() {
  const medalFor = (pos) => (pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}.`);
  const localRows = () => {
    const history = loadHistory().sort((a, b) => b.score - a.score).slice(0, 5);
    return history.length
      ? history.map((h, i) => `<div class="source-item"><strong>${medalFor(i + 1)} ${h.score} ${tr('نقطة', 'pts')}</strong><span>${escapeHtml(h.mode || '')} · ${h.correct || 0} ${tr('إجابة صحيحة', 'correct')}</span></div>`).join('')
      : `<div class="empty-state">${tr('لا نتائج بعد — العب سباقاً لتظهر نتيجتك هنا.', 'No results yet — play a race to appear here.')}</div>`;
  };
  if (!isAppOnline() || !SUPABASE_CONFIGURED || !supabaseUser || supabaseUser.is_anonymous) {
    openModal(
      tr('🏆 لوحة الصدارة (محلية)', '🏆 Leaderboard (Local)'),
      `<div class="source-list">${localRows()}</div><p>${tr('لوحة الصدارة العالمية عبر Supabase تظهر عند الاتصال بالإنترنت وبعد ربط حساب Gmail.', 'Global leaderboard via Supabase is available online after linking a Gmail account.')}</p>`,
      'info',
    );
    return;
  }
  openModal(
    tr('🏆 لوحة الصدارة', '🏆 Leaderboard'),
    `<div class="modal-loading"><span class="modal-spinner" aria-hidden="true"></span><p>${tr('جارٍ تحميل الصدارة العالمية…', 'Loading global leaderboard…')}</p></div>`,
    'info',
  );
  const res = await sbFetchLeaderboard();
  if (!res.ok) {
    openModal(tr('🏆 لوحة الصدارة (محلية)', '🏆 Leaderboard (Local)'), `<div class="source-list">${localRows()}</div><p>${tr('تعذّر تحميل الصدارة العالمية:', 'Could not load global leaderboard:')} ${escapeHtml(res.reason || '')}</p>`, 'info');
    return;
  }
  const rows = res.rows.length
    ? res.rows.map((r, idx) => `<div class="source-item"><strong>${medalFor(r.rank_position || idx + 1)} ${escapeHtml(r.display_name || r.username || tr('لاعب', 'Player'))}</strong><span>${r.total_score || 0} ${tr('نقطة', 'pts')} · ${r.games_won || 0} ${tr('فوزاً', 'wins')} · ${tr('أفضل سلسلة', 'best streak')} ${r.best_streak || 0}</span></div>`).join('')
    : `<div class="empty-state">${tr('لا لاعبين بعد في الصدارة العالمية — كُن أولهم!', 'No players on the global leaderboard yet — be the first!')}</div>`;
  try {
    localStorage.setItem(DISCOVER_LB_CACHE_KEY, JSON.stringify((res.rows || []).slice(0, 5)));
    renderDiscoverSection();
  } catch (error) { /* ignore */ }
  openModal(tr('🏆 لوحة الصدارة العالمية', '🏆 Global Leaderboard'), `<div class="source-list">${rows}</div><p>${tr('مرتبة حسب النقاط والانتصارات من جدول profiles عبر Supabase.', 'Ranked by score and wins via Supabase.')}</p>`, 'info');
}
/* يفتح معرض تطبيقاتنا في المتصفح الخارجي، لا داخل WebView، حتى تعمل أزرار فتح التطبيقات في المعرض. */ function openOurApps() { window.open('https://apps-showcase.pages.dev', '_blank', 'noopener,noreferrer'); }
function openProfile() {
  const title = displayTitle(titleFor(profile.xp));
  const level = Math.floor(profile.xp / 250) + 1;
  const leagueInfo = getLeagueStatus();
  const achievements = (profile.achievements || []);
  const linked = isLinkedGoogleAccount();
  const linkedEmail = (profile.google && profile.google.email) || (supabaseUser && !supabaseUser.is_anonymous ? supabaseUser.email : '') || '';
  const enCount = countEnglishQuestions();
  const totalCount = QUESTION_BANK.length;
  const statusBadge = linked
    ? `<span class="account-status-badge linked">${tr(`✓ حساب Gmail مرتبط (${linkedEmail})`, `✓ Gmail Linked (${linkedEmail})`)}</span>`
    : `<span class="account-status-badge guest">${tr('👤 حساب ضيف · التقدّم محفوظ محلياً', '👤 Guest Account · Saved Locally')}</span>`;
  const accountBtn = linked
    ? `<button class="ghost-button" data-action="google-signin">${tr('إدارة حساب Google', 'Manage Google Account')}</button>`
    : `<button class="primary-button" id="linkGmailBtn" data-action="link-gmail">${tr('اربط حساب Gmail', 'Link Gmail Account')}</button>`;
  const enCounterBox = `
    <div class="en-counter-box">
      <span>🌐 ${tr(`عدد الأسئلة المتاحة بالإنجليزية: <strong>${enCount} من ${totalCount}</strong>`, `Questions available in English: <strong>${enCount} of ${totalCount}</strong>`)}</span>
      <div class="lang-switch" role="group" aria-label="${tr('تبديل اللغة', 'Switch language')}">
        <button type="button" class="lang-btn ${currentLang === 'ar' ? 'active' : ''}" data-action="set-lang" data-lang="ar">AR</button>
        <button type="button" class="lang-btn ${currentLang === 'en' ? 'active' : ''}" data-action="set-lang" data-lang="en">EN</button>
      </div>
    </div>
  `;
  const leagueBox = `
    <div class="profile-league-box">
      <div class="profile-league-head">
        <strong>${leagueInfo.league.icon} ${tr(`دوري ${leagueInfo.league.name} (${leagueInfo.league.en})`, `${leagueInfo.league.en} League`)}</strong>
        <span class="league-zone-chip ${leagueInfo.zone}">${leagueInfo.zoneLabel}</span>
      </div>
      <div class="xp-row"><div><span>${tr('تقدّم الدوري', 'League Progress')}</span><b>${leagueInfo.nextText}</b></div><div class="progress-track league-track"><span style="width: ${leagueInfo.progressPct}%"></span></div></div>
      <button type="button" class="ghost-button" data-action="open-leagues">${tr('🏅 عرض الدوريات الـ 8 وتقييم الموسم', '🏅 View 8 Leagues & Season Settlement')}</button>
    </div>
  `;
  const initial = displayProfileName().trim().charAt(0).toUpperCase() || tr('ض', 'G');
  const avatarPicker = `
    <div class="customizer-box">
      <strong class="customizer-title">🎨 ${tr('اختر الأفاتار (8 رموز وألوان)', 'Choose Avatar (8 icons & colors)')}</strong>
      <div class="avatar-grid">${AVATARS.map((av) => `
        <button type="button" class="avatar-option ${(profile.avatarId || 'default') === av.id ? 'active' : ''}" data-action="select-avatar" data-avatar-id="${av.id}">
          <span class="avatar-dot" style="background: ${av.bg}">${av.icon || initial}</span>
          <span>${tr(av.ar, av.en)}</span>
        </button>
      `).join('')}</div>
    </div>
  `;
  const companionPicker = `
    <div class="customizer-box">
      <strong class="customizer-title">🤝 ${tr('شخصية الرفيق المشجّع', 'Encouraging Companion')}</strong>
      <div class="companion-grid">${COMPANIONS.map((c) => `
        <button type="button" class="companion-option ${(profile.companionId || 'siraj') === c.id ? 'active' : ''}" data-action="select-companion" data-companion-id="${c.id}">
          <span>${c.icon}</span>
          <span>${tr(c.ar, c.en)}</span>
        </button>
      `).join('')}</div>
    </div>
  `;
  const ach = ACHIEVEMENTS.map((a) => {
    const unlocked = achievements.includes(a.id);
    const achTitle = isEn() && ACH_EN[a.id] ? ACH_EN[a.id].title : a.title;
    const achDesc = isEn() && ACH_EN[a.id] ? ACH_EN[a.id].desc : a.desc;
    return `<div class="ach-item ${unlocked ? 'unlocked' : 'locked'}"><span>${a.icon}</span><div><strong>${achTitle}</strong><small>${achDesc}</small></div><b>${unlocked ? '✓' : '🔒'}</b></div>`;
  }).join('');
  const kpiGrid = `
    <div class="profile-kpi-grid">
      <div class="profile-kpi-card"><strong>${profile.xp}</strong><span>${tr('نقاط الخبرة', 'XP')}</span></div>
      <div class="profile-kpi-card"><strong>${profile.games}</strong><span>${tr('السباقات', 'Races')}</span></div>
      <div class="profile-kpi-card"><strong>${profile.wins}</strong><span>${tr('الانتصارات', 'Wins')}</span></div>
      <div class="profile-kpi-card"><strong>${profile.bestStreak}</strong><span>${tr('أفضل سلسلة', 'Best Streak')}</span></div>
    </div>
  `;
  openModal(
    tr('👤 ملف اللاعب واللغة', '👤 Player Profile & Settings'),
    `<div class="profile-sheet">${statusBadge}<p><b>${escapeHtml(displayProfileName())}</b> · ${tr('اللقب', 'Title')}: ${title} · ${tr('المستوى', 'Level')} ${level}</p>${kpiGrid}${enCounterBox}${avatarPicker}${companionPicker}${leagueBox}<div class="ach-grid">${ach}</div><div class="profile-actions">${accountBtn}<button type="button" class="ghost-button" data-action="edit-name">${tr('تعديل الاسم', 'Edit Name')}</button><button type="button" class="ghost-button" data-action="enable-notifications">${tr('تفعيل الإشعارات', 'Enable Notifications')}</button><button type="button" class="ghost-button" data-action="open-our-apps">${tr('📱 تطبيقاتنا', '📱 Our Apps')}</button></div><p class="app-version-footer"><small>${tr('الإصدار v1.5.0', 'Version v1.5.0')}</small></p></div>`,
    'info',
  );
}

function playAsGuest() {
  if (!isLinkedGoogleAccount()) {
    profile.isGuest = true;
    if (!profile.name) profile.name = 'ضيف';
    saveProfile();
    updateHomeStats();
  }
  showToast(tr('بدأت اللعب كضيف — تقدّمك محفوظ محلياً على جهازك', 'Playing as Guest — progress saved locally on your device'));
  startRace();
  trySupabaseAnonymousSignIn();
}

async function linkGmailAccount() {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  try {
    localStorage.setItem(GUEST_LINK_KEY, JSON.stringify({
      xp: profile.xp || 0,
      wins: profile.wins || 0,
      games: profile.games || 0,
      totalAnswered: profile.totalAnswered || 0,
      totalCorrect: profile.totalCorrect || 0,
      bestStreak: profile.bestStreak || 0,
      achievements: profile.achievements || [],
      campaign: campaignState,
      league: leagueState,
      name: profile.name || 'ضيف',
    }));
  } catch (error) { /* ignore */ }

  if (SUPABASE_CONFIGURED) {
    const client = await getSupabaseClient();
    if (!client) {
      showOfflineRequiredMessage();
      return;
    }
    try { sessionStorage.setItem('sibaq-pending-action', 'link-gmail'); } catch (error) { /* ignore */ }
    const redirectTo = `${location.origin}${location.pathname}`;
    if (supabaseUser && supabaseUser.is_anonymous && client.auth && typeof client.auth.linkIdentity === 'function') {
      try {
        const { error } = await client.auth.linkIdentity({ provider: 'google', options: { redirectTo } });
        if (!error) return;
      } catch (error) { /* fall back to standard OAuth signIn */ }
    }
    const res = await signInWithGoogleSupabase();
    if (!res.ok) openModal(tr('ربط حساب Gmail', 'Link Gmail Account'), `<p>${tr('تعذّر بدء الربط:', 'Could not start linking:')} ${res.reason || ''}</p>`, 'info');
    return;
  }
  openGoogleSignIn();
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
    profile.isGuest = false;
    profile.google = { email: payload.email || '', name: payload.name || '' };
    try { localStorage.removeItem(GUEST_LINK_KEY); } catch (error) { /* ignore */ }
    saveProfile();
    closeModal();
    updateHomeStats();
    showToast(tr(`أهلاً ${payload.name || 'بك'}! تم ربط حساب Gmail وحفظ تقدّمك`, `Welcome ${payload.name || ''}! Gmail linked & progress saved`));
  } catch (error) {
    showToast(tr('تعذّر إكمال تسجيل الدخول', 'Could not complete sign-in'));
  }
}

async function openGoogleSignIn() {
  if (!isAppOnline()) {
    showOfflineRequiredMessage();
    return;
  }
  if (SUPABASE_CONFIGURED) {
    if (supabaseUser && !supabaseUser.is_anonymous) {
      const out = await openConfirm(
        tr('تسجيل الدخول بـ Google', 'Google Sign-In'),
        tr(`<p>أنت مسجّل الدخول بحساب <b>${supabaseUser.email || ''}</b> عبر Supabase.</p>`, `<p>Signed in as <b>${supabaseUser.email || ''}</b> via Supabase.</p>`),
        tr('تسجيل الخروج', 'Sign Out'),
        tr('إغلاق', 'Close'),
      );
      if (out === true) {
        const client = await getSupabaseClient();
        if (client) await client.auth.signOut();
        supabaseUser = null;
        profile.isGuest = true;
        profile.google = null;
        saveProfile();
        showToast(tr('تم تسجيل الخروج', 'Signed out'));
        updateHomeStats();
      }
      return;
    }
    const res = await signInWithGoogleSupabase();
    if (!res.ok) openModal(tr('تسجيل الدخول بـ Google', 'Google Sign-In'), `<p>${tr('تعذّر بدء تسجيل الدخول:', 'Could not start sign-in:')} ${res.reason || ''}</p>`, 'info');
    return;
  }
  if (!GOOGLE_CONFIGURED) {
    openModal(tr('تسجيل الدخول بـ Google', 'Google Sign-In'), tr('<p>الدخول بـ Google (Gmail فقط، لا دخول برقم هاتف) غير مفعّل بعد — أضف بيانات Supabase في config.js أولاً.</p>', '<p>Google Sign-In (Gmail only) is not configured yet — add Supabase keys to config.js first.</p>'), 'info');
    return;
  }
  openModal(tr('تسجيل الدخول بـ Google', 'Google Sign-In'), `<p>${tr('سجّل الدخول بحساب Google الخاص بك:', 'Sign in with your Google account:')}</p><div id="gsiButton"></div>`, 'info');
  loadGsi().then(() => {
    window.google.accounts.id.initialize({ client_id: SIBAQ_CONFIG.GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    window.google.accounts.id.renderButton(document.getElementById('gsiButton'), { theme: 'outline', size: 'large', width: 280 });
  }).catch(() => showToast(tr('تعذّر تحميل خدمة Google', 'Could not load Google Sign-In')));
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
  document.documentElement.dataset.theme = next;
  localStorage.setItem('sibaq-theme', next);
  showToast(next === 'light' ? tr('تم تفعيل الوضع الفاتح', 'Light mode enabled') : tr('تم تفعيل الوضع الليلي', 'Dark mode enabled'));
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const actionTarget = event.target.closest('[data-action]');
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'set-lang') {
        const reopenProfile = !ui.modal.hidden && actionTarget.closest('#modalBody');
        setLanguage(actionTarget.dataset.lang);
        if (reopenProfile) openProfile();
      } else if (action === 'start-race') startRace();
      else if (action === 'play-guest') playAsGuest();
      else if (action === 'open-campaign') openCampaign();
      else if (action === 'play-next-campaign') startCampaignLevel(campaignState.unlockedLevel);
      else if (action === 'play-campaign-level') startCampaignLevel(Number(actionTarget.dataset.level));
      else if (action === 'next-campaign-level') startCampaignLevel(Math.min(CAMPAIGN_TOTAL_LEVELS, (state.campaignLevel || campaignState.unlockedLevel) + 1));
      else if (action === 'replay-campaign-level') startCampaignLevel(state.campaignLevel || campaignState.unlockedLevel);
      else if (action === 'open-hifz') openHifz();
      else if (action === 'start-hifz') startHifzPractice(actionTarget.dataset.hifzType || 'all');
      else if (action === 'replay-hifz') startHifzPractice(state.hifzType || 'all');
      else if (action === 'toggle-hifz-surah') toggleHifzSurah(actionTarget.dataset.surahId);
      else if (action === 'toggle-kids') toggleKidsMode();
      else if (action === 'open-quests') openQuestsModal();
      else if (action === 'claim-quest') claimQuest(actionTarget.dataset.questId);
      else if (action === 'open-wheel') openSpinWheelModal();
      else if (action === 'spin-wheel') spinDailyWheel();
      else if (action === 'select-avatar') selectAvatar(actionTarget.dataset.avatarId);
      else if (action === 'select-companion') selectCompanion(actionTarget.dataset.companionId);
      else if (action === 'open-teams') openTeamsModal();
      else if (action === 'pick-team-avatar') {
        selectedTeamAvatarId = actionTarget.dataset.avatarId || 'shield';
        openTeamsModal();
      } else if (action === 'create-team') {
        const nameEl = document.getElementById('teamNameInput');
        createTeam(nameEl ? nameEl.value : '', selectedTeamAvatarId);
      } else if (action === 'join-team') {
        const codeEl = document.getElementById('teamCodeInput');
        joinTeamByCode(codeEl ? codeEl.value : '');
      } else if (action === 'add-team-member') {
        openPrompt(
          tr('➕ إضافة عضو للفريق', '➕ Add Team Member'),
          tr('اسم العضو الجديد في الفريق:', 'New teammate name:'),
          '',
          tr('اسم العضو', 'Member name'),
          tr('إضافة', 'Add'),
        ).then((mName) => {
          if (mName && mName.trim()) addLocalTeamMember(mName.trim());
        });
      } else if (action === 'copy-team-code' && teamState) {
        try { navigator.clipboard.writeText(teamState.code); } catch (e) { /* ignore */ }
        showToast(tr(`تم نسخ رمز الفريق: ${teamState.code}`, `Copied team code: ${teamState.code}`));
      } else if (action === 'leave-team') leaveTeam();
      else if (action === 'start-team-battle' || action === 'replay-team-battle') startTeamBattle();
      else if (action === 'play-category') startRace('سراج', 'training', null, actionTarget.dataset.category);
      else if (action === 'open-teacher') openTeacherScreen();
      else if (action === 'teacher-role') switchTeacherRole(actionTarget.dataset.role);
      else if (action === 'create-teacher-session') createTeacherSession();
      else if (action === 'next-teacher-question') nextTeacherQuestion();
      else if (action === 'copy-teacher-code' && teacherState.hostCode) {
        try { navigator.clipboard.writeText(teacherState.hostCode); } catch (e) { /* ignore */ }
        showToast(tr(`تم نسخ رمز المعلم: ${teacherState.hostCode}`, `Copied code: ${teacherState.hostCode}`));
      } else if (action === 'join-teacher-session') {
        const cEl = document.getElementById('teacherJoinCodeInput');
        const nEl = document.getElementById('teacherStudentNameInput');
        joinTeacherSession(cEl ? cEl.value : '', nEl ? nEl.value : '');
      } else if (action === 'answer-teacher-question') {
        submitStudentAnswer(Number(actionTarget.dataset.answerIndex));
      } else if (action === 'spectate-room') openSpectatorModal();
      else if (action === 'open-leagues') openLeaguesModal();
      else if (action === 'settle-season') { closeModal(); evaluateSeasonSettlement(true); }
      else if (action === 'start-online') openOnlineQuick();
      else if (action === 'start-room') openRoom();
      else if (action === 'start-tournament') startTournament();
      else if (action === 'start-daily') startDaily();
      else if (action === 'home') { clearRoundTimers(); showScreen('home'); }
      else if (action === 'theme') toggleTheme();
      else if (action === 'how-to-play') openHowToPlay();
      else if (action === 'open-sources') openSources(); else if (action === 'open-our-apps') openOurApps();
      else if (action === 'show-question-source') showQuestionSource();
      else if (action === 'close-modal') closeModal();
      else if (action === 'confirm-primary') closeModal(true);
      else if (action === 'confirm-secondary') closeModal('secondary');
      else if (action === 'quit-race') {
        clearRoundTimers();
        state.spectating = false;
        if (ui.race) ui.race.classList.remove('is-spectating');
        if (ui.spectatorBanner) ui.spectatorBanner.hidden = true;
        showScreen(state.mode === 'campaign' ? 'campaign' : state.mode === 'hifz' ? 'hifz' : 'home');
      }
      else if (action === 'locked-mode') showToast(tr('هذا النمط جزء من المرحلة الثانية — جرّب نمط التدريب الآن', 'This mode unlocks soon — try Practice now'));
      else if (action === 'open-leaderboard') openLeaderboard();
      else if (action === 'open-profile') openProfile();
      else if (action === 'google-signin') openGoogleSignIn();
      else if (action === 'link-gmail') linkGmailAccount();
      else if (action === 'enable-notifications') enableNotifications();
      else if (action === 'edit-name') {
        openPrompt(
          tr('✏️ تعديل اسم اللاعب', '✏️ Edit Player Name'),
          tr('ما اسمك؟', 'What is your name?'),
          displayProfileName(),
          tr('أدخل اسمك', 'Enter your name'),
          tr('حفظ', 'Save'),
        ).then((name) => {
          if (name && name.trim()) {
            profile.name = name.trim();
            saveProfile();
            updateHomeStats();
            openProfile();
          }
        });
      } else if (action === 'use-power-skip') usePower('skip');
      else if (action === 'use-power-freeze') usePower('freeze');
      else if (action === 'use-power-double') usePower('double');
      else if (action === 'next-question') advanceQuestion();
      else if (action === 'confirm-order') answerOrder();
    }
    const answer = event.target.closest('.answer-button');
    if (answer && !answer.dataset.action) {
      if (answer.classList.contains('order-button')) pickOrder(Number(answer.dataset.answerIndex), answer);
      else handleAnswer(Number(answer.dataset.answerIndex));
    }
  });
  ui.modal.addEventListener('click', (event) => {
    if (event.target === ui.modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !ui.modal.hidden) closeModal();
    if ((event.key === 'Enter' || event.key === ' ') && event.target && event.target.matches('[role="button"][data-action]')) {
      event.preventDefault();
      event.target.click();
    }
  });
  if (teacherBroadcast) {
    teacherBroadcast.onmessage = (event) => {
      if (event && event.data && event.data.type === 'teacher-session' && event.data.session) {
        saveTeacherSessionRecord(event.data.session);
        if (state.screen === 'teacher') renderTeacherScreen();
      }
    };
  }
  window.addEventListener('storage', (event) => {
    if (event && event.key === TEACHER_SESSIONS_KEY && state.screen === 'teacher') {
      renderTeacherScreen();
    }
  });
  window.addEventListener('online', () => {
    updateConnectionStatus();
    mergeRemoteQuestions();
    showToast(tr('عاد الاتصال بالإنترنت ✓', 'Back online ✓'));
  });
  window.addEventListener('offline', () => {
    updateConnectionStatus();
    showToast(tr('أنت الآن في وضع عدم الاتصال — الحملة والتدريب والتحدي اليومي متاحة', 'You are offline — Campaign, Practice & Daily Challenge remain ready'));
  });
}

function boot() {
  loadCachedRemoteQuestions();
  validateQuestionBank();
  checkSeasonRolloverOnBoot();
  refreshSupabaseSession();
  mergeRemoteQuestions();
  const savedTheme = localStorage.getItem('sibaq-theme');
  const initialTheme = savedTheme === 'light' ? 'light' : 'dark';
  ui.shell.dataset.theme = initialTheme;
  document.documentElement.dataset.theme = initialTheme;
  applyKidsMode();
  applyLanguageToDOM();
  bindEvents();
  showScreen('home');
  const params = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    window.setTimeout(() => {
      showToast(tr(`وصلتك دعوة غرفة: ${roomCode}`, `Room invite received: ${roomCode}`));
      joinRoomByCode(roomCode.toUpperCase());
    }, 600);
  }
  console.info(`سباق المعلومات جاهز — ${QUESTION_BANK.length} سؤالاً (${countEnglishQuestions()} بالإنجليزية). حالة الشبكة: ${networkAdapter.status()}`);
}

window.sibaqDebug = { questionBank: QUESTION_BANK, HIFZ_QUESTIONS, state, campaignState, leagueState, hifzState, questsState, teamState, discoverStats, teacherState, LEAGUES, CAMPAIGN_TOTAL_LEVELS, countEnglishQuestions, setLanguage, toggleKidsMode, openHifz, openQuestsModal, openSpinWheelModal, openTeamsModal, openTeacherScreen, startSpectatorMode, validateQuestionBank, network: networkAdapter };
boot();

// ===== مشاركة النتيجة كصورة (v1.3) =====
// رسم صورة النتيجة لمشاركتها (Canvas 2D فقط — يعمل دون إنترنت وداخل غلاف Capacitor)
function drawResultCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const playerWon = state.playerProgress > state.opponentProgress || (state.playerProgress === state.opponentProgress && state.playerScore >= state.opponentScore);
  const isTie = state.mode !== 'campaign' && state.playerProgress === state.opponentProgress && state.playerScore === state.opponentScore;
  const title = state.mode === 'campaign'
    ? (playerWon ? tr(`🏆 اجتزت المستوى ${state.campaignLevel}!`, `🏆 Passed Level ${state.campaignLevel}!`) : tr(`🥈 المستوى ${state.campaignLevel} — حاول مجدداً`, `🥈 Level ${state.campaignLevel} — Try Again`))
    : isTie ? tr('🤝 تعادل في سباق المعلومات', '🤝 Draw in Knowledge Race') : playerWon ? tr('🏆 فزت في سباق المعلومات!', '🏆 Won Knowledge Race!') : tr('🥈 خسرت في سباق المعلومات', '🥈 Tough Race in Knowledge Race');
  const bg = ctx.createLinearGradient(0, 0, 800, 1000);
  bg.addColorStop(0, '#0B3D2E');
  bg.addColorStop(1, '#07231B');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 800, 1000);
  ctx.strokeStyle = '#B88918';
  ctx.lineWidth = 10;
  ctx.strokeRect(20, 20, 760, 960);
  ctx.strokeStyle = 'rgba(184, 137, 24, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(38, 38, 724, 924);
  ctx.font = 'bold 36px Cairo, "Segoe UI", sans-serif';
  ctx.fillStyle = '#FFD700';
  ctx.textAlign = 'center';
  ctx.fillText(tr('✨ سباق المعلومات الإسلامي ✨', '✨ Islamic Knowledge Race ✨'), 400, 110);
  ctx.font = 'bold 44px Cairo, "Segoe UI", sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(title, 400, 190);
  ctx.fillStyle = 'rgba(13, 78, 60, 0.9)';
  ctx.fillRect(70, 230, 660, 480);
  ctx.strokeStyle = '#B88918';
  ctx.lineWidth = 3;
  ctx.strokeRect(70, 230, 660, 480);
  const playerName = displayProfileName() || tr('الباحث', 'Player');
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 40px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(playerName, 400, 300);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 64px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(state.playerScore + tr(' نقطة', ' pts'), 400, 375);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 30px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(tr('— ضد —', '— vs —'), 400, 435);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 40px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(displayOpponent(state.opponentName) || tr('المنافس', 'Opponent'), 400, 500);
  ctx.fillStyle = '#00E5FF';
  ctx.font = 'bold 64px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(state.opponentScore + tr(' نقطة', ' pts'), 400, 575);
  const raceTotal = state.raceTotal || 10;
  const correct = state.correct || 0;
  const accuracy = Math.round((correct / raceTotal) * 100);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '28px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(tr('عدد الأسئلة: ' + raceTotal + ' | إجابات صحيحة: ' + correct, 'Questions: ' + raceTotal + ' | Correct: ' + correct), 400, 650);
  ctx.fillText(tr('أفضل سلسلة: ' + (profile.bestStreak || 0) + ' | نسبة الدقة: ' + accuracy + '%', 'Best Streak: ' + (profile.bestStreak || 0) + ' | Accuracy: ' + accuracy + '%'), 400, 695);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 30px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(tr('سباق المعلومات الإسلامي', 'Islamic Knowledge Race'), 400, 810);
  ctx.fillStyle = '#CCCCCC';
  ctx.font = '24px Cairo, "Segoe UI", sans-serif';
  ctx.fillText(new Date().toLocaleDateString(tr('ar-SA', 'en-US')), 400, 855);
  return canvas;
}

async function shareResultImage() {
  try {
    const canvas = drawResultCanvas();
    if (!canvas) {
      showToast(tr('تعذر إنشاء صورة النتيجة', 'Could not create result image'));
      return;
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      showToast(tr('تعذر إنشاء صورة النتيجة', 'Could not create result image'));
      return;
    }
    const file = new File([blob], 'sibaq-result.png', { type: 'image/png' });
    const shareData = {
      files: [file],
      title: tr('نتيجة سباق المعلومات الإسلامي', 'Islamic Knowledge Race Result'),
      text: tr('🏆 حققت ' + state.playerScore + ' نقطة في سباق المعلومات الإسلامي', '🏆 I scored ' + state.playerScore + ' points in Knowledge Race!'),
    };
    if (navigator.canShare && navigator.canShare(shareData)) {
      await navigator.share(shareData);
      showToast(tr('تمت مشاركة النتيجة بنجاح', 'Result shared successfully'));
      return;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast(tr('تم إلغاء المشاركة', 'Share cancelled'));
      return;
    }
    console.warn('Share error:', err);
  }
  try {
    const canvas = drawResultCanvas();
    const url = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve, 'image/png')));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sibaq-result.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(tr('تم تحميل صورة النتيجة (sibaq-result.png)', 'Result image downloaded (sibaq-result.png)'));
  } catch (err) {
    console.error('Share result failed', err);
    showToast(tr('تعذر مشاركة النتيجة، حاول مرة أخرى', 'Could not share result, please try again'));
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('#shareResultBtn') : null;
  if (btn) shareResultImage();
});
