/* Demo del Radar de licitaciones · tippingpoint.es
 * Todo ocurre en el navegador: se descargan las licitaciones abiertas (datos públicos de la
 * Plataforma de Contratación del Sector Público, regenerados cada día) y se filtran y puntúan
 * aquí con reglas simples. La selección del visitante no se envía a ningún sitio.
 */
(function () {
  "use strict";
  var DATA = "https://raw.githubusercontent.com/rokelinho/tippingpoint-web/radar-data/";
  var DEEPLINK = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=";

  // ---------------------------------------------------------------- catálogos
  // Sector → prefijos CPV. Cuanto más largo el prefijo que casa, más específico el encaje.
  var SECTORES = [
    { id: "obra-civil", n: "Obra civil y carreteras", p: ["4523", "45221", "45222", "4511", "45112"] },
    { id: "edificacion", n: "Edificación y reformas", p: ["4521", "4526", "454", "4544", "4542"] },
    { id: "hidraulica", n: "Obras hidráulicas y marítimas", p: ["4524", "45232", "4525", "45252"] },
    { id: "instalaciones", n: "Instalaciones y climatización", p: ["453", "5071", "5072", "5073", "4533"] },
    { id: "ingenieria", n: "Ingeniería y arquitectura", p: ["71"] },
    { id: "informatica", n: "Informática y software", p: ["72", "48", "302"] },
    { id: "consultoria", n: "Consultoría y servicios a empresas", p: ["794", "793", "791", "792", "73"] },
    { id: "formacion", n: "Formación", p: ["80"] },
    { id: "limpieza", n: "Limpieza y residuos", p: ["909", "905", "906", "907"] },
    { id: "mantenimiento", n: "Mantenimiento y reparación", p: ["50"] },
    { id: "jardineria", n: "Jardinería y forestal", p: ["77"] },
    { id: "seguridad", n: "Seguridad y vigilancia", p: ["797", "357"] },
    { id: "marketing", n: "Comunicación, diseño y eventos", p: ["7934", "7982", "7995", "7996", "92"] },
    { id: "sanidad", n: "Sanidad y material sanitario", p: ["33", "85"] },
    { id: "alimentacion", n: "Alimentación y catering", p: ["15", "55"] },
    { id: "transporte", n: "Transporte y vehículos", p: ["34", "60"] },
    { id: "energia", n: "Energía y electricidad", p: ["09", "31", "65"] },
    { id: "mobiliario", n: "Mobiliario y equipamiento", p: ["39", "37", "301"] }
  ];
  var CCAA = { ES11: "Galicia", ES12: "Asturias", ES13: "Cantabria", ES21: "País Vasco", ES22: "Navarra", ES23: "La Rioja", ES24: "Aragón", ES30: "Madrid", ES41: "Castilla y León", ES42: "Castilla-La Mancha", ES43: "Extremadura", ES51: "Cataluña", ES52: "Comunitat Valenciana", ES53: "Illes Balears", ES61: "Andalucía", ES62: "Región de Murcia", ES63: "Ceuta", ES64: "Melilla", ES70: "Canarias" };
  var PROV = { ES111: "A Coruña", ES112: "Lugo", ES113: "Ourense", ES114: "Pontevedra", ES120: "Asturias", ES130: "Cantabria", ES211: "Álava", ES212: "Gipuzkoa", ES213: "Bizkaia", ES220: "Navarra", ES230: "La Rioja", ES241: "Huesca", ES242: "Teruel", ES243: "Zaragoza", ES300: "Madrid", ES411: "Ávila", ES412: "Burgos", ES413: "León", ES414: "Palencia", ES415: "Salamanca", ES416: "Segovia", ES417: "Soria", ES418: "Valladolid", ES419: "Zamora", ES421: "Albacete", ES422: "Ciudad Real", ES423: "Cuenca", ES424: "Guadalajara", ES425: "Toledo", ES431: "Badajoz", ES432: "Cáceres", ES511: "Barcelona", ES512: "Girona", ES513: "Lleida", ES514: "Tarragona", ES521: "Alicante", ES522: "Castellón", ES523: "Valencia", ES531: "Eivissa y Formentera", ES532: "Mallorca", ES533: "Menorca", ES611: "Almería", ES612: "Cádiz", ES613: "Córdoba", ES614: "Granada", ES615: "Huelva", ES616: "Jaén", ES617: "Málaga", ES618: "Sevilla", ES620: "Murcia", ES630: "Ceuta", ES640: "Melilla", ES703: "El Hierro", ES704: "Fuerteventura", ES705: "Gran Canaria", ES706: "La Gomera", ES707: "La Palma", ES708: "Lanzarote", ES709: "Tenerife" };
  var IMPORTES = [
    { id: "any", n: "Cualquier importe", min: 0, max: Infinity },
    { id: "s", n: "Hasta 50.000 €", min: 0, max: 50000 },
    { id: "m", n: "50.000 – 250.000 €", min: 50000, max: 250000 },
    { id: "l", n: "250.000 € – 1 M€", min: 250000, max: 1000000 },
    { id: "xl", n: "Más de 1 M€", min: 1000000, max: Infinity }
  ];
  var TIPO = { "1": "Suministros", "2": "Servicios", "3": "Obras", "21": "Gestión de servicios", "31": "Concesión de obras", "22": "Concesión de servicios", "40": "Colaboración público-privada", "7": "Administrativo especial", "8": "Privado", "50": "Patrimonial" };

  // ---------------------------------------------------------------- utilidades
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var norm = function (s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); };
  var nf = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
  var eur = function (n) { return n == null ? "Importe no publicado" : nf.format(n) + " €"; };
  var eurCorto = function (n) { return n >= 1e9 ? nf.format(Math.round(n / 1e8) / 10) + " mil M€" : n >= 1e6 ? (Math.round(n / 1e5) / 10).toLocaleString("es-ES") + " M€" : n >= 1e3 ? nf.format(Math.round(n / 1e3)) + " mil €" : nf.format(n) + " €"; };
  var hoy = function () { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  var dias = function (iso) { var p = iso.split("-"); return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - hoy()) / 864e5); };
  var fechaLarga = function (iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString("es-ES", { day: "numeric", month: "long" }); };
  var zona = function (nuts) { if (!nuts || nuts === "ES") return "España"; return PROV[nuts] || CCAA[nuts.slice(0, 4)] || "España"; };
  var titulo = function (t) { // muchos órganos publican en MAYÚSCULAS: se pasa a frase para que se lea
    if (t.length > 12 && t === t.toUpperCase()) t = t.charAt(0) + t.slice(1).toLowerCase();
    return t;
  };

  // ---------------------------------------------------------------- estado
  var st = { sectores: [], zona: "", importe: "any", kw: "", orden: "encaje", visibles: 12, lista: [], indice: null };
  var cache = {};

  function leerHash() {
    var q = new URLSearchParams(location.hash.replace(/^#/, ""));
    var s = (q.get("s") || "").split(",").filter(function (x) { return SECTORES.some(function (y) { return y.id === x; }); });
    if (s.length) st.sectores = s.slice(0, 3);
    if (q.get("z") && CCAA[q.get("z")]) st.zona = q.get("z");
    if (q.get("i") && IMPORTES.some(function (x) { return x.id === q.get("i"); })) st.importe = q.get("i");
    if (q.get("q")) st.kw = q.get("q").slice(0, 80);
    return s.length > 0 || !!q.get("q");
  }
  function escribirHash() {
    var q = new URLSearchParams();
    if (st.sectores.length) q.set("s", st.sectores.join(","));
    if (st.zona) q.set("z", st.zona);
    if (st.importe !== "any") q.set("i", st.importe);
    if (st.kw) q.set("q", st.kw);
    history.replaceState(null, "", "#" + q.toString());
  }

  // ---------------------------------------------------------------- datos
  function getJSON(path) {
    if (!cache[path]) cache[path] = fetch(DATA + path, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    return cache[path];
  }
  function cargarIndice() {
    return getJSON("index.json").then(function (ix) {
      st.indice = ix;
      var d = new Date(ix.generated);
      var cuando = d.toDateString() === new Date().toDateString() ? "hoy a las " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "el " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
      $("#live").innerHTML = '<i></i><b>' + nf.format(ix.total) + "</b> licitaciones abiertas ahora mismo en España · actualizado " + cuando;
      $("#live").classList.add("on");
    }).catch(function () {
      $("#live").textContent = "No se han podido cargar los datos. Recarga la página en unos minutos.";
    });
  }

  // ---------------------------------------------------------------- encaje (reglas, sin IA)
  function puntuar(it, prefijos, kws, rango) {
    // it: [id, título, órgano, NUTS, tipo, "cpv cpv", importe, límite, publicado, url]
    var cpvs = it[5] ? it[5].split(" ") : [], mejor = 0, cpvHit = "";
    for (var i = 0; i < cpvs.length; i++) for (var j = 0; j < prefijos.length; j++) if (cpvs[i].indexOf(prefijos[j]) === 0 && prefijos[j].length > mejor) { mejor = prefijos[j].length; cpvHit = cpvs[i]; }
    var t = norm(it[1]), kwHits = [];
    for (var k = 0; k < kws.length; k++) if (t.indexOf(kws[k]) !== -1) kwHits.push(kws[k]);
    if (prefijos.length && !mejor && !kwHits.length) return null;
    if (!prefijos.length && kws.length && !kwHits.length) return null;
    if (st.zona && it[3] && it[3] !== "ES" && it[3].slice(0, 4) !== st.zona) return null;
    var imp = it[6];
    if (rango.id !== "any" && imp != null && (imp < rango.min || imp > rango.max)) return null;

    var s = 40, por = [];
    if (mejor) { s += 14 + Math.min(12, (mejor - 2) * 4); por.push("actividad (CPV " + cpvHit.slice(0, 5) + ")"); }
    if (kwHits.length) { s += Math.min(26, kwHits.length * 16); por.push("«" + kwHits.join("», «") + "» en el título"); }
    else if (kws.length) s -= 8;
    if (st.zona && it[3] && it[3].slice(0, 4) === st.zona) { s += 10; por.push("tu zona"); }
    if (rango.id !== "any" && imp != null) { s += 8; por.push("importe en tu rango"); }
    var d = dias(it[7]);
    if (d >= 10) s += 6; else if (d <= 3) s -= 10;
    if (imp == null) s -= 4;
    return { it: it, s: Math.max(5, Math.min(99, s)), por: por, d: d };
  }

  function buscar() {
    var sel = SECTORES.filter(function (x) { return st.sectores.indexOf(x.id) !== -1; });
    var prefijos = [].concat.apply([], sel.map(function (x) { return x.p; }));
    var kws = norm(st.kw).split(/[,;]+/).map(function (x) { return x.trim(); }).filter(function (x) { return x.length >= 3; }).slice(0, 5);
    var rango = IMPORTES.filter(function (x) { return x.id === st.importe; })[0];
    if (!prefijos.length && !kws.length) { $("#aviso").textContent = "Elige al menos un sector o escribe una palabra clave."; return; }
    $("#aviso").textContent = "";
    var divs = prefijos.length ? prefijos.map(function (p) { return p.slice(0, 2); }) : Object.keys(st.indice ? st.indice.byDiv : {});
    divs = divs.filter(function (d, i, a) { return a.indexOf(d) === i && (!st.indice || st.indice.byDiv[d]); });
    var btn = $("#buscar"); btn.disabled = true; btn.textContent = "Buscando…";
    escribirHash();
    Promise.all(divs.map(function (d) { return getJSON("d/" + d + ".json").catch(function () { return { items: [] }; }); })).then(function (files) {
      var vistos = {}, out = [];
      files.forEach(function (f) { f.items.forEach(function (it) { if (vistos[it[0]] || it[7] < isoHoy()) return; vistos[it[0]] = 1; var r = puntuar(it, prefijos, kws, rango); if (r) out.push(r); }); });
      st.lista = out; st.visibles = 12;
      pintar(sel, kws, rango);
      btn.disabled = false; btn.textContent = "Ver licitaciones abiertas";
      $("#resultados").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function isoHoy() { var d = hoy(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // ---------------------------------------------------------------- pintar
  function ordenar() {
    var f = { encaje: function (a, b) { return b.s - a.s || a.d - b.d; }, cierre: function (a, b) { return a.d - b.d || b.s - a.s; }, importe: function (a, b) { return (b.it[6] || 0) - (a.it[6] || 0); }, nuevas: function (a, b) { return a.it[8] < b.it[8] ? 1 : a.it[8] > b.it[8] ? -1 : b.s - a.s; } }[st.orden];
    st.lista.sort(f);
  }
  function tarjeta(r) {
    var it = r.it, url = it[9] ? (it[9].charAt(0) === "~" ? DEEPLINK + it[9].slice(1) : it[9]) : "";
    var cls = r.s >= 80 ? "hi" : r.s >= 62 ? "mid" : "";
    var plazo = r.d === 0 ? "cierra hoy" : r.d === 1 ? "cierra mañana" : "cierra en " + r.d + " días";
    return '<article class="lic">' +
      '<div class="score ' + cls + '" title="Encaje estimado con tu selección"><b>' + r.s + "</b><small>encaje</small></div>" +
      '<div class="lic-b"><h3>' + esc(titulo(it[1])) + "</h3>" +
      '<p class="org">' + esc(it[2] || "Órgano no indicado") + "</p>" +
      '<p class="meta"><span class="m imp">' + eur(it[6]) + '</span><span class="m' + (r.d <= 5 ? " urg" : "") + '">' + plazo + " · " + fechaLarga(it[7]) + '</span><span class="m">' + esc(zona(it[3])) + "</span>" + (TIPO[it[4]] ? '<span class="m">' + TIPO[it[4]] + "</span>" : "") + "</p>" +
      (r.por.length ? '<p class="por">Encaja por: ' + esc(r.por.join(" · ")) + "</p>" : "") +
      "</div>" +
      (url ? '<a class="ver" href="' + esc(url) + '" target="_blank" rel="noopener nofollow">Ver expediente<span aria-hidden="true"> ↗</span></a>' : "") +
      "</article>";
  }
  function pintar(sel, kws, rango) {
    var box = $("#resultados"); box.classList.add("show");
    var n = st.lista.length;
    var desc = [sel.map(function (x) { return x.n; }).join(" + ") || "Cualquier sector", st.zona ? CCAA[st.zona] : "toda España", rango.n.toLowerCase()].concat(kws.length ? ["«" + kws.join("», «") + "»"] : []).join(" · ");
    if (!n) {
      box.innerHTML = '<div class="wrap"><div class="rep-head"><div><h2>Hoy no hay nada abierto que encaje.</h2><p>' + esc(desc) + '</p></div></div><p class="vacio">Prueba a ampliar la zona, quitar el filtro de importe o añadir otro sector. Las licitaciones cambian cada día: el Radar de verdad vigila por ti y solo te escribe cuando aparece algo.</p></div>';
      return;
    }
    ordenar();
    var total = 0, conImp = 0, semana = 0, altas = 0;
    st.lista.forEach(function (r) { if (r.it[6] != null) { total += r.it[6]; conImp++; } if (r.d <= 7) semana++; if (r.s >= 80) altas++; });
    var html = '<div class="wrap">' +
      '<div class="rep-head"><div><h2>' + nf.format(n) + (n === 1 ? " licitación abierta encaja" : " licitaciones abiertas encajan") + " con tu perfil.</h2><p>" + esc(desc) + "</p></div>" +
      '<div class="rep-actions"><button type="button" class="btn btn-ghost btn-sm" id="copiar">Copiar enlace a esta búsqueda</button></div></div>' +
      '<div class="cards">' +
      '<div class="card"><div class="k">Importe total en juego</div><div class="v">' + eurCorto(total) + "</div></div>" +
      '<div class="card"><div class="k">Cierran en 7 días</div><div class="v' + (semana ? " bad" : "") + '">' + nf.format(semana) + "</div></div>" +
      '<div class="card"><div class="k">Encaje alto (80+)</div><div class="v">' + nf.format(altas) + "</div></div>" +
      '<div class="card dark"><div class="k">Con el Radar</div><div class="v"><small class="line">Te llegarían solas cada semana, ya leídas y resumidas.</small></div></div>' +
      "</div>" +
      '<div class="tools"><label for="orden">Ordenar por</label><select id="orden"><option value="encaje">Mejor encaje</option><option value="cierre">Cierran antes</option><option value="importe">Mayor importe</option><option value="nuevas">Más recientes</option></select></div>' +
      '<div id="lista"></div><div class="mas" id="mas"></div></div>';
    box.innerHTML = html;
    $("#orden").value = st.orden;
    $("#orden").onchange = function () { st.orden = this.value; ordenar(); st.visibles = 12; pintarLista(); };
    $("#copiar").onclick = function () {
      var b = this, done = function () { b.textContent = "Enlace copiado"; setTimeout(function () { b.textContent = "Copiar enlace a esta búsqueda"; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, function () { prompt("Copia este enlace:", location.href); });
      else prompt("Copia este enlace:", location.href);
    };
    pintarLista();
  }
  function pintarLista() {
    var vis = st.lista.slice(0, st.visibles), html = "";
    vis.forEach(function (r, i) {
      html += tarjeta(r);
      if (i === 4 && st.lista.length > 5) html += '<aside class="pitch"><div><h3>Esto es la demo. El Radar hace el trabajo por ti.</h3><p>Aquí has tenido que venir tú, elegir filtros y leer títulos. El Radar conoce tu empresa (qué hacéis, dónde, con qué solvencia), lee cada anuncio con IA y cada semana te manda por correo solo lo que merece la pena, puntuado y resumido en una página.</p></div><a class="btn btn-signal" href="/#contacto">Pedir una prueba</a></aside>';
    });
    $("#lista").innerHTML = html;
    var quedan = st.lista.length - vis.length;
    $("#mas").innerHTML = quedan > 0 ? '<button type="button" class="btn btn-ghost" id="vermas">Ver ' + Math.min(12, quedan) + " más (quedan " + nf.format(quedan) + ")</button>" : '<p class="fin">Has visto las ' + nf.format(st.lista.length) + ". Mañana habrá otras.</p>";
    if (quedan > 0) $("#vermas").onclick = function () { st.visibles += 12; pintarLista(); };
  }

  // ---------------------------------------------------------------- formulario
  function montar() {
    var chips = $("#sectores");
    chips.innerHTML = SECTORES.map(function (s) { return '<button type="button" class="chip" data-id="' + s.id + '" aria-pressed="false">' + s.n + "</button>"; }).join("");
    chips.addEventListener("click", function (e) {
      var b = e.target.closest(".chip"); if (!b) return;
      var id = b.dataset.id, i = st.sectores.indexOf(id);
      if (i !== -1) st.sectores.splice(i, 1);
      else { if (st.sectores.length >= 3) { $("#aviso").textContent = "Máximo tres sectores a la vez: quita uno para añadir otro."; return; } st.sectores.push(id); }
      $("#aviso").textContent = ""; reflejar();
    });
    $("#zona").innerHTML = '<option value="">Toda España</option>' + Object.keys(CCAA).sort(function (a, b) { return CCAA[a].localeCompare(CCAA[b], "es"); }).map(function (k) { return '<option value="' + k + '">' + CCAA[k] + "</option>"; }).join("");
    $("#importe").innerHTML = IMPORTES.map(function (x) { return '<option value="' + x.id + '">' + x.n + "</option>"; }).join("");
    $("#zona").onchange = function () { st.zona = this.value; };
    $("#importe").onchange = function () { st.importe = this.value; };
    $("#kw").oninput = function () { st.kw = this.value; };
    $("#form").addEventListener("submit", function (e) { e.preventDefault(); buscar(); });
    document.querySelectorAll("[data-ejemplo]").forEach(function (a) {
      a.addEventListener("click", function (e) { e.preventDefault(); location.hash = a.dataset.ejemplo; st.sectores = []; st.zona = ""; st.importe = "any"; st.kw = ""; leerHash(); reflejar(); buscar(); });
    });
  }
  function reflejar() {
    document.querySelectorAll("#sectores .chip").forEach(function (b) { var on = st.sectores.indexOf(b.dataset.id) !== -1; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
    $("#zona").value = st.zona; $("#importe").value = st.importe; $("#kw").value = st.kw;
  }

  montar();
  var auto = leerHash(); reflejar();
  cargarIndice().then(function () { if (auto) buscar(); });
  var y = $("#y"); if (y) y.textContent = new Date().getFullYear();
})();
