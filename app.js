(function () {
  const DATA = globalThis.INV_DATA;
  const R = globalThis.Rules;
  const HELP = globalThis.INV_HELP || { stats: {}, derived: {}, skills: {}, occupations: {} };
  const CAP = 75;
  const MODERN_SKILLS = { Informatique: true, Électronique: true };

  (function stripModern() {
    function modernSkill(name) { return !!MODERN_SKILLS[name]; }
    function simplify(slot) {
      if (!slot) return null;
      if (slot.k === "skill" && modernSkill(slot.name)) return null;
      if (slot.k === "one") {
        const options = slot.options.filter(function (op) { return !(op.k === "skill" && modernSkill(op.name)); });
        if (!options.length) return null;
        if (options.length === 1) return options[0];
        return { k: "one", options: options };
      }
      return slot;
    }
    DATA.skills = DATA.skills.filter(function (s) { return s.tags.indexOf("modern") < 0 && !modernSkill(s.name); });
    DATA.occupations = DATA.occupations.filter(function (o) { return o.era !== "modern"; });
    DATA.occupations.forEach(function (o) {
      o.slots = o.slots.map(simplify).filter(Boolean);
    });
  })();
  const STEPS = ["Identité", "Caractéristiques", "Métier", "Occupation", "Intérêt", "Bagage", "Profil", "Fiche"];
  const LAST_STEP = STEPS.length - 1;
  const STEP_INTEREST = 4;
  const STEP_BAG = 5;
  const INTEREST_DROPDOWN_SPECS = ["Combat rapproché", "Combat à distance", "Sciences"];
  const WIZARD_LAYOUT = "skills-interest-full";
  const WIZARD_LAYOUT_PREV = "skills-3-test-variants";
  const SPEC = ["Arts et métiers", "Combat à distance", "Combat rapproché", "Langues", "Langue maternelle", "Pilotage", "Savoir", "Sciences", "Survie"];
  const BAGAGES = {
    none: { name: "Aucun", points: 0 },
    soldier: {
      name: "Militaire — soldat", points: 70, san: "1d10+5",
      note: "Immunisé contre les pertes de Santé Mentale dues à un cadavre ou à une sale blessure.",
      fixed: ["Combat à distance::Fusils / fusils de chasse", "Combat rapproché::Corps à corps", "Discrétion", "Écouter", "Grimper", "Intimidation", "Lancer", "Pickpocket", "Premiers soins", "Trouver Objet Caché"],
      specs: ["Survie"],
    },
    officer: {
      name: "Militaire — officier", points: 70, san: "1d10+5",
      note: "Immunisé contre les pertes de Santé Mentale dues à un cadavre ou à une sale blessure.",
      fixed: ["Combat à distance::Armes de poing", "Discrétion", "Écouter", "Grimper", "Lancer", "Orientation", "Premiers soins", "Trouver Objet Caché"],
      social: 1,
    },
    police: {
      name: "Policier", points: 60, san: "1d10", minAge: 25,
      note: "Immunisé contre les pertes de Santé Mentale dues à la vue d'un cadavre.",
      fixed: ["Combat rapproché::Corps à corps", "Conduite", "Droit", "Écouter", "Grimper", "Intimidation", "Pister", "Premiers soins"],
      firearm: ["Armes de poing", "Fusils / fusils de chasse"],
      specs: ["Langues"],
      social: 2,
    },
    crime: {
      name: "Criminel", points: 60, san: "1d10", minAge: 20,
      note: "Immunisé contre les pertes de Santé Mentale liées à un meurtre ou à la violence envers un humain.",
      fixed: ["Conduite", "Crochetage", "Discrétion", "Droit", "Écouter", "Grimper", "Pickpocket", "Psychologie", "Trouver Objet Caché"],
      firearm: "any",
      fighting: "any",
      social: 1,
    },
    medic: {
      name: "Médical", points: 60, san: "1d10", minAge: 30,
      note: "Ajouter au profil une ligne liée à cette expérience, dans Phobies et manies.",
      fixed: ["Droit", "Écouter", "Médecine", "Premiers soins", "Psychologie", "Trouver Objet Caché"],
      sciences: 2,
    },
    myth: {
      name: "Mythe de Cthulhu", points: 0,
      note: "La Santé Mentale maximum baisse du niveau de Mythe. Un croyant perd en plus autant de Santé Mentale actuelle.",
    },
  };

  let state = blank();
  let focus = null;

  function blank() {
    const raw = {};
    R.STATS.forEach(function (s) { raw[s] = null; });
    return {
      step: 0, name: "", player: "", sex: "", age: 30, birth: "", residence: "",
      language: "Français", portrait: "", description: "", method: "classic", raw: raw,
      chanceRolls: [], chance: null, mods: R.defaultMods(30), eduChecks: [],
      assignRolls: [], assignMap: {}, assignKind: "", occupationId: "", formulaStat: "", picks: {},
      points: {}, extras: [], bagage: "none", bagSan: null, mythos: null, believer: false,
      bagSpec: {}, bagSocial: [], bagFirearm: "", bagFight: "", bagSci: ["", ""],
      profile: { ideology: "", people: "", places: "", treasures: "", traits: "", bond: "", phobias: "", scars: "", encounters: "", equipment: "", notes: "" },
      weapons: [0, 1, 2, 3].map(function () { return { name: "", skill: "", damage: "", range: "", shots: "", ammo: "", malfunction: "" }; }),
      occQuery: "", saveMsg: "",
      interestSpec: {},
      weaponsTouched: false,
    };
  }

  function blankWeaponRow() {
    return { name: "", skill: "", damage: "", range: "", shots: "", ammo: "", malfunction: "" };
  }

  function weaponTemplateForKey(key) {
    const bits = String(key).split("::");
    if (bits.length < 2) return null;
    const entry = specCatalogEntry(bits[0], bits[1]);
    return entry && entry.weapon ? entry.weapon : null;
  }

  function combatSkillKeysForWeapons(stats) {
    const keys = [];
    const seen = {};
    function consider(key) {
      if (!key || seen[key]) return;
      const parent = String(key).split("::")[0];
      if (parent !== "Combat rapproché" && parent !== "Combat à distance") return;
      const row = pt(key);
      const invested = (Number(row.occ) || 0) + (Number(row.per) || 0) + (Number(row.bag) || 0);
      const listed = occupationKeys().indexOf(key) >= 0 || bagKeys().indexOf(key) >= 0;
      if (invested > 0 || listed) {
        seen[key] = true;
        keys.push(key);
      }
    }
    Object.keys(state.points || {}).forEach(consider);
    occupationKeys().forEach(consider);
    bagKeys().forEach(consider);
    ["Combat rapproché", "Combat à distance"].forEach(function (parent) {
      const spec = resolveInterestSpec(parent);
      if (spec) consider(keyOf(parent, spec));
    });
    keys.sort(function (a, b) { return totalOf(b, stats) - totalOf(a, stats); });
    return keys;
  }

  function weaponRowFromSkillKey(key, stats) {
    const tpl = weaponTemplateForKey(key);
    const total = totalOf(key, stats);
    const spec = String(key).split("::")[1] || String(key);
    if (!tpl) return Object.assign(blankWeaponRow(), { name: spec, skill: String(total) });
    return {
      name: tpl.name,
      skill: String(total),
      damage: tpl.damage,
      range: tpl.range,
      shots: tpl.shots,
      ammo: tpl.ammo != null ? tpl.ammo : tpl.shots,
      malfunction: tpl.malfunction != null ? String(tpl.malfunction) : "—",
    };
  }

  function syncWeaponsFromSkills(force) {
    const stats = applied().stats;
    const empty = (state.weapons || []).every(function (w) {
      return !w.name && !w.skill && !w.damage && !w.range && !w.shots && !w.ammo && !w.malfunction;
    });
    if (state.weaponsTouched && !force && !empty) return;
    const keys = combatSkillKeysForWeapons(stats);
    const rows = keys.slice(0, 4).map(function (k) { return weaponRowFromSkillKey(k, stats); });
    while (rows.length < 4) rows.push(blankWeaponRow());
    state.weapons = rows;
    if (force) state.weaponsTouched = false;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hover(label, text) {
    if (!text) return esc(label);
    return '<span class="has-tip" tabindex="0" data-tip="' + esc(text) + '">' + esc(label) + "</span>";
  }

  function skillHelp(key) {
    const bits = String(key).split("::");
    const base = HELP.skills[bits[0]] || "";
    if (!bits[1]) return base;
    return base ? base + " Spécialité : " + bits[1] + "." : bits[1];
  }

  function skillName(name, spec) {
    const label = spec ? name + " (" + spec + ")" : name;
    return hover(label, skillHelp(spec ? name + "::" + spec : name));
  }

  function dice(n, sides) {
    let t = 0;
    for (let i = 0; i < n; i++) t += 1 + Math.floor(Math.random() * sides);
    return t;
  }
  function roll3() { return dice(3, 6) * 5; }
  function roll26() { return (dice(2, 6) + 6) * 5; }
  function isSpec(name) { return SPEC.indexOf(name) >= 0; }
  function keyOf(parent, spec) {
    const name = String(spec || "").trim();
    return name ? parent + "::" + name : null;
  }
  function labelOf(key) {
    const bits = String(key).split("::");
    return bits[1] ? bits[0] + " (" + bits[1] + ")" : bits[0];
  }
  function occById(id) { return DATA.occupations.find(function (o) { return o.id === id; }) || null; }
  function occLabel(o) {
    if (!o.parent || o.parent === o.name) return o.name;
    return o.parent + " — " + o.name;
  }

  function currentRaw() {
    return state.raw;
  }

  function numericRaw() {
    const raw = currentRaw();
    const out = {};
    R.STATS.forEach(function (s) { out[s] = raw[s] == null || raw[s] === "" ? 0 : Number(raw[s]); });
    return out;
  }

  function missingStats() {
    const raw = currentRaw();
    return R.STATS.filter(function (s) { return raw[s] == null || raw[s] === ""; });
  }

  function applied() {
    return R.applyCharacteristics(numericRaw(), state.age, state.mods, state.eduChecks);
  }

  function pt(key) {
    return state.points[key] || { occ: 0, per: 0, bag: 0 };
  }

  function baseOf(key, stats) {
    const bits = key.split("::");
    return R.skillBase(bits[0], bits[1], stats, DATA);
  }

  function mythosBonus() {
    return state.bagage === "myth" ? (Number(state.mythos) || 0) : 0;
  }

  function totalOf(key, stats) {
    const row = pt(key);
    const extra = key === "Mythe de Cthulhu" ? mythosBonus() : 0;
    return baseOf(key, stats) + (row.occ || 0) + (row.per || 0) + (row.bag || 0) + extra;
  }

  function optionLabel(opt) {
    if (!opt) return "";
    if (opt.k === "skill") return opt.name;
    if (opt.spec) return opt.skill + " (" + opt.spec + ")";
    if (opt.options) return opt.skill + " (" + opt.options.join(" ou ") + ")";
    return opt.skill + " (au choix)";
  }

  function resolveOption(opt, text) {
    if (!opt) return null;
    if (opt.k === "skill") return opt.name;
    if (opt.spec) return keyOf(opt.skill, opt.spec);
    if (opt.options) return opt.options.indexOf(text) >= 0 ? keyOf(opt.skill, text) : null;
    return keyOf(opt.skill, text);
  }

  function resolveSlot(slot, pick) {
    pick = pick || {};
    if (slot.k === "skill") return [slot.name];
    if (slot.k === "spec") return [slot.spec ? keyOf(slot.skill, slot.spec) : keyOf(slot.skill, pick.text)];
    if (slot.k === "specs") {
      const list = pick.list || [];
      return Array.from({ length: slot.n }, function (_, i) { return keyOf(slot.skill, list[i]); });
    }
    if (slot.k === "one") return [resolveOption(slot.options[pick.index], pick.text)];
    if (slot.k === "social") {
      const list = pick.list || [];
      return Array.from({ length: slot.n }, function (_, i) { return list[i] || null; });
    }
    if (slot.k === "any" || slot.k === "among") {
      const list = pick.list || [];
      return Array.from({ length: slot.n }, function (_, i) {
        const item = list[i] || {};
        if (slot.k === "among") return resolveOption(slot.options[item.index], item.text);
        if (isSpec(item.skill)) return keyOf(item.skill, item.spec);
        return item.skill || null;
      });
    }
    if (slot.k === "sci") {
      const keys = (slot.fixed || []).map(function (n) { return "Sciences::" + n; });
      const list = pick.list || [];
      for (let i = 0; i < slot.n; i++) keys.push(keyOf("Sciences", list[i]));
      return keys;
    }
    return [];
  }

  function occupationKeys() {
    const occ = occById(state.occupationId);
    if (!occ) return [];
    const keys = ["Crédit"];
    occ.slots.forEach(function (slot, i) {
      resolveSlot(slot, state.picks[i]).forEach(function (k) { if (k) keys.push(k); });
    });
    return keys;
  }

  function bagKeys() {
    const bag = BAGAGES[state.bagage] || BAGAGES.none;
    const keys = (bag.fixed || []).slice();
    (bag.specs || []).forEach(function (skill) {
      const k = keyOf(skill, state.bagSpec[skill]);
      if (k) keys.push(k);
    });
    if (bag.firearm === "any" && state.bagFirearm) keys.push("Combat à distance::" + state.bagFirearm);
    if (Array.isArray(bag.firearm) && state.bagFirearm) keys.push("Combat à distance::" + state.bagFirearm);
    if (bag.fighting === "any" && state.bagFight) keys.push("Combat rapproché::" + state.bagFight);
    if (bag.sciences) {
      (state.bagSci || []).forEach(function (n) {
        const k = keyOf("Sciences", n);
        if (k) keys.push(k);
      });
    }
    (state.bagSocial || []).forEach(function (n) { if (n) keys.push(n); });
    if (state.bagage === "myth") keys.push("Mythe de Cthulhu");
    return keys;
  }

  function isNativeTongueKey(key) {
    return String(key).split("::")[0] === "Langue maternelle";
  }

  function visibleKeys(stats) {
    const set = [];
    function add(k) {
      if (!k || isNativeTongueKey(k)) return;
      if (set.indexOf(k) < 0) set.push(k);
    }
    add("Crédit");
    add("Esquive");
    add("Combat rapproché::Corps à corps");
    DATA.skills.forEach(function (s) {
      if (s.tags.indexOf("spec") >= 0 || s.name === "Crédit" || s.name === "Mythe de Cthulhu") return;
      const optional = s.tags.indexOf("rare") >= 0 || s.name === "Conduite d'attelage";
      if (optional && totalOf(s.name, stats) === baseOf(s.name, stats) && occupationKeys().indexOf(s.name) < 0) return;
      add(s.name);
    });
    occupationKeys().forEach(add);
    bagKeys().forEach(add);
    state.extras.forEach(add);
    if (mythosBonus() > 0) add("Mythe de Cthulhu");
    return set;
  }

  function spent(field) {
    return Object.keys(state.points).reduce(function (sum, k) { return sum + (Number(state.points[k][field]) || 0); }, 0);
  }

  function budgets(stats) {
    const occ = occById(state.occupationId);
    const bag = BAGAGES[state.bagage] || BAGAGES.none;
    return {
      occ: occ ? R.occupationPoints(stats, occ.formula, state.formulaStat) : 0,
      per: R.interestPoints(stats),
      bag: bag.points || 0,
    };
  }

  function issues(stats) {
    const list = [];
    if (!state.name.trim()) list.push("Indiquez le nom de l'investigateur.");
    missingStats().forEach(function (s) { list.push("Caractéristique manquante : " + s + "."); });
    if (state.chance == null) list.push("La Chance n'a pas été tirée.");
    const band = R.bandFor(state.age);
    const pool = R.poolTotal(state.age);
    const used = band.pools.reduce(function (sum, p) {
      return sum + p.stats.reduce(function (s, k) { return s + (Number(state.mods[k]) || 0); }, 0);
    }, 0);
    if (used !== pool) list.push("Les malus d'âge ne sont pas entièrement répartis (" + used + " / " + pool + ").");
    if (state.eduChecks.length < band.checks) list.push("Il reste " + (band.checks - state.eduChecks.length) + " test(s) d'Éducation à lancer.");
    const occ = occById(state.occupationId);
    if (!occ) list.push("Choisissez une occupation.");
    else {
      const keys = [];
      let incomplete = false;
      occ.slots.forEach(function (slot, i) {
        resolveSlot(slot, state.picks[i]).forEach(function (k) {
          if (!k) incomplete = true;
          else if (keys.indexOf(k) >= 0) incomplete = true;
          else keys.push(k);
        });
      });
      if (incomplete) list.push("Certaines compétences d'occupation ne sont pas choisies, ou le sont en double.");
      const cr = (pt("Crédit").occ || 0);
      if (cr < occ.credit[0] || cr > occ.credit[1]) {
        list.push("Le Crédit payé avec les points d'occupation doit rester entre " + occ.credit[0] + " et " + occ.credit[1] + ".");
      }
    }
    const bud = budgets(stats);
    if (occ && spent("occ") !== bud.occ) list.push("Points d'occupation : " + spent("occ") + " utilisés sur " + bud.occ + ".");
    if (spent("per") !== bud.per) list.push("Points d'intérêt : " + spent("per") + " utilisés sur " + bud.per + ".");
    if (bud.bag && spent("bag") !== bud.bag) list.push("Points de bagage : " + spent("bag") + " utilisés sur " + bud.bag + ".");
    const bag = BAGAGES[state.bagage];
    if (bag && bag.minAge && state.age < bag.minAge) list.push("Ce bagage demande au moins " + bag.minAge + " ans.");
    if (state.bagage === "myth" && !state.mythos) list.push("Lancez ou saisissez le niveau de Mythe de Cthulhu.");
    visibleKeys(stats).forEach(function (k) {
      const row = pt(k);
      const added = (row.occ || 0) + (row.per || 0) + (row.bag || 0);
      if (totalOf(k, stats) > CAP && added > 0) list.push(labelOf(k) + " dépasse le plafond de " + CAP + " %.");
    });
    return list;
  }

  function setPoint(key, field, value) {
    const stats = applied().stats;
    if (!state.points[key]) state.points[key] = { occ: 0, per: 0, bag: 0 };
    const next = Math.max(0, Math.floor(Number(value) || 0));
    state.points[key][field] = next;
    const cap = CAP;
    let guard = 0;
    while (guard < 400 && (totalOf(key, stats) > cap || spent(field) > budgets(stats)[field])) {
      if (state.points[key][field] <= 0) break;
      state.points[key][field] -= 1;
      guard += 1;
    }
  }

  function setAge(age) {
    const prev = R.bandFor(state.age).id;
    state.age = Math.max(15, Math.min(89, Number(age) || 15));
    if (R.bandFor(state.age).id !== prev) {
      state.mods = R.defaultMods(state.age);
      state.eduChecks = [];
      state.chance = null;
      state.chanceRolls = [];
    }
  }

  function selectOcc(id) {
    if (state.occupationId === id) return;
    Object.keys(state.points).forEach(function (k) { state.points[k].occ = 0; });
    state.occupationId = id;
    state.picks = {};
    const occ = occById(id);
    state.formulaStat = occ && occ.formula.options[0] ? occ.formula.options[0].stat : "";
  }

  function setPath(path, value) {
    const parts = path.split(".");
    let obj = state;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
  }

  function financesNow(stats) {
    const cr = totalOf("Crédit", stats);
    return { cr: cr, fin: R.finances(cr), life: R.livingStandard(cr) };
  }

  function render() {
    hideTip();
    const app = document.getElementById("app");
    try {
      app.innerHTML = shell();
    } catch (err) {
      app.textContent = "Erreur d'affichage : " + (err && err.message ? err.message : err);
      return;
    }
    if (focus) {
      const el = app.querySelector('[data-bind="' + focus.id.replace(/"/g, "") + '"]');
      if (el) {
        el.focus();
        if (focus.sel != null && el.setSelectionRange) {
          try { el.setSelectionRange(focus.sel, focus.sel); } catch (e) { /* ignore */ }
        }
      }
    }
    try { localStorage.setItem("inv-draft", JSON.stringify(state)); } catch (e) { state.saveMsg = "Sauvegarde auto impossible (portrait trop lourd). Téléchargez le JSON."; }
  }

  function shell() {
    const steps = STEPS.map(function (name, i) {
      return '<button type="button" class="no-print ' + (state.step === i ? "active" : "") + '" data-action="goto" data-step="' + i + '">' + (i + 1) + ". " + name + "</button>";
    }).join("");
    return '<header class="top no-print"><div class="brand"><h1>Créateur d\'investigateur</h1><p>Vos joueurs créent leur personnage pas à pas, puis téléchargent la fiche. Outil de table, non officiel : le livre reste la référence.</p></div></header><nav class="steps">' + steps + '</nav><main class="card no-print">' + body() + '</main>' + (state.step === LAST_STEP ? '<div class="sheet-wrap">' + sheetHtml() + "</div>" : "") + '<div class="nav no-print"><button type="button" class="btn secondary" data-action="prev"' + (state.step === 0 ? " disabled" : "") + '>Retour</button><button type="button" class="btn" data-action="next"' + (state.step === LAST_STEP ? " disabled" : "") + ">Continuer</button></div>";
  }

  function body() {
    if (state.step === 0) return stepIdentity();
    if (state.step === 1) return stepStats();
    if (state.step === 2) return stepOcc();
    if (state.step === 3) return stepSkillsOcc();
    if (state.step === STEP_INTEREST) return stepSkillsInterest();
    if (state.step === STEP_BAG) return stepSkillsBag();
    if (state.step === LAST_STEP - 1) return stepProfile();
    return stepSheet();
  }

  function field(label, bind, value, type) {
    return '<label class="field"><span>' + label + '</span><input data-bind="' + bind + '" type="' + (type || "text") + '" value="' + esc(value) + '"></label>';
  }

  function stepIdentity() {
    return '<h2>Identité</h2><p class="lead">La partie se déroule dans les années 1920. L\'âge modifiera les caractéristiques à l\'étape suivante.</p><div class="grid-2">' +
      field("Nom de l'investigateur", "name", state.name) +
      field("Joueur", "player", state.player) +
      '<label class="field"><span>Genre</span><select data-bind="sex" data-action="bind">' + ["", "Femme", "Homme", "Autre", "Non précisé"].map(function (g) {
        return '<option value="' + esc(g) + '"' + (state.sex === g ? " selected" : "") + ">" + esc(g || "—") + "</option>";
      }).join("") + "</select></label>" +
      '<label class="field"><span>Âge (15 à 89)</span><input data-bind="age" inputmode="numeric" maxlength="2" value="' + esc(state.age) + '"></label>' +
      field("Langue maternelle", "language", state.language) +
      field("Lieu de naissance", "birth", state.birth) +
      field("Résidence", "residence", state.residence) +
      '</div><label class="field" style="margin-top:12px"><span>Description</span><textarea data-bind="description">' + esc(state.description) + '</textarea></label><label class="field" style="margin-top:12px"><span>Portrait (facultatif)</span><input type="file" accept="image/*" data-action="portrait"></label>' +
      (state.portrait ? '<img class="portrait" alt="Portrait" src="' + state.portrait + '">' : "");
  }

  function stepStats() {
    const app = applied();
    const stats = app.stats;
    const raw = currentRaw();
    const missing = missingStats();
    let html = '<h2>Caractéristiques</h2>';
    html += '<p class="lead">FOR, CON, DEX, APP et POU : 3D6 × 5. TAI, INT et ÉDU : (2D6+6) × 5. Vous pouvez aussi saisir une valeur. Survolez un nom pour sa signification.</p><div class="actions"><button type="button" class="btn" data-action="roll-all">Tout lancer</button></div><div class="stats">';
    const formulas = { FOR: "3D6 × 5", CON: "3D6 × 5", TAI: "(2D6+6) × 5", DEX: "3D6 × 5", APP: "3D6 × 5", INT: "(2D6+6) × 5", POU: "3D6 × 5", "ÉDU": "(2D6+6) × 5" };
    R.STATS.forEach(function (s) {
      html += '<div class="stat"><h3>' + hover(s, HELP.stats[s]) + '</h3><div class="hint">' + formulas[s] + '</div><div class="row"><input data-bind="raw.' + s + '" data-kind="stat" type="number" min="0" max="99" value="' + (raw[s] == null ? "" : raw[s]) + '"><button type="button" class="btn ghost" data-action="roll-stat" data-stat="' + s + '">Lancer</button></div><div class="hint">Au final : ' + (missing.indexOf(s) >= 0 ? "—" : stats[s]) + "</div></div>";
    });
    html += "</div>";
    html += chanceBlock() + ageBlock(app) + derivedBlock(stats, missing);
    return html;
  }

  function chanceBlock() {
    const band = R.bandFor(state.age);
    const rolls = state.chanceRolls.length ? "Jets : " + state.chanceRolls.join(", ") : "";
    return '<div class="stat" style="margin-top:12px"><h3>' + hover("Chance", HELP.stats.Chance) + '</h3><p class="hint">3D6 × 5' + (band.luckRolls === 2 ? ". Entre 15 et 19 ans, deux jets, on garde le meilleur." : "") + '</p><div class="row"><strong>' + (state.chance == null ? "—" : state.chance) + '</strong><button type="button" class="btn ghost" data-action="roll-chance">Lancer</button><span class="hint">' + rolls + "</span></div></div>";
  }

  function ageBlock(app) {
    const band = app.band;
    let html = "<h3>Âge : " + state.age + " ans</h3>";
    if (!band.pools.length && !band.app && !band.eduDelta && band.checks) html += "<p>Un test d'expérience en ÉDU.</p>";
    band.pools.forEach(function (pool) {
      const used = pool.stats.reduce(function (s, k) { return s + (Number(state.mods[k]) || 0); }, 0);
      html += "<p>Retirez " + pool.points + " points entre " + pool.stats.join(", ") + " (" + used + " / " + pool.points + ").</p><div class=\"row\">";
      pool.stats.forEach(function (s) {
        html += '<div class="pill"><span>' + s + '</span><div class="stepper"><button type="button" data-action="mod" data-stat="' + s + '" data-delta="-1">−</button><strong>' + (state.mods[s] || 0) + '</strong><button type="button" data-action="mod" data-stat="' + s + '" data-delta="1">+</button></div></div>';
      });
      html += "</div>";
    });
    if (band.app) html += "<p>Apparence : −" + band.app + ".</p>";
    if (band.eduDelta) html += "<p>Éducation : " + band.eduDelta + ".</p>";
    if (band.mov) html += "<p>Mouvement : −" + band.mov + ".</p>";
    if (band.checks) {
      html += "<h3>Tests d'Éducation</h3><p class=\"hint\">Si le D100 est strictement supérieur à l'ÉDU actuelle, ajoutez 1D10, sans dépasser 99.</p>";
      app.eduDetail.forEach(function (d, i) {
        html += "<p>Test " + (i + 1) + " : " + d.roll + " contre " + d.eduBefore + " — " + (d.success ? "réussite +" + d.gain : "échec") + "</p>";
      });
      if (state.eduChecks.length < band.checks) {
        html += '<button type="button" class="btn" data-action="edu">Lancer le test ' + (state.eduChecks.length + 1) + "</button>";
      }
    }
    return html;
  }

  function derivedBlock(stats, missing) {
    if (missing && missing.length) {
      return '<p class="hint">Les valeurs dérivées apparaîtront quand les huit caractéristiques seront connues.</p>';
    }
    const imp = R.impact(stats.FOR, stats.TAI);
    const cells = [
      ["Points de vie", R.hitPoints(stats.CON, stats.TAI)],
      ["Points de magie", R.magicPoints(stats.POU)],
      ["Santé Mentale", stats.POU],
      ["Impact", imp.text],
      ["Carrure", imp.build],
      ["Mouvement", R.movement(stats.FOR, stats.DEX, stats.TAI, state.age)],
      ["Chance", state.chance == null ? "—" : state.chance],
      ["FOR + TAI", imp.total],
    ];
    return '<div class="derived">' + cells.map(function (c) { return "<div><span class=\"hint\">" + hover(c[0], HELP.derived[c[0]]) + "</span><strong>" + c[1] + "</strong></div>"; }).join("") + "</div>";
  }

  function stepOcc() {
    const q = state.occQuery.toLowerCase();
    const list = DATA.occupations.filter(function (o) { return occLabel(o).toLowerCase().indexOf(q) >= 0; });
    const occ = occById(state.occupationId);
    let html = '<h2>Métier</h2><p class="lead">Choisissez l\'occupation de l\'investigateur : elle détermine les compétences de métier et le calcul des points d\'occupation à l\'étape suivante. Survolez un nom pour un aperçu.</p><label class="field"><span>Rechercher</span><input data-bind="occQuery" value="' + esc(state.occQuery) + '"></label><div class="list">';
    list.forEach(function (o) {
      const blurb = HELP.occupations[o.id] || "";
      html += '<button type="button" data-action="occ" data-id="' + esc(o.id) + '"' + (blurb ? ' data-tip="' + esc(blurb) + '"' : "") + ' class="' + (o.id === state.occupationId ? "active" : "") + '">' + esc(occLabel(o)) + "</button>";
    });
    html += "</div>";
    if (!occ) return html;
    const stats = applied().stats;
    html += '<div class="slot"><h3>' + esc(occLabel(occ)) + "</h3>";
    if (HELP.occupations[occ.id]) html += '<p class="occ-blurb">' + esc(HELP.occupations[occ.id]) + "</p>";
    if (occ.formula.options.length > 1) {
      html += "<p>Formule : ÉDU × " + occ.formula.edu + " + au choix</p><div class=\"row\">";
      occ.formula.options.forEach(function (op) {
        html += '<label><input type="radio" name="formula" data-action="formula" value="' + op.stat + '"' + (state.formulaStat === op.stat ? " checked" : "") + "> " + op.stat + " × " + op.mult + "</label>";
      });
      html += "</div>";
    } else if (occ.formula.options.length === 1) {
      html += "<p>Formule : ÉDU × " + occ.formula.edu + " + " + occ.formula.options[0].stat + " × " + occ.formula.options[0].mult + "</p>";
    } else html += "<p>Formule : ÉDU × " + occ.formula.edu + "</p>";
    html += "<p><strong>" + R.occupationPoints(stats, occ.formula, state.formulaStat) + "</strong> points d'occupation. Intérêts personnels : <strong>" + R.interestPoints(stats) + "</strong> (INT × 2).</p>";
    html += "<p>Crédit recommandé : " + occ.credit[0] + "–" + occ.credit[1] + (occ.creditNote ? " (" + esc(occ.creditNote) + ")" : "") + ".</p>";
    html += '<div class="slots">' + occ.slots.map(renderSlot).join("") + "</div></div>";
    return html;
  }

  function renderSlot(slot, index) {
    const pick = state.picks[index] || {};
    let inner = "";
    if (slot.k === "skill") inner = "<strong>" + skillName(slot.name) + "</strong>";
    else if (slot.k === "spec" && slot.spec) inner = "<strong>" + skillName(slot.skill, slot.spec) + "</strong>";
    else if (slot.k === "spec") inner = specInput(slot.skill, pick.text, "pick-text", index, slot.options || slot.hint);
    else if (slot.k === "specs") {
      inner = "<strong>" + skillName(slot.skill) + " × " + slot.n + "</strong>";
      for (let i = 0; i < slot.n; i++) inner += specInput(slot.skill, (pick.list || [])[i], "pick-list", index, null, i);
    } else if (slot.k === "one") {
      inner = '<select data-action="pick-index" data-index="' + index + '"><option value="">Choisir…</option>' + slot.options.map(function (op, j) {
        return '<option value="' + j + '"' + (String(pick.index) === String(j) ? " selected" : "") + ">" + esc(optionLabel(op)) + "</option>";
      }).join("") + "</select>";
      const opt = slot.options[pick.index];
      if (opt && opt.k === "spec" && !opt.spec) inner += specInput(opt.skill, pick.text, "pick-text", index, opt.options || opt.hint);
    } else if (slot.k === "social") {
      inner = "<strong>" + slot.n + " compétence(s) sociale(s)</strong>";
      for (let i = 0; i < slot.n; i++) {
        inner += '<select data-action="pick-social" data-index="' + index + '" data-i="' + i + '"><option value="">Choisir…</option>' + DATA.social.map(function (n) {
          return '<option ' + ((pick.list || [])[i] === n ? "selected" : "") + ">" + n + "</option>";
        }).join("") + "</select>";
      }
    } else if (slot.k === "any") {
      inner = "<strong>" + slot.n + " compétence(s) au choix</strong>";
      for (let i = 0; i < slot.n; i++) inner += anyInput(index, i, (pick.list || [])[i] || {});
    } else if (slot.k === "among") {
      inner = "<strong>" + slot.n + " compétence(s) parmi la liste</strong>";
      for (let i = 0; i < slot.n; i++) {
        const item = (pick.list || [])[i] || {};
        inner += '<select data-action="pick-among" data-index="' + index + '" data-i="' + i + '"><option value="">Choisir…</option>' + slot.options.map(function (op, j) {
          return '<option value="' + j + '"' + (String(item.index) === String(j) ? " selected" : "") + ">" + esc(optionLabel(op)) + "</option>";
        }).join("") + "</select>";
        const opt = slot.options[item.index];
        if (opt && opt.k === "spec" && !opt.spec) inner += specInput(opt.skill, item.text, "pick-among-text", index, opt.options || opt.hint, i);
      }
    } else if (slot.k === "sci") {
      inner = "<strong>" + skillName("Sciences") + "</strong> " + (slot.fixed || []).map(esc).join(", ");
      for (let i = 0; i < slot.n; i++) inner += specInput("Sciences", (pick.list || [])[i], "pick-list", index, DATA.sciences, i);
    }
    return '<div class="slot">' + inner + "</div>";
  }

  function specInput(skill, value, action, index, options, i) {
    const catalog = skill === "Combat rapproché" ? DATA.fighting : skill === "Combat à distance" ? DATA.firearms : skill === "Sciences" ? DATA.sciences.map(function (n) { return { name: n }; }) : null;
    const list = options || (catalog ? catalog.map(function (c) { return c.name; }) : null);
    const attr = ' data-action="' + action + '" data-index="' + index + '"' + (i == null ? "" : ' data-i="' + i + '"');
    let control;
    if (list && list.length) {
      control = '<select' + attr + '><option value="">' + esc(skill) + '…</option>' + list.map(function (n) {
        return '<option ' + (value === n ? "selected" : "") + ">" + esc(n) + "</option>";
      }).join("") + "</select>";
    } else {
      control = '<input' + attr + ' data-bind="spec-' + index + "-" + (i == null ? "x" : i) + '" placeholder="Préciser" value="' + esc(value || "") + '">';
    }
    return '<label class="field"><span>' + hover(skill, HELP.skills[skill]) + "</span>" + control + "</label>";
  }

  function anyInput(index, i, item) {
    const names = DATA.skills.filter(function (s) { return s.name !== "Crédit" && s.name !== "Mythe de Cthulhu"; }).map(function (s) { return s.name; });
    let html = '<select data-action="pick-any" data-index="' + index + '" data-i="' + i + '"><option value="">Compétence…</option>' + names.map(function (n) {
      return '<option ' + (item.skill === n ? "selected" : "") + ">" + esc(n) + "</option>";
    }).join("") + "</select>";
    if (isSpec(item.skill)) html += specInput(item.skill, item.spec, "pick-any-spec", index, null, i);
    return html;
  }

  function stepper(key, field, value, enabled) {
    if (!enabled) {
      if (value > 0) return '<div class="point-readonly nums"><strong>' + value + "</strong></div>";
      return '<div class="point-na" title="Points non utilisables ici">—</div>';
    }
    return '<div class="stepper"><button type="button" data-action="point" data-key="' + esc(key) + '" data-field="' + field + '" data-delta="-5">−5</button><button type="button" data-action="point" data-key="' + esc(key) + '" data-field="' + field + '" data-delta="-1">−</button><input data-action="point-set" data-bind="pt-' + field + "-" + esc(key) + '" data-key="' + esc(key) + '" data-field="' + field + '" type="number" min="0" value="' + value + '"><button type="button" data-action="point" data-key="' + esc(key) + '" data-field="' + field + '" data-delta="1">+</button><button type="button" data-action="point" data-key="' + esc(key) + '" data-field="' + field + '" data-delta="5">+5</button></div>';
  }

  function budgetPill(label, used, max) {
    const rest = max - used;
    let cls = "";
    if (max > 0) {
      if (used > max) cls = "bad";
      else if (used === max) cls = "good";
      else if (used > 0) cls = "warn";
    } else if (used === 0) cls = "good";
    const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
    const restLine = max > 0
      ? (rest > 0 ? "Il reste <strong>" + rest + "</strong> pt" : rest < 0 ? "Trop de points placés" : "Budget épuisé")
      : "";
    return '<div class="pill ' + cls + '"><span class="hint">' + label + '</span><strong class="budget-nums">' + used + " / " + max + "</strong>" + (restLine ? '<span class="budget-rest">' + restLine + "</span>" : "") + '<span class="budget-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span></div>';
  }

  function sortSkillKeysForStep(keys, occKeys) {
    const head = [];
    if (keys.indexOf("Crédit") >= 0) head.push("Crédit");
    occKeys.forEach(function (k) {
      if (k && k !== "Crédit" && head.indexOf(k) < 0 && keys.indexOf(k) >= 0) head.push(k);
    });
    const tail = keys.filter(function (k) { return head.indexOf(k) < 0; });
    tail.sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b), "fr"); });
    return head.concat(tail);
  }

  function keysForOccStep(stats) {
    const visible = visibleKeys(stats);
    const occKeys = occupationKeys();
    const keys = [];
    if (visible.indexOf("Crédit") >= 0) keys.push("Crédit");
    occKeys.forEach(function (k) {
      if (k && k !== "Crédit" && keys.indexOf(k) < 0 && visible.indexOf(k) >= 0) keys.push(k);
    });
    return keys;
  }

  function keysForInterestStep(stats) {
    const occKeys = occupationKeys();
    return sortSkillKeysForStep(visibleKeys(stats), occKeys).filter(function (k) {
      return k !== "Crédit";
    });
  }

  function isInterestDropdownSpecKey(key) {
    const bits = String(key).split("::");
    return bits.length > 1 && INTEREST_DROPDOWN_SPECS.indexOf(bits[0]) >= 0;
  }

  function interestSpecCatalog(parent) {
    if (parent === "Combat rapproché") return DATA.fighting || [];
    if (parent === "Combat à distance") return DATA.firearms || [];
    if (parent === "Sciences") return (DATA.sciences || []).map(function (n) { return { name: n, base: 1 }; });
    return [];
  }

  function interestDropdownCatalog(parent) {
    return interestSpecCatalog(parent).map(function (e) { return e.name; });
  }

  function specCatalogEntry(parent, specName) {
    return interestSpecCatalog(parent).find(function (e) { return e.name === specName; }) || null;
  }

  function isSpecRare(parent, specName) {
    const entry = specCatalogEntry(parent, specName);
    return !!(entry && entry.rare);
  }

  function resolveInterestSpec(parent) {
    if (!state.interestSpec) state.interestSpec = {};
    const list = interestDropdownCatalog(parent);
    let spec = state.interestSpec[parent];
    if (spec && list.indexOf(spec) >= 0) return spec;
    const sources = [] .concat(occupationKeys(), bagKeys(), state.extras || [], Object.keys(state.points || {}));
    for (let i = 0; i < sources.length; i++) {
      const bits = String(sources[i]).split("::");
      if (bits[0] === parent && bits[1] && list.indexOf(bits[1]) >= 0) {
        state.interestSpec[parent] = bits[1];
        return bits[1];
      }
    }
    if (parent === "Combat rapproché" && list.indexOf("Corps à corps") >= 0) spec = "Corps à corps";
    else spec = list.length ? list[0] : "";
    state.interestSpec[parent] = spec;
    return spec;
  }

  function visibleKeysInterestList(stats) {
    const set = [];
    function add(k) {
      if (!k || k === "Crédit" || isNativeTongueKey(k) || isInterestDropdownSpecKey(k)) return;
      if (set.indexOf(k) < 0) set.push(k);
    }
    add("Esquive");
    DATA.skills.forEach(function (s) {
      if (s.tags.indexOf("spec") >= 0 || s.name === "Crédit" || s.name === "Mythe de Cthulhu") return;
      add(s.name);
    });
    occupationKeys().forEach(add);
    bagKeys().forEach(add);
    (state.extras || []).forEach(add);
    if (mythosBonus() > 0) add("Mythe de Cthulhu");
    return set;
  }

  function keysForInterestList(stats) {
    const occKeys = occupationKeys();
    return sortSkillKeysForStep(visibleKeysInterestList(stats), occKeys);
  }

  function mergedInterestRows(stats) {
    const items = keysForInterestList(stats).map(function (key) {
      return { kind: "skill", key: key, sort: labelOf(key) };
    });
    INTEREST_DROPDOWN_SPECS.forEach(function (parent) {
      items.push({ kind: "dropdown", parent: parent, sort: parent });
    });
    items.sort(function (a, b) { return a.sort.localeCompare(b.sort, "fr"); });
    return items;
  }

  function skillRareTag(key) {
    const bits = String(key).split("::");
    const parent = bits[0];
    if (bits.length > 1 && INTEREST_DROPDOWN_SPECS.indexOf(parent) >= 0) {
      if (isSpecRare(parent, bits[1])) return '<span class="tag-rare">rare</span>';
      return "";
    }
    const def = DATA.skills.find(function (s) { return s.name === parent; });
    if (def && def.tags.indexOf("rare") >= 0) return '<span class="tag-rare">rare</span>';
    return "";
  }

  function renderInterestSkillNameCell(key) {
    const bits = String(key).split("::");
    return '<div class="skill-name-col"><div class="skill-name-line">' + skillName(bits[0], bits[1]) + skillRareTag(key) + "</div></div>";
  }

  function renderInterestDataRow(key, stats) {
    const row = pt(key);
    const base = baseOf(key, stats);
    const total = totalOf(key, stats);
    const perOk = key !== "Mythe de Cthulhu";
    const rowCls = "skill" + (total > CAP ? " skill-over-cap" : "");
    let html = '<div class="' + rowCls + '">';
    html += renderInterestSkillNameCell(key);
    html += '<div class="nums">' + base + "</div>";
    html += occPointsDisplay(key) + stepper(key, "per", row.per || 0, perOk);
    html += '<div class="nums skill-total"><strong>' + total + "</strong></div></div>";
    return html;
  }

  function renderInterestDropdownRow(parent, stats) {
    const spec = resolveInterestSpec(parent);
    const key = spec ? keyOf(parent, spec) : null;
    const row = key ? pt(key) : { occ: 0, per: 0 };
    const base = key ? baseOf(key, stats) : "—";
    const total = key ? totalOf(key, stats) : 0;
    const perOk = !!key && key !== "Mythe de Cthulhu";
    const rowCls = "skill skill-spec-picker" + (total > CAP ? " skill-over-cap" : "");
    let html = '<div class="' + rowCls + '">';
    html += '<div class="skill-name-col"><div class="skill-name-line">' + skillName(parent, null) + (spec && isSpecRare(parent, spec) ? skillRareTag(key) : "") + '</div><select data-action="interest-spec" data-parent="' + esc(parent) + '">';
    html += interestSpecCatalog(parent).map(function (e) {
      const label = e.name + (e.rare ? " (rare)" : "");
      return '<option value="' + esc(e.name) + '"' + (spec === e.name ? " selected" : "") + ">" + esc(label) + "</option>";
    }).join("");
    html += "</select></div>";
    html += '<div class="nums">' + base + "</div>";
    if (key) html += occPointsDisplay(key) + stepper(key, "per", row.per || 0, perOk);
    else html += '<div class="point-na">—</div><div class="point-na">—</div>';
    html += '<div class="nums skill-total"><strong>' + (key ? total : "—") + "</strong></div></div>";
    return html;
  }

  function renderInterestFullTable(stats) {
    const rows = mergedInterestRows(stats);
    let html = '<div class="skills-table mode-per">';
    html += '<div class="skill head"><strong>Compétence</strong><span>Base</span><span>Occ.</span><span>Intérêt</span><span>Total</span></div>';
    rows.forEach(function (item) {
      if (item.kind === "skill") html += renderInterestDataRow(item.key, stats);
      else html += renderInterestDropdownRow(item.parent, stats);
    });
    return html + "</div>";
  }

  function interestBudgetBlock(stats) {
    const bud = budgets(stats);
    return '<div class="budget">' + budgetPill("Points d'intérêt (INT × 2)", spent("per"), bud.per) + "</div>";
  }

  function interestLifeBlock(stats) {
    const money = financesNow(stats);
    return "<h3>Niveau de vie</h3><p>Crédit " + money.cr + " — " + money.life + ". Espèces " + R.money(money.fin.cash) + ", capital " + R.money(money.fin.assets) + ", dépenses courantes " + R.money(money.fin.spend) + ".</p>";
  }

  function interestIssuesBlock(stats, step) {
    return issueList(issuesForStep(stats, step));
  }

  function occPointsDisplay(key) {
    const v = pt(key).occ || 0;
    if (v > 0) return '<div class="nums point-readonly"><strong>' + v + "</strong></div>";
    return '<div class="point-na" aria-hidden="true">—</div>';
  }

  function issuesForStep(stats, step) {
    const all = issues(stats);
    if (step === 3) {
      return all.filter(function (m) {
        return /occupation|Crédit|Choisissez une occupation|compétences d'occupation/i.test(m);
      });
    }
    if (step === STEP_INTEREST) {
      return all.filter(function (m) {
        return /intérêt|plafond|dépasse/i.test(m);
      });
    }
    if (step === STEP_BAG) {
      return all.filter(function (m) {
        return /bagage|Mythe/i.test(m);
      });
    }
    return all;
  }

  function stepSkillsOcc() {
    const stats = applied().stats;
    const bud = budgets(stats);
    const occ = occById(state.occupationId);
    const occKeys = occupationKeys();
    const keys = keysForOccStep(stats);
    let html = "<h2>Occupation</h2>";
    html += '<p class="lead">Les <strong>points d\'occupation</strong> reflètent la formation du métier (calculés avec l\'Éducation et parfois une autre caractéristique). Placez-les <em>uniquement</em> sur les compétences de votre occupation et sur le <strong>Crédit</strong>, dans la fourchette indiquée par le métier.</p>';
    html += '<div class="budget">' + budgetPill("Points d'occupation", spent("occ"), bud.occ) + "</div>";
    html += '<p class="hint">Plafond à la création : ' + CAP + " % par compétence. Survolez un nom pour l'aide.</p>";
    if (!keys.length) {
      html += '<p class="warn">Choisissez d\'abord un métier et complétez ses compétences à l\'étape précédente.</p>';
    } else {
      html += '<div class="skills-table mode-occ">';
      html += '<div class="skill head"><strong>Compétence</strong><span>Base</span><span>Points</span><span>Total</span></div>';
      keys.forEach(function (key) {
        const row = pt(key);
        const base = baseOf(key, stats);
        const total = totalOf(key, stats);
        const occOk = occKeys.indexOf(key) >= 0 && key !== "Mythe de Cthulhu";
        const rowCls = "skill skill-occ-row" + (total > CAP ? " skill-over-cap" : "");
        html += '<div class="' + rowCls + '"><div>' + skillName(key.split("::")[0], key.split("::")[1]) + '</div><div class="nums">' + base + "</div>";
        html += stepper(key, "occ", row.occ || 0, occOk || key === "Crédit");
        html += '<div class="nums skill-total"><strong>' + total + "</strong></div></div>";
      });
      html += "</div>";
    }
    if (occ) html += '<p class="hint">Crédit attendu pour ce métier : entre <strong>' + occ.credit[0] + "</strong> et <strong>" + occ.credit[1] + "</strong> % (payé en points d'occupation).</p>";
    html += issueList(issuesForStep(stats, 3));
    return html;
  }

  function stepSkillsInterest() {
    const stats = applied().stats;
    let html = "<h2>Intérêt</h2>";
    html += '<p class="lead">Les <strong>points d\'intérêt personnels</strong> (INT × 2) permettent de distinguer votre investigateur. Toutes les compétences figurent ci-dessous ; le <strong>Crédit</strong> se règle à l\'étape Occupation. Pour le combat et les sciences, choisissez la spécialité dans le menu.</p>';
    html += interestBudgetBlock(stats);
    html += '<p class="hint">Plafond à la création : ' + CAP + " %. La colonne « Occ. » rappelle l'étape Occupation. Les compétences marquées <span class=\"tag-rare\">rare</span> le sont au sens du livre.</p>";
    html += renderInterestFullTable(stats);
    html += interestLifeBlock(stats);
    html += interestIssuesBlock(stats, STEP_INTEREST);
    return html;
  }

  function stepSkillsBag() {
    const stats = applied().stats;
    const bud = budgets(stats);
    const bKeys = bagKeys();
    const hasBagPts = bud.bag > 0;
    let html = "<h2>Bagage</h2>";
    html += '<p class="lead">Le <strong>bagage d\'expérience</strong> décrit un passé (guerre, police, etc.) <em>avant</em> l\'occupation actuelle. C\'est <strong>optionnel</strong> et demande l\'accord du Gardien des Arcanes. Il peut accorder des points de compétence bonus et une perte de Santé mentale.</p>';
    html += bagageBlock();
    if (hasBagPts) {
      html += '<div class="budget">' + budgetPill("Points de bagage", spent("bag"), bud.bag) + "</div>";
      html += '<p class="hint">Placez ces points sur les compétences liées à votre bagage (une fois les choix ci-dessus faits).</p>';
      html += '<div class="skills-table mode-bag">';
      html += '<div class="skill head"><strong>Compétence</strong><span>Base</span><span>Bagage</span><span>Total</span></div>';
      bKeys.forEach(function (key) {
        if (key === "Mythe de Cthulhu" && state.bagage === "myth") return;
        const row = pt(key);
        const base = baseOf(key, stats);
        const total = totalOf(key, stats);
        const bagOk = state.bagage !== "myth" && key !== "Mythe de Cthulhu";
        const rowCls = "skill" + (total > CAP ? " skill-over-cap" : "");
        html += '<div class="' + rowCls + '"><div>' + skillName(key.split("::")[0], key.split("::")[1]) + '</div><div class="nums">' + base + "</div>";
        html += stepper(key, "bag", row.bag || 0, bagOk);
        html += '<div class="nums skill-total"><strong>' + total + "</strong></div></div>";
      });
      html += "</div>";
    } else {
      html += '<p class="hint">Sans bagage (ou bagage sans points bonus), vous pouvez passer directement à l\'étape suivante.</p>';
    }
    html += issueList(issuesForStep(stats, STEP_BAG));
    return html;
  }

  function bagageBlock() {
    let html = '<div class="bag-config"><label class="field"><span>Type de bagage</span><select data-action="bagage">';
    Object.keys(BAGAGES).forEach(function (id) {
      html += '<option value="' + id + '"' + (state.bagage === id ? " selected" : "") + ">" + esc(BAGAGES[id].name) + "</option>";
    });
    html += "</select>";
    const bag = BAGAGES[state.bagage];
    if (bag.note) html += "<p>" + esc(bag.note) + "</p>";
    if (bag.san) html += '<div class="row"><button type="button" class="btn ghost" data-action="roll-san">Perte de Santé Mentale (' + bag.san + ")</button><strong>" + (state.bagSan == null ? "—" : "−" + state.bagSan) + "</strong></div>";
    if (bag.firearm) {
      const opts = bag.firearm === "any" ? DATA.firearms.map(function (f) { return f.name; }) : bag.firearm;
      html += '<label class="field"><span>Combat à distance</span><select data-action="bag-fire"><option value="">Choisir…</option>' + opts.map(function (n) {
        return '<option ' + (state.bagFirearm === n ? "selected" : "") + ">" + esc(n) + "</option>";
      }).join("") + "</select></label>";
    }
    if (bag.fighting) {
      html += '<label class="field"><span>Combat rapproché</span><select data-action="bag-fight"><option value="">Choisir…</option>' + DATA.fighting.map(function (f) {
        return '<option ' + (state.bagFight === f.name ? "selected" : "") + ">" + esc(f.name) + "</option>";
      }).join("") + "</select></label>";
    }
    (bag.specs || []).forEach(function (skill) {
      html += '<label class="field"><span>' + esc(skill) + '</span><input data-action="bag-spec" data-skill="' + esc(skill) + '" data-bind="bag-' + esc(skill) + '" value="' + esc(state.bagSpec[skill] || "") + '"></label>';
    });
    if (bag.social) {
      for (let i = 0; i < bag.social; i++) {
        html += '<select data-action="bag-social" data-i="' + i + '"><option value="">Compétence sociale…</option>' + DATA.social.map(function (n) {
          return '<option ' + (state.bagSocial[i] === n ? "selected" : "") + ">" + n + "</option>";
        }).join("") + "</select>";
      }
    }
    if (bag.sciences) {
      for (let i = 0; i < bag.sciences; i++) {
        html += '<select data-action="bag-sci" data-i="' + i + '"><option value="">Science…</option>' + DATA.sciences.map(function (n) {
          return '<option ' + (state.bagSci[i] === n ? "selected" : "") + ">" + esc(n) + "</option>";
        }).join("") + "</select>";
      }
    }
    if (state.bagage === "myth") {
      html += '<div class="row"><button type="button" class="btn ghost" data-action="roll-myth">Mythe (1D10+5)</button><input data-bind="mythos" data-kind="myth" type="number" min="0" value="' + (state.mythos == null ? "" : state.mythos) + '"><label><input type="checkbox" data-action="believer" ' + (state.believer ? "checked" : "") + "> Croyant</label></div>";
    }
    return html + "</div>";
  }

  function issueList(list) {
    if (!list.length) return '<p class="ok">La fiche est cohérente avec les étapes de création.</p>';
    return '<ul class="issues">' + list.map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul>";
  }

  function stepProfile() {
    syncWeaponsFromSkills(false);
    const p = state.profile;
    const areas = [["Idéologie et croyances", "ideology"], ["Personnes importantes", "people"], ["Lieux significatifs", "places"], ["Biens précieux", "treasures"], ["Traits", "traits"], ["Attache vitale", "bond"], ["Phobies et manies", "phobias"], ["Séquelles et cicatrices", "scars"], ["Rencontres étranges", "encounters"]];
    let html = "<h2>Profil</h2><div class=\"grid-2\">" + areas.map(function (a) {
      return '<label class="field"><span>' + a[0] + '</span><textarea data-bind="profile.' + a[1] + '">' + esc(p[a[1]]) + "</textarea></label>";
    }).join("") + "</div>";
    html += '<label class="field"><span>Équipement et possessions</span><textarea data-bind="profile.equipment">' + esc(p.equipment) + '</textarea></label><label class="field"><span>Notes</span><textarea data-bind="profile.notes">' + esc(p.notes) + "</textarea></label>";
    html += "<h3>Armes</h3>";
    html += '<p class="hint">Remplies automatiquement à partir de vos compétences de <strong>Combat rapproché</strong> et <strong>Combat à distance</strong> (jusqu\'à 4 armes, modèle type années 1920). Modifiez librement ; utilisez le bouton pour resynchroniser après un changement de compétences.</p>';
    html += '<div class="actions"><button type="button" class="btn ghost" data-action="sync-weapons">Actualiser depuis les compétences</button></div>';
    state.weapons.forEach(function (w, i) {
      html += '<div class="grid-3">' + ["name", "skill", "damage", "range", "shots", "ammo", "malfunction"].map(function (k) {
        const labels = { name: "Arme", skill: "Compétence %", damage: "Dégâts", range: "Portée", shots: "Coups", ammo: "Munitions", malfunction: "Panne (jet)" };
        return field(labels[k], "weapons." + i + "." + k, w[k]);
      }).join("") + "</div>";
    });
    return html;
  }

  function stepSheet() {
    const stats = applied().stats;
    return '<h2>Fiche</h2><p class="lead">La fiche suit la présentation des années 1920, sur deux pages. Téléchargez-la en PDF : dans la fenêtre qui s\'ouvre, choisissez « Enregistrer au format PDF ».</p><div class="actions"><button type="button" class="btn" data-action="print">Télécharger en PDF</button></div>' + issueList(issues(stats)) + '<p><button type="button" class="btn ghost" data-action="reset">Nouvelle fiche</button></p>';
  }

  function savesHtml() {
    let saves = [];
    try { saves = JSON.parse(localStorage.getItem("inv-saves") || "[]"); } catch (e) { saves = []; }
    if (!saves.length) return "";
    return "<h3>Fiches enregistrées ici</h3><div class=\"list\">" + saves.map(function (s) {
      return '<button type="button" data-action="load-named" data-id="' + esc(s.id) + '">' + esc(s.name || "Sans nom") + " — " + esc(s.at) + "</button>";
    }).join("") + "</div>";
  }

  function sanNow(stats) {
    const myth = mythosBonus();
    let current = stats.POU - (Number(state.bagSan) || 0);
    if (state.bagage === "myth" && state.believer) current -= myth;
    return { current: Math.max(0, current), max: 99 - myth };
  }

  function sheetHtml() {
    const app = applied();
    const stats = app.stats;
    const missing = missingStats();
    const known = !missing.length;
    const imp = known ? R.impact(stats.FOR, stats.TAI) : { text: "", build: "" };
    const san = sanNow(stats);
    const money = financesNow(stats);
    const occ = occById(state.occupationId);
    const profile = state.profile;
    const mov = known ? R.movement(stats.FOR, stats.DEX, stats.TAI, state.age) : null;

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function cells(from, to, mark, max) {
      let html = "";
      for (let n = from; n <= to; n++) {
        let cls = "";
        if (max != null && n > max) cls = "gone";
        else if (mark != null && n === mark) cls = "on";
        html += "<i" + (cls ? ' class="' + cls + '"' : "") + ">" + pad(n) + "</i>";
      }
      return '<span class="nums">' + html + "</span>";
    }
    function trow(label, from, to, mark) {
      return '<div class="trow"><span>' + label + "</span>" + cells(from, to, mark) + "</div>";
    }
    function charBox(label, value, half, fifth) {
      function cell(n) { return "<b>" + (n == null || n === "" ? "" : n) + "</b>"; }
      return '<div class="cstat"><span>' + label + '</span><div class="cbox cbox-3"><i>Jet</i><i>Maj.</i><i>Ext.</i>' + cell(value) + cell(half) + cell(fifth) + "</div></div>";
    }
    function printedBase(name) {
      if (name === "Esquive") return "DEX/2";
      if (name === "Langue maternelle") return "ÉDU";
      const def = DATA.skills.find(function (s) { return s.name === name; });
      if (!def || typeof def.base !== "number") return "";
      return (def.base < 10 ? "0" : "") + def.base + " %";
    }
    function specBase(parent, spec) {
      const cat = parent === "Combat rapproché" ? DATA.fighting : parent === "Combat à distance" ? DATA.firearms : null;
      if (cat) {
        const hit = cat.find(function (f) { return f.name === spec; });
        if (hit) return (hit.base < 10 ? "0" : "") + hit.base + " %";
      }
      return printedBase(parent);
    }
    function active(key) {
      if (!key) return false;
      const row = state.points[key];
      const added = row ? (row.occ || 0) + (row.per || 0) + (row.bag || 0) : 0;
      if (added > 0) return true;
      if ((state.extras || []).indexOf(key) >= 0) return true;
      if (occupationKeys().indexOf(key) >= 0) return true;
      if (bagKeys().indexOf(key) >= 0) return true;
      if (key === "Mythe de Cthulhu" && mythosBonus() > 0) return true;
      return false;
    }
    function specsOf(parent) {
      const seen = {};
      const found = [];
      function add(key) {
        if (!key || seen[key] || key.indexOf(parent + "::") !== 0) return;
        if (!active(key)) return;
        seen[key] = true;
        found.push(key);
      }
      Object.keys(state.points).forEach(add);
      (state.extras || []).forEach(add);
      occupationKeys().forEach(add);
      bagKeys().forEach(add);
      return found;
    }

    const placed = {};
    const overflow = [];
    function mark(key) { if (key) placed[key] = true; }
    function takeSpecs(parent, skip, count) {
      const list = specsOf(parent).filter(function (k) { return skip.indexOf(k) < 0; });
      const rows = [];
      for (let i = 0; i < count; i++) {
        if (list[i]) {
          mark(list[i]);
          const spec = list[i].split("::")[1];
          rows.push({ key: list[i], label: spec, base: specBase(parent, spec), sub: true });
        } else rows.push({ empty: true, sub: true });
      }
      list.slice(count).forEach(function (k) { overflow.push(k); });
      return rows;
    }
    function fixed(name, key, sub) {
      const id = key || name;
      mark(id);
      const base = id.indexOf("::") > 0 ? specBase(id.split("::")[0], id.split("::")[1]) : printedBase(id);
      return { key: id, label: name, base: base, sub: !!sub, bare: id === "Arts et métiers" };
    }

    const tongue = keyOf("Langue maternelle", state.language || "Français");
    mark(tongue);
    const col1 = [
      fixed("Anthropologie"), fixed("Archéologie"), fixed("Arts et métiers")
    ].concat(takeSpecs("Arts et métiers", [], 3), [
      fixed("Baratin"), fixed("Bibliothèque"), fixed("Charme"),
      { head: "Combat à distance" }
    ], [
      fixed("(Armes de poing)", "Combat à distance::Armes de poing", true),
      fixed("(Fusils)", "Combat à distance::Fusils / fusils de chasse", true)
    ], takeSpecs("Combat à distance", ["Combat à distance::Armes de poing", "Combat à distance::Fusils / fusils de chasse"], 1), [
      { head: "Combat rapproché" },
      fixed("(Corps à corps)", "Combat rapproché::Corps à corps", true)
    ], takeSpecs("Combat rapproché", ["Combat rapproché::Corps à corps"], 2), [
      fixed("Comptabilité"), fixed("Conduite"), fixed("Conduite d'engin lourd", "Conduite engin lourd"),
      fixed("Crédit"), fixed("Crochetage"), fixed("Discrétion")
    ]);
    const col2 = [
      fixed("Droit"), fixed("Écouter"), fixed("Électricité"), fixed("Équitation"), fixed("Esquive"),
      fixed("Estimation"), fixed("Grimper"), fixed("Histoire"), fixed("Imposture"), fixed("Intimidation"),
      fixed("Lancer"),
      { key: tongue, label: "Langue maternelle" + (state.language ? " — " + state.language : ""), base: "ÉDU" },
      { empty: true }
    ].concat([{ head: "Langues" }], takeSpecs("Langues", [], 3), [
      fixed("Mécanique"), fixed("Médecine"), fixed("Mythe de Cthulhu"), fixed("Nager"), fixed("Naturalisme"), fixed("Occultisme")
    ]);
    const col3 = [
      fixed("Orientation"), fixed("Persuasion"), fixed("Pickpocket"),
      { head: "Pilotage" }
    ].concat(takeSpecs("Pilotage", [], 1), [
      fixed("Pister"), fixed("Premiers soins"), fixed("Psychanalyse"), fixed("Psychologie"), fixed("Sauter"),
      { head: "Sciences" }
    ], takeSpecs("Sciences", [], 3), [
      { head: "Survie" }
    ], takeSpecs("Survie", [], 1), [
      fixed("Trouver Objet Caché")
    ]);
    while (col3.length < 17) col3.push({ empty: true });
    const freeStart = col3.length;
    for (let i = 0; i < 6; i++) col3.push({ empty: true });

    const knownParents = {};
    ["Anthropologie", "Archéologie", "Arts et métiers", "Baratin", "Bibliothèque", "Charme", "Comptabilité", "Conduite", "Conduite engin lourd", "Crédit", "Crochetage", "Discrétion", "Droit", "Écouter", "Électricité", "Équitation", "Esquive", "Estimation", "Grimper", "Histoire", "Imposture", "Intimidation", "Lancer", "Langue maternelle", "Langues", "Mécanique", "Médecine", "Mythe de Cthulhu", "Nager", "Naturalisme", "Occultisme", "Orientation", "Persuasion", "Pickpocket", "Pilotage", "Pister", "Premiers soins", "Psychanalyse", "Psychologie", "Sauter", "Sciences", "Survie", "Trouver Objet Caché", "Combat à distance", "Combat rapproché"].forEach(function (n) { knownParents[n] = true; });
    const seenExtra = {};
    function consider(key) {
      if (!key || placed[key] || seenExtra[key] || !active(key)) return;
      const parent = key.split("::")[0];
      if (knownParents[parent] && key.indexOf("::") < 0) return;
      if (knownParents[parent] && key.indexOf("::") > 0) {
        if (overflow.indexOf(key) >= 0) { seenExtra[key] = true; return; }
      }
      seenExtra[key] = true;
      overflow.push(key);
    }
    Object.keys(state.points).forEach(consider);
    (state.extras || []).forEach(consider);
    occupationKeys().forEach(consider);
    bagKeys().forEach(consider);

    let freeAt = freeStart;
    overflow.forEach(function (key) {
      const bits = key.split("::");
      const row = { key: key, label: bits[1] ? bits[0] + " (" + bits[1] + ")" : bits[0], base: bits[1] ? specBase(bits[0], bits[1]) : printedBase(bits[0]) };
      if (col2.some(function (r) { return r.empty && !r.used; })) {
        const slot = col2.find(function (r) { return r.empty && !r.used; });
        slot.used = true;
        slot.empty = false;
        slot.key = row.key;
        slot.label = row.label;
        slot.base = row.base;
        return;
      }
      if (freeAt < col3.length && col3[freeAt].empty) {
        col3[freeAt] = row;
        freeAt += 1;
        return;
      }
      col3.push(row);
    });

    function skRow(row, index) {
      if (row.head) return '<div class="sk head">' + esc(row.head) + "</div>";
      let value = "";
      let half = "";
      let fifth = "";
      if (row.key && !(row.bare && !active(row.key))) {
        const needsStats = row.key === "Esquive" || row.key.indexOf("Langue maternelle") === 0;
        if (!(needsStats && !known)) {
          const n = totalOf(row.key, stats);
          value = n;
          half = R.half(n);
          fifth = R.fifth(n);
        }
      }
      return '<div class="sk' + (row.sub ? " sub" : "") + (index % 2 ? " alt" : "") + '"><i class="tick"></i><span>' + esc(row.label || "") + (row.base ? "<small> (" + esc(row.base) + ")</small>" : "") + '</span><b>' + value + '</b><span class="pct">' + (row.key || row.empty ? "%" : "") + '</span><i class="mini">' + half + '</i><i class="mini">' + fifth + "</i></div>";
    }
    function colHtml(rows) {
      return rows.map(skRow).join("");
    }

    function stat(code) {
      const name = code === "INT" ? 'INT<small>Idée</small>' : code;
      if (!known) return charBox(name, null, null, null);
      return charBox(name, stats[code], R.half(stats[code]), R.fifth(stats[code]));
    }
    const mvt = '<div class="cstat"><span>MVT</span><div class="cbox"><b>' + (mov == null ? "" : mov) + '</b><b></b></div><div class="mvt-side"><b>' + (mov == null ? "+1" : "+1 " + (mov + 1)) + "</b><b>" + (mov == null ? "−1" : "−1 " + (mov - 1)) + "</b></div></div>";

    const hp = known ? R.hitPoints(stats.CON, stats.TAI) : null;
    const mp = known ? R.magicPoints(stats.POU) : null;
    const luck = state.chance;

    function weaponScores(text) {
      const raw = String(text || "").trim();
      if (!raw) return null;
      if (/^\d+$/.test(raw)) return Number(raw);
      const keys = [] .concat(Object.keys(state.points), state.extras || [], occupationKeys(), bagKeys(), ["Esquive", "Combat rapproché::Corps à corps"]);
      const hit = keys.find(function (k) {
        return k && (k === raw || labelOf(k).toLowerCase() === raw.toLowerCase() || (k.split("::")[1] || "") === raw);
      });
      return hit ? totalOf(hit, stats) : null;
    }
    const brawl = known ? totalOf("Combat rapproché::Corps à corps", stats) : null;
    const dodge = known ? totalOf("Esquive", stats) : null;
    let unarmed = "1D3";
    if (known && imp.text && imp.text !== "Aucun") unarmed = "1D3" + (String(imp.text).indexOf("−") === 0 ? imp.text : "+" + imp.text);
    function wcells(n) {
      if (n == null) return "<td></td><td></td><td></td>";
      return "<td>" + n + "</td><td>" + R.half(n) + "</td><td>" + R.fifth(n) + "</td>";
    }
    const weaponRows = [{ name: "À mains nues", score: brawl, damage: unarmed, range: "—", shots: "1", ammo: "—", malfunction: "—" }];
    state.weapons.forEach(function (w) {
      if (w.name || w.skill || w.damage || w.range || w.shots || w.ammo || w.malfunction) {
        weaponRows.push({ name: w.name, score: weaponScores(w.skill), damage: w.damage, range: w.range, shots: w.shots, ammo: w.ammo, malfunction: w.malfunction });
      }
    });
    while (weaponRows.length < 5) weaponRows.push({});
    const weaponHtml = weaponRows.map(function (w) {
      return "<tr><td>" + esc(w.name || "") + "</td>" + wcells(w.score) + "<td>" + esc(w.damage || "") + "</td><td>" + esc(w.range || "") + "</td><td>" + esc(w.shots || "") + "</td><td>" + esc(w.ammo || "") + "</td><td>" + esc(w.malfunction || "") + "</td></tr>";
    }).join("");

    const people = [profile.people, profile.bond ? "Attache vitale : " + profile.bond : ""].filter(Boolean).join("\n");
    const noteText = [profile.notes, state.bagage && state.bagage !== "none" ? "Bagage : " + BAGAGES[state.bagage].name + (BAGAGES[state.bagage].note ? ". " + BAGAGES[state.bagage].note : "") : ""].filter(Boolean).join("\n\n");
    function prow(title, text) {
      return '<div class="prow"><b>' + title + "</b><p>" + esc(text || "") + "</p></div>";
    }
    const friends = [0, 1, 2, 3, 4, 5, 6, 7].map(function () {
      return '<div class="friend">Nom<br>Joueur</div>';
    });
    friends.splice(4, 0, '<div class="moi">MOI</div>');

    const page1 = '<section class="sheet-page"><div class="sheet-inner"><div class="sheet-top"><div class="id-block"><h3>Années 1920</h3>'
      + '<div class="id-line"><b>Nom</b><span>' + esc(state.name) + "</span></div>"
      + '<div class="id-line"><b>Joueur</b><span>' + esc(state.player) + "</span></div>"
      + '<div class="id-line"><b>Occupation</b><span>' + esc(occ ? occLabel(occ) : "") + "</span></div>"
      + '<div class="id-pair"><div class="id-line"><b>Sexe</b><span>' + esc(state.sex) + '</span></div><div class="id-line"><b>Âge</b><span>' + esc(state.age) + "</span></div></div>"
      + '<div class="id-line"><b>Résidence</b><span>' + esc(state.residence) + "</span></div>"
      + '<div class="id-line"><b>Lieu de naissance</b><span>' + esc(state.birth) + "</span></div>"
      + (state.portrait ? '<img class="portrait" alt="" src="' + state.portrait + '">' : "")
      + '</div><div class="char-block"><h3>Caractéristiques</h3><div class="char-grid">'
      + stat("FOR") + stat("DEX") + stat("POU")
      + stat("CON") + stat("APP") + stat("ÉDU")
      + stat("TAI") + stat("INT") + mvt
      + "</div></div></div>"
      + '<div class="vitals"><div><h3>Points de vie</h3>'
      + trow("Inconscient", 0, 4, hp)
      + trow("Mourant", 5, 8, hp)
      + '<div class="trow"><span>Blessure grave <i class="tick"></i></span>' + cells(9, 12, hp) + "</div>"
      + '<div class="trow"><span></span>' + cells(13, 16, hp) + "</div>"
      + '<div class="trow"><span>PV max <b class="boxn">' + (hp == null ? "" : hp) + "</b></span>" + cells(17, 20, hp) + "</div>"
      + '</div><div><div class="san-head"><h3>Santé mentale</h3><span>Initiale <b class="boxn">' + (known ? san.current : "") + '</b> Max. <b class="boxn">' + (known ? san.max : "") + "</b></span></div>"
      + '<div class="san-head"><label><i class="tick"></i> Folie temp.</label><label><i class="tick"></i> Folie persist.</label><label><i class="tick"></i> Folie</label></div>'
      + cells(1, 20, known ? san.current : null, known ? san.max : null)
      + cells(21, 40, known ? san.current : null, known ? san.max : null)
      + cells(41, 60, known ? san.current : null, known ? san.max : null)
      + cells(61, 80, known ? san.current : null, known ? san.max : null)
      + cells(81, 99, known ? san.current : null, known ? san.max : null)
      + "</div></div>"
      + '<div class="vitals"><div><h3>Points de magie</h3>'
      + trow("", 0, 5, mp)
      + trow("", 6, 10, mp)
      + trow("", 11, 15, mp)
      + trow("", 16, 20, mp)
      + '<div class="trow"><span>PM max <b class="boxn">' + (mp == null ? "" : mp) + "</b></span>" + cells(21, 25, mp) + "</div>"
      + '</div><div><div class="luck-head"><h3>Chance</h3><label><i class="tick"></i> Pas de chance</label></div>'
      + cells(1, 20, luck)
      + cells(21, 40, luck)
      + cells(41, 60, luck)
      + cells(61, 80, luck)
      + cells(81, 99, luck)
      + "</div></div>"
      + '<h3 style="margin-top:4px">Compétences de l\'investigateur</h3><div class="skills3"><div>' + colHtml(col1) + "</div><div>" + colHtml(col2) + "</div><div>" + colHtml(col3) + "</div></div>"
      + '<div class="sheet-bottom"><div><h3>Armes</h3><table class="weapons"><tr><th>Arme</th><th>Ord.</th><th>Maj.</th><th>Ext.</th><th>Dégâts</th><th>Portée</th><th>Cad.</th><th>Cap.</th><th>Panne</th></tr>' + weaponHtml + '</table></div><div class="combat"><h3>Combat</h3>'
      + '<div class="cstat"><span>Impact</span><div class="cbox"><b>' + esc(imp.text || "") + "</b></div></div>"
      + '<div class="cstat"><span>Carrure</span><div class="cbox"><b>' + (imp.build === "" || imp.build == null ? "" : imp.build) + "</b></div></div>"
      + '<div class="cstat"><span>Esquive</span><div class="cbox"><b>' + (dodge == null ? "" : dodge) + "</b><b>" + (dodge == null ? "" : R.half(dodge)) + "</b></div></div>"
      + "</div></div></div></section>";

    const page2 = '<section class="sheet-page"><div class="sheet-inner"><h3>Profil</h3><div class="profile2"><div>'
      + prow("Description", state.description)
      + prow("Idéologie et croyances", profile.ideology)
      + prow("Personnes importantes", people)
      + prow("Lieux significatifs", profile.places)
      + prow("Biens précieux", profile.treasures)
      + "</div><div>"
      + prow("Traits", profile.traits)
      + prow("Séquelles et cicatrices", profile.scars)
      + prow("Phobies et manies", profile.phobias)
      + prow("Ouvrages occultes, sorts et artefacts", "")
      + prow("Rencontres avec entités étranges", profile.encounters)
      + '</div></div><div class="split2"><div><h3>Équipement et possessions</h3><div class="equip"><p>' + esc(profile.equipment || "") + '</p></div></div><div><h3>Fortune</h3><div class="prow"><b>Dépenses courantes</b><p>' + (known ? R.money(money.fin.spend) : "") + '</p></div><div class="prow"><b>Espèces</b><p>' + (known ? R.money(money.fin.cash) : "") + '</p></div><div class="prow"><b>Capital</b><p>' + (known ? R.money(money.fin.assets) + (money.life ? "\nNiveau de vie : " + money.life : "") : "") + '</p></div></div></div>'
      + '<div class="split2"><div><h3>Amis investigateurs</h3><div class="friends">' + friends.join("") + '</div></div><div><h3>Notes</h3><div class="notes"><p>' + esc(noteText) + "</p></div></div></div>"
      + '<div class="memo"><div><h3>Aide-mémoire</h3><h4>Tests de compétence ou de caractéristique</h4><p><b>Maladresse</b> — 100, ou 96 et plus si la compétence est inférieure à 50.</p><p><b>Échec</b> — au-dessus de la valeur.</p><p><b>Ordinaire</b> — égal ou inférieur à la valeur.</p><p><b>Majeur</b> — égal ou inférieur à la moitié.</p><p><b>Extrême</b> — égal ou inférieur au cinquième.</p><p><b>Critique</b> — 01.</p><p>Un test peut être redoublé avec une raison valable. C\'est impossible en combat ou pour la Santé Mentale.</p></div><div><h4>Blessures et soins</h4><p><b>Premiers soins</b> — rend 1 PV.</p><p><b>Médecine</b> — rend 1D3 PV.</p><p><b>Blessure grave</b> — perte d\'au moins la moitié des PV en une seule attaque.</p><p><b>0 PV sans blessure grave</b> — inconscient.</p><p><b>0 PV avec blessure grave</b> — mourant.</p><p><b>Mourant</b> — Premiers soins pour stabiliser, puis Médecine.</p><p><b>Guérison naturelle</b> — 1 PV par jour sans blessure grave, ou un test par semaine si la blessure est grave.</p></div></div>'
      + '<p class="fine">Fiche pour une table privée, sur le modèle des années 1920. L\'Appel de Cthulhu est une marque de Chaosium. Cet outil n\'est pas officiel.</p></div></section>';

    return page1 + page2;
  }
  function download(filename, text, type) {
    const blob = new Blob([text], { type: type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function fileName() {
    const n = (state.name || "investigateur").replace(/[^\w\u00C0-\u024f\- ]+/g, "").trim().replace(/\s+/g, "-");
    return n || "investigateur";
  }

  function downloadHtml() {
    const css = document.querySelector("link[rel=stylesheet]");
    fetch(css.href).then(function (r) { return r.text(); }).then(function (text) {
      const doc = "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>" + esc(state.name || "Investigateur") + "</title><style>" + text + "</style></head><body>" + sheetHtml() + "</body></html>";
      download(fileName() + ".html", doc, "text/html");
    }).catch(function () {
      const style = "body{font-family:Georgia,serif;color:#1d1a17;margin:24px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4dacb;padding:3px 4px;text-align:left}.cols{columns:2}h2,h3{font-family:Georgia,serif}";
      download(fileName() + ".html", "<!DOCTYPE html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Fiche</title><style>" + style + "</style></head><body>" + sheetHtml() + "</body></html>", "text/html");
    });
  }

  function ensurePick(index) {
    if (!state.picks[index]) state.picks[index] = {};
    return state.picks[index];
  }

  function onClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.tagName === "SELECT" || btn.tagName === "INPUT" || btn.tagName === "TEXTAREA") return;
    const action = btn.dataset.action;
    if (action === "goto") state.step = Number(btn.dataset.step);
    if (action === "next") state.step = Math.min(LAST_STEP, state.step + 1);
    if (action === "prev") state.step = Math.max(0, state.step - 1);
    if (action === "roll-all") {
      ["FOR", "CON", "DEX", "APP", "POU"].forEach(function (s) { state.raw[s] = roll3(); });
      ["TAI", "INT", "ÉDU"].forEach(function (s) { state.raw[s] = roll26(); });
      state.eduChecks = [];
    }
    if (action === "roll-stat") {
      const s = btn.dataset.stat;
      state.raw[s] = (s === "TAI" || s === "INT" || s === "ÉDU") ? roll26() : roll3();
      if (s === "ÉDU") state.eduChecks = [];
    }
    if (action === "roll-chance") {
      const n = R.bandFor(state.age).luckRolls;
      state.chanceRolls = [];
      for (let i = 0; i < n; i++) state.chanceRolls.push(roll3());
      state.chance = Math.max.apply(null, state.chanceRolls);
    }
    if (action === "mod") {
      const stat = btn.dataset.stat;
      const delta = Number(btn.dataset.delta);
      const pool = R.bandFor(state.age).pools.find(function (p) { return p.stats.indexOf(stat) >= 0; });
      if (pool) {
        const next = (state.mods[stat] || 0) + delta;
        const others = pool.stats.reduce(function (s, k) { return s + (k === stat ? 0 : (state.mods[k] || 0)); }, 0);
        if (next >= 0 && others + next <= pool.points) state.mods[stat] = next;
      }
    }
    if (action === "edu") {
      const seq = R.eduSequence(Math.max(0, (Number(numericRaw()["ÉDU"]) || 0) + R.bandFor(state.age).eduDelta), state.eduChecks);
      const roll = dice(1, 100);
      state.eduChecks.push({ roll: roll, die: roll > seq.edu ? dice(1, 10) : 0 });
    }
    if (action === "occ") selectOcc(btn.dataset.id);
    if (action === "point") setPoint(btn.dataset.key, btn.dataset.field, (pt(btn.dataset.key)[btn.dataset.field] || 0) + Number(btn.dataset.delta));
    if (action === "roll-san") {
      const bag = BAGAGES[state.bagage];
      state.bagSan = bag && bag.san === "1d10+5" ? dice(1, 10) + 5 : dice(1, 10);
    }
    if (action === "roll-myth") state.mythos = dice(1, 10) + 5;
    if (action === "print") {
      state.step = LAST_STEP;
      render();
      setTimeout(function () { window.print(); }, 60);
      return;
    }
    if (action === "download-html") downloadHtml();
    if (action === "download-json") download(fileName() + ".json", JSON.stringify({ version: 1, state: state }, null, 2), "application/json");
    if (action === "save-named") saveNamed();
    if (action === "load-named") loadNamed(btn.dataset.id);
    if (action === "reset") {
      if (window.confirm("Effacer la fiche en cours ?")) {
        state = blank();
        localStorage.removeItem("inv-draft");
      }
    }
    if (action === "sync-weapons") syncWeaponsFromSkills(true);
    render();
  }

  function onChange(e) {
    const el = e.target;
    const action = el.dataset.action;
    if (el.dataset.bind === "age") setAge(el.value);
    if (action === "bind") setPath(el.dataset.bind, el.value);
    if (action === "formula") state.formulaStat = el.value;
    if (action === "pick-index") ensurePick(el.dataset.index).index = el.value === "" ? "" : Number(el.value);
    if (action === "pick-text" || action === "pick-list" || action === "pick-social" || action === "pick-any" || action === "pick-any-spec" || action === "pick-among" || action === "pick-among-text") updatePick(el);
    if (action === "add-skill") addSkill(el.value);
    if (action === "interest-spec") {
      if (!state.interestSpec) state.interestSpec = {};
      state.interestSpec[el.dataset.parent] = el.value;
    }
    if (action === "bagage") {
      Object.keys(state.points).forEach(function (k) { state.points[k].bag = 0; });
      state.bagage = el.value;
      state.bagSan = null;
      state.mythos = null;
      state.bagSpec = {};
      state.bagSocial = [];
      state.bagFirearm = "";
      state.bagFight = "";
      state.bagSci = ["", ""];
    }
    if (action === "bag-fire") state.bagFirearm = el.value;
    if (action === "bag-fight") state.bagFight = el.value;
    if (action === "bag-spec") state.bagSpec[el.dataset.skill] = el.value;
    if (action === "bag-social") state.bagSocial[Number(el.dataset.i)] = el.value;
    if (action === "bag-sci") state.bagSci[Number(el.dataset.i)] = el.value;
    if (action === "believer") state.believer = el.checked;
    if (action === "portrait") readPortrait(el);
    if (action === "import") readImport(el);
    if (action !== "portrait" && action !== "import") render();
  }

  function updatePick(el) {
    const pick = ensurePick(el.dataset.index);
    const i = el.dataset.i == null ? null : Number(el.dataset.i);
    if (el.dataset.action === "pick-text") pick.text = el.value;
    if (el.dataset.action === "pick-list") {
      pick.list = pick.list || [];
      pick.list[i] = el.value;
    }
    if (el.dataset.action === "pick-social") {
      pick.list = pick.list || [];
      pick.list[i] = el.value;
    }
    if (el.dataset.action === "pick-any" || el.dataset.action === "pick-any-spec" || el.dataset.action === "pick-among" || el.dataset.action === "pick-among-text") {
      pick.list = pick.list || [];
      pick.list[i] = pick.list[i] || {};
      if (el.dataset.action === "pick-any") pick.list[i].skill = el.value;
      if (el.dataset.action === "pick-any-spec") pick.list[i].spec = el.value;
      if (el.dataset.action === "pick-among") pick.list[i].index = el.value === "" ? "" : Number(el.value);
      if (el.dataset.action === "pick-among-text") pick.list[i].text = el.value;
    }
  }

  function addSkill(name) {
    if (!name) return;
    if (isSpec(name)) {
      const spec = window.prompt("Spécialité pour " + name + " :");
      if (!spec) return;
      const key = keyOf(name, spec);
      if (state.extras.indexOf(key) < 0) state.extras.push(key);
    } else if (state.extras.indexOf(name) < 0 && name !== "Esquive") {
      state.extras.push(name);
    }
  }

  function onInput(e) {
    const el = e.target;
    if (el.tagName === "SELECT") return;
    if (el.dataset.bind === "age") {
      const digits = String(el.value).replace(/\D/g, "").slice(0, 2);
      if (el.value !== digits) el.value = digits;
      if (digits.length === 2) setAge(digits);
      return;
    }
    focus = { id: el.dataset.bind || "", sel: el.selectionStart };
    if (el.dataset.action === "point-set") {
      setPoint(el.dataset.key, el.dataset.field, el.value);
      render();
      return;
    }
    if (el.dataset.action === "bag-spec") {
      state.bagSpec[el.dataset.skill] = el.value;
      return;
    }
    if (el.dataset.action === "pick-text" || el.dataset.action === "pick-list" || el.dataset.action === "pick-any-spec" || el.dataset.action === "pick-among-text") {
      updatePick(el);
      return;
    }
    if (!el.dataset.bind) return;
    let value = el.value;
    if (el.dataset.bind === "mythos") { state.mythos = value === "" ? null : Number(value); render(); return; }
    if (el.dataset.bind.indexOf("raw.") === 0) {
      const stat = el.dataset.bind.split(".")[1];
      state.raw[stat] = value === "" ? null : Number(value);
      if (stat === "ÉDU") state.eduChecks = [];
      render();
      return;
    }
    if (el.dataset.bind.indexOf("weapons.") === 0 || el.dataset.bind.indexOf("profile.") === 0) {
      if (el.dataset.bind.indexOf("weapons.") === 0) state.weaponsTouched = true;
      setPath(el.dataset.bind, value);
      return;
    }
    if (el.dataset.bind === "language") {
      const previous = keyOf("Langue maternelle", state.language);
      const nextKey = keyOf("Langue maternelle", value);
      state.language = value;
      if (previous && nextKey && previous !== nextKey && state.points[previous]) {
        state.points[nextKey] = state.points[previous];
        delete state.points[previous];
      }
      render();
      return;
    }
    setPath(el.dataset.bind, value);
    if (el.dataset.bind === "occQuery" || el.dataset.bind === "name") render();
  }

  function readPortrait(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 700000) { window.alert("Choisissez une image plus légère (moins de 700 Ko)."); return; }
    const reader = new FileReader();
    reader.onload = function () { state.portrait = reader.result; render(); };
    reader.readAsDataURL(file);
  }

  function readImport(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        state = loadState(data.state || data);
        state.step = LAST_STEP;
        render();
      } catch (err) { window.alert("Ce fichier n'est pas une sauvegarde lisible."); }
    };
    reader.readAsText(file);
  }

  function saveNamed() {
    let saves = [];
    try { saves = JSON.parse(localStorage.getItem("inv-saves") || "[]"); } catch (e) { saves = []; }
    saves.unshift({ id: String(Date.now()), name: state.name || "Sans nom", at: new Date().toLocaleString("fr-FR"), state: state });
    saves = saves.slice(0, 15);
    try {
      localStorage.setItem("inv-saves", JSON.stringify(saves));
      state.saveMsg = "Fiche enregistrée dans ce navigateur.";
    } catch (e) { state.saveMsg = "Enregistrement impossible. Téléchargez plutôt le JSON."; }
    render();
  }

  function loadNamed(id) {
    const saves = JSON.parse(localStorage.getItem("inv-saves") || "[]");
    const found = saves.find(function (s) { return s.id === id; });
    if (!found) return;
    state = loadState(found.state);
    state.step = LAST_STEP;
  }

  function enforceCreationRules() {
    if (state.method === "assign" && state.assignMap) {
      R.STATS.forEach(function (s) {
        const roll = (state.assignRolls || []).find(function (r) { return r.id === state.assignMap[s]; });
        if (roll) state.raw[s] = roll.value;
      });
    }
    state.method = "classic";
    state.extras = (state.extras || []).filter(function (k) { return !MODERN_SKILLS[String(k).split("::")[0]]; });
    Object.keys(state.points).forEach(function (key) {
      if (MODERN_SKILLS[String(key).split("::")[0]]) delete state.points[key];
    });
    if (state.occupationId && !occById(state.occupationId)) {
      state.occupationId = "";
      state.picks = {};
      state.formulaStat = "";
      Object.keys(state.points).forEach(function (k) {
        if (state.points[k]) state.points[k].occ = 0;
      });
    }
    const stats = applied().stats;
    Object.keys(state.points).forEach(function (key) {
      const row = state.points[key];
      ["bag", "per", "occ"].forEach(function (field) {
        while (row && totalOf(key, stats) > CAP && (row[field] || 0) > 0) row[field] -= 1;
      });
    });
  }

  function loadState(raw) {
    const base = blank();
    if (!raw || typeof raw !== "object") return base;
    const next = Object.assign(base, raw);
    next.raw = Object.assign(blank().raw, raw.raw || {});
    next.mods = Object.assign(R.defaultMods(next.age || 30), raw.mods || {});
    next.profile = Object.assign(blank().profile, raw.profile || {});
    next.points = raw.points || {};
    next.picks = raw.picks || {};
    next.weapons = raw.weapons && raw.weapons.length ? raw.weapons : blank().weapons;
    next.eduChecks = raw.eduChecks || [];
    next.extras = raw.extras || [];
    next.bagSpec = raw.bagSpec || {};
    next.bagSocial = raw.bagSocial || [];
    next.bagSci = raw.bagSci || ["", ""];
    next.assignRolls = raw.assignRolls || [];
    next.assignMap = raw.assignMap || {};
    next.interestSpec = raw.interestSpec || {};
    next.weaponsTouched = !!raw.weaponsTouched;
    if (next.wizard !== WIZARD_LAYOUT && typeof next.step === "number") {
      if (next.wizard === WIZARD_LAYOUT_PREV) {
        if (next.step >= 9) next.step -= 4;
        else if (next.step >= 5 && next.step <= 8) next.step = STEP_INTEREST;
      } else if (!next.wizard || next.wizard === "legacy") {
        if (next.step === 4) next.step = 6;
        else if (next.step >= 5) next.step = LAST_STEP;
      }
    }
    next.wizard = WIZARD_LAYOUT;
    if (typeof next.step !== "number" || next.step < 0) next.step = 0;
    else if (next.step > LAST_STEP) next.step = LAST_STEP;
    return next;
  }

  let tipEl = null;

  function tipBox() {
    if (tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "tip-pop";
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function hideTip() {
    if (tipEl) tipEl.hidden = true;
  }

  function showTip(el) {
    const text = el && el.getAttribute ? el.getAttribute("data-tip") : "";
    if (!text) { hideTip(); return; }
    const box = tipBox();
    box.textContent = text;
    box.hidden = false;
    const rect = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8));
    let top = rect.bottom + 8;
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - box.offsetHeight - 8);
    box.style.left = left + "px";
    box.style.top = top + "px";
  }

  function bindTips() {
    document.addEventListener("mouseover", function (e) {
      const el = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (el) showTip(el);
      else hideTip();
    });
    document.addEventListener("focusin", function (e) {
      const el = e.target.closest ? e.target.closest("[data-tip]") : null;
      if (el) showTip(el);
    });
    document.addEventListener("focusout", hideTip);
    window.addEventListener("scroll", hideTip, true);
  }

  function init() {
    if (!DATA || !R) {
      document.getElementById("app").textContent = "Impossible de charger les données du créateur.";
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem("inv-draft") || "null");
      if (draft) state = loadState(draft);
    } catch (e) { /* ignore broken draft */ }
    enforceCreationRules();
    const app = document.getElementById("app");
    app.addEventListener("click", onClick);
    app.addEventListener("change", onChange);
    app.addEventListener("input", onInput);
    app.addEventListener("focusin", function (e) {
      if (e.target && e.target.dataset && e.target.dataset.bind === "age") e.target.select();
    });
    bindTips();
    render();
  }

  init();
})();
