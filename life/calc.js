(function (root) {

  function calcCost(d) {
    if (!d) return 0;
    const capex = (d.price != null && d.qty != null && d.life != null) ? d.qty * d.price / d.life / 12 : 0;
    const opex  = (d.freq != null && d.period != null && d.unit != null) ? d.freq * d.period * d.unit / 12 : 0;
    const con   = (d.conP != null && d.conL != null) ? d.conP / d.conL / 12 : 0;
    return capex + opex + con;
  }

  function filterByHousehold(items, hh) {
    return items.filter(i => i.가구 && i.가구[hh] === 'O');
  }

  function getCategoriesInOrder(items) {
    const seen = [];
    items.forEach(i => { if (!seen.includes(i.대분류)) seen.push(i.대분류); });
    return seen;
  }

  function categorySubtotal(items, cat, personaKey) {
    return items
      .filter(i => i.대분류 === cat)
      .reduce((sum, i) => sum + calcCost(i[personaKey]), 0);
  }

  function groupByUid(items, personaKey) {
    const order = [];
    const map = new Map();
    items.forEach(i => {
      const key = i.대분류 + '::' + i.uid;
      if (!map.has(key)) {
        map.set(key, { uid: i.uid, 대분류: i.대분류, 소분류: i.소분류, total: 0 });
        order.push(key);
      }
      map.get(key).total += calcCost(i[personaKey]);
    });
    return order.map(k => map.get(k));
  }

  function groupItemsByUid(items, personaKey) {
    const order = [];
    const map = new Map();
    items.forEach(i => {
      const key = i.대분류 + '::' + i.uid;
      if (!map.has(key)) {
        map.set(key, { uid: i.uid, 대분류: i.대분류, 소분류: i.소분류, items: [] });
        order.push(key);
      }
      const p = i[personaKey];
      map.get(key).items.push({
        idx: i._idx,
        아이템: i.아이템,
        approach: p ? p.approach : null,
        실행: p ? p.실행 : null,
        cost: calcCost(p),
        vars: p,
      });
    });
    return order.map(k => map.get(k));
  }

  function grandTotal(items, catPersonaMap) {
    return getCategoriesInOrder(items)
      .reduce((sum, cat) => sum + categorySubtotal(items, cat, catPersonaMap[cat]), 0);
  }

  // ── 재무 프로젝션 (Phase 3) ──

  const TROPHIES = {
    '세컨카':      { price: 50000000,  opex: 100000 },
    '농막':        { price: 100000000, opex: 100000 },
    '세컨하우스':  { price: 250000000, opex: 200000 },
    '창작공간':    { price: 250000000, opex: 200000 },
    '산섬':        { price: 500000000, opex: 500000 },
    '풀빌라회원권': { price: 100000000, opex: 1000000 },
    '골프회원권':  { price: 50000000,  opex: 1000000 },
    '포르쉐':      { price: 150000000, opex: 500000 },
    '크루즈3개월': { price: 106000000, opex: 0 },
    '해외여행1년': { price: 100000000, opex: 0 },
  };

  // trophyStack: [{trophy, year}] — year = 구매가 일어나는 연차(1-indexed)
  function trophyOpexSumAtYear(trophyStack, year, trophyDefs) {
    return trophyStack
      .filter(t => t.year <= year)
      .reduce((sum, t) => sum + trophyDefs[t.trophy].opex, 0);
  }

  // params: monthlyIncome, years, annualReturn(%), retireYear, baseMonthlyCost, trophyStack, trophyDefs,
  //         loan?, initialAssets?, ownedTrophyOpex?
  // loan(선택): { principal, termYears, rate(%) } — 원금은 CAPEX식 정액상환(termYears에 걸쳐 매달 균등),
  // 이자는 잔액 기준 매달 재계산(OPEX식이지만 동적), termYears 지나면 상환 완료로 소멸.
  // initialAssets(선택): 프로젝션 시작 시점의 현재 금융자산(스칼라, 기본 0)
  // ownedTrophyOpex(선택): 이미 보유 중인 트로피들의 OPEX 합(가격은 차감하지 않고 OPEX만 시작부터 반영)
  // 반환: [{year, assets, retired, investmentIncome, loanBalance, trophyOpex, trophyPurchased}] (연말 스냅샷)
  // assets = 순자산(투자자산 cash - 대출잔액loanBalance) — 대출 있으면 시작 시점부터 마이너스로 표시됨
  // trophyOpex = 그 해 활성화된 트로피(구매분+기보유분) OPEX 합, trophyPurchased = 그 해 새로 구매한 트로피명('/' 구분)
  function simulateProjection(params) {
    const { monthlyIncome, years, annualReturn, retireYear, baseMonthlyCost, trophyStack, trophyDefs, loan, initialAssets, ownedTrophyOpex } = params;
    let cash = initialAssets || 0;
    let loanBalance = loan ? loan.principal : 0;
    const monthlyPrincipal = (loan && loan.termYears > 0) ? loan.principal / loan.termYears / 12 : 0;
    const baseOwnedOpex = ownedTrophyOpex || 0;
    const yearly = [];
    for (let month = 1; month <= years * 12; month++) {
      const year = Math.ceil(month / 12);
      if ((month - 1) % 12 === 0) {
        trophyStack.filter(t => t.year === year).forEach(t => { cash -= trophyDefs[t.trophy].price; });
      }
      const activeOpex = trophyOpexSumAtYear(trophyStack, year, trophyDefs) + baseOwnedOpex;
      const retired = year > retireYear;

      let principalPayment = 0, interestPayment = 0;
      if (loanBalance > 0) {
        interestPayment = loanBalance * loan.rate / 100 / 12;
        principalPayment = Math.min(monthlyPrincipal, loanBalance);
        loanBalance -= principalPayment;
      }

      const investmentIncome = cash * annualReturn / 100 / 12;
      const laborIncome = retired ? 0 : monthlyIncome;
      const savings = (laborIncome - baseMonthlyCost - activeOpex - principalPayment - interestPayment) + investmentIncome;
      cash += savings;

      if (month % 12 === 0) {
        yearly.push({
          year, assets: cash - loanBalance, retired, investmentIncome: cash * annualReturn / 100 / 12, loanBalance,
          trophyOpex: activeOpex,
          trophyPurchased: trophyStack.filter(t => t.year === year).map(t => t.trophy).join('/'),
        });
      }
    }
    return yearly;
  }

  // 트로피는 지출 재생산(FI) 달성 이후에만 선택 가능하고, 추가했다고 가정한 뒤
  // 전체 시뮬레이션을 다시 돌려서 남은 기간 내내 자산이 마이너스로 가지 않는지도 검증한다.
  // params: monthlyIncome, years, annualReturn, retireYear, baseMonthlyCost, trophyDefs
  function canAddTrophy(params, trophyStack, candidateName, candidateYear) {
    const baseSim = simulateProjection({ ...params, trophyStack });
    const fiYear = firstFiYear(baseSim, params.baseMonthlyCost);
    if (fiYear === null || candidateYear < fiYear) return false;

    const hypotheticalStack = trophyStack.concat([{ trophy: candidateName, year: candidateYear }]);
    const sim = simulateProjection({ ...params, trophyStack: hypotheticalStack });
    return sim.every(p => p.assets >= 0);
  }

  function firstFiYear(yearlyResults, baseMonthlyCost) {
    const hit = yearlyResults.find(p => p.investmentIncome > baseMonthlyCost);
    return hit ? hit.year : null;
  }

  const api = {
    calcCost, filterByHousehold, getCategoriesInOrder, categorySubtotal, groupByUid, groupItemsByUid, grandTotal,
    TROPHIES, simulateProjection, trophyOpexSumAtYear, canAddTrophy, firstFiYear,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }

})(typeof window !== 'undefined' ? window : globalThis);
