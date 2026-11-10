// ProteinMaxx meal builder. Loaded after the main page script and uses its globals:
// RAW, FOODS, S, makeFoods, myFoodRows, loadDataset, render, passes, $, esc, fmt, fmt0.

const TYPE_TARGETS = { breakfast: 30, lunch: 40, dinner: 40, snack: 20, other: 30 };
const TYPE_LABELS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", other: "Other" };
// Groups that make poor top-ups: mixed dishes, sweets, fats and drinks
const NO_TOPUP_GROUPS = ["Prepared dishes", "Sweets & snacks", "Fats, sauces & spreads", "Drinks"];

let ALL = new Map();        // every food from every database, by key
let TOPUP_POOL = [];        // one database's worth of foods for top-ups, so the same food isn't suggested twice in two languages
let MEALS = { current: null, meals: [] };
let copyTimer, toastTimer;

// English names lead everywhere, like in Browse foods. FSVO names often end in "(without addition of fat
// and salt)", which is noise on a button, so short labels drop it.
const shortName = name => name.replace(/\s*\((?:without|wothout)[^)]*\)/gi, "").trim();
const deNote = (de, name) => de && de !== name ? de : "";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round5 = g => Math.max(5, Math.ceil(g / 5) * 5);

function buildAll() {
  const rows = [...(Array.isArray(window.SWISS_FOODS) ? window.SWISS_FOODS : []), ...RAW, ...myFoodRows()];
  ALL = new Map();
  makeFoods(rows).forEach(f => { if (!ALL.has(f.key)) ALL.set(f.key, f); });
  const swiss = Array.isArray(window.SWISS_FOODS);
  TOPUP_POOL = makeFoods([...(swiss ? [...window.SWISS_FOODS, ...RAW.filter(r => r[1] === "Powders")] : RAW), ...myFoodRows()]);
}

// ---------- Storage ----------
function loadMeals() {
  try {
    const m = JSON.parse(localStorage.getItem("pmx-meals") || "null");
    if (m && Array.isArray(m.meals) && m.meals.length) MEALS = m;
  } catch (e) {}
  // Meals saved before the rename stored the calorie target as "budget"
  MEALS.meals.forEach(m => { if ("budget" in m) { m.kcalTarget ??= m.budget; delete m.budget; } });
  if (!MEALS.meals.length) MEALS = { current: null, meals: [exampleMeal()] };
  if (!MEALS.meals.some(m => m.id === MEALS.current)) MEALS.current = MEALS.meals[0].id;
}
const saveMeals = () => { try { localStorage.setItem("pmx-meals", JSON.stringify(MEALS)); } catch (e) {} };
const meal = () => MEALS.meals.find(m => m.id === MEALS.current);

function newMeal(name, type = "lunch") {
  return { id: uid(), name, type, target: TYPE_TARGETS[type], targetSet: false, kcalTarget: null, servings: 1, items: [] };
}

function snapshot(f, grams) {
  return {
    key: f.key, name: f.name, de: f.de || "", group: f.group, src: f.src, gl: f.gl, q: f.q, ref: f.ref, url: f.url || "",
    porkMaybe: !!f.porkMaybe, composite: !!f.composite,
    kcal: f.kcal, p: f.p, fat: f.f, c: f.c, fib: f.fib, salt: f.salt, grams,
  };
}

function exampleMeal() {
  const m = newMeal("Example: quark breakfast bowl", "breakfast");
  m.target = 45; m.targetSet = true;
  const swiss = [["ch:71", 250], ["ch:198", 40], ["ch:276", 15], ["ch:389", 100]];
  const usda = [["us:Greek yogurt, plain, nonfat", 250], ["us:Oats, rolled, dry", 40], ["us:Pumpkin seeds, hulled", 15], ["us:Banana", 100]];
  const pick = ALL.has("ch:71") ? swiss : usda;
  m.items = pick.filter(([k]) => ALL.has(k)).map(([k, g]) => snapshot(ALL.get(k), g));
  return m;
}

// ---------- Maths ----------
function totals(m) {
  const t = { p: 0, kcal: 0, fat: 0, c: 0, fib: 0, salt: 0, saltKnown: true, pq: 0 };
  m.items.forEach(it => {
    const k = (it.grams || 0) / 100;
    t.p += it.p * k; t.kcal += it.kcal * k; t.fat += it.fat * k; t.c += it.c * k; t.fib += (it.fib || 0) * k;
    if (it.salt == null) t.saltKnown = false; else t.salt += it.salt * k;
    t.pq += it.p * k * Math.min(1, it.q);
  });
  const n = Math.max(1, m.servings || 1);
  return { ...t, n, ps: t.p / n, ks: t.kcal / n, quality: t.p > 0 ? t.pq / t.p : 1 };
}

function dietOf(items) {
  if (!items.length) return null;
  const srcs = new Set(items.map(i => i.src));
  const only = allowed => [...srcs].every(s => allowed.includes(s));
  const diet = only(["plant"]) ? "Vegan" : only(["plant", "dairy", "egg"]) ? "Vegetarian"
    : only(["plant", "dairy", "egg", "fish", "shellfish"]) ? "Pescatarian" : "Contains meat";
  const gluten = items.some(i => i.gl === 1) ? "Contains gluten" : items.some(i => i.gl === 2) ? "Gluten: check labels" : "Gluten-free";
  const pork = srcs.has("pork") ? "Contains pork" : items.some(i => i.porkMaybe) ? "May contain pork" : "";
  return { diet, gluten, pork, recipe: items.some(i => i.composite) };
}

// ---------- Rendering ----------
function renderBuilder() {
  const m = meal(); if (!m) return;
  $("tab-count").textContent = m.items.length ? ` · ${m.items.length}` : "";
  $("meal-sel").innerHTML = MEALS.meals.map(x => `<option value="${x.id}"${x.id === m.id ? " selected" : ""}>${esc(x.name || "Untitled meal")}</option>`).join("");
  if (document.activeElement !== $("meal-name")) $("meal-name").value = m.name;
  $("meal-type").value = m.type;
  if (document.activeElement !== $("meal-target")) $("meal-target").value = m.target;
  if (document.activeElement !== $("meal-kcal")) $("meal-kcal").value = m.kcalTarget ?? "";
  if (document.activeElement !== $("meal-serv")) $("meal-serv").value = m.servings;
  $("target-note").textContent = m.targetSet ? `Custom target. ${TYPE_LABELS[m.type]} starts at ${TYPE_TARGETS[m.type]} g.` : `${TYPE_LABELS[m.type]} default.`;
  syncBuilderFilters();
  renderItems();
  renderTotals();
  renderResults();
  renderMyFoods();
}

// The builder's filter controls mirror the Browse ones and write to the same state (S)
function syncBuilderFilters() {
  const press = (sel, on) => document.querySelectorAll(sel).forEach(b => b.setAttribute("aria-pressed", on(b.dataset.v)));
  press("#b-diet button", v => v === S.diet);
  press("#b-flags .chip", v => S.flags.includes(v));
  $("b-dens").value = S.dens;
  $("b-dens-v").textContent = S.dens ? `≥ ${S.dens} g` : "any";
}

function renderItems() {
  const m = meal();
  $("meal-items").innerHTML = m.items.length ? m.items.map((it, i) => {
    const label = shortName(it.name);
    const sub = deNote(it.de, it.name) || it.group;
    const src = it.ref === "CH" ? "FSVO" : it.ref === "OFF" ? "Open Food Facts" : it.ref === "MY" ? "my food" : "USDA";
    return `<div class="ing" data-i="${i}">
      <div style="min-width:0"><div class="fname">${esc(label)}</div>
        <div class="meta"><span${deNote(it.de, it.name) ? ' lang="de"' : ""}>${esc(sub)}</span><span>${fmt(it.p)} g protein / 100 g</span><span class="tag">${src}</span>
        <span class="m-only" data-mobile></span></div></div>
      <label class="amt"><input type="number" min="0" step="5" value="${it.grams}" data-grams="${i}" aria-label="Grams of ${esc(label)}"><span class="label">g</span></label>
      <span class="num c-p" data-p></span>
      <span class="num c-k" data-k></span>
      <div class="bar c-s"><i data-share style="background:var(--fg)"></i></div>
      <button type="button" class="rm" data-rm="${i}" aria-label="Remove ${esc(label)}">×</button>
    </div>`;
  }).join("") : `<div class="empty-meal">Add your first ingredient with the search below, or use the + buttons in Browse foods.</div>`;
}

function renderTotals() {
  const m = meal();
  const t = totals(m);
  // Row numbers update in place so typing in an amount keeps focus
  document.querySelectorAll("#meal-items .ing").forEach(row => {
    const it = m.items[+row.dataset.i]; if (!it) return;
    const p = it.p * it.grams / 100, k = it.kcal * it.grams / 100;
    row.querySelector("[data-p]").textContent = `${fmt(p)} g`;
    row.querySelector("[data-k]").textContent = fmt0(k);
    row.querySelector("[data-share]").style.width = (t.p > 0 ? p / t.p * 100 : 0) + "%";
    row.querySelector("[data-mobile]").textContent = `${fmt(p)} g protein · ${fmt0(k)} kcal`;
  });

  const per = t.n > 1 ? " per serving" : "";
  const above = m.kcalTarget && t.ks > m.kcalTarget;
  const ppc = t.kcal > 0 ? t.p / t.kcal * 100 : 0;
  const d = dietOf(m.items);
  const badge = (txt, cls) => `<span class="badge ${cls}">${esc(txt)}</span>`;
  const whole = t.n > 1 ? `<span class="sub">Whole recipe: ${fmt(t.p)} g, ${fmt0(t.kcal)} kcal</span>` : "";
  $("meal-sum").innerHTML = `
    <div class="sum"><span class="label">Protein${per}</span>
      <span class="big">${fmt(t.ps)}<small>g</small></span>
      ${m.target > 0 ? goalBar(t.ps, m.target, "protein target") : ""}
      <span class="sub">${m.target > 0 ? `${fmt0(t.ps / m.target * 100)}% of ${m.target} g target${t.ps > m.target ? ` · ${fmt(t.ps - m.target)} g above` : ""}` : "No target set"}</span>${whole}</div>
    <div class="sum"><span class="label">Calories${per}</span>
      <span class="big">${fmt0(t.ks)}<small>kcal</small></span>
      ${m.kcalTarget ? `${goalBar(t.ks, m.kcalTarget, "calorie target")}
      <span class="sub">${above ? `${fmt0(t.ks - m.kcalTarget)} kcal above the` : `${fmt0(t.ks / m.kcalTarget * 100)}% of`} ${m.kcalTarget} kcal target</span>` : `<span class="sub">No calorie target set</span>`}</div>
    <div class="sum"><span class="label">Protein per 100 kcal</span>
      <span class="big">${fmt(ppc)}<small>g</small></span>
      <span class="sub">${fmt0(t.kcal > 0 ? Math.min(100, t.p * 4 / t.kcal * 100) : 0)}% of calories from protein</span></div>
    <div class="sum"><span class="label">Fits</span>
      ${d ? `<div class="badges">${badge(d.diet, d.diet === "Contains meat" ? "plain" : "ok")}${badge(d.gluten, d.gluten === "Gluten-free" ? "ok" : "warn")}${d.pork ? badge(d.pork, "warn") : ""}${d.recipe ? badge("Check recipes", "plain") : ""}</div>` : `<span class="sub">Add ingredients to see</span>`}
      <span class="sub">Fat ${fmt(t.fat / t.n)} g · Carbs ${fmt(t.c / t.n)} g · Fibre ${fmt(t.fib / t.n)} g · Salt ${t.saltKnown ? fmt(t.salt / t.n, 2) : "≥ " + fmt(t.salt / t.n, 2)} g${per}</span>
      ${t.p > 0 && t.quality < 0.6 ? `<span class="note warn">Most of this protein comes from low-scoring sources. Adding legumes, soy, dairy or eggs balances it.</span>` : ""}</div>`;
  renderTopups(t);
}

// Filled part up to 100%; anything beyond is a neutral bar laid over it from the left
function goalBar(value, target, what) {
  const pct = value / target * 100;
  const extra = Math.min(100, Math.max(0, pct - 100));
  return `<div class="goal" role="img" aria-label="${fmt0(pct)}% of ${what}"><i style="width:${Math.min(100, pct)}%"></i>${extra ? `<b style="width:${extra}%"></b>` : ""}</div>`;
}

// Top-ups are shown as one row, drawn from these kinds of food in this order: the most calorie-efficient
// options first, then plant proteins, legumes and vegetables so meals stay varied.
// cap = largest amount suggested, in grams per serving.
const DRIED = /dried|getrocknet|\bdry\b/i;
// Eaten in pinches, not portions
const SEASONING = /garlic|parsley|chive|basil|dill|cress|coriander|herb|thyme|rosemary|mint|oregano|lovage|horseradish/i;
const TOPUP_MIX = [
  { n: 2, cap: 300, pick: f => f.p >= 8 && f.q >= 0.5, by: (a, b) => a.kcal - b.kcal },
  { n: 1, cap: 200, pick: f => f.group === "Plant proteins" && f.p >= 8, by: (a, b) => a.kcal - b.kcal },
  { n: 2, cap: 250, pick: f => f.group === "Beans & lentils" && !DRIED.test(f.name), by: (a, b) => a.kcal - b.kcal },
  { n: 1, cap: 200, pick: f => f.group === "Vegetables" && f.p >= 2.5 && !DRIED.test(f.name) && !SEASONING.test(f.name), by: (a, b) => b.f.ppc - a.f.ppc },
];

function renderTopups(t) {
  const m = meal();
  const remaining = m.target - t.ps;
  const box = $("topups");
  if (!m.target) { $("top-sub").textContent = "Set a protein target to see ideas."; box.innerHTML = ""; return; }
  if (remaining <= 0.05) {
    $("top-sub").textContent = "";
    box.innerHTML = m.items.length ? `<p class="note">This meal reaches its ${m.target} g target.</p>` : "";
    return;
  }
  const dietName = { any: "any diet", pesc: "pescatarian", veg: "vegetarian", vegan: "vegan" }[S.diet];
  $("top-sub").textContent = `${fmt(remaining)} g to reach ${m.target} g · ${dietName}, using the filters above`;
  const inMeal = new Set(m.items.map(i => i.key));
  const pool = TOPUP_POOL.filter(f => passes(f, true) && !f.composite && !NO_TOPUP_GROUPS.includes(f.group) && f.q > 0 && !inMeal.has(f.key));
  const seen = new Set();   // one suggestion per food, e.g. not three kinds of cod
  const stem = f => (f.de || f.name).split(/[,(]/)[0].trim().toLowerCase();
  const ideas = [];
  TOPUP_MIX.forEach(g => {
    let taken = 0;
    for (const x of pool.filter(g.pick).map(f => {
      const grams = round5(Math.min(remaining * t.n / f.p * 100, g.cap * t.n));
      return { f, grams, prot: grams * f.p / 100 / t.n, kcal: grams * f.kcal / 100 / t.n };
    }).sort(g.by)) {
      if (taken === g.n) break;
      if (seen.has(stem(x.f))) continue;
      seen.add(stem(x.f)); ideas.push(x); taken++;
    }
  });
  box.innerHTML = ideas.length ? ideas.map(({ f, grams, prot, kcal }) => {
    const label = shortName(f.name);
    const part = prot < remaining - 0.05 ? ` · covers ${fmt0(prot / remaining * 100)}%` : "";
    const aboveKcal = m.kcalTarget && t.ks + kcal > m.kcalTarget;
    return `<button type="button" class="btn topup" data-top="${esc(f.key)}" data-g="${grams}">
      <b>${esc(label)} +${grams} g</b>
      <span>+${fmt(prot)} g protein · +${fmt0(kcal)} kcal${t.n > 1 ? " per serving" : ""}${part}${aboveKcal ? " · goes above calorie target" : ""}</span></button>`;
  }).join("") : `<p class="note">No foods fit your current diet and filters. Loosen the filters above to see ideas.</p>`;
}

// ---------- Actions ----------
function addToMeal(key, grams, fromBrowse) {
  const f = ALL.get(key) || FOODS.find(x => x.key === key);
  if (!f) return;
  const m = meal();
  const g = grams ?? (f.sv || 100);
  const existing = m.items.find(i => i.key === key);
  if (existing) existing.grams = Math.round((existing.grams || 0) + g); else m.items.push(snapshot(f, g));
  saveMeals();
  renderBuilder();
  if (fromBrowse) toast(`Added ${g} g ${shortName(f.name)} to “${m.name}”`, true);
}

function toast(msg, withOpen) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(msg)}</span>${withOpen ? `<button type="button" id="toast-open">Open meal</button>` : ""}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function showTab(name) {
  const builder = name === "builder";
  $("panel-browse").hidden = builder;
  $("panel-builder").hidden = !builder;
  $("tab-browse").setAttribute("aria-selected", !builder);
  $("tab-builder").setAttribute("aria-selected", builder);
  try { history.replaceState(null, "", builder ? "#builder" : "#browse"); } catch (e) {}
  if (builder) renderBuilder();
}

function mealText(m) {
  const t = totals(m);
  const lines = [`${m.name} (${TYPE_LABELS[m.type].toLowerCase()}, ${t.n} serving${t.n > 1 ? "s" : ""})`];
  m.items.forEach(i => lines.push(`- ${i.grams} g ${shortName(i.name)}${deNote(i.de, i.name) ? ` (${i.de})` : ""}`));
  const per = t.n > 1 ? "Per serving" : "Total";
  lines.push("", `${per}: ${fmt(t.ps)} g protein, ${fmt0(t.ks)} kcal, ${fmt(t.kcal > 0 ? t.p / t.kcal * 100 : 0)} g protein per 100 kcal`);
  lines.push(`Fat ${fmt(t.fat / t.n)} g · Carbs ${fmt(t.c / t.n)} g · Fibre ${fmt(t.fib / t.n)} g · Salt ${fmt(t.salt / t.n, 2)} g`);
  lines.push("", "Made with ProteinMaxx. Data: Swiss Food Composition Database (FSVO), USDA FoodData Central, Open Food Facts.");
  return lines.join("\n");
}

// ---------- Add-food search ----------
function searchFoods(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const f of ALL.values()) if (words.every(w => f.hay.includes(w))) hits.push(f);
  const first = words[0];
  const score = f => {
    const n = f.name.toLowerCase(), d = (f.de || "").toLowerCase();
    return (n.startsWith(first) || d.startsWith(first) ? 0 : 1) * 1000 + Math.min(n.length, d.length || 999);
  };
  return hits.sort((a, b) => score(a) - score(b)).slice(0, 8);
}

function renderResults() {
  const q = $("add-q").value.trim();
  const res = $("add-res");
  if (!q) { res.hidden = true; res.innerHTML = ""; return; }
  const hits = searchFoods(q);
  res.hidden = false;
  res.innerHTML = hits.length ? hits.map(f => {
    const label = esc(f.name) + (deNote(f.de, f.name) ? ` <span lang="de" style="color:var(--muted);font-weight:400">· ${esc(f.de)}</span>` : "");
    const src = f.ref === "CH" ? "FSVO" : f.ref === "OFF" ? "Open Food Facts" : f.ref === "MY" ? "my food" : "USDA";
    return `<button type="button" class="res" data-key="${esc(f.key)}"><span class="fname">${label}</span>
      <span class="meta"><span>${fmt(f.p)} g protein · ${fmt0(f.kcal)} kcal per 100 g</span><span>${fmt(f.ppc)} g / 100 kcal</span><span class="tag">${src}</span>${passes(f, true) ? "" : `<span class="tag warn">outside your filters</span>`}<span>adds ${f.sv} g</span></span></button>`;
  }).join("") : `<div class="empty-meal">No food matches “${esc(q)}”. Try the German or English name, or add it under My foods.</div>`;
}

// ---------- My foods ----------
const MY_FIELDS = ["my-name", "my-brand", "my-sv", "my-kcal", "my-p", "my-f", "my-c", "my-fib", "my-salt"];
let offLink = { ref: "MY", url: "" };

function renderMyFoods() {
  const rows = myFoodRows();
  $("my-list").innerHTML = rows.length ? rows.map(r => {
    const [name, , , kcal, p] = r;
    const fromOff = r[12] === "OFF";
    return `<div class="myrow"><div><div class="fname">${esc(name)}${r[13] ? ` <span style="color:var(--muted);font-weight:400">· ${esc(r[13])}</span>` : ""}</div>
      <div class="meta"><span>${fmt(p)} g protein · ${fmt0(kcal)} kcal per 100 g</span>${fromOff ? `<span class="tag"><a href="${esc(r[17])}" target="_blank" rel="noopener">Open Food Facts</a></span>` : `<span class="tag">typed in</span>`}</div></div>
      <div class="row" style="gap:8px"><button type="button" class="btn" data-my-add="my:${r[16]}">Add to meal</button><button type="button" class="btn danger" data-my-del="${r[16]}">Delete</button></div></div>`;
  }).join("") : `<p class="note">No foods of your own yet.</p>`;
}

function myFoodsChanged() {
  buildAll();
  loadDataset();
  render();
}

function guessSource(p) {
  const tags = [...(p.labels_tags || []), ...(p.ingredients_analysis_tags || [])];
  const al = p.allergens_tags || [];
  const cats = p.categories_tags || [];
  if (tags.includes("en:vegan")) return "plant";
  if (cats.some(c => /meats|sausages|hams/.test(c))) return cats.some(c => /pork/.test(c)) ? "pork" : "meat";
  if (cats.some(c => /poultr|chicken/.test(c))) return "poultry";
  if (al.includes("en:fish")) return "fish";
  if (al.includes("en:crustaceans") || al.includes("en:molluscs")) return "shellfish";
  if (al.includes("en:milk")) return "dairy";
  if (al.includes("en:eggs")) return "egg";
  return "";
}

async function lookupOff() {
  const raw = $("off-q").value.trim();
  const code = (raw.match(/\d{8,14}/) || [])[0];
  const status = $("off-status");
  if (!code) { status.className = "err"; status.textContent = "Enter a barcode (8 to 14 digits) or an Open Food Facts product link."; return; }
  status.className = "note"; status.textContent = `Looking up ${code}…`;
  let data;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_de,product_name_en,brands,nutriments,serving_quantity,allergens_tags,labels_tags,ingredients_analysis_tags,categories_tags`);
    data = await r.json();
  } catch (e) {
    status.className = "err";
    status.textContent = "Couldn't reach Open Food Facts. Lookups work on the GitHub Pages version of ProteinMaxx; here you can type the values in.";
    return;
  }
  const p = data && data.product;
  const n = p && p.nutriments;
  if (!p || !n) { status.className = "err"; status.textContent = `No product found for ${code}. Check the number, or type the values in.`; return; }
  const kcal = n["energy-kcal_100g"] ?? (n["energy_100g"] != null ? n["energy_100g"] / 4.184 : null);
  const set = (id, v, d = 1) => { $(id).value = v == null || v === "" ? "" : Math.round(v * 10 ** d) / 10 ** d; };
  $("my-name").value = p.product_name_de || p.product_name || p.product_name_en || "";
  $("my-brand").value = (p.brands || "").split(",")[0].trim();
  $("my-basis").value = "100";
  set("my-sv", p.serving_quantity, 0);
  set("my-kcal", kcal, 0); set("my-p", n.proteins_100g); set("my-f", n.fat_100g); set("my-c", n.carbohydrates_100g);
  set("my-fib", n.fiber_100g); set("my-salt", n.salt_100g, 2);
  $("my-src").value = guessSource(p);
  const al = p.allergens_tags || [], labels = p.labels_tags || [];
  $("my-gl").value = al.includes("en:gluten") ? "1" : labels.some(l => /no-gluten|gluten-free/.test(l)) ? "0" : "2";
  offLink = { ref: "OFF", url: `https://world.openfoodfacts.org/product/${p.code || code}` };
  status.className = "note";
  status.innerHTML = `Found it. Values per 100 g from <a href="${esc(offLink.url)}" target="_blank" rel="noopener">Open Food Facts</a>. Check them against the label, choose the protein source, then save.`;
}

function saveMyFood(e) {
  e.preventDefault();
  const num = id => { const v = $(id).value.trim(); return v === "" ? null : +v; };
  const err = $("my-err");
  const name = $("my-name").value.trim();
  const kcal = num("my-kcal"), p = num("my-p"), sv = num("my-sv");
  const perServing = $("my-basis").value === "serv";
  if (!name) { err.textContent = "Enter a name for the food."; $("my-name").focus(); return; }
  if (kcal == null || kcal <= 0) { err.textContent = "Enter the energy in kcal."; $("my-kcal").focus(); return; }
  if (p == null || p < 0) { err.textContent = "Enter the protein in grams."; $("my-p").focus(); return; }
  if (perServing && !(sv > 0)) { err.textContent = "Enter the serving size in grams, or switch to per 100 g."; $("my-sv").focus(); return; }
  if (!$("my-src").value) { err.textContent = "Choose the main protein source so the diet filters work."; $("my-src").focus(); return; }
  const k = perServing ? 100 / sv : 1;
  const r1 = v => v == null ? null : Math.round(v * k * 10) / 10;
  const src = $("my-src").value;
  const q = src !== "plant" ? 1 : /soy|soja|tofu|pea|erbse|mycoprotein/i.test(name) ? 0.85 : 0.6;
  const id = uid();
  const row = [name, "My foods", src, Math.round(kcal * k), r1(p), r1(num("my-f")) || 0, r1(num("my-c")) || 0, r1(num("my-fib")),
    sv > 0 ? sv : 100, sv > 0 ? "1 serving" : "100 g", +$("my-gl").value, q, offLink.ref, $("my-brand").value.trim(), "",
    num("my-salt") == null ? null : Math.round(num("my-salt") * k * 100) / 100, id, offLink.url];
  const rows = myFoodRows();
  rows.push(row);
  try { localStorage.setItem("pmx-myfoods", JSON.stringify(rows)); } catch (e2) { err.textContent = "Couldn't save: this browser blocks local storage."; return; }
  err.textContent = "";
  clearMyForm();
  myFoodsChanged();
  toast(`Saved ${name} to My foods`, false);
}

function clearMyForm() {
  MY_FIELDS.forEach(id => { $(id).value = ""; });
  $("my-basis").value = "100"; $("my-src").value = ""; $("my-gl").value = "2";
  $("my-err").textContent = "";
  offLink = { ref: "MY", url: "" };
}

// ---------- Events ----------
// Builder filter buttons are copies of the Browse ones, so labels and tooltips stay identical
$("b-diet").innerHTML = $("diet").innerHTML;
$("b-flags").innerHTML = $("flags").innerHTML;
$("b-diet").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.diet = b.dataset.v; render(); } });
$("b-flags").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const v = b.dataset.v; S.flags = S.flags.includes(v) ? S.flags.filter(x => x !== v) : [...S.flags, v]; render();
});
$("b-dens").addEventListener("input", e => { S.dens = +e.target.value; render(); });
// Resets only the filters shown here; the Browse database, sorting and target stay as they are
$("b-reset").addEventListener("click", () => { S = { ...S, diet: DEFAULTS.diet, flags: [], dens: DEFAULTS.dens }; render(); });

$("tab-browse").addEventListener("click", () => showTab("browse"));
$("tab-builder").addEventListener("click", () => showTab("builder"));
$("toast").addEventListener("click", e => { if (e.target.id === "toast-open") { $("toast").hidden = true; showTab("builder"); window.scrollTo(0, 0); } });

$("meal-sel").addEventListener("change", e => { MEALS.current = e.target.value; saveMeals(); $("del-confirm").hidden = true; renderBuilder(); });
$("meal-name").addEventListener("input", e => { meal().name = e.target.value; saveMeals(); renderBuilder(); });
$("meal-new").addEventListener("click", () => {
  const m = newMeal(`Meal ${MEALS.meals.length + 1}`);
  MEALS.meals.push(m); MEALS.current = m.id; saveMeals(); renderBuilder(); $("meal-name").focus(); $("meal-name").select();
});
$("meal-dup").addEventListener("click", () => {
  const m = JSON.parse(JSON.stringify(meal()));
  m.id = uid(); m.name = `${m.name} (copy)`;
  MEALS.meals.push(m); MEALS.current = m.id; saveMeals(); renderBuilder();
});
$("meal-del").addEventListener("click", () => {
  const c = $("del-confirm");
  c.innerHTML = `<span>Delete “${esc(meal().name)}”? This can't be undone.</span><button type="button" class="btn danger" id="del-yes">Delete meal</button><button type="button" class="btn" id="del-no">Keep it</button>`;
  c.hidden = false;
});
$("del-confirm").addEventListener("click", e => {
  if (e.target.id === "del-no") $("del-confirm").hidden = true;
  if (e.target.id === "del-yes") {
    MEALS.meals = MEALS.meals.filter(m => m.id !== MEALS.current);
    if (!MEALS.meals.length) MEALS.meals.push(newMeal("Meal 1"));
    MEALS.current = MEALS.meals[0].id;
    $("del-confirm").hidden = true; saveMeals(); renderBuilder();
  }
});
$("meal-copy").addEventListener("click", () => {
  const text = mealText(meal());
  const btn = $("meal-copy"), fb = $("copy-fallback");
  const done = () => { btn.textContent = "Copied"; clearTimeout(copyTimer); copyTimer = setTimeout(() => { btn.textContent = "Copy as text"; }, 2000); };
  const fallback = () => { fb.hidden = false; fb.value = text; fb.focus(); fb.select(); btn.textContent = "Select and copy below"; };
  try { navigator.clipboard.writeText(text).then(() => { fb.hidden = true; done(); }, fallback); } catch (e) { fallback(); }
});
$("meal-type").addEventListener("change", e => {
  const m = meal(); m.type = e.target.value;
  if (!m.targetSet) m.target = TYPE_TARGETS[m.type];
  saveMeals(); renderBuilder();
});
$("meal-target").addEventListener("input", e => {
  const v = e.target.value === "" ? 0 : Math.max(0, Math.min(300, +e.target.value));
  const m = meal(); m.target = v; m.targetSet = v !== TYPE_TARGETS[m.type];
  saveMeals(); renderBuilder();
});
$("meal-kcal").addEventListener("input", e => {
  const v = +e.target.value; meal().kcalTarget = e.target.value === "" || v <= 0 ? null : v; saveMeals(); renderTotals();
});
$("meal-serv").addEventListener("input", e => {
  const v = Math.round(+e.target.value); if (!(v >= 1)) return;
  meal().servings = Math.min(50, v); saveMeals(); renderTotals();
});

$("meal-items").addEventListener("input", e => {
  const i = e.target.dataset.grams; if (i == null) return;
  meal().items[+i].grams = Math.max(0, +e.target.value || 0); saveMeals(); renderTotals();
});
$("meal-items").addEventListener("click", e => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  meal().items.splice(+b.dataset.rm, 1); saveMeals(); renderBuilder();
});
$("topups").addEventListener("click", e => {
  const b = e.target.closest("[data-top]"); if (b) addToMeal(b.dataset.top, +b.dataset.g, false);
});

$("add-q").addEventListener("input", renderResults);
$("add-q").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); const first = $("add-res").querySelector("[data-key]"); if (first) first.click(); }
  if (e.key === "Escape") { $("add-q").value = ""; renderResults(); }
});
$("add-res").addEventListener("click", e => {
  const b = e.target.closest("[data-key]"); if (!b) return;
  addToMeal(b.dataset.key, null, false);
  $("add-q").value = ""; renderResults(); $("add-q").focus();
});

$("off-go").addEventListener("click", lookupOff);
$("off-q").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); lookupOff(); } });
$("my-form").addEventListener("submit", saveMyFood);
$("my-clear").addEventListener("click", clearMyForm);
$("my-form").addEventListener("input", () => { $("my-err").textContent = ""; });
$("my-list").addEventListener("click", e => {
  const add = e.target.closest("[data-my-add]");
  if (add) { addToMeal(add.dataset.myAdd, null, false); window.scrollTo(0, 0); return; }
  const del = e.target.closest("[data-my-del]");
  if (del) {
    const rows = myFoodRows().filter(r => r[16] !== del.dataset.myDel);
    try { localStorage.setItem("pmx-myfoods", JSON.stringify(rows)); } catch (e2) {}
    myFoodsChanged();
  }
});

// ---------- Start ----------
buildAll();
loadMeals();
saveMeals();
showTab(location.hash === "#builder" ? "builder" : "browse");
renderBuilder();
