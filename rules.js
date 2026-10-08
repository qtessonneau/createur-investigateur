(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.Rules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATS = ["FOR", "CON", "TAI", "DEX", "APP", "INT", "POU", "ÉDU"];

  const AGE_BANDS = [
    { id: "15", min: 15, max: 19, eduDelta: -5, checks: 0, app: 0, mov: 0, luckRolls: 2, pools: [{ stats: ["FOR", "TAI"], points: 5 }] },
    { id: "20", min: 20, max: 39, eduDelta: 0, checks: 1, app: 0, mov: 0, luckRolls: 1, pools: [] },
    { id: "40", min: 40, max: 49, eduDelta: 0, checks: 2, app: 5, mov: 1, luckRolls: 1, pools: [{ stats: ["FOR", "CON", "DEX"], points: 5 }] },
    { id: "50", min: 50, max: 59, eduDelta: 0, checks: 3, app: 10, mov: 2, luckRolls: 1, pools: [{ stats: ["FOR", "CON", "DEX"], points: 10 }] },
    { id: "60", min: 60, max: 69, eduDelta: 0, checks: 4, app: 15, mov: 3, luckRolls: 1, pools: [{ stats: ["FOR", "CON", "DEX"], points: 20 }] },
    { id: "70", min: 70, max: 79, eduDelta: 0, checks: 4, app: 20, mov: 4, luckRolls: 1, pools: [{ stats: ["FOR", "CON", "DEX"], points: 40 }] },
    { id: "80", min: 80, max: 89, eduDelta: 0, checks: 4, app: 25, mov: 5, luckRolls: 1, pools: [{ stats: ["FOR", "CON", "DEX"], points: 80 }] },
  ];

  const CASH = {
    "1920": [
      { max: 0, label: "Indigent", cash: function () { return 0.5; }, assets: function () { return 0; }, spend: 0.5 },
      { max: 9, label: "Pauvre", cash: function (cr) { return cr * 1; }, assets: function (cr) { return cr * 10; }, spend: 2 },
      { max: 49, label: "Moyen", cash: function (cr) { return cr * 2; }, assets: function (cr) { return cr * 50; }, spend: 10 },
      { max: 89, label: "Aisé", cash: function (cr) { return cr * 5; }, assets: function (cr) { return cr * 500; }, spend: 50 },
      { max: 98, label: "Riche", cash: function (cr) { return cr * 20; }, assets: function (cr) { return cr * 2000; }, spend: 250 },
      { max: 99, label: "Richissime", cash: function () { return 50000; }, assets: function () { return 5000000; }, spend: 5000 },
    ],
  };

  function bandFor(age) {
    const n = Number(age);
    return AGE_BANDS.find(function (b) { return n >= b.min && n <= b.max; }) || AGE_BANDS[1];
  }

  function half(n) { return Math.floor(Number(n) / 2); }
  function fifth(n) { return Math.floor(Number(n) / 5); }

  function impact(str, siz) {
    const total = (Number(str) || 0) + (Number(siz) || 0);
    const rows = [
      [64, "−2", -2],
      [84, "−1", -1],
      [124, "Aucun", 0],
      [164, "+1D4", 1],
      [204, "+1D6", 2],
      [284, "+2D6", 3],
      [364, "+3D6", 4],
      [444, "+4D6", 5],
      [9999, "+5D6", 6],
    ];
    for (let i = 0; i < rows.length; i++) {
      if (total <= rows[i][0]) return { total: total, text: rows[i][1], build: rows[i][2] };
    }
    return { total: total, text: "+5D6", build: 6 };
  }

  function movement(str, dex, siz, age) {
    str = Number(str) || 0;
    dex = Number(dex) || 0;
    siz = Number(siz) || 0;
    let mov = 8;
    if (str < siz && dex < siz) mov = 7;
    else if (str > siz && dex > siz) mov = 9;
    return Math.max(0, mov - bandFor(age).mov);
  }

  function hitPoints(con, siz) {
    return Math.floor(((Number(con) || 0) + (Number(siz) || 0)) / 10);
  }

  function magicPoints(pow) {
    return Math.floor((Number(pow) || 0) / 5);
  }

  function eduSequence(startEdu, checks) {
    let edu = Math.max(0, Number(startEdu) || 0);
    const detail = [];
    (checks || []).forEach(function (c) {
      const roll = Number(c.roll);
      const success = roll > edu;
      let gain = 0;
      if (success && c.die) gain = Math.min(Number(c.die) || 0, Math.max(0, 99 - edu));
      detail.push({
        roll: roll,
        eduBefore: edu,
        success: success,
        gain: gain,
        die: c.die || 0,
        needsDie: success && !c.die,
      });
      edu += gain;
    });
    return { edu: Math.min(99, edu), detail: detail };
  }

  function applyCharacteristics(raw, age, mods, eduChecks) {
    const band = bandFor(age);
    const stats = {};
    STATS.forEach(function (s) {
      if (s === "ÉDU") return;
      let v = Number(raw && raw[s]);
      if (!Number.isFinite(v)) v = 0;
      v -= Number(mods && mods[s] || 0);
      if (s === "APP") v -= band.app;
      stats[s] = Math.max(0, v);
    });
    const eduBase = Math.max(0, (Number(raw && raw["ÉDU"]) || 0) + band.eduDelta);
    const seq = eduSequence(eduBase, eduChecks);
    stats["ÉDU"] = seq.edu;
    return { stats: stats, band: band, eduDetail: seq.detail };
  }

  function occupationPoints(stats, formula, choiceStat) {
    const edu = Number(stats["ÉDU"]) || 0;
    let pts = (formula.edu || 0) * edu;
    const opts = formula.options || [];
    if (!opts.length) return pts;
    const chosen = opts.find(function (o) { return o.stat === choiceStat; }) || opts[0];
    pts += chosen.mult * (Number(stats[chosen.stat]) || 0);
    return pts;
  }

  function interestPoints(stats) {
    return (Number(stats.INT) || 0) * 2;
  }

  function skillBase(parent, spec, stats, catalogs) {
    if (parent === "Esquive") return half(stats.DEX || 0);
    if (parent === "Langue maternelle") return Number(stats["ÉDU"]) || 0;
    if (parent === "Combat rapproché") {
      const hit = (catalogs.fighting || []).find(function (f) { return f.name === spec; });
      return hit ? hit.base : 1;
    }
    if (parent === "Combat à distance") {
      const hit = (catalogs.firearms || []).find(function (f) { return f.name === spec; });
      return hit ? hit.base : 1;
    }
    const def = (catalogs.skills || []).find(function (s) { return s.name === parent; });
    if (!def || typeof def.base !== "number") return 1;
    return def.base;
  }

  function livingStandard(cr) {
    cr = Number(cr) || 0;
    if (cr <= 0) return "Indigent";
    if (cr <= 9) return "Pauvre";
    if (cr <= 49) return "Moyen";
    if (cr <= 89) return "Aisé";
    if (cr <= 98) return "Riche";
    return "Richissime";
  }

  function finances(cr) {
    cr = Math.max(0, Math.min(99, Number(cr) || 0));
    const table = CASH["1920"];
    const row = table.find(function (r) { return cr <= r.max; }) || table[table.length - 1];
    return {
      label: row.label,
      cash: row.cash(cr),
      assets: row.assets(cr),
      spend: row.spend,
    };
  }

  function money(n) {
    const v = Number(n) || 0;
    const text = v.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
    return text + " $";
  }

  function defaultMods(age) {
    const mods = { FOR: 0, CON: 0, TAI: 0, DEX: 0, APP: 0 };
    bandFor(age).pools.forEach(function (pool) {
      let left = pool.points;
      pool.stats.forEach(function (s, i) {
        const share = Math.floor(left / (pool.stats.length - i));
        mods[s] += share;
        left -= share;
      });
    });
    return mods;
  }

  function poolTotal(age) {
    return bandFor(age).pools.reduce(function (sum, p) { return sum + p.points; }, 0);
  }

  return {
    STATS: STATS,
    AGE_BANDS: AGE_BANDS,
    bandFor: bandFor,
    half: half,
    fifth: fifth,
    impact: impact,
    movement: movement,
    hitPoints: hitPoints,
    magicPoints: magicPoints,
    eduSequence: eduSequence,
    applyCharacteristics: applyCharacteristics,
    occupationPoints: occupationPoints,
    interestPoints: interestPoints,
    skillBase: skillBase,
    livingStandard: livingStandard,
    finances: finances,
    money: money,
    defaultMods: defaultMods,
    poolTotal: poolTotal,
  };
});
