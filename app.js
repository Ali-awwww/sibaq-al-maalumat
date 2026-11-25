const QUESTION_BANK = [
  { id: 1, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما أول سورة في ترتيب المصحف؟', options: ['الفاتحة', 'البقرة', 'الإخلاص', 'الناس'], correct: 0, source: 'سورة الفاتحة، ترتيب المصحف' },
  { id: 2, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'ما أطول سورة في القرآن الكريم؟', options: ['آل عمران', 'البقرة', 'النساء', 'المائدة'], correct: 1, source: 'سورة البقرة، ترتيب السور' },
  { id: 3, category: 'القرآن', difficulty: 'سهل', type: 'mcq', question: 'كم عدد سور القرآن الكريم؟', options: ['110 سور', '112 سورة', '114 سورة', '120 سورة'], correct: 2, source: 'المصحف الشريف، عدّ السور' },
  { id: 4, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'في أي شهر أنزل القرآن؟', options: ['رجب', 'شعبان', 'رمضان', 'ذو الحجة'], correct: 2, source: 'سورة البقرة، الآية 185' },
  { id: 5, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'ما السورة التي لا تبدأ بالبسملة؟', options: ['الأنفال', 'التوبة', 'يونس', 'هود'], correct: 1, source: 'سورة التوبة، افتتاح السورة' },
  { id: 6, category: 'القرآن', difficulty: 'متوسط', type: 'mcq', question: 'في أي سورة توجد آية الكرسي؟', options: ['آل عمران', 'طه', 'البقرة', 'الرحمن'], correct: 2, source: 'سورة البقرة، الآية 255' },
  { id: 7, category: 'الفقه', difficulty: 'سهل', type: 'boolean', question: 'الصلوات المفروضة في اليوم والليلة خمس صلوات.', options: ['صحيح', 'خطأ'], correct: 0, source: 'حديث جبريل، صحيح مسلم، حديث 8' },
  { id: 8, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'إلى أي جهة يتوجه المسلمون في الصلاة؟', options: ['المسجد الأقصى', 'الكعبة المشرفة', 'جبل عرفات', 'المدينة المنورة'], correct: 1, source: 'سورة البقرة، الآيات 144–150' },
  { id: 9, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'ما الشهر الذي يصومه المسلمون فرضاً؟', options: ['محرم', 'رمضان', 'شوال', 'ذو القعدة'], correct: 1, source: 'سورة البقرة، الآية 185' },
  { id: 10, category: 'الفقه', difficulty: 'متوسط', type: 'boolean', question: 'صلاة الجمعة تؤدى جماعة في يوم الجمعة.', options: ['صحيح', 'خطأ'], correct: 0, source: 'سورة الجمعة، الآيتان 9–10' },
  { id: 11, category: 'الفقه', difficulty: 'متوسط', type: 'mcq', question: 'ما العبادة التي تسبقها الطهارة غالباً؟', options: ['الصلاة', 'الصدقة', 'الصيام', 'الحج'], correct: 0, source: 'سورة المائدة، الآية 6' },
  { id: 12, category: 'الفقه', difficulty: 'سهل', type: 'mcq', question: 'ما الركن الرابع من أركان الإسلام في الحديث المشهور؟', options: ['إيتاء الزكاة', 'صوم رمضان', 'حج البيت', 'إقامة الصلاة'], correct: 1, source: 'صحيح البخاري، حديث 8؛ صحيح مسلم، حديث 16' },
  { id: 13, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'أين نزل أول الوحي على النبي محمد ﷺ؟', options: ['غار ثور', 'غار حراء', 'مسجد قباء', 'جبل عرفات'], correct: 1, source: 'صحيح البخاري، كتاب بدء الوحي، حديث 3' },
  { id: 14, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'ما أول كلمة نزلت من الوحي؟', options: ['سبّح', 'اقرأ', 'قم', 'قل'], correct: 1, source: 'سورة العلق، الآيات 1–5؛ صحيح البخاري، حديث 3' },
  { id: 15, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'في أي مدينة وُلد النبي محمد ﷺ؟', options: ['المدينة المنورة', 'الطائف', 'مكة المكرمة', 'القدس'], correct: 2, source: 'كتب السيرة النبوية المعتمدة، باب مولده ﷺ' },
  { id: 16, category: 'السيرة', difficulty: 'سهل', type: 'mcq', question: 'إلى أي مدينة هاجر النبي ﷺ من مكة؟', options: ['الطائف', 'المدينة المنورة', 'خيبر', 'دمشق'], correct: 1, source: 'السيرة النبوية؛ سورة التوبة، الآية 40' },
  { id: 17, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'من صاحب النبي ﷺ في الهجرة؟', options: ['عمر بن الخطاب', 'علي بن أبي طالب', 'أبو بكر الصديق', 'عثمان بن عفان'], correct: 2, source: 'سورة التوبة، الآية 40؛ صحيح البخاري، حديث 3905' },
  { id: 18, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'ما اسم أول مسجد بناه النبي ﷺ عند قدومه إلى المدينة؟', options: ['المسجد النبوي', 'مسجد قباء', 'المسجد الحرام', 'مسجد القبلتين'], correct: 1, source: 'صحيح البخاري، كتاب فضل الصلاة في مسجد مكة والمدينة' },
  { id: 19, category: 'السيرة', difficulty: 'متوسط', type: 'mcq', question: 'في أي غار اختبأ النبي ﷺ وأبو بكر أثناء الهجرة؟', options: ['حراء', 'ثور', 'أحد', 'الصفا'], correct: 1, source: 'سورة التوبة، الآية 40؛ كتب السيرة' },
  { id: 20, category: 'السيرة', difficulty: 'صعب', type: 'mcq', question: 'في أي سنة هجرية كان فتح مكة؟', options: ['2 هـ', '5 هـ', '8 هـ', '10 هـ'], correct: 2, source: 'كتب السيرة النبوية، غزوة فتح مكة' },
  { id: 21, category: 'الحديث', difficulty: 'سهل', type: 'mcq', question: 'ما أول الأعمال بالنيات كما في الحديث المشهور؟', options: ['الأعمال بالنيات', 'الأعمال بالأموال', 'الأعمال بالأقوال', 'الأعمال بالعدد'], correct: 0, source: 'صحيح البخاري، كتاب بدء الوحي، حديث 1؛ صحيح مسلم، حديث 1907' },
  { id: 22, category: 'الحديث', difficulty: 'سهل', type: 'boolean', question: 'بُني الإسلام على خمسة أركان.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح البخاري، حديث 8؛ صحيح مسلم، حديث 16' },
  { id: 23, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'من الصحابي المعروف بكثرة رواية الحديث؟', options: ['أبو هريرة', 'أبو ذر الغفاري', 'سعد بن أبي وقاص', 'زيد بن ثابت'], correct: 0, source: 'كتب تراجم الصحابة، ترجمة أبي هريرة رضي الله عنه' },
  { id: 24, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'من الملك الذي جاء في حديث جبريل عليه السلام؟', options: ['ميكائيل', 'إسرافيل', 'جبريل', 'ملك الموت'], correct: 2, source: 'صحيح مسلم، حديث 8' },
  { id: 25, category: 'الحديث', difficulty: 'سهل', type: 'boolean', question: 'حديث «إنما الأعمال بالنيات» رواه البخاري ومسلم.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح البخاري، حديث 1؛ صحيح مسلم، حديث 1907' },
  { id: 26, category: 'الحديث', difficulty: 'متوسط', type: 'mcq', question: 'ما العمل الذي وُصف بأنه من الإيمان في حديث «الإيمان بضع وسبعون شعبة»؟', options: ['إماطة الأذى عن الطريق', 'كثرة السفر', 'جمع المال', 'رفع الصوت'], correct: 0, source: 'صحيح مسلم، حديث 35' },
  { id: 27, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'ما الاسم القديم للمدينة المنورة؟', options: ['يثرب', 'بصرى', 'تبوك', 'نجران'], correct: 0, source: 'سورة الأحزاب، الآية 13' },
  { id: 28, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'في أي سنة هجرية وقعت غزوة بدر الكبرى؟', options: ['1 هـ', '2 هـ', '3 هـ', '4 هـ'], correct: 1, source: 'كتب السيرة والتاريخ الإسلامي، غزوة بدر' },
  { id: 29, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'ماذا سُمّي المسلمون الذين هاجروا من مكة إلى المدينة؟', options: ['الأنصار', 'المهاجرون', 'التابعون', 'أهل الذمة'], correct: 1, source: 'سورة الحشر، الآيتان 8–9' },
  { id: 30, category: 'التاريخ', difficulty: 'متوسط', type: 'mcq', question: 'ماذا سُمّي أهل المدينة الذين نصروا المهاجرين؟', options: ['الأنصار', 'المهاجرون', 'الأحبار', 'المرابطون'], correct: 0, source: 'سورة الحشر، الآيتان 8–9' },
  { id: 31, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'من أول الخلفاء الراشدين؟', options: ['عمر بن الخطاب', 'أبو بكر الصديق', 'عثمان بن عفان', 'علي بن أبي طالب'], correct: 1, source: 'التاريخ الإسلامي المبكر، الخلافة الراشدة' },
  { id: 32, category: 'التاريخ', difficulty: 'سهل', type: 'mcq', question: 'من أول مؤذن في الإسلام؟', options: ['بلال بن رباح', 'عبد الله بن مسعود', 'زيد بن ثابت', 'خالد بن الوليد'], correct: 0, source: 'كتب السيرة والتراجم، ترجمة بلال بن رباح رضي الله عنه' },
  { id: 33, category: 'العقيدة', difficulty: 'سهل', type: 'mcq', question: 'كم عدد أركان الإيمان المذكورة في حديث جبريل؟', options: ['أربعة', 'خمسة', 'ستة', 'سبعة'], correct: 2, source: 'صحيح مسلم، حديث 8' },
  { id: 34, category: 'العقيدة', difficulty: 'سهل', type: 'boolean', question: 'الإيمان بالملائكة أحد أركان الإيمان.', options: ['صحيح', 'خطأ'], correct: 0, source: 'صحيح مسلم، حديث 8' },
  { id: 35, category: 'العقيدة', difficulty: 'سهل', type: 'mcq', question: 'من خاتم الأنبياء والمرسلين؟', options: ['موسى عليه السلام', 'عيسى عليه السلام', 'محمد ﷺ', 'إبراهيم عليه السلام'], correct: 2, source: 'سورة الأحزاب، الآية 40' },
  { id: 36, category: 'العقيدة', difficulty: 'متوسط', type: 'mcq', question: 'ما السورة التي اشتهرت ببيان توحيد الله؟', options: ['الفلق', 'الإخلاص', 'الكوثر', 'الماعون'], correct: 1, source: 'سورة الإخلاص، الآيات 1–4' }
];

const STORAGE_KEY = 'ilmrace-profile-v1';
const ui = {
  shell: document.querySelector('#appShell'),
  home: document.querySelector('#homeScreen'),
  race: document.querySelector('#raceScreen'),
  result: document.querySelector('#resultScreen'),
  questionNumber: document.querySelector('#questionNumber'),
  answeredCount: document.querySelector('#answeredCount'),
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
  raceStreak: document.querySelector('#raceStreak'),
  finalScore: document.querySelector('#finalScore'),
  finalCorrect: document.querySelector('#finalCorrect'),
  finalAccuracy: document.querySelector('#finalAccuracy'),
  finalSpeed: document.querySelector('#finalSpeed'),
  resultTitle: document.querySelector('#resultTitle'),
  resultSubtitle: document.querySelector('#resultSubtitle'),
  resultEyebrow: document.querySelector('#resultEyebrow'),
  toast: document.querySelector('#toast'),
  toastText: document.querySelector('#toastText'),
  modal: document.querySelector('#modalBackdrop'),
  modalTitle: document.querySelector('#modalTitle'),
  modalBody: document.querySelector('#modalBody'),
  confetti: document.querySelector('#confettiLayer')
};

const state = {
  screen: 'home',
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
  startedAt: 0
};

const networkAdapter = {
  mode: 'local-training',
  async createRoom() { return { ok: false, reason: 'Supabase Realtime غير مربوط في النسخة الأولى' }; },
  async joinRoom() { return { ok: false, reason: 'Supabase Realtime غير مربوط في النسخة الأولى' }; },
  subscribeToRaceState() { return () => {}; }
};
window.ilmraceNetwork = networkAdapter;

let profile = loadProfile();

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved || { wins: 0, games: 0, totalAnswered: 0, totalCorrect: 0, bestStreak: 0, xp: 0 };
  } catch {
    return { wins: 0, games: 0, totalAnswered: 0, totalCorrect: 0, bestStreak: 0, xp: 0 };
  }
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  updateHomeStats();
}

function updateHomeStats() {
  const accuracy = profile.totalAnswered ? Math.round((profile.totalCorrect / profile.totalAnswered) * 100) : 0;
  const xpCap = 250;
  const xp = profile.xp % xpCap;
  document.querySelector('#winsValue').textContent = profile.wins;
  document.querySelector('#accuracyValue').textContent = `${accuracy}%`;
  document.querySelector('#streakValue').textContent = profile.bestStreak;
  document.querySelector('#xpValue').textContent = `${xp} / ${xpCap} XP`;
  document.querySelector('#xpBar').style.width = `${Math.min(100, (xp / xpCap) * 100)}%`;
}

function showScreen(name) {
  const screens = { home: ui.home, race: ui.race, result: ui.result };
  Object.entries(screens).forEach(([key, element]) => {
    const active = key === name;
    element.hidden = !active;
    element.classList.toggle('active', active);
  });
  state.screen = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function validateQuestionBank() {
  const ids = new Set();
  const texts = new Set();
  const categories = new Set();
  QUESTION_BANK.forEach((question) => {
    if (ids.has(question.id)) throw new Error(`Duplicate question id: ${question.id}`);
    if (texts.has(question.question)) throw new Error(`Duplicate question text: ${question.question}`);
    if (!question.source || !question.options?.length || question.correct < 0 || question.correct >= question.options.length) {
      throw new Error(`Invalid question: ${question.id}`);
    }
    ids.add(question.id);
    texts.add(question.question);
    categories.add(question.category);
  });
  if (ids.size !== QUESTION_BANK.length || categories.size < 6) throw new Error('Question bank coverage is incomplete');
  return { count: QUESTION_BANK.length, categories: [...categories] };
}

function startRace() {
  clearRoundTimers();
  const categories = ['القرآن', 'السيرة', 'الفقه', 'الحديث', 'التاريخ', 'العقيدة'];
  const picked = [];
  categories.forEach(category => {
    const categoryQuestions = shuffle(QUESTION_BANK.filter(q => q.category === category));
    if (categoryQuestions[0]) picked.push(categoryQuestions[0]);
  });
  const selectedIds = new Set(picked.map(question => question.id));
  const remainder = shuffle(QUESTION_BANK.filter(question => !selectedIds.has(question.id)));
  state.questions = shuffle([...picked, ...remainder]).slice(0, 10);
  if (new Set(state.questions.map(question => question.id)).size !== state.questions.length) {
    throw new Error('Race question selection produced a duplicate');
  }
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
  showScreen('race');
  renderQuestion();
}

function renderQuestion() {
  if (state.gameOver) return;
  clearRoundTimers();
  state.currentQuestion = state.questions[state.index];
  state.locked = false;
  state.botResponded = false;
  state.botCorrect = Math.random() > 0.2;
  ui.questionNumber.textContent = state.index + 1;
  ui.answeredCount.textContent = state.index;
  ui.category.textContent = state.currentQuestion.category;
  ui.difficulty.textContent = state.currentQuestion.difficulty;
  ui.questionType.textContent = state.currentQuestion.type === 'boolean' ? 'صح أم خطأ' : 'اختيار من متعدد';
  ui.questionText.textContent = state.currentQuestion.question;
  ui.feedback.textContent = '';
  ui.feedback.className = 'answer-feedback';
  ui.card.classList.remove('answer-correct', 'answer-wrong');
  ui.answers.innerHTML = '';
  const letters = ['أ', 'ب', 'ج', 'د'];
  state.currentQuestion.options.forEach((option, index) => {
    const button = document.createElement('button');
    button.className = 'answer-button';
    button.dataset.answerIndex = String(index);
    button.innerHTML = `<span class="answer-letter">${letters[index] || index + 1}</span><span class="answer-label">${option}</span>`;
    ui.answers.appendChild(button);
  });
  ui.raceStreak.textContent = state.streak;
  updateScoreboard();
  startTimer();
  startBot();
}

function startTimer() {
  state.remaining = 15;
  state.startedAt = performance.now();
  updateTimer();
  state.timerId = window.setInterval(() => {
    if (state.locked || state.gameOver) return;
    state.remaining = Math.max(0, 15 - (performance.now() - state.startedAt) / 1000);
    updateTimer();
    if (state.remaining <= 0) handleAnswer(null);
  }, 50);
}

function updateTimer() {
  const seconds = Math.ceil(state.remaining);
  ui.timerValue.textContent = seconds;
  ui.timerRing.style.setProperty('--timer-progress', Math.max(0, state.remaining / 15));
  ui.timerRing.classList.toggle('urgent', state.remaining <= 5);
  ui.timerRing.classList.toggle('done', state.remaining <= 0);
}

function startBot() {
  const delay = 2200 + Math.random() * 3900;
  state.botTimer = window.setTimeout(() => botRespond(), delay);
}

function botRespond() {
  if (state.botResponded || state.gameOver) return;
  state.botResponded = true;
  if (state.botCorrect) {
    state.opponentProgress = Math.min(10, state.opponentProgress + 1);
    state.opponentScore += state.locked ? 5 : 10;
    updateScoreboard();
    if (!state.locked) showToast('سراج أجاب قبلك — ما زالت لديك فرصة بنصف النقاط');
  } else if (!state.locked) {
    showToast('سراج أخطأ — ركّز وخذ التقدم');
  }
}

function applyPendingBotResult(playerWasCorrect) {
  if (state.botResponded) return;
  state.botResponded = true;
  if (state.botCorrect) {
    state.opponentProgress = Math.min(10, state.opponentProgress + 1);
    state.opponentScore += playerWasCorrect ? 5 : 10;
  }
  updateScoreboard();
}

function handleAnswer(answerIndex) {
  if (state.locked || state.gameOver) return;
  state.locked = true;
  clearInterval(state.timerId);
  state.timerId = null;
  if (state.botTimer) clearTimeout(state.botTimer);
  const question = state.currentQuestion;
  const elapsed = Math.min(15, Math.max(0.1, (performance.now() - state.startedAt) / 1000));
  state.times.push(elapsed);
  const isCorrect = answerIndex !== null && answerIndex === question.correct;
  const buttons = [...ui.answers.querySelectorAll('.answer-button')];
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index === question.correct) button.classList.add('correct');
    if (answerIndex === index && !isCorrect) button.classList.add('wrong');
  });
  if (isCorrect) {
    const faster = !state.botResponded;
    const points = faster ? 10 : 5;
    state.playerScore += points;
    state.playerProgress = Math.min(10, state.playerProgress + 1);
    state.correct += 1;
    state.streak += 1;
    ui.feedback.textContent = faster ? `إجابة صحيحة — +${points} نقاط، أنت الأسرع` : `إجابة صحيحة — +${points} نقاط، سراج كان أسرع`;
    ui.feedback.className = 'answer-feedback good';
    ui.card.classList.add('answer-correct');
    burstSparkles();
  } else {
    state.streak = 0;
    ui.feedback.textContent = answerIndex === null ? 'انتهى الوقت — لا تتوقف، السؤال التالي ينتظرك' : `ليست الإجابة الصحيحة. المرجع: ${question.source}`;
    ui.feedback.className = 'answer-feedback bad';
    ui.card.classList.add('answer-wrong');
  }
  ui.raceStreak.textContent = state.streak;
  updateScoreboard();
  if (!state.botResponded) window.setTimeout(() => applyPendingBotResult(isCorrect), 560);
  window.setTimeout(() => advanceQuestion(), 1050);
}

function advanceQuestion() {
  if (state.gameOver) return;
  state.index += 1;
  if (state.index >= state.questions.length) {
    finishRace();
  } else {
    renderQuestion();
  }
}

function finishRace() {
  state.gameOver = true;
  clearRoundTimers();
  const playerWon = state.playerProgress > state.opponentProgress || (state.playerProgress === state.opponentProgress && state.playerScore >= state.opponentScore);
  const tie = state.playerProgress === state.opponentProgress && state.playerScore === state.opponentScore;
  const accuracy = Math.round((state.correct / state.questions.length) * 100);
  const average = state.times.length ? (state.times.reduce((sum, time) => sum + time, 0) / state.times.length).toFixed(1) : '—';
  profile.games += 1;
  profile.wins += playerWon && !tie ? 1 : 0;
  profile.totalAnswered += state.questions.length;
  profile.totalCorrect += state.correct;
  profile.bestStreak = Math.max(profile.bestStreak, state.streak);
  profile.xp += state.playerScore + (playerWon && !tie ? 15 : 5);
  saveProfile();
  ui.finalScore.textContent = state.playerScore;
  ui.finalCorrect.textContent = `${state.correct}/10`;
  ui.finalAccuracy.textContent = `${accuracy}%`;
  ui.finalSpeed.textContent = average === '—' ? average : `${average}ث`;
  if (tie) {
    ui.resultEyebrow.textContent = 'تعادل قوي';
    ui.resultTitle.textContent = 'تعادل! أداء متقارب';
    ui.resultSubtitle.textContent = 'السؤال الفاصل سيحسم النتيجة في المرحلة الثانية.';
  } else if (playerWon) {
    ui.resultEyebrow.textContent = 'فوز مستحق';
    ui.resultTitle.textContent = 'أحسنت يا مؤيد!';
    ui.resultSubtitle.textContent = 'سرعتك صنعت الفارق. واصلت حتى النهاية.';
  } else {
    ui.resultEyebrow.textContent = 'سباق قوي';
    ui.resultTitle.textContent = 'سراج سبقك هذه المرة';
    ui.resultSubtitle.textContent = 'كل سباق تدريب جديد يرفع دقتك وسرعتك.';
  }
  showScreen('result');
  if (playerWon && !tie) createConfetti();
}

function clearRoundTimers() {
  if (state.timerId) clearInterval(state.timerId);
  if (state.botTimer) clearTimeout(state.botTimer);
  state.timerId = null;
  state.botTimer = null;
}

function setProgress(runner, progress) {
  const safe = Math.max(0, Math.min(10, progress));
  runner.style.setProperty('--progress', `${Math.max(4, safe * 9.4)}%`);
  runner.parentElement.querySelector('.track-glow').style.width = `${Math.max(4, safe * 9.4)}%`;
}

function updateScoreboard() {
  ui.playerScore.textContent = state.playerScore;
  ui.opponentScore.textContent = state.opponentScore;
  setProgress(ui.playerRunner, state.playerProgress);
  setProgress(ui.opponentRunner, state.opponentProgress);
}

function showToast(message) {
  ui.toastText.textContent = message;
  ui.toast.classList.add('visible');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => ui.toast.classList.remove('visible'), 2600);
}

function openModal(title, body, symbol = 'clock') {
  ui.modalTitle.textContent = title;
  ui.modalBody.innerHTML = body;
  ui.modal.querySelector('.modal-symbol').innerHTML = symbol === 'info' ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/></svg>';
  ui.modal.hidden = false;
}

function closeModal() { ui.modal.hidden = true; }

function openHowToPlay() {
  openModal('كيف تُلعب؟', '<p>سباق من 10 أسئلة. لديك 15 ثانية لكل سؤال، وكل إجابة صحيحة تحركك خطوة على المضمار.</p><ul><li>أجب قبل سراج لتحصل على 10 نقاط.</li><li>إذا سبقك سراج وأجبت صحيحاً تحصل على 5 نقاط.</li><li>الإجابة الخاطئة توقف تقدمك في السؤال.</li><li>المراجع ظاهرة لكل سؤال حتى تبقى المعرفة دقيقة.</li></ul>', 'clock');
}

function openSources() {
  const sources = [...new Set(QUESTION_BANK.map(question => question.category))];
  openModal('مصادر بنك الأسئلة', `<p>النواة الحالية صُممت لتقديم أسئلة مأمونة المصدر، مع إظهار المرجع داخل السباق.</p><div class="source-list">${sources.map(source => `<div class="source-item"><strong>${source}</strong><span>${QUESTION_BANK.filter(q => q.category === source).length} أسئلة</span></div>`).join('')}</div>`, 'info');
}

function showQuestionSource() {
  if (!state.currentQuestion) return;
  openModal('مرجع السؤال', `<p>${state.currentQuestion.source}</p><p style="color:var(--subtle);font-size:.68rem">المحتوى الحالي نواة مراجعة أولى. التوسعة إلى 500 سؤال ستتم بإضافة مراجعة بشرية لكل سؤال قبل تفعيل اللعب الشبكي.</p>`, 'info');
}

function createConfetti() {
  ui.confetti.innerHTML = '';
  for (let index = 0; index < 30; index += 1) {
    const piece = document.createElement('i');
    piece.className = 'confetti';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${Math.random() * .65}s`;
    piece.style.transform = `rotate(${Math.random() * 180}deg)`;
    ui.confetti.appendChild(piece);
  }
}

function burstSparkles() {
  const count = 7;
  for (let index = 0; index < count; index += 1) {
    const sparkle = document.createElement('i');
    sparkle.style.position = 'fixed';
    sparkle.style.zIndex = '25';
    sparkle.style.width = '5px';
    sparkle.style.height = '5px';
    sparkle.style.borderRadius = '50%';
    sparkle.style.background = index % 2 ? 'var(--gold-bright)' : 'var(--emerald-bright)';
    sparkle.style.pointerEvents = 'none';
    const rect = ui.card.getBoundingClientRect();
    sparkle.style.left = `${rect.left + rect.width / 2}px`;
    sparkle.style.top = `${rect.top + 45}px`;
    const angle = (Math.PI * 2 * index) / count;
    sparkle.animate([{ transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * 72 - 50}%, ${Math.sin(angle) * 72 - 50}%) scale(0)`, opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2,.8,.3,1)' });
    document.body.appendChild(sparkle);
    window.setTimeout(() => sparkle.remove(), 700);
  }
}

function toggleTheme() {
  const next = ui.shell.dataset.theme === 'light' ? 'dark' : 'light';
  ui.shell.dataset.theme = next;
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ilmrace-theme', next);
}

function bindEvents() {
  document.addEventListener('click', event => {
    const actionTarget = event.target.closest('[data-action]');
    if (actionTarget) {
      const action = actionTarget.dataset.action;
      if (action === 'start-race') startRace();
      if (action === 'home') { clearRoundTimers(); showScreen('home'); }
      if (action === 'theme') toggleTheme();
      if (action === 'how-to-play') openHowToPlay();
      if (action === 'open-sources') openSources();
      if (action === 'show-question-source') showQuestionSource();
      if (action === 'close-modal') closeModal();
      if (action === 'quit-race') { clearRoundTimers(); showScreen('home'); showToast('تم حفظ تقدمك. يمكنك العودة إلى السباق متى شئت'); }
      if (action === 'locked-mode') showToast('هذا النمط جزء من المرحلة الثانية وسيُفتح مع اللعب عبر الإنترنت');
    }
    const answer = event.target.closest('.answer-button');
    if (answer) handleAnswer(Number(answer.dataset.answerIndex));
  });
  ui.modal.addEventListener('click', event => { if (event.target === ui.modal) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
}

function boot() {
  const bankReport = validateQuestionBank();
  const savedTheme = localStorage.getItem('ilmrace-theme') || 'dark';
  ui.shell.dataset.theme = savedTheme;
  document.documentElement.dataset.theme = savedTheme;
  updateHomeStats();
  bindEvents();
  showScreen('home');
  window.ilmraceDebug = { questionBank: QUESTION_BANK, state, validateQuestionBank };
  console.info(`IlmRace ready: ${bankReport.count} sourced questions across ${bankReport.categories.length} categories`);
}

boot();
