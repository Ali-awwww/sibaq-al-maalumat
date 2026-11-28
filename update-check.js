// فحص التحديث داخل التطبيق — سباق المعلومات.
// يجلب أحدث إصدار من https://apps-showcase.pages.dev/api/latest ويعرض بطاقة
// تحديث صغيرة عند وجود إصدار أحدث. أي فشل في الجلب يفشل بصمت ولا يوقف اللعبة أبداً.
(function () {
  'use strict';

  // الإصدار الحالي للتطبيق.
  // ملاحظة: ارفع هذا الثابت مع كل إصدار جديد، ومعه package.json وversionName في android/app/build.gradle.
  // التطبيق لا يستخدم App.getInfo() من @capacitor/app، لذلك يُقرأ الإصدار الحالي من هذا الثابت.
  var CURRENT_VERSION = '1.5.7';

  var API_URL = 'https://apps-showcase.pages.dev/api/latest';
  var REPO = 'sibaq-al-maalumat';
  var CHECK_TIMEOUT_MS = 30000;
  var KEY_LAST_CHECK = 'sibaq-update-last-check';
  var KEY_DISMISSED = 'sibaq-update-dismissed';
  var LANG_KEY = 'sibaq-lang-v1';

  var TEXT = {
    ar: {
      updateAvailable: 'يوجد تحديث جديد',
      dismissToday: 'لا تذكرني اليوم',
      update: 'تحديث',
      checking: 'جارٍ التحقق من وجود تحديث…',
      latest: 'إصدارك هو الأحدث',
      failed: 'تعذّر التحقق من وجود تحديث. تحقق من اتصالك بالإنترنت وحاول مجدداً.'
    },
    en: {
      updateAvailable: 'A new update is available',
      dismissToday: 'Don’t remind me today',
      update: 'Update',
      checking: 'Checking for updates…',
      latest: 'You have the latest version',
      failed: 'Could not check for updates. Check your connection and try again.'
    }
  };

  function isEnglish() {
    try {
      if (window.localStorage.getItem(LANG_KEY) === 'en') return true;
      if (window.localStorage.getItem(LANG_KEY) === 'ar') return false;
      return document.documentElement && document.documentElement.lang === 'en';
    } catch (e) {
      return false;
    }
  }

  function t(key) {
    return TEXT[isEnglish() ? 'en' : 'ar'][key];
  }

  function todayString() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* تجاهل أخطاء التخزين */ }
  }

  function stripLeadingV(version) {
    return String(version == null ? '' : version).replace(/^[vV]/, '');
  }

  // مقارنة رقمية جزءاً بجزء: 1.5.10 أكبر من 1.5.9. لا تقارن النصوص حرفياً أبداً.
  function compareVersions(a, b) {
    var pa = stripLeadingV(a).split('.');
    var pb = stripLeadingV(b).split('.');
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var na = parseInt(pa[i], 10);
      var nb = parseInt(pb[i], 10);
      if (isNaN(na)) na = 0;
      if (isNaN(nb)) nb = 0;
      if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
  }

  function firstLineShort(body) {
    var lines = String(body || '').split(/\r?\n/);
    var line = '';
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim()) { line = lines[i].trim(); break; }
    }
    if (line.length > 120) line = line.slice(0, 120) + '…';
    return line;
  }

  // يجلب أحدث إصدار؛ يرجع null عند أي فشل (لا إنترنت، انتهاء المهلة، رد سيئ).
  async function fetchLatestInfo() {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, CHECK_TIMEOUT_MS);
    try {
      var response = await fetch(API_URL, { signal: controller.signal });
      if (!response || !response.ok) return null;
      var data = await response.json();
      var list = null;
      if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.latest)) list = data.latest;
      else if (data && Array.isArray(data.apps)) list = data.apps;
      if (!list) return null;
      var item = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].repo === REPO) { item = list[i]; break; }
      }
      if (!item || !item.tag || !item.apkUrl) return null;
      return {
        version: stripLeadingV(item.tag),
        apkUrl: item.apkUrl,
        notes: firstLineShort(item.body)
      };
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function openApk(url) {
    // نفس النمط المستخدم في openOurApps().
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function showUpdateCard(info) {
    var card = document.getElementById('updateCard');
    if (!card) return;
    card.innerHTML = '';
    var title = document.createElement('p');
    title.className = 'update-card-title';
    title.textContent = t('updateAvailable') + ' ' + info.version;
    card.appendChild(title);
    if (info.notes) {
      var notes = document.createElement('p');
      notes.className = 'update-card-notes';
      notes.textContent = info.notes;
      card.appendChild(notes);
    }
    var actions = document.createElement('div');
    actions.className = 'update-card-actions';
    var updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'primary-button';
    updateBtn.textContent = t('update');
    updateBtn.addEventListener('click', function () { openApk(info.apkUrl); });
    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'ghost-button';
    dismissBtn.textContent = t('dismissToday');
    dismissBtn.addEventListener('click', function () {
      safeSet(KEY_DISMISSED, todayString() + '|' + info.version);
      card.hidden = true;
    });
    actions.appendChild(updateBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(actions);
    card.hidden = false;
  }

  // الفحص التلقائي: مرة واحدة في اليوم كحد أقصى.
  async function maybeCheckForUpdate() {
    try {
      var today = todayString();
      if (safeGet(KEY_LAST_CHECK) === today) return;
      safeSet(KEY_LAST_CHECK, today);
      var info = await fetchLatestInfo();
      if (!info) return;
      if (compareVersions(info.version, CURRENT_VERSION) <= 0) return;
      if (safeGet(KEY_DISMISSED) === today + '|' + info.version) return;
      showUpdateCard(info);
    } catch (e) {
      // لا يوقف اللعبة أبداً.
    }
  }

  function removeSectionUpdateButton() {
    var section = document.getElementById('updateSection');
    var old = section && section.querySelector('.update-section-update');
    if (old) old.remove();
  }

  // الفحص اليدوي من قسم «التحديثات»: يجلب دائماً.
  async function checkManually() {
    var statusEl = document.getElementById('updateStatus');
    var buttonEl = document.querySelector('[data-action="check-update"]');
    var info = null;
    try {
      if (statusEl) statusEl.textContent = t('checking');
      if (buttonEl) buttonEl.disabled = true;
      info = await fetchLatestInfo();
    } catch (e) {
      info = null;
    }
    if (buttonEl) buttonEl.disabled = false;
    if (!statusEl) return;
    if (!info) {
      removeSectionUpdateButton();
      statusEl.textContent = t('failed');
      return;
    }
    safeSet(KEY_LAST_CHECK, todayString());
    if (compareVersions(info.version, CURRENT_VERSION) <= 0) {
      removeSectionUpdateButton();
      statusEl.textContent = t('latest');
      return;
    }
    statusEl.textContent = '';
    var head = document.createElement('span');
    head.textContent = t('updateAvailable') + ' ' + info.version;
    statusEl.appendChild(head);
    if (info.notes) {
      statusEl.appendChild(document.createElement('br'));
      var small = document.createElement('small');
      small.textContent = info.notes;
      statusEl.appendChild(small);
    }
    var section = document.getElementById('updateSection');
    if (section && !section.querySelector('.update-section-update')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'primary-button update-section-update';
      btn.textContent = t('update');
      btn.addEventListener('click', function () { openApk(info.apkUrl); });
      section.appendChild(btn);
    }
  }

  document.addEventListener('click', function (event) {
    var el = event.target && event.target.closest ? event.target.closest('[data-action="check-update"]') : null;
    if (el) checkManually();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeCheckForUpdate);
  } else {
    maybeCheckForUpdate();
  }

  window.SibaqUpdateCheck = {
    CURRENT_VERSION: CURRENT_VERSION,
    compareVersions: compareVersions,
    fetchLatestInfo: fetchLatestInfo,
    checkManually: checkManually,
    maybeCheckForUpdate: maybeCheckForUpdate
  };
})();
