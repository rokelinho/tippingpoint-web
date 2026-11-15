#!/usr/bin/env node
/**
 * Datos de la demo pública del Radar (tippingpoint.es/herramientas/radar-licitaciones/).
 *
 * Recorre los feeds ATOM vivos de la Plataforma de Contratación del Sector Público (PLACSP)
 * y deja, en un directorio de salida, las licitaciones ABIERTAS (estado PUB y plazo sin vencer)
 * en JSON compacto, troceado por división CPV (2 dígitos) para que el navegador solo descargue
 * el sector que pide el visitante.
 *
 *   node .github/scripts/radar-demo-data.mjs --out=<dir> [--dias=30] [--max-paginas=400]
 *
 * Incremental: <dir>/all.json guarda el almacén y, por feed, el <updated> más reciente ya visto.
 * La primera corrida cubre --dias; las siguientes solo las páginas nuevas. Sin dependencias.
 *
 * Datos: © Plataforma de Contratación del Sector Público (Ministerio de Hacienda), reutilización
 * de datos abiertos. Solo se guardan campos públicos del anuncio.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://contrataciondelsectorpublico.gob.es/sindicacion";
export const FEEDS = [
  { key: "643", url: `${BASE}/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom` },
  { key: "agr", url: `${BASE}/sindicacion_1044/PlataformasAgregadasSinMenores.atom` },
];

// ---------------------------------------------------------------- XML (por local-name, sin dependencias)
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
/** Texto del primer elemento hoja <prefijo:name ...>texto</...>. */
export const first = (xml, name) => { const m = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`).exec(xml); return m ? decode(m[1]) : undefined; };
export const all = (xml, name) => { const re = new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:[\\w.-]+:)?${name}>`, "g"); const out = []; let m; while ((m = re.exec(xml))) out.push(decode(m[1])); return out; };
/** Contenido del primer bloque <prefijo:name> … </prefijo:name> (name exacto: no casa con nameLot). */
export const block = (xml, name) => { const m = new RegExp(`<((?:[\\w.-]+:)?${name})(?:\\s[^>]*)?>([\\s\\S]*?)</\\1>`).exec(xml); return m ? m[2] : undefined; };

/** Una <entry> → registro o null. Mismo mapeo que el pipeline (src/codice.ts del Radar). */
export function mapEntry(e) {
  const id = first(e, "id"); if (!id) return null;
  const cfs = block(e, "ContractFolderStatus") ?? e;
  const pp = block(cfs, "ProcurementProject") ?? "";
  const dl = block(cfs, "TenderSubmissionDeadlinePeriod") ?? "";
  const budget = block(pp, "BudgetAmount") ?? block(cfs, "BudgetAmount") ?? "";
  const summary = first(e, "summary") ?? "";
  const organo = summary.match(/Órgano de Contrataci[oó]n:\s*(.+?)(?:;|,\s*(?:Importe|Estado)\b|$)/i)?.[1]?.trim()
    ?? first(block(block(cfs, "LocatedContractingParty") ?? "", "PartyName") ?? "", "Name") ?? "";
  let url; for (const m of e.matchAll(/<link\b([^>]*)>/g)) { const rel = /rel="([^"]*)"/.exec(m[1])?.[1]; const href = /href="([^"]*)"/.exec(m[1])?.[1]; if (href && !["next", "self", "first", "last"].includes(rel)) { url = decode(href); break; } }
  const num = (s) => { const n = Number(s); return s != null && s !== "" && Number.isFinite(n) ? n : null; };
  // el título del contrato es el primer <Name> hoja del ProcurementProject (antes de lotes y CPV)
  return {
    id, updated: first(e, "updated") ?? "",
    estado: first(cfs, "ContractFolderStatusCode") ?? "",
    titulo: first(pp, "Name") ?? first(e, "title") ?? "",
    organo, nuts: first(pp, "CountrySubentityCode") ?? first(cfs, "CountrySubentityCode") ?? "",
    tipo: first(pp, "TypeCode") ?? "",
    cpv: [...new Set(all(cfs, "ItemClassificationCode").filter((c) => /^\d{8}$/.test(c)))],
    importe: num(first(budget, "TaxExclusiveAmount")) ?? num(first(budget, "TotalAmount")),
    limite: (first(dl, "EndDate") ?? "").slice(0, 10), url,
  };
}

/** Página del feed → { next, entries (xml), deleted (ids) }. */
export function parsePage(xml) {
  const head = xml.slice(0, xml.search(/<entry[\s>]/) === -1 ? xml.length : xml.search(/<entry[\s>]/));
  let next; for (const m of head.matchAll(/<link\b([^>]*)>/g)) if (/rel="next"/.test(m[1])) next = decode(/href="([^"]*)"/.exec(m[1])?.[1] ?? "") || undefined;
  const entries = [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g)].map((m) => m[0]);
  const deleted = [...xml.matchAll(/<(?:[\w.-]+:)?deleted-entry\b[^>]*\bref="([^"]*)"/g)].map((m) => decode(m[1]));
  return { next: next?.replace(/^http:/, "https:"), entries, deleted };
}

// ---------------------------------------------------------------- almacén
const hoyISO = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // ~hora peninsular
/** Registro compacto: [id, título, órgano, NUTS, tipo, "cpv cpv", importe, límite, publicado, url|idEvl] */
export function compact(r) {
  const idc = r.id.match(/(\d+)\s*$/)?.[1] ?? r.id;
  const evl = r.url?.match(/idEvl=([^&]+)/)?.[1];
  return [idc, r.titulo.slice(0, 260), r.organo.slice(0, 120), r.nuts, r.tipo, r.cpv.slice(0, 5).join(" "), r.importe == null ? null : Math.round(r.importe), r.limite, r.updated.slice(0, 10), evl ? "~" + evl : (r.url ?? "")];
}
export const abierta = (r, hoy) => r.estado === "PUB" && /^\d{4}-\d\d-\d\d$/.test(r.limite) && r.limite >= hoy && r.titulo.length > 3;

/** Aplica una página al almacén. Devuelve cuántas entries eran más nuevas que `corte`. */
export function applyPage(store, feedKey, page, corte, hoy, vistos) {
  let dentro = 0, max = store.state[feedKey]?.last ?? "";
  for (const xml of page.entries) {
    const r = mapEntry(xml); if (!r) continue;
    const t = Date.parse(r.updated); if (!Number.isFinite(t)) continue;
    if (t >= corte) dentro++;
    const k = feedKey + ":" + r.id; const prev = vistos.get(k);
    if (prev != null && prev >= t) continue; // ya procesada una versión igual o más nueva en esta corrida
    vistos.set(k, t);
    if (r.updated > max) max = r.updated;
    if (abierta(r, hoy)) store.items[k] = compact(r); else delete store.items[k];
  }
  for (const ref of page.deleted) delete store.items[feedKey + ":" + ref];
  return { dentro, max };
}

export function writeOut(out, store, hoy) {
  for (const [k, it] of Object.entries(store.items)) if (it[7] < hoy) delete store.items[k];
  mkdirSync(join(out, "d"), { recursive: true });
  for (const f of readdirSync(join(out, "d"))) rmSync(join(out, "d", f));
  const byDiv = {};
  for (const it of Object.values(store.items)) {
    const divs = [...new Set(it[5].split(" ").filter(Boolean).map((c) => c.slice(0, 2)))].slice(0, 4);
    for (const d of divs.length ? divs : ["00"]) (byDiv[d] ??= []).push(it);
  }
  const generated = new Date().toISOString();
  const counts = {};
  for (const [d, items] of Object.entries(byDiv)) { items.sort((a, b) => (a[8] < b[8] ? 1 : -1)); counts[d] = items.length; writeFileSync(join(out, "d", d + ".json"), JSON.stringify({ g: generated, items })); }
  writeFileSync(join(out, "index.json"), JSON.stringify({ generated, total: Object.keys(store.items).length, byDiv: counts, feeds: store.state }));
  writeFileSync(join(out, "all.json"), JSON.stringify(store));
  return { total: Object.keys(store.items).length, divs: Object.keys(byDiv).length };
}

// ---------------------------------------------------------------- red
function get(url) {
  // curl -k: la cadena de certificados de PLACSP (FNMT) falla en algunos runners; --compressed ahorra ~85 %
  return execFileSync("curl", ["-ksSL", "--compressed", "--retry", "3", "--retry-delay", "5", "--max-time", "240", "-A", "tippingpoint-radar-demo/1.0 (+https://tippingpoint.es)", url], { maxBuffer: 400 * 1024 * 1024, encoding: "utf8" });
}

async function main() {
  const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
  const out = arg("out"); if (!out) { console.error("Falta --out=<dir>"); process.exit(2); }
  const dias = Number(arg("dias", "30")), maxPag = Number(arg("max-paginas", "400")), t0 = Date.now(), presupuestoMs = Number(arg("max-min", "100")) * 60e3;
  mkdirSync(out, { recursive: true });
  const store = existsSync(join(out, "all.json")) ? JSON.parse(readFileSync(join(out, "all.json"), "utf8")) : { state: {}, items: {} };
  store.state ??= {}; store.items ??= {};
  const hoy = hoyISO();
  let fallos = 0;
  for (const feed of FEEDS) {
    const last = store.state[feed.key]?.last;
    const corte = last ? Date.parse(last) - 6 * 3600e3 : Date.now() - dias * 86400e3;
    const vistos = new Map(); let url = feed.url, pag = 0, max = last ?? "", completo = false;
    try {
      while (url && pag < maxPag && Date.now() - t0 < presupuestoMs) {
        const page = parsePage(get(url)); pag++;
        if (!page.entries.length && !page.deleted.length) { if (pag === 1) throw new Error("página 1 sin entries: ¿cambió el feed?"); completo = true; break; }
        const r = applyPage(store, feed.key, page, corte, hoy, vistos); if (r.max > max) max = r.max;
        if (pag % 10 === 0) console.log(`  [${feed.key}] ${pag} páginas · ${Object.keys(store.items).length} abiertas`);
        if (page.entries.length && r.dentro === 0) { completo = true; break; }
        url = page.next; if (!url) completo = true;
      }
      // solo avanzamos el cursor si la ventana quedó cubierta: si no, la próxima corrida reintenta desde el mismo punto
      if (completo && max) store.state[feed.key] = { last: max, run: new Date().toISOString(), pages: pag };
      console.log(`[${feed.key}] ${pag} páginas · ${completo ? "ventana cubierta" : "INCOMPLETA (tope de páginas/tiempo)"} · último updated ${max}`);
    } catch (e) { fallos++; console.error(`[${feed.key}] ERROR: ${e.message}`); }
  }
  const r = writeOut(out, store, hoy);
  console.log(`Abiertas: ${r.total} · divisiones CPV: ${r.divs} · ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
  if (fallos === FEEDS.length) process.exit(1); // los dos feeds caídos: que el job falle y no se publique nada
  if (r.total === 0) { console.error("0 licitaciones abiertas: no se publica"); process.exit(1); }
}

if (process.argv[1]?.endsWith("radar-demo-data.mjs")) main().catch((e) => { console.error(e); process.exit(1); });
