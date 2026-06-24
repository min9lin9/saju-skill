#!/usr/bin/env node
'use strict';
/* ============================================================
   사주닥터 — 만세력 CLI (이연 도령 댓글봇 전용)
   기존 frontend/assets/saju.js 엔진을 node에서 그대로 재사용.
   LLM이 만세력을 암산하면 절기/일진 경계에서 틀리므로,
   정확한 명식은 반드시 이 CLI로 계산한다.

   사용법:
     node manse.cjs "2008-03-15 06:30 남"
     node manse.cjs --date 2008-03-15 --time 06:30 --gender 여
     node manse.cjs "1996-11-02 여 음력"     (시 미상 → 정오 가정, 시주 불확실 표시)
     node manse.cjs --json "2008-03-15 06:30 남"   (JSON 출력)

   토큰(순서 무관):
     YYYY-MM-DD | YYYY.MM.DD | YYYY/MM/DD   생년월일
     HH:MM | HH시                            시각(생략 가능)
     남|여 (남자|여자|m|f)                   성별
     음력 | --lunar                          음력 입력
     윤달 | --leap                           음력 윤달
     --json                                  JSON 출력
   ============================================================ */

const path = require('path');

let Solar, Lunar;
try {
  ({ Solar, Lunar } = require('lunar-javascript'));
} catch (e) {
  console.error('[오류] lunar-javascript 미설치. tools 폴더에서: npm install');
  process.exit(2);
}
globalThis.Solar = Solar;
globalThis.Lunar = Lunar;
require(path.join(__dirname, 'saju.js'));
const SD = globalThis.SajuDoctor;

// ---------- 입력 파싱 ----------
function parse(argv) {
  const a = { gender: '', genderGiven: false, isLunar: false, isLeap: false, json: false, hour: null, minute: 0, hourGiven: false };
  const rest = [];
  // 각 인자를 공백으로도 분해 (따옴표로 묶인 "2008-03-15 06:30 남" 대응)
  const tokens = argv.slice(2).flatMap(s => String(s).split(/\s+/)).filter(Boolean);
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    if (t === '--json') a.json = true;
    else if (t === '--lunar' || t === '음력' || t === '음') a.isLunar = true;
    else if (t === '--leap' || t === '윤달' || t === '윤') a.isLeap = true;
    else if (t === '--date' || t === '--time' || t === '--gender') continue; // 플래그 키는 무시(값만 사용)
    else if (/^(남|남자|m|M|male)$/.test(t)) { a.gender = '남'; a.genderGiven = true; }
    else if (/^(여|여자|f|F|female)$/.test(t)) { a.gender = '여'; a.genderGiven = true; }
    else rest.push(t);
  }
  for (const t of rest) {
    let m;
    if ((m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/))) {
      a.year = +m[1]; a.month = +m[2]; a.day = +m[3];
    } else if ((m = t.match(/^(\d{8})$/))) {
      a.year = +t.slice(0, 4); a.month = +t.slice(4, 6); a.day = +t.slice(6, 8);
    } else if ((m = t.match(/^(\d{1,2}):(\d{2})$/))) {
      a.hour = +m[1]; a.minute = +m[2]; a.hourGiven = true;
    } else if ((m = t.match(/^(\d{1,2})시$/))) {
      a.hour = +m[1]; a.hourGiven = true;
    }
  }
  return a;
}

function fail(msg) {
  console.error('[입력 오류] ' + msg);
  console.error('예) node manse.cjs "2008-03-15 06:30 남"   /   node manse.cjs "1996-11-02 여 음력"');
  process.exit(1);
}

const a = parse(process.argv);
if (!a.year || !a.month || !a.day) fail('생년월일(YYYY-MM-DD)이 필요해.');
if (!a.gender) a.gender = '남'; // 미상 시 가정(아래 경고)
if (a.hour == null) { a.hour = 12; a.minute = 0; } // 시 미상 → 정오 가정

let result;
try {
  result = SD.analyze({
    year: a.year, month: a.month, day: a.day,
    hour: a.hour, minute: a.minute,
    gender: a.gender, isLunar: a.isLunar, isLeap: a.isLeap
  });
  SD.enrichManse(result);
} catch (e) {
  fail('명식 계산 실패: ' + (e && e.message ? e.message : e));
}

// 점수 자체 계산 (saju.js의 동명 함수는 한자 변수명 + strict 충돌로 node에서 깨짐 → 동일 공식 재구현)
function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }
function medicalScore(r) {
  const sp = (k) => Number(r.shipsin[k]) || 0;
  const inseong = sp('正印') + sp('偏印') * 0.7;
  const siksin = sp('食神') + sp('傷官') * 0.5;
  const gwan = sp('正官') + sp('偏官') * 0.7;
  const bi = sp('比肩') + sp('劫財') * 0.5;
  let s = Math.min(inseong, 3) * 12 + Math.min(siksin, 2) * 10 + Math.min(gwan, 2) * 10 + Math.min(bi, 2) * 6;
  const vals = ['木', '火', '土', '金', '水'].map(k => r.ohaeng[k]);
  if (Math.max(...vals) - Math.min(...vals) < 3.5) s += 8;
  const str = r.ohaeng[r.ilgan.ohaeng];
  if (str < 1.5) s -= 8;
  if (str > 5.5) s -= 5;
  return clamp(s);
}
function marriageScore(r, gender) {
  const sp = (k) => Number(r.shipsin[k]) || 0;
  const gwan = sp('正官') + sp('偏官') * 0.8;
  const jae = sp('正財') + sp('偏財') * 0.7;
  const inseong = sp('正印') + sp('偏印') * 0.5;
  let s = 0;
  if (gender === '여') {
    s += Math.min(gwan, 3) * 14 + Math.min(inseong, 2) * 8 + Math.min(jae, 2) * 6;
  } else {
    s += Math.min(jae, 3) * 12 + Math.min(gwan, 2) * 8 + Math.min(inseong, 2) * 8;
  }
  if (['子', '卯', '酉', '午'].includes(r.palja.dayPillar.branch)) s += 8;
  const str = r.ohaeng[r.ilgan.ohaeng];
  if (str >= 2.0 && str <= 4.5) s += 6;
  return clamp(s);
}
const medScore = medicalScore(result);
const marScore = marriageScore(result, a.gender);

// ---------- 개수 기반 요약 (소수점 가중치 대신 실제 글자 개수로 풀이) ----------
// 일반 대중 사주는 "재성이 0.9" 같은 가중치를 절대 안 쓴다. 천간4+지지4 글자에서
// 오행/십신이 몇 개 나타나는지(개수)로 강약을 말한다. 그 개수를 여기서 계산해 준다.
function buildCounts(r) {
  const pillars = ['year', 'month', 'day', 'hour'].map(k => r.manse && r.manse[k]).filter(Boolean);
  const ohaeng = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  pillars.forEach(p => { if (p.stemOhaeng) ohaeng[p.stemOhaeng]++; if (p.branchOhaeng) ohaeng[p.branchOhaeng]++; });
  const GROUP = { 비견: '비겁', 겁재: '비겁', 식신: '식상', 상관: '식상', 편재: '재성', 정재: '재성', 편관: '관성', 정관: '관성', 편인: '인성', 정인: '인성' };
  const shipsinDetail = { 비견: 0, 겁재: 0, 식신: 0, 상관: 0, 편재: 0, 정재: 0, 편관: 0, 정관: 0, 편인: 0, 정인: 0 };
  const shipsinGroup = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  pillars.forEach(p => {
    [p.stemShipsinKo, p.branchShipsinKo].forEach(s => {
      if (s && shipsinDetail.hasOwnProperty(s)) { shipsinDetail[s]++; shipsinGroup[GROUP[s]]++; }
    });
  });
  // 강약 등급(개수 기준): 0=없음, 1=약함, 2=보통, 3=강함, 4+=과다
  const grade = (n) => n === 0 ? '없음' : n === 1 ? '약함' : n === 2 ? '보통' : n === 3 ? '강함' : '과다';
  const ohaengGrade = {}; Object.keys(ohaeng).forEach(k => ohaengGrade[k] = grade(ohaeng[k]));
  const shipsinGroupGrade = {}; Object.keys(shipsinGroup).forEach(k => shipsinGroupGrade[k] = grade(shipsinGroup[k]));
  const lacking = Object.keys(ohaeng).filter(k => ohaeng[k] === 0);   // 아예 없는 오행
  const missingShipsin = Object.keys(shipsinGroup).filter(k => shipsinGroup[k] === 0); // 없는 십신 그룹
  // 신강/신약은 용신 reason에 이미 판정됨
  const sinKangYak = /신강/.test((r.yongshin && r.yongshin.reason) || '') ? '신강'
    : /신약/.test((r.yongshin && r.yongshin.reason) || '') ? '신약' : '중화';
  return { ohaeng, ohaengGrade, lacking, shipsinDetail, shipsinGroup, shipsinGroupGrade, missingShipsin, sinKangYak };
}
const counts = buildCounts(result);

if (a.json) {
  console.log(JSON.stringify({ input: a, result, counts, scores: { medical: medScore, marriage: marScore } }, null, 2));
  process.exit(0);
}

// ---------- 사람이 읽는 출력(봇이 그대로 참고) ----------
const KO = SD.constants;
const warns = [];
if (!a.hourGiven) warns.push('시(時) 미상 → 정오로 가정함. 시주·일부 신살은 불확실 (정확히 보려면 태어난 시간 필요).');
if (!a.genderGiven) warns.push('성별 미입력 → 남자로 가정함 (의사 인연 점수는 성별에 따라 달라짐).');

const lines = [];
lines.push('═══ 명식 계산 결과 (이 데이터에 근거해서만 답글 작성) ═══');
lines.push(`[입력] ${a.isLunar ? '음력' : '양력'} ${a.year}-${String(a.month).padStart(2,'0')}-${String(a.day).padStart(2,'0')} ${a.hourGiven ? String(a.hour).padStart(2,'0')+':'+String(a.minute).padStart(2,'0') : '(시 미상)'} / ${a.gender}`);
lines.push('');
lines.push(SD.toPromptContext(result));
lines.push('');
lines.push('[오행 개수] (소수점 가중치 아님 — 실제 글자 개수로 풀이할 것)');
lines.push(['木','火','土','金','水'].map(k => `${k} ${counts.ohaeng[k]}개(${counts.ohaengGrade[k]})`).join(' / '));
if (counts.lacking.length) lines.push(`→ 아예 없는 오행: ${counts.lacking.join('·')}`);
lines.push('[십신 그룹 개수]');
lines.push(['비겁','식상','재성','관성','인성'].map(k => `${k} ${counts.shipsinGroup[k]}개(${counts.shipsinGroupGrade[k]})`).join(' / '));
if (counts.missingShipsin.length) lines.push(`→ 없는 십신: ${counts.missingShipsin.join('·')}`);
lines.push(`[신강/신약] ${counts.sinKangYak}`);
lines.push('');

// 신살 요약
const shinsalSummary = [];
['year','month','day','hour'].forEach(k => {
  const m = result.manse && result.manse[k];
  if (m && m.shinsals && m.shinsals.length) {
    const pos = { year:'연지', month:'월지', day:'일지', hour:'시지' }[k];
    shinsalSummary.push(`${pos} ${m.branchKo}: ${m.shinsals.join('·')}`);
  }
});
lines.push('[신살] ' + (shinsalSummary.length ? shinsalSummary.join(' / ') : '주요 신살 없음'));
lines.push('');
lines.push('[사주닥터 점수]');
lines.push(`의대 적성: ${medScore}/100`);
lines.push(`의사 인연: ${marScore}/100  (${a.gender} 기준)`);
lines.push('');
lines.push('[일주] ' + result.palja.dayPillar.stem + result.palja.dayPillar.branch +
  ' (' + KO.STEM_KO[result.palja.dayPillar.stem] + KO.BRANCH_KO[result.palja.dayPillar.branch] + ')');

if (warns.length) {
  lines.push('');
  lines.push('⚠ 주의: ' + warns.join(' / '));
}
console.log(lines.join('\n'));
