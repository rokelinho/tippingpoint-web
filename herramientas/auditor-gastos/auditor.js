/* Auditor de gastos — motor en el navegador. Nada sale de tu ordenador.
   Port de https://github.com/rokelinho/auditor-gastos (versión Python). */
(function (global) {
  "use strict";

  // ---------------------------------------------------------------- CSV
  function parseCSV(text, sep) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (q) {
        if (c === '"' && n === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && n === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim()));
  }

  function sniffSep(text) {
    const head = text.slice(0, 5000);
    const counts = { ";": 0, ",": 0, "\t": 0, "|": 0 };
    for (const ch of head) if (ch in counts) counts[ch]++;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  function readTable(text) {
    // saltar preámbulo hasta la fila de cabecera
    const lines = text.split(/\r?\n/);
    let start = 0;
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const low = lines[i].toLowerCase();
      if (/(fecha|datum|date)/.test(low) && /(importe|bedrag|amount|concepto|omschrijving|description)/.test(low)) { start = i; break; }
    }
    const body = lines.slice(start).join("\n");
    const sep = sniffSep(body);
    const rows = parseCSV(body, sep);
    if (rows.length < 2) throw new Error("El fichero parece vacío.");
    const header = rows[0].map(h => h.trim());
    const data = rows.slice(1).map(r => { const o = {}; header.forEach((h, i) => o[h] = (r[i] ?? "").trim()); return o; });
    return { header, data };
  }

  // ---------------------------------------------------------------- helpers
  function num(v) {
    if (v == null) return NaN;
    let s = String(v).trim().replace(/€|EUR/g, "").replace(/−/g, "-").trim();
    if (!s) return NaN;
    if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
    s = s.replace(",", ".").replace(/[^\d.\-+]/g, "");
    const f = parseFloat(s); return isNaN(f) ? NaN : f;
  }
  function dateParse(v, fmt) {
    if (!v) return null;
    const s = String(v).trim();
    let y, m, d, mt;
    if (fmt === "YYYYMMDD" && (mt = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [mt[1], mt[2], mt[3]];
    else if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [mt[1], mt[2], mt[3]];
    else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/))) [d, m, y] = [mt[1], mt[2], mt[3]];
    else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/))) [d, m, y] = [mt[1], mt[2], "20" + mt[3]];
    else if ((mt = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [mt[1], mt[2], mt[3]];
    else { const t = Date.parse(s); return isNaN(t) ? null : new Date(t); }
    const dt = new Date(Date.UTC(+y, +m - 1, +d));
    return isNaN(dt) ? null : dt;
  }
  const iso = d => d.toISOString().slice(0, 10);
  const ym = d => d.toISOString().slice(0, 7);
  const dayDiff = (a, b) => Math.round((b - a) / 86400000);
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

  const NOISE = new RegExp([
    "\\bpasnr\\.?\\s*\\d+\\b", "\\btransactie:?\\s*\\w+\\b", "\\bterm:?\\s*\\w+\\b",
    "\\b\\d{2}[-/]\\d{2}[-/]\\d{2,4}\\b", "\\b\\d{1,2}:\\d{2}(:\\d{2})?\\b",
    "\\bvalutadatum:?\\s*\\S+", "\\bapple pay\\b", "\\bgoogle pay\\b", "\\bcontactless\\b",
    "\\bbetaalpas\\b", "\\bpas\\s*\\d+\\b", "\\bnr:\\S+", "\\bkenmerk:?\\s*\\S+", "\\biban:?\\s*\\S+",
    "\\bbic:?\\s*\\S+", "\\bomschrijving:?", "\\bnaam:?", "\\bcompra\\b", "\\btarjeta\\b",
    "\\bpago en\\b", "\\brecibo\\b", "\\badeudo\\b", "\\bcard\\s*\\d+\\b", "\\*{2,}\\d+",
    "\\b[A-Z]{2}\\d{2}[A-Z0-9]{10,30}\\b", "\\bref[:.]?\\s*\\S+", "\\bid[:.]?\\s*\\d+\\b", "#\\d+"
  ].join("|"), "gi");
  const STOP = new Set(["SEPA", "INCASSO", "OVERBOEKING", "IDEAL", "BETALING", "TRANSFERENCIA", "COMPRA", "PAGO", "RECIBO",
    "DOMICILIACION", "ADEUDO", "CARD", "PAYMENT", "DIRECT", "DEBIT", "AB", "BV", "SL", "SA", "LTD", "INC", "LLC",
    "AMSTERDAM", "EINDHOVEN", "MADRID", "BARCELONA", "VIGO", "NLD", "ESP", "NL", "ES", "THE", "DE", "LA", "EL", "VAN", "DEN", "DER", "VIA", "POS"]);

  function cleanMerchant(text) {
    if (!text) return "";
    let t = String(text).toUpperCase().replace(/https?:\/\/\S+/g, " ");
    t = t.replace(NOISE, " ");
    t = t.replace(/\.(COM|NL|ES|EU|NET|ORG|IO|CO)\b/g, " ");
    t = t.replace(/[^A-Z0-9&' ]+/g, " ").replace(/\b\d{3,}\b/g, " ").replace(/\s+/g, " ").trim();
    const words = t.split(" ").filter(w => (w.length > 1 || w === "&") && !STOP.has(w));
    return words.length ? words.slice(0, 3).join(" ") : t.slice(0, 30);
  }

  // ---------------------------------------------------------------- importadores
  const lc = o => { const m = {}; Object.keys(o).forEach(k => m[k.toLowerCase().trim()] = k); return m; };
  function mk(date, amount, merchant, description, account, bank) {
    return { date, amount, merchant: merchant ?? cleanMerchant(description), description: description || "", account: account || "", bank };
  }
  const BANKS = [
    { name: "ING NL", req: ["datum", "naam / omschrijving", "af bij", "bedrag (eur)"], fn: (rows, c) => rows.map(r => {
      const sign = /^af$/i.test(r[c["af bij"]].trim()) ? -1 : 1; const n = r[c["naam / omschrijving"]];
      return mk(dateParse(r[c["datum"]], "YYYYMMDD"), num(r[c["bedrag (eur)"]]) * sign, cleanMerchant(n), n + " | " + (r[c["mededelingen"]] || ""), r[c["rekening"]], "ING NL"); }) },
    { name: "Rabobank", req: ["iban/bban", "datum", "bedrag", "naam tegenpartij"], fn: (rows, c) => rows.map(r => {
      const n = r[c["naam tegenpartij"]]; const oms = Object.keys(c).filter(k => k.startsWith("omschrijving")).map(k => r[c[k]]).join(" ");
      return mk(dateParse(r[c["datum"]]), num(r[c["bedrag"]]), cleanMerchant(n), n + " | " + oms, r[c["iban/bban"]], "Rabobank"); }) },
    { name: "ABN AMRO", req: ["accountnumber", "transactiondate", "amount", "description"], fn: (rows, c) => rows.map(r =>
      mk(dateParse(r[c["transactiondate"]], "YYYYMMDD"), num(r[c["amount"]]), undefined, r[c["description"]], r[c["accountnumber"]], "ABN AMRO")) },
    { name: "bunq", req: ["date", "amount", "account", "counterparty", "name"], fn: (rows, c) => rows.map(r => {
      const n = r[c["name"]]; return mk(dateParse(r[c["date"]]), num(r[c["amount"]]), cleanMerchant(n), n + " | " + (r[c["description"]] || ""), r[c["account"]], "bunq"); }) },
    { name: "Revolut", req: ["type", "started date", "completed date", "description", "amount"], fn: (rows, c) => rows
      .filter(r => !c["state"] || r[c["state"]].toUpperCase() === "COMPLETED").map(r => {
        const d = r[c["description"]]; const fee = c["fee"] ? (num(r[c["fee"]]) || 0) : 0;
        return mk(dateParse(r[c["completed date"]] || r[c["started date"]]), num(r[c["amount"]]) - fee, cleanMerchant(d), r[c["type"]] + " | " + d, r[c["product"]], "Revolut"); }) },
    { name: "N26", req: ["date", "payee", "amount (eur)"], fn: (rows, c) => rows.map(r => {
      const p = r[c["payee"]]; return mk(dateParse(r[c["date"]]), num(r[c["amount (eur)"]]), cleanMerchant(p), p + " | " + (r[c["payment reference"]] || ""), "", "N26"); }) },
    { name: "BBVA", req: ["fecha", "concepto", "importe", "f.valor"], fn: (rows, c) => rows.map(r => {
      const k = r[c["concepto"]]; return mk(dateParse(r[c["fecha"]]), num(r[c["importe"]]), cleanMerchant(k), k + " | " + (r[c["movimiento"]] || ""), "", "BBVA"); }) },
    { name: "Santander", req: ["fecha operación", "concepto", "importe"], fn: (rows, c) => rows.map(r => {
      const k = r[c["concepto"]]; return mk(dateParse(r[c["fecha operación"]]), num(r[c["importe"]]), cleanMerchant(k), k, "", "Santander"); }) },
    { name: "Santander", req: ["fecha operacion", "concepto", "importe"], fn: (rows, c) => rows.map(r => {
      const k = r[c["concepto"]]; return mk(dateParse(r[c["fecha operacion"]]), num(r[c["importe"]]), cleanMerchant(k), k, "", "Santander"); }) },
    { name: "CaixaBank", req: ["concepto", "fecha", "importe", "saldo"], fn: (rows, c) => rows.map(r => {
      const k = r[c["concepto"]]; return mk(dateParse(r[c["fecha"]]), num(r[c["importe"]]), cleanMerchant(k), k + " | " + (r[c["concepto ampliado"]] || ""), "", "CaixaBank"); }) },
  ];

  function parseGeneric(rows, c) {
    const find = (...cands) => { for (const cand of cands) for (const k of Object.keys(c)) if (k.includes(cand)) return c[k]; return null; };
    const dcol = find("date", "fecha", "datum"), acol = find("amount", "importe", "bedrag", "monto", "cantidad");
    const tcol = find("description", "descripcion", "descripción", "concepto", "omschrijving", "naam", "name", "payee", "merchant", "detail");
    if (!(dcol && acol && tcol)) throw new Error("No reconozco el formato. Columnas encontradas: " + Object.values(c).join(", ") + ". Renombra las columnas a date, amount, description o escríbenos con un ejemplo.");
    const deb = find("debit", "debe", "cargo"), cred = find("credit", "haber", "abono");
    return rows.map(r => {
      const d = r[tcol]; let a;
      if (deb && cred && deb !== acol) a = (num(r[cred]) || 0) - (num(r[deb]) || 0); else a = num(r[acol]);
      return mk(dateParse(r[dcol]), a, cleanMerchant(d), d, "", "Genérico");
    });
  }

  function importTable({ header, data }) {
    const c = lc(Object.fromEntries(header.map(h => [h, h])));
    const cols = new Set(Object.keys(c));
    for (const b of BANKS) if (b.req.every(k => cols.has(k))) return { bank: b.name, rows: b.fn(data, c) };
    return { bank: "Genérico", rows: parseGeneric(data, c) };
  }

  function normalize(all) {
    const seen = new Set();
    return all.filter(r => r.date && !isNaN(r.amount)).filter(r => {
      const k = iso(r.date) + "|" + r.amount + "|" + r.description + "|" + r.account;
      if (seen.has(k)) return false; seen.add(k); return true;
    }).sort((a, b) => a.date - b.date);
  }

  // ---------------------------------------------------------------- categorías
  let RULES = [];
  function setRules(list) {
    RULES = list.map(r => ({
      ...r,
      rx: r.keywords.length ? new RegExp(r.keywords.map(k => { const e = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return k.length <= 4 ? `\\b${e}\\b` : e; }).join("|"), "i") : null
    }));
  }
  const FIXED = () => new Set(RULES.filter(r => r.fixed).map(r => r.name));
  function categorize(rows, overrides) {
    const fixed = FIXED();
    for (const r of rows) {
      const text = (r.merchant + " " + r.description).toLowerCase();
      let cat = null;
      for (const rule of RULES) { if (!rule.rx) continue; if (rule.onlyPositive && r.amount <= 0) continue; if (rule.rx.test(text)) { cat = rule.name; break; } }
      if (!cat && r.amount > 0) cat = "Ingresos";
      if (overrides && overrides[r.merchant]) cat = overrides[r.merchant];
      r.category = cat || "Otros"; r.fixed = fixed.has(r.category);
    }
    return rows;
  }

  // ---------------------------------------------------------------- suscripciones
  const PERIODS = { semanal: [7, 2], quincenal: [14, 3], mensual: [30.4, 6], bimestral: [61, 8], trimestral: [91, 10], semestral: [182, 15], anual: [365, 25] };
  const PER_YEAR = { semanal: 52, quincenal: 26, mensual: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 };
  const REVIEW = new Set(["Suscripciones digitales", "Deporte y salud", "Ocio y cultura", "Otros"]);
  const VARIABLE = new Set(["Supermercado", "Restaurantes y bares", "Transporte", "Compras", "Efectivo y transferencias", "Viajes"]);

  function periodFor(gaps) {
    if (!gaps.length) return null; const med = median(gaps);
    for (const [name, [days, tol]] of Object.entries(PERIODS))
      if (Math.abs(med - days) <= tol && mean(gaps.map(g => Math.abs(g - days) <= tol * 1.5 ? 1 : 0)) >= 0.6) return name;
    return null;
  }

  // Subida de precio: el tramo final (cobros iguales al último, máx. 6) frente al tramo
  // anterior, que tiene que ser estable (así no saltan las facturas variables de luz/gas).
  function priceChange(amounts) {
    const current = amounts[amounts.length - 1];
    let k = amounts.length - 1;
    while (k > 0 && Math.abs(amounts[k - 1] - current) < 0.01 && amounts.length - k < 6) k--;
    const old = amounts.slice(0, k);
    if (old.length < 2) return { current, prev: old.length ? old[0] : current, inc: false };
    const prev = median(old), stable = std(old) / (prev || 1) < 0.03;
    return { current, prev, inc: stable && current > prev * 1.02 && current - prev >= 0.5 };
  }

  function detectSubscriptions(rows, today) {
    const groups = {};
    for (const r of rows) if (r.amount < 0 && r.merchant) (groups[r.merchant] ||= []).push(r);
    const out = [];
    for (const [merchant, g0] of Object.entries(groups)) {
      // colapsar mismo día
      const byDay = {}; for (const r of g0) { const k = iso(r.date); (byDay[k] ||= { date: r.date, abs: 0, category: r.category, fixed: r.fixed }).abs += -r.amount; }
      const g = Object.values(byDay).sort((a, b) => a.date - b.date);
      if (g.length < 2 || VARIABLE.has(g[0].category)) continue;
      const gaps = g.slice(1).map((x, i) => dayDiff(g[i].date, x.date));
      const period = periodFor(gaps); if (!period) continue;
      const amounts = g.map(x => x.abs), med = median(amounts); if (med <= 0) continue;
      const cv = std(amounts) / med; if (cv > 0.35 && period !== "anual") continue;
      const [days, tol] = PERIODS[period], last = g[g.length - 1].date, first = g[0].date;
      const sinceLast = dayDiff(last, today);
      let status = "activa";
      if (sinceLast > days * 1.5 + tol) status = "probablemente cancelada";
      else if (g.length < 3 && ["mensual", "semanal", "quincenal"].includes(period)) status = "reciente";
      const { current, prev, inc } = priceChange(amounts);
      const months = dayDiff(first, last) / 30.4;
      const review = status === "activa" && months >= 6 && cv < 0.05 && REVIEW.has(g[0].category);
      const dayCounts = {}; g.forEach(x => dayCounts[x.date.getUTCDate()] = (dayCounts[x.date.getUTCDate()] || 0) + 1);
      const typicalDay = +Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0];
      out.push({ merchant, category: g[0].category, fixed: !!g[0].fixed, period, nCharges: g.length, firstDate: iso(first), lastDate: iso(last),
        typicalDay, currentAmount: +current.toFixed(2), previousAmount: +prev.toFixed(2), annualCost: +(current * PER_YEAR[period]).toFixed(2),
        priceIncrease: inc, increasePct: prev ? +((current / prev - 1) * 100).toFixed(1) : 0, status, review,
        nextExpected: iso(new Date(last.getTime() + Math.round(days) * 86400000)), amounts, dates: g.map(x => iso(x.date)) });
    }
    return out.sort((a, b) => (a.status !== "activa") - (b.status !== "activa") || b.annualCost - a.annualCost);
  }

  function findDuplicates(rows, window = 2) {
    const groups = {}; for (const r of rows) if (r.amount < 0 && r.merchant && r.category !== "Efectivo y transferencias") (groups[r.merchant + "|" + r.amount] ||= []).push(r);
    const out = [];
    for (const g of Object.values(groups)) { g.sort((a, b) => a.date - b.date);
      for (let i = 1; i < g.length; i++) { const gap = dayDiff(g[i - 1].date, g[i].date); if (gap > 0 && gap <= window) out.push({ merchant: g[i].merchant, amount: g[i].amount, date1: g[i - 1].date, date2: g[i].date, gap }); } }
    return out;
  }

  function newMerchants(rows, today, days = 30) {
    const first = {}; for (const r of rows) if (r.amount < 0) if (!first[r.merchant] || r.date < first[r.merchant]) first[r.merchant] = r.date;
    const cutoff = new Date(today.getTime() - days * 86400000);
    const out = {};
    for (const r of rows) if (r.amount < 0 && first[r.merchant] >= cutoff) { const o = out[r.merchant] ||= { merchant: r.merchant, firstDate: iso(first[r.merchant]), n: 0, total: 0, category: r.category }; o.n++; o.total += -r.amount; }
    return Object.values(out).sort((a, b) => b.total - a.total);
  }

  function summarize(rows, subs, today) {
    const spend = rows.filter(r => r.amount < 0), income = rows.filter(r => r.amount > 0);
    const byMonth = {}, incMonth = {}, byCatMonth = {}, byCat = {}, byMerchant = {};
    for (const r of spend) { const m = ym(r.date), a = -r.amount; byMonth[m] = (byMonth[m] || 0) + a; (byCatMonth[m] ||= {})[r.category] = (byCatMonth[m]?.[r.category] || 0) + a; byCat[r.category] = (byCat[r.category] || 0) + a; byMerchant[r.merchant] = (byMerchant[r.merchant] || 0) + a; }
    for (const r of income) { const m = ym(r.date); incMonth[m] = (incMonth[m] || 0) + r.amount; }
    const months = [...new Set([...Object.keys(byMonth), ...Object.keys(incMonth)])].sort();
    const active = subs.filter(s => s.status !== "probablemente cancelada");
    const real = active.filter(s => !s.fixed), fixedS = active.filter(s => s.fixed);
    const monthlySubs = real.reduce((a, s) => a + s.annualCost, 0) / 12, monthlyFixed = fixedS.reduce((a, s) => a + s.annualCost, 0) / 12;
    const leaks = real.filter(s => s.review || s.priceIncrease);
    const minD = rows[0].date, maxD = rows[rows.length - 1].date;
    let full = months.filter(m => m !== ym(maxD) || maxD.getUTCDate() >= 25).filter(m => m !== ym(minD) || minD.getUTCDate() <= 5);
    if (!full.length) full = months;
    let cmonths = months.filter(m => byCatMonth[m]); if (maxD.getUTCDate() < 25 && cmonths.length >= 2) cmonths = cmonths.slice(0, -1);
    const movers = [];
    if (cmonths.length >= 2) {
      const lastM = cmonths[cmonths.length - 1], baseMs = cmonths.length >= 4 ? cmonths.slice(-4, -1) : cmonths.slice(0, -1);
      const cats = new Set(cmonths.flatMap(m => Object.keys(byCatMonth[m])));
      for (const c of cats) { const base = mean(baseMs.map(m => byCatMonth[m][c] || 0)); if (base > 20) { const last = byCatMonth[lastM][c] || 0; movers.push([c, last, base, (last / base - 1) * 100]); } }
      movers.sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]));
    }
    const sortObj = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
    return { periodStart: iso(minD), periodEnd: iso(maxD), n: rows.length, months, spendByMonth: byMonth, incomeByMonth: incMonth,
      spendByCategory: sortObj(byCat), avgSpend: mean(full.map(m => byMonth[m] || 0)), avgIncome: mean(full.map(m => incMonth[m] || 0)),
      subsActive: real.length, subsMonthly: monthlySubs, fixedMonthly: monthlyFixed, leakMonthly: leaks.reduce((a, s) => a + s.annualCost, 0) / 12,
      movers: movers.slice(0, 5), comparedMonth: cmonths[cmonths.length - 1], topMerchants: Object.entries(sortObj(byMerchant)).slice(0, 10) };
  }

  // ---------------------------------------------------------------- datos de ejemplo (formato ING)
  function sampleCSV() {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const U = (a, b) => +(a + rnd() * (b - a)).toFixed(2), pick = a => a[Math.floor(rnd() * a.length)];
    const rows = []; const add = (d, name, amount, note = "") => rows.push([d.toISOString().slice(0, 10).replace(/-/g, ""), name, "NL00INGB0001234567", "", "GT", amount < 0 ? "Af" : "Bij", Math.abs(amount).toFixed(2).replace(".", ","), "Betaalautomaat", note]);
    const today = new Date(); const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1));
    const upMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 3, 1)), cancelMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 5, 1));
    for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
      const day = d.getUTCDate(), wd = d.getUTCDay(), mo = d.getUTCMonth();
      if (day === 1) { add(d, "Salaris Studentenjob BV", 1150, "Loon"); add(d, "Factuur klant", 420, "Invoice"); add(d, "Holland2Stay Huur", -545, "Huur kamer"); }
      if (day === 3) add(d, "Zilveren Kruis Zorgverzekering", -142.5, "Premie");
      if (day === 5) add(d, "NETFLIX.COM 866-579-7172 NL", d < upMonth ? -13.99 : -15.99, "Pasnr. 123");
      if (day === 7) add(d, "SEPA Incasso Spotify AB", -10.99, "Kenmerk: SP-9981");
      if (day === 9) add(d, "Basic-Fit Nederland BV", -29.99, "Lidmaatschap");
      if (day === 12 && d < cancelMonth) add(d, "Adobe Systems Software", -24.19, "Creative Cloud");
      if (day === 14) add(d, "Odido Netherlands", -20, "Mobiel abonnement");
      if (day === 16) add(d, "APPLE.COM/BILL ITUNES.COM", -2.99, "iCloud 200GB");
      if (day === 18) add(d, "Anthropic PBC", -21.78, "Claude Pro");
      if (day === 20) add(d, "Headspace Inc", -12.99);
      if (day === 22) add(d, "Vattenfall Energie", -(68 + U(-6, 6)), "Termijnbedrag");
      if (day === 25 && [0, 3, 6, 9].includes(mo)) add(d, "Fontys Sports Center", -45, "Kwartaal");
      if (mo === 2 && day === 10) add(d, "NordVPN S.A.", -59.88, "Annual plan");
      if (dayDiff(d, end) === 4) add(d, "Cursor AI", -20, "Pro");
      if (wd === 2 || wd === 5) add(d, "Albert Heijn 1234 EINDHOVEN", -U(18, 62), "Betaalpas");
      if (wd === 6 && rnd() < 0.7) add(d, "Jumbo Eindhoven Woensel", -U(25, 70));
      if (rnd() < 0.18) add(d, pick(["Thuisbezorgd.nl", "Doppio Espresso", "Stratumseind Cafe De Rat", "Kebab Palace", "Coffeelab Eindhoven"]), -U(4, 28));
      if (rnd() < 0.08) add(d, "NS GROEP IZ OV-CHIPKAART", -U(6, 24), "Reizen op saldo");
      if (rnd() < 0.05) add(d, pick(["Bol.com", "Amazon EU SARL", "Coolblue BV", "Action Eindhoven"]), -U(9, 120));
      if (rnd() < 0.03) add(d, "Tikkie betaling", -U(5, 40), "Tikkie: etentje");
      if (rnd() < 0.02) add(d, "Geldautomaat Rabobank Eindhoven", -50);
      if (mo === 6 && day === 3) add(d, "Ryanair", -98.46, "EIN-SCQ");
    }
    const dup = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 10)); add(dup, "Basic-Fit Nederland BV", -29.99, "Lidmaatschap");
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    const head = ["Datum", "Naam / Omschrijving", "Rekening", "Tegenrekening", "Code", "Af Bij", "Bedrag (EUR)", "Mutatiesoort", "Mededelingen"];
    return [head, ...rows].map(r => r.map(v => `"${v}"`).join(";")).join("\n");
  }

  // ---------------------------------------------------------------- API
  function analyze(tables, opts = {}) {
    const today = opts.today || new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
    const banks = [], all = [];
    for (const t of tables) { const { bank, rows } = importTable(t); banks.push(bank); all.push(...rows); }
    const rows = normalize(all);
    if (!rows.length) throw new Error("No he encontrado movimientos con fecha e importe válidos.");
    categorize(rows, opts.overrides);
    const subs = detectSubscriptions(rows, today), dups = findDuplicates(rows), newM = newMerchants(rows, today);
    return { banks: [...new Set(banks)], rows, subs, dups, newM, summary: summarize(rows, subs, today) };
  }

  global.Auditor = { parseCSV, readTable, importTable, analyze, setRules, sampleCSV, cleanMerchant, iso };
})(window);
