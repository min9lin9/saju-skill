/* ============================================================
   사주닥터 — Saju Calculation Framework
   ============================================================
   Wraps lunar-javascript (CDN) for 만세력 → 팔자 → 십신 → 오행
   Exposes: window.SajuDoctor

   Dependencies (load before this file):
     <script src="https://cdn.jsdelivr.net/npm/lunar-javascript@1.7.6/lunar.min.js"></script>

   Output shape (SajuDoctor.analyze):
   {
     palja:    { yearPillar, monthPillar, dayPillar, hourPillar },
     ilgan:    { char, ohaeng, yinyang },
     ohaeng:   { 木:n, 火:n, 土:n, 金:n, 水:n, dominant, lacking },
     shipsin:  { 比肩, 劫財, 食神, 傷官, 偏財, 正財, 偏官, 正官, 偏印, 正印 },
     kyukguk:  추정 격국 (간단 룰),
     yongshin: 추정 용신,
     daewoon:  10년 단위 대운 리스트,
     meta:     { gender, solar, lunar }
   }
   ============================================================ */

(function (global) {
  'use strict';

  // ============== 상수 ==============

  const HEAVENLY_STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const EARTHLY_BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

  // 천간 오행 (yang/yin)
  const STEM_OHAENG = {
    '甲': { ohaeng: '木', yinyang: '양' },
    '乙': { ohaeng: '木', yinyang: '음' },
    '丙': { ohaeng: '火', yinyang: '양' },
    '丁': { ohaeng: '火', yinyang: '음' },
    '戊': { ohaeng: '土', yinyang: '양' },
    '己': { ohaeng: '土', yinyang: '음' },
    '庚': { ohaeng: '金', yinyang: '양' },
    '辛': { ohaeng: '金', yinyang: '음' },
    '壬': { ohaeng: '水', yinyang: '양' },
    '癸': { ohaeng: '水', yinyang: '음' }
  };

  // 지지 — 지장간 (본기/중기/여기 비율)
  const BRANCH_HIDDEN = {
    '子': [{ stem: '癸', weight: 1.0 }],
    '丑': [{ stem: '己', weight: 0.6 }, { stem: '癸', weight: 0.2 }, { stem: '辛', weight: 0.2 }],
    '寅': [{ stem: '甲', weight: 0.6 }, { stem: '丙', weight: 0.2 }, { stem: '戊', weight: 0.2 }],
    '卯': [{ stem: '乙', weight: 1.0 }],
    '辰': [{ stem: '戊', weight: 0.6 }, { stem: '乙', weight: 0.2 }, { stem: '癸', weight: 0.2 }],
    '巳': [{ stem: '丙', weight: 0.6 }, { stem: '戊', weight: 0.2 }, { stem: '庚', weight: 0.2 }],
    '午': [{ stem: '丁', weight: 0.7 }, { stem: '己', weight: 0.3 }],
    '未': [{ stem: '己', weight: 0.6 }, { stem: '丁', weight: 0.2 }, { stem: '乙', weight: 0.2 }],
    '申': [{ stem: '庚', weight: 0.6 }, { stem: '壬', weight: 0.2 }, { stem: '戊', weight: 0.2 }],
    '酉': [{ stem: '辛', weight: 1.0 }],
    '戌': [{ stem: '戊', weight: 0.6 }, { stem: '辛', weight: 0.2 }, { stem: '丁', weight: 0.2 }],
    '亥': [{ stem: '壬', weight: 0.7 }, { stem: '甲', weight: 0.3 }]
  };

  // 한자 → 한글 음 (UI 표시용)
  const STEM_KO = {
    '甲':'갑','乙':'을','丙':'병','丁':'정','戊':'무',
    '己':'기','庚':'경','辛':'신','壬':'임','癸':'계'
  };
  const BRANCH_KO = {
    '子':'자','丑':'축','寅':'인','卯':'묘','辰':'진','巳':'사',
    '午':'오','未':'미','申':'신','酉':'유','戌':'술','亥':'해'
  };

  // 십신 계산: 일간 vs 다른 천간
  // (일간 음양, 일간 오행) × (대상 음양, 대상 오행)
  function getShipsin(dayStem, targetStem) {
    const day = STEM_OHAENG[dayStem];
    const target = STEM_OHAENG[targetStem];
    if (!day || !target) return null;

    const sameYY = day.yinyang === target.yinyang;
    const dO = day.ohaeng;
    const tO = target.ohaeng;

    // 생극 관계
    // 木生火 火生土 土生金 金生水 水生木
    // 木克土 土克水 水克火 火克金 金克木

    if (dO === tO) {
      return sameYY ? '比肩' : '劫財';
    }
    // 일간이 생하는 것 (식상)
    if (productOf(dO) === tO) {
      return sameYY ? '食神' : '傷官';
    }
    // 일간이 극하는 것 (재성)
    if (controlsOf(dO) === tO) {
      return sameYY ? '偏財' : '正財';
    }
    // 일간을 극하는 것 (관성)
    if (controlsOf(tO) === dO) {
      return sameYY ? '偏官' : '正官';
    }
    // 일간을 생하는 것 (인성)
    if (productOf(tO) === dO) {
      return sameYY ? '偏印' : '正印';
    }
    return null;
  }

  function productOf(ohaeng) {
    return { '木':'火', '火':'土', '土':'金', '金':'水', '水':'木' }[ohaeng];
  }
  function controlsOf(ohaeng) {
    return { '木':'土', '火':'金', '土':'水', '金':'木', '水':'火' }[ohaeng];
  }

  // ============== 메인 분석 함수 ==============

  /**
   * @param {Object} input
   *   year, month, day, hour, minute  — 양력
   *   gender    — '남' | '여'
   *   isLunar   — boolean (default false: 양력)
   *   isLeap    — boolean (음력 윤달 여부, default false)
   * @returns {Object} 분석 결과
   */
  function analyze(input) {
    if (!global.Lunar || !global.Solar) {
      throw new Error('lunar-javascript 라이브러리가 로드되지 않았습니다. <script src="https://cdn.jsdelivr.net/npm/lunar-javascript@1.7.6/lunar.min.js"></script> 추가 필요');
    }

    const { year, month, day, hour, minute = 0, gender, isLunar = false, isLeap = false } = input;

    // 1) 양력으로 변환
    let solar;
    if (isLunar) {
      const lunar = global.Lunar.fromYmdHms(year, month, day, hour, minute, 0);
      solar = lunar.getSolar();
    } else {
      solar = global.Solar.fromYmdHms(year, month, day, hour, minute, 0);
    }
    const lunar = solar.getLunar();

    // 2) 사주팔자 (EightChar)
    const ec = lunar.getEightChar();
    const yearPillar  = { stem: ec.getYearGan(),  branch: ec.getYearZhi() };
    const monthPillar = { stem: ec.getMonthGan(), branch: ec.getMonthZhi() };
    const dayPillar   = { stem: ec.getDayGan(),   branch: ec.getDayZhi() };
    const hourPillar  = { stem: ec.getTimeGan(),  branch: ec.getTimeZhi() };

    const dayStem = dayPillar.stem;
    const ilgan = {
      char: dayStem,
      ko: STEM_KO[dayStem],
      ...STEM_OHAENG[dayStem]
    };

    // 3) 오행 분포 (천간 + 지장간 가중)
    const ohaeng = { '木': 0, '火': 0, '土': 0, '金': 0, '水': 0 };

    [yearPillar, monthPillar, dayPillar, hourPillar].forEach(p => {
      // 천간 (가중 1.0)
      ohaeng[STEM_OHAENG[p.stem].ohaeng] += 1.0;
      // 지장간
      const hidden = BRANCH_HIDDEN[p.branch] || [];
      hidden.forEach(h => {
        ohaeng[STEM_OHAENG[h.stem].ohaeng] += h.weight;
      });
    });

    // 정수화
    Object.keys(ohaeng).forEach(k => {
      ohaeng[k] = Math.round(ohaeng[k] * 10) / 10;
    });

    const ohaengEntries = Object.entries(ohaeng).sort((a, b) => b[1] - a[1]);
    ohaeng.dominant = ohaengEntries[0][0];
    ohaeng.lacking = ohaengEntries[4][0];

    // 4) 십신 분포
    const shipsin = {
      '比肩': 0, '劫財': 0, '食神': 0, '傷官': 0, '偏財': 0,
      '正財': 0, '偏官': 0, '正官': 0, '偏印': 0, '正印': 0
    };

    // 천간 4개 (일간 제외 3개)
    [yearPillar.stem, monthPillar.stem, hourPillar.stem].forEach(s => {
      const sh = getShipsin(dayStem, s);
      if (sh) shipsin[sh] += 1;
    });

    // 지장간 (가중)
    [yearPillar.branch, monthPillar.branch, dayPillar.branch, hourPillar.branch].forEach(b => {
      const hidden = BRANCH_HIDDEN[b] || [];
      hidden.forEach(h => {
        const sh = getShipsin(dayStem, h.stem);
        if (sh) shipsin[sh] += h.weight;
      });
    });

    Object.keys(shipsin).forEach(k => {
      shipsin[k] = Math.round(shipsin[k] * 10) / 10;
    });

    // 5) 격국 추정 (간단 룰)
    // 월지의 본기 십신이 격국 후보 (정관/식신/편재/편인 등)
    const monthMainStem = BRANCH_HIDDEN[monthPillar.branch][0].stem;
    const monthShipsin = getShipsin(dayStem, monthMainStem);
    const kyukgukMap = {
      '正官': '정관격', '偏官': '편관격(칠살격)',
      '正財': '정재격', '偏財': '편재격',
      '正印': '정인격', '偏印': '편인격',
      '食神': '식신격', '傷官': '상관격',
      '比肩': '건록격', '劫財': '양인격'
    };
    const kyukguk = kyukgukMap[monthShipsin] || '잡격';

    // 6) 용신 추정 (간단: 부족한 오행 + 일간 신강/신약 고려)
    // 강한 오행 ≥ 3.5 ⇒ 신강, 식상/재성/관성으로 설기
    // 약한 일간 ⇒ 인성/비겁으로 보강
    const ilganOhaeng = ilgan.ohaeng;
    const ilganStrength = ohaeng[ilganOhaeng];
    const isStrong = ilganStrength >= 3.0;
    let yongshin;
    if (isStrong) {
      // 신강 — 일간을 설기하는 오행 (식상/재성/관성)
      const drain = productOf(ilganOhaeng);
      yongshin = { ohaeng: drain, reason: '신강 — 설기 필요' };
    } else {
      // 신약 — 일간을 돕는 오행 (인성/비겁)
      const support = Object.entries({
        '木':'水','火':'木','土':'火','金':'土','水':'金'
      }).find(([k]) => k === ilganOhaeng);
      yongshin = { ohaeng: support[1], reason: '신약 — 보강 필요' };
    }

    // 7) 대운 (10년 단위, 8개)
    const yun = ec.getYun(gender === '남' ? 1 : 0);
    const daewoonList = yun.getDaYun().slice(0, 9).map(d => ({
      startYear: d.getStartYear(),
      startAge: d.getStartAge(),
      ganZhi: d.getGanZhi(),
      stem: d.getGanZhi()[0],
      branch: d.getGanZhi()[1]
    }));

    // 결과
    return {
      palja: { yearPillar, monthPillar, dayPillar, hourPillar },
      ilgan,
      ohaeng,
      shipsin,
      kyukguk,
      yongshin,
      daewoon: daewoonList,
      meta: {
        gender,
        solar: { y: solar.getYear(), m: solar.getMonth(), d: solar.getDay(), h: solar.getHour() },
        lunar: { y: lunar.getYear(), m: lunar.getMonth(), d: lunar.getDay(), isLeap: lunar.getMonth() < 0 }
      }
    };
  }

  // ============== AI 프롬프트 컨텍스트 빌더 ==============
  /**
   * 분석 결과 → Gemini Flash 프롬프트용 컨텍스트 문자열
   * AI 모델에 넘기기 전에 사람이 읽기 쉬운 명리 데이터로 변환
   */
  function toPromptContext(result) {
    const p = result.palja;
    const lines = [];

    lines.push('[사주 명식]');
    lines.push(`연주: ${p.yearPillar.stem}${p.yearPillar.branch} (${STEM_KO[p.yearPillar.stem]}${BRANCH_KO[p.yearPillar.branch]})`);
    lines.push(`월주: ${p.monthPillar.stem}${p.monthPillar.branch} (${STEM_KO[p.monthPillar.stem]}${BRANCH_KO[p.monthPillar.branch]})`);
    lines.push(`일주: ${p.dayPillar.stem}${p.dayPillar.branch} (${STEM_KO[p.dayPillar.stem]}${BRANCH_KO[p.dayPillar.branch]}) ★ 일간`);
    lines.push(`시주: ${p.hourPillar.stem}${p.hourPillar.branch} (${STEM_KO[p.hourPillar.stem]}${BRANCH_KO[p.hourPillar.branch]})`);

    lines.push('');
    lines.push('[일간]');
    lines.push(`${result.ilgan.char} (${result.ilgan.ko}) — ${result.ilgan.ohaeng} ${result.ilgan.yinyang}`);

    lines.push('');
    lines.push('[오행 분포]');
    ['木','火','土','金','水'].forEach(k => {
      lines.push(`${k}: ${result.ohaeng[k]}`);
    });
    lines.push(`강한 오행: ${result.ohaeng.dominant} / 부족한 오행: ${result.ohaeng.lacking}`);

    lines.push('');
    lines.push('[십신 분포]');
    Object.entries(result.shipsin).forEach(([k, v]) => {
      if (v > 0) lines.push(`${k}: ${v}`);
    });

    lines.push('');
    lines.push(`[격국 후보] ${result.kyukguk}`);
    lines.push(`[용신 후보] ${result.yongshin.ohaeng} — ${result.yongshin.reason}`);

    lines.push('');
    lines.push('[대운 (10년 단위)]');
    result.daewoon.forEach(d => {
      lines.push(`${d.startYear}년~ (${d.startAge}세~) ${d.ganZhi}`);
    });

    return lines.join('\n');
  }

  // ============== 의대/의사 특화 분석 (USP 차별점) ==============

  /**
   * 의대 적성 점수 (1-100)
   * 학업운 핵심 지표: 인성(印星) + 식신(食神) + 일간 안정성
   */
  function getMedicalAptitudeScore(result) {
    if (!result || !result.shipsin || !result.ohaeng || !result.ilgan) return 50;
    const sp = (k) => Number(result.shipsin[k]) || 0;
    const印 = sp('正印') + sp('偏印') * 0.7;
    const식 = sp('食神') + sp('傷官') * 0.5;
    const官 = sp('正官') + sp('偏官') * 0.7;
    const比 = sp('比肩') + sp('劫財') * 0.5;

    // 인성/식신/관성 균형이 핵심
    let score = 0;
    score += Math.min(印, 3) * 12;  // 인성 (학업 흡수력)
    score += Math.min(식, 2) * 10;  // 식신 (사고력)
    score += Math.min(官, 2) * 10;  // 관성 (자기관리)
    score += Math.min(比, 2) * 6;   // 비겁 (체력)

    // 오행 균형 가점
    const values = ['木','火','土','金','水'].map(k => result.ohaeng[k]);
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max - min < 3.5) score += 8;  // 균형 가점

    // 일간 강도 보정 (너무 약하면 감점)
    const ilganStrength = result.ohaeng[result.ilgan.ohaeng];
    if (ilganStrength < 1.5) score -= 8;
    if (ilganStrength > 5.5) score -= 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * 의사 인연 점수 (1-100)
   * 관성(官星) + 재성(財星) + 도화/홍염 신살 고려
   */
  function getDoctorMarriageScore(result, gender) {
    if (!result || !result.shipsin || !result.ohaeng || !result.ilgan) return 50;
    const sp = (k) => Number(result.shipsin[k]) || 0;
    const官 = sp('正官') + sp('偏官') * 0.8;
    const財 = sp('正財') + sp('偏財') * 0.7;
    const印 = sp('正印') + sp('偏印') * 0.5;

    let score = 0;

    // 여성: 관성이 배우자 (의사 = 관성 강함)
    // 남성: 재성이 배우자
    if (gender === '여') {
      score += Math.min(官, 3) * 14;  // 관성
      score += Math.min(印, 2) * 8;   // 인성 (의사 직군 친화)
      score += Math.min(財, 2) * 6;   // 재성
    } else {
      score += Math.min(財, 3) * 12;
      score += Math.min(官, 2) * 8;
      score += Math.min(印, 2) * 8;
    }

    // 도화살 (子卯酉午 중 일지)
    const dayBranch = result.palja.dayPillar.branch;
    if (['子','卯','酉','午'].includes(dayBranch)) score += 8;

    // 일간 강도
    const ilganStrength = result.ohaeng[result.ilgan.ohaeng];
    if (ilganStrength >= 2.0 && ilganStrength <= 4.5) score += 6;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ============== 위치별 십성 / 12운성 / 신살 (만세력 풍부화) ==============
  const SHIPSIN_KO = {
    '比肩': '비견', '劫財': '겁재',
    '食神': '식신', '傷官': '상관',
    '偏財': '편재', '正財': '정재',
    '偏官': '편관', '正官': '정관',
    '偏印': '편인', '正印': '정인'
  };

  const BRANCH_MAIN_STEM = {
    '子':'癸','丑':'己','寅':'甲','卯':'乙','辰':'戊','巳':'丙',
    '午':'丁','未':'己','申':'庚','酉':'辛','戌':'戊','亥':'壬'
  };

  const UNSEONG_TABLE = {
    '甲': { '亥':'장생','子':'목욕','丑':'관대','寅':'건록','卯':'제왕','辰':'쇠','巳':'병','午':'사','未':'묘','申':'절','酉':'태','戌':'양' },
    '乙': { '午':'장생','巳':'목욕','辰':'관대','卯':'건록','寅':'제왕','丑':'쇠','子':'병','亥':'사','戌':'묘','酉':'절','申':'태','未':'양' },
    '丙': { '寅':'장생','卯':'목욕','辰':'관대','巳':'건록','午':'제왕','未':'쇠','申':'병','酉':'사','戌':'묘','亥':'절','子':'태','丑':'양' },
    '丁': { '酉':'장생','申':'목욕','未':'관대','午':'건록','巳':'제왕','辰':'쇠','卯':'병','寅':'사','丑':'묘','子':'절','亥':'태','戌':'양' },
    '戊': { '寅':'장생','卯':'목욕','辰':'관대','巳':'건록','午':'제왕','未':'쇠','申':'병','酉':'사','戌':'묘','亥':'절','子':'태','丑':'양' },
    '己': { '酉':'장생','申':'목욕','未':'관대','午':'건록','巳':'제왕','辰':'쇠','卯':'병','寅':'사','丑':'묘','子':'절','亥':'태','戌':'양' },
    '庚': { '巳':'장생','午':'목욕','未':'관대','申':'건록','酉':'제왕','戌':'쇠','亥':'병','子':'사','丑':'묘','寅':'절','卯':'태','辰':'양' },
    '辛': { '子':'장생','亥':'목욕','戌':'관대','酉':'건록','申':'제왕','未':'쇠','午':'병','巳':'사','辰':'묘','卯':'절','寅':'태','丑':'양' },
    '壬': { '申':'장생','酉':'목욕','戌':'관대','亥':'건록','子':'제왕','丑':'쇠','寅':'병','卯':'사','辰':'묘','巳':'절','午':'태','未':'양' },
    '癸': { '卯':'장생','寅':'목욕','丑':'관대','子':'건록','亥':'제왕','戌':'쇠','酉':'병','申':'사','未':'묘','午':'절','巳':'태','辰':'양' }
  };

  // 신살 — 연지 기준
  const SHINSAL_DOHWA = { '寅':'卯','午':'卯','戌':'卯','申':'酉','子':'酉','辰':'酉','亥':'子','卯':'子','未':'子','巳':'午','酉':'午','丑':'午' };
  const SHINSAL_YEONGMA = { '寅':'申','午':'申','戌':'申','申':'寅','子':'寅','辰':'寅','亥':'巳','卯':'巳','未':'巳','巳':'亥','酉':'亥','丑':'亥' };
  const SHINSAL_HWAGAE = { '寅':'戌','午':'戌','戌':'戌','申':'辰','子':'辰','辰':'辰','亥':'未','卯':'未','未':'未','巳':'丑','酉':'丑','丑':'丑' };
  const SHINSAL_JANGSEONG = { '寅':'午','午':'午','戌':'午','申':'子','子':'子','辰':'子','亥':'卯','卯':'卯','未':'卯','巳':'酉','酉':'酉','丑':'酉' };

  /**
   * 사주 결과에 위치별 십성/운성/신살을 추가 (만세력 표 렌더링용)
   */
  function enrichManse(result) {
    try {
      if (!result || !result.palja || !result.ilgan) return result;
      const dayStem = result.palja.dayPillar.stem;
      const yearBranch = result.palja.yearPillar.branch;

      const pillars = ['year','month','day','hour'];
      const manse = {};
      pillars.forEach(k => {
        const pill = result.palja[k + 'Pillar'];
        if (!pill) return;
        const stem = pill.stem;
        const branch = pill.branch;
        const stemShipsin = (k === 'day') ? null : getShipsin(dayStem, stem);
        const mainHidden = BRANCH_MAIN_STEM[branch];
        const branchShipsin = mainHidden ? getShipsin(dayStem, mainHidden) : null;
        const unseong = UNSEONG_TABLE[dayStem]?.[branch] || '';
        const shinsals = [];
        if (SHINSAL_DOHWA[yearBranch] === branch) shinsals.push('도화');
        if (SHINSAL_YEONGMA[yearBranch] === branch) shinsals.push('역마');
        if (SHINSAL_HWAGAE[yearBranch] === branch) shinsals.push('화개');
        if (SHINSAL_JANGSEONG[yearBranch] === branch) shinsals.push('장성');

        manse[k] = {
          stem, branch,
          stemKo: STEM_KO[stem], branchKo: BRANCH_KO[branch],
          stemOhaeng: STEM_OHAENG[stem]?.ohaeng,
          stemYinyang: STEM_OHAENG[stem]?.yinyang,
          branchOhaeng: STEM_OHAENG[mainHidden]?.ohaeng,
          branchYinyang: STEM_OHAENG[mainHidden]?.yinyang,
          stemShipsin, stemShipsinKo: stemShipsin ? SHIPSIN_KO[stemShipsin] : null,
          branchShipsin, branchShipsinKo: branchShipsin ? SHIPSIN_KO[branchShipsin] : null,
          unseong,
          shinsals
        };
      });
      result.manse = manse;
      return result;
    } catch (e) {
      console.error('[enrichManse]', e);
      return result;
    }
  }

  // ============== Export ==============
  global.SajuDoctor = {
    analyze,
    toPromptContext,
    getMedicalAptitudeScore,
    getDoctorMarriageScore,
    enrichManse,
    constants: {
      HEAVENLY_STEMS,
      EARTHLY_BRANCHES,
      STEM_OHAENG,
      STEM_KO,
      BRANCH_KO,
      SHIPSIN_KO
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
