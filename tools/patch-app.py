#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ترقيع app.js لربط Supabase الحقيقي — يُشغَّل من GitHub Actions.
يقرأ tools/supabase-patch.js (مقتطفات JS) ويُدخلها في app.js في مواضعها.
كل ترقيع يتحقق من وجود مرساته مرة واحدة بالضبط؛ أي اختلاف يُفشل السكربت
بدلاً من إنتاج ملف مكسور.
"""
import sys

APP = 'app.js'
PATCH = 'tools/supabase-patch.js'


def fail(msg):
    print(f'PATCH FAILED: {msg}')
    sys.exit(1)


def section(patch_text, name):
    marker = f'// ===== SECTION: {name} ====='
    start = patch_text.find(marker)
    if start < 0:
        fail(f'section {name} not found in {PATCH}')
    start += len(marker)
    nxt = patch_text.find('// ===== SECTION:', start)
    body = patch_text[start:(nxt if nxt >= 0 else len(patch_text))]
    return body.strip('\n') + '\n'


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        fail(f'{label}: expected exactly 1 occurrence, found {n}')
    return text.replace(old, new)


def span_between(text, start_marker, end_marker, label):
    a = text.find(start_marker)
    if a < 0:
        fail(f'{label}: start marker not found')
    if text.count(start_marker) != 1:
        fail(f'{label}: start marker not unique')
    b = text.find(end_marker, a)
    if b < 0:
        fail(f'{label}: end marker not found')
    return a, b


def replace_span(text, start_marker, end_marker, new_body, label):
    a, b = span_between(text, start_marker, end_marker, label)
    return text[:a] + new_body.rstrip('\n') + '\n' + text[b:]


def main():
    src = open(APP, encoding='utf-8').read()
    patch = open(PATCH, encoding='utf-8').read()
    orig_len = len(src)

    # 1) إدراج كتلة Supabase بعد سطر GOOGLE_CONFIGURED
    block = section(patch, 'SUPABASE_BLOCK')
    anchor = 'const GOOGLE_CONFIGURED = Boolean(SIBAQ_CONFIG.GOOGLE_CLIENT_ID);'
    src = replace_once(src, anchor, anchor + '\n\n' + block.rstrip('\n') + '\n', 'supabase block insert')

    # 2) استبدال networkAdapter بالكامل بالتنفيذ الحقيقي
    adapter = section(patch, 'NETWORK_ADAPTER')
    src = replace_span(src, 'const networkAdapter = {', 'let profile = loadProfile();', adapter, 'networkAdapter')

    # 3) startRace: معامل اختياري للأسئلة المشتركة + تجاوز الاختيار العشوائي
    src = replace_once(src, "function startRace(opponentName = 'سراج', mode = 'training') {",
                       "function startRace(opponentName = 'سراج', mode = 'training', sharedQuestions = null) {", 'startRace signature')
    src = replace_once(src, 'state.questions = shuffle(picked);',
                       'state.questions = shuffle(picked);\n  if (sharedQuestions && sharedQuestions.length) state.questions = [...sharedQuestions];', 'startRace shared questions')

    # 4) startBot: لا بوت في السباق المباشر
    src = replace_once(src, "if (state.mode === 'daily') return;",
                       "if (state.mode === 'daily' || state.mode === 'online') return;", 'startBot guard')

    # 5) scoreAnswer: دفع النتيجة المباشرة + منع نتيجة البوت الوهمية في وضع online
    src = replace_once(src, 'if (!state.botResponded) window.setTimeout(() => applyPendingBotResult(isCorrect), 560);',
                       'if (!state.botResponded && state.mode !== \'online\') window.setTimeout(() => applyPendingBotResult(isCorrect), 560);', 'scoreAnswer bot guard')
    a, b = span_between(src, 'function scoreAnswer(isCorrect, wrongFeedback) {', 'function handleAnswer(answerIndex) {', 'scoreAnswer span')
    seg = src[a:b]
    seg = replace_once(seg, '  updateScoreboard();', '  updateScoreboard();\n  if (state.mode === \'online\') pushOnlineScore();', 'scoreAnswer push')
    src = src[:a] + seg + src[b:]

    # 6) finishRace: تسجيل النتيجة المباشرة/اليومية في Supabase
    a, b = span_between(src, 'function finishRace() {', 'async function handleTournamentFinish(won) {', 'finishRace span')
    seg = src[a:b]
    seg = replace_once(seg, '  updateHomeStats();', '  updateHomeStats();\n  recordOnlineResult();', 'finishRace record')
    src = src[:a] + seg + src[b:]

    # 7) استبدال دوال الأوضاع الأونلاين والدخول والصدارة
    for name, start_marker, end_marker in [
        ('OPEN_ONLINE_QUICK', 'async function openOnlineQuick() {', 'async function openRoom() {'),
        ('OPEN_ROOM', 'async function openRoom() {', 'function joinRoomByCode(code) {'),
        ('JOIN_ROOM_BY_CODE', 'function joinRoomByCode(code) {', 'function openLeaderboard() {'),
        ('OPEN_LEADERBOARD', 'function openLeaderboard() {', 'function openProfile() {'),
        ('OPEN_GOOGLE_SIGNIN', 'function openGoogleSignIn() {', 'function createConfetti() {'),
    ]:
        body = section(patch, name)
        src = replace_span(src, start_marker, end_marker, body, name)

    # 8) boot: استعادة جلسة Supabase + دمج أسئلة الجدول
    src = replace_once(src, 'validateQuestionBank();',
                       'validateQuestionBank();\n  refreshSupabaseSession();\n  mergeRemoteQuestions();', 'boot supabase init')

    # 9) usePower: التجميد لا يعمل ضد خصم حقيقي
    src = replace_once(src, "if (state.mode === 'daily') { showToast('لا خصم في تحدي اليوم لتجميده'); return; }",
                       "if (state.mode === 'daily') { showToast('لا خصم في تحدي اليوم لتجميده'); return; }\n    if (state.mode === 'online') { showToast('لا يمكن تجميد خصم حقيقي — التجميد يعمل ضد الكمبيوتر فقط'); return; }", 'freeze guard')

    open(APP, 'w', encoding='utf-8').write(src)
    print(f'PATCH OK: app.js {orig_len} -> {len(src)} chars')


if __name__ == '__main__':
    main()
