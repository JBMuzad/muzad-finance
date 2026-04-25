import { useState, useEffect, useCallback, useMemo } from "react";
import { parseCSV } from "./parseCSV.js";
import { CATEGORIES, DEFAULT_FAMILY_ACCOUNTS, processTxList, detectAccounts } from "./categorize.js";

// ── Muzad kleurpalet ──────────────────────────────────────────────────────
const C = {
  teal:   "#0D4A52", teal2: "#1A6B7C", teal3: "#2A8A9C",
  gold:   "#C9922A", gold2: "#E8B84B",
  white:  "#FFFFFF", bg:    "#f0f5f6", card:  "#FFFFFF",
  border: "rgba(13,74,82,0.13)", muted: "#5a7a80",
  text:   "#1A2B2F", dark:  "#0D2B30",
};

// ── Helpers ───────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(n);
const fmtShort = n => {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return (n < 0 ? "-" : "") + "€" + s;
};
const maandLabel = m => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
  return d.toLocaleDateString("nl-BE", { month: "short", year: "2-digit" });
};

function pct(part, total) { return total === 0 ? 0 : Math.round((part / total) * 100); }

// ── Persistence ───────────────────────────────────────────────────────────
const LS_KEY = "muzad_finance_v1";
function loadState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

// ── MiniBar (inline horizontale balk) ────────────────────────────────────
function MiniBar({ value, max, color, height = 8 }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#e9eeef", borderRadius: 4, height, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
    </div>
  );
}

// ── Maandgrafiek (verticale bars) ─────────────────────────────────────────
function MaandGrafiek({ maanden, selected, onSelect }) {
  const maxVal = Math.max(...maanden.map(m => Math.max(m.inkomen, m.uitgaven)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, padding: "0 4px" }}>
      {maanden.map(m => {
        const incH = Math.round((m.inkomen / maxVal) * 110);
        const uitH = Math.round((m.uitgaven / maxVal) * 110);
        const isSelected = selected === m.maand;
        return (
          <div key={m.maand} onClick={() => onSelect(isSelected ? null : m.maand)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", opacity: selected && !isSelected ? 0.45 : 1, transition: "opacity .2s" }}>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 110, gap: 2 }}>
              <div title={`Inkomsten: ${fmt(m.inkomen)}`}
                style={{ height: incH, background: isSelected ? "#0a7c5c" : "#34a37e", borderRadius: "3px 3px 0 0", transition: "height .3s", minHeight: m.inkomen > 0 ? 2 : 0 }} />
              <div title={`Uitgaven: ${fmt(m.uitgaven)}`}
                style={{ height: uitH, background: isSelected ? C.teal : C.teal2, borderRadius: "3px 3px 0 0", transition: "height .3s", minHeight: m.uitgaven > 0 ? 2 : 0 }} />
            </div>
            <span style={{ fontSize: 9, color: C.muted, whiteSpace: "nowrap" }}>{maandLabel(m.maand)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── DonutChart ────────────────────────────────────────────────────────────
function DonutChart({ segments, size = 140 }) {
  const r = 42, cx = 50, cy = 50, stroke = 14;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e9eeef" strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const el = (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={seg.color} strokeWidth={stroke}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={-offset}
            style={{ transformOrigin: "50% 50%", transform: "rotate(-90deg)" }}
          />
        );
        offset += dash;
        return el;
      })}
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill={C.teal}>{segments.length}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize={7} fill={C.muted}>categ.</text>
    </svg>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color = C.teal, icon }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
        {icon && <span style={{ marginRight: 5 }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── CatBadge ─────────────────────────────────────────────────────────────
function CatBadge({ cat }) {
  const c = CATEGORIES[cat] || CATEGORIES.overige;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      padding: "2px 7px", borderRadius: 10, background: c.bg, color: c.color, whiteSpace: "nowrap" }}>
      {c.icon} {c.label}
    </span>
  );
}

// ── UploadZone ────────────────────────────────────────────────────────────
function UploadZone({ onFiles }) {
  const [over, setOver] = useState(false);
  const handle = files => { if (files.length) onFiles(Array.from(files)); };
  return (
    <label
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, border: `2px dashed ${over ? C.gold : C.teal3}`, borderRadius: 16,
        padding: "40px 20px", cursor: "pointer", transition: "all .2s",
        background: over ? "#fef9ee" : "#f7fbfc",
      }}>
      <input type="file" accept=".csv" multiple style={{ display: "none" }}
        onChange={e => handle(e.target.files)} />
      <span style={{ fontSize: 40 }}>📂</span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.teal }}>Sleep CSV-bestanden hierheen</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>of klik om te selecteren · meerdere bestanden tegelijk mogelijk</div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, background: "#e8f2f4", padding: "4px 12px", borderRadius: 8 }}>
        ING-formaat (puntkomma-gescheiden) · UTF-8
      </div>
    </label>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOOFD APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const stored = loadState();

  const [transactions, setTransactions] = useState(stored.transactions || []);
  const [catOverrides, setCatOverrides]  = useState(stored.catOverrides || {});   // {id: cat}
  const [savingsGoal, setSavingsGoal]    = useState(stored.savingsGoal || 500);
  const [view, setView]                  = useState("overzicht");
  const [maandFilter, setMaandFilter]    = useState(null);   // "2026-04" or null = all
  const [catFilter, setCatFilter]        = useState(null);   // category key or null
  const [rekeningFilter, setRekeningFilter] = useState(null);
  const [zoekterm, setZoekterm]          = useState("");
  const [editCat, setEditCat]            = useState(null);   // tx.id being edited
  const [reducSliders, setReducSliders]  = useState({});     // {cat: pct (0-100)}
  const [selectedMaand, setSelectedMaand] = useState(null); // chart click

  // Persist
  useEffect(() => {
    saveState({ transactions, catOverrides, savingsGoal });
  }, [transactions, catOverrides, savingsGoal]);

  // ── CSV inladen ──────────────────────────────────────────────────────
  const familyIBANs = useMemo(() => new Set(Object.keys(DEFAULT_FAMILY_ACCOUNTS)), []);

  const handleFiles = useCallback(async (files) => {
    const newTxs = [];
    for (const file of files) {
      const text = await file.text();
      const parsed = parseCSV(text);
      newTxs.push(...parsed);
    }
    if (!newTxs.length) return;

    setTransactions(prev => {
      const existing = new Set(prev.map(t => t.id));
      const toAdd = newTxs.filter(t => !existing.has(t.id));
      const all = [...prev, ...toAdd];
      return processTxList(all, familyIBANs);
    });
    setView("overzicht");
  }, [familyIBANs]);

  // ── Transacties met overrides ────────────────────────────────────────
  const allTx = useMemo(() =>
    transactions.map(t => ({
      ...t,
      categorie: catOverrides[t.id] || t.categorie,
    })),
    [transactions, catOverrides]
  );

  // ── Rekeningen in data ───────────────────────────────────────────────
  const accounts = useMemo(() => detectAccounts(allTx), [allTx]);

  // ── Beschikbare maanden ──────────────────────────────────────────────
  const maanden = useMemo(() => {
    const set = new Set(allTx.map(t => t.maand));
    return [...set].sort();
  }, [allTx]);

  // ── Gefilterde transacties ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = zoekterm.toLowerCase();
    return allTx.filter(t =>
      (!maandFilter || t.maand === maandFilter) &&
      (!catFilter || t.categorie === catFilter) &&
      (!rekeningFilter || t.rekening === rekeningFilter) &&
      (!needle || `${t.merchant} ${t.tegenpartijNaam} ${t.mededeling} ${t.details}`.toLowerCase().includes(needle))
    );
  }, [allTx, maandFilter, catFilter, rekeningFilter, zoekterm]);

  // ── Externe transacties (excl. intern familie/sparen voor overzicht) ──
  const externe = useMemo(() =>
    allTx.filter(t => t.categorie !== "familie"),
    [allTx]
  );

  // ── Stats per maand ───────────────────────────────────────────────────
  const maandStats = useMemo(() => {
    const map = {};
    externe.forEach(t => {
      if (!map[t.maand]) map[t.maand] = { maand: t.maand, inkomen: 0, uitgaven: 0, sparen: 0 };
      if (t.categorie === "inkomen") map[t.maand].inkomen += t.bedrag;
      else if (t.categorie === "sparen") map[t.maand].sparen += Math.abs(t.bedrag);
      else if (t.bedrag < 0) map[t.maand].uitgaven += Math.abs(t.bedrag);
    });
    return Object.values(map).sort((a, b) => a.maand.localeCompare(b.maand));
  }, [externe]);

  const aantalMaanden = Math.max(maandStats.length, 1);
  const gemInkomen  = maandStats.reduce((s, m) => s + m.inkomen, 0) / aantalMaanden;
  const gemUitgaven = maandStats.reduce((s, m) => s + m.uitgaven, 0) / aantalMaanden;
  const gemSaldo    = gemInkomen - gemUitgaven;
  const maandenPos  = maandStats.filter(m => m.inkomen > m.uitgaven).length;

  // ── Stats per categorie ───────────────────────────────────────────────
  const catStats = useMemo(() => {
    const map = {};
    const basis = maandFilter ? filtered : externe;
    basis.filter(t => t.bedrag < 0 && t.categorie !== "familie").forEach(t => {
      if (!map[t.categorie]) map[t.categorie] = { cat: t.categorie, totaal: 0, count: 0, merchants: {} };
      map[t.categorie].totaal += Math.abs(t.bedrag);
      map[t.categorie].count++;
      const m = t.merchant || "Onbekend";
      map[t.categorie].merchants[m] = (map[t.categorie].merchants[m] || 0) + Math.abs(t.bedrag);
    });
    return Object.values(map).sort((a, b) => b.totaal - a.totaal);
  }, [externe, filtered, maandFilter]);

  const totalUitgaven = catStats.reduce((s, c) => s + c.totaal, 0);

  // ── Savings Simulator berekening ──────────────────────────────────────
  const simStats = useMemo(() => {
    const reducible = catStats.filter(c => CATEGORIES[c.cat]?.reducible);
    const perMaand = reducible.map(c => ({
      cat: c.cat,
      avgPerMaand: c.totaal / aantalMaanden,
      maxReduc: CATEGORIES[c.cat]?.maxReduc || 50,
      slider: reducSliders[c.cat] || 0,
    }));
    const huidigeSparing  = gemSaldo;
    const extraBesparing  = perMaand.reduce((s, r) => s + (r.avgPerMaand * r.slider / 100), 0);
    const gesimuleerdSaldo = huidigeSparing + extraBesparing;
    return { reducible: perMaand, huidigeSparing, extraBesparing, gesimuleerdSaldo };
  }, [catStats, aantalMaanden, gemSaldo, reducSliders]);

  // ── Verwijder alle data ───────────────────────────────────────────────
  function resetData() {
    if (!confirm("Alle transacties verwijderen?")) return;
    setTransactions([]); setCatOverrides({}); setMaandFilter(null);
    setCatFilter(null); setZoekterm(""); setSelectedMaand(null);
  }

  // ── Render ────────────────────────────────────────────────────────────
  const noData = transactions.length === 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* ── Header ── */}
      <header style={{ background: `linear-gradient(135deg, ${C.teal} 0%, ${C.teal2} 60%, ${C.teal} 100%)`, borderBottom: `3px solid ${C.gold}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, background: C.gold, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: C.teal, letterSpacing: 1, flexShrink: 0 }}>MF</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.white, letterSpacing: ".2px" }}>Muzad Finance</div>
            <div style={{ fontSize: 11, color: C.gold2 }}>Family Buytaert — privé financieel overzicht</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {!noData && <span style={{ fontSize: 11, color: "#7AAAB4" }}>{allTx.length} transacties · {maanden.length} maanden</span>}
            {!noData && (
              <button onClick={resetData} style={{ padding: "5px 10px", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, color: "#fff", fontSize: 11, cursor: "pointer" }}>
                ✕ Reset
              </button>
            )}
          </div>
        </div>

        {/* Nav tabs */}
        {!noData && (
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", display: "flex", gap: 2 }}>
            {[
              { key: "overzicht",    label: "Overzicht" },
              { key: "transacties",  label: "Transacties" },
              { key: "categorieen",  label: "Categorieën" },
              { key: "sparen",       label: "Spaar Simulator" },
            ].map(t => (
              <button key={t.key} onClick={() => setView(t.key)}
                style={{ padding: "7px 16px", border: "none", borderBottom: view === t.key ? `2px solid ${C.gold}` : "2px solid transparent",
                  background: "transparent", color: view === t.key ? C.gold2 : "rgba(255,255,255,.65)",
                  fontFamily: "inherit", fontSize: 13, fontWeight: view === t.key ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* ── LEGE STAAT ── */}
        {noData && (
          <div style={{ maxWidth: 560, margin: "40px auto" }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 32 }}>💳</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: C.teal, marginTop: 8 }}>Welkom bij Muzad Finance</h1>
              <p style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>
                Upload je bankuittreksels (ING CSV-formaat) om te starten.<br />
                Je gegevens worden enkel lokaal opgeslagen — nooit naar een server gestuurd.
              </p>
            </div>
            <UploadZone onFiles={handleFiles} />
            <div style={{ marginTop: 20, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 10 }}>Hoe exporteer je het CSV-bestand in ING?</div>
              <ol style={{ paddingLeft: 16, fontSize: 12, color: C.muted, lineHeight: 1.8 }}>
                <li>Ga naar <b>mijnING</b> → Rekeningen → Kies rekening</li>
                <li>Klik op <b>Exporteer</b> → CSV</li>
                <li>Selecteer de gewenste periode</li>
                <li>Upload het bestand hierboven</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── OVERZICHT ── */}
        {!noData && view === "overzicht" && (
          <ViewOverzicht
            gemInkomen={gemInkomen} gemUitgaven={gemUitgaven} gemSaldo={gemSaldo}
            maandenPos={maandenPos} aantalMaanden={aantalMaanden}
            maandStats={maandStats} catStats={catStats} totalUitgaven={totalUitgaven}
            accounts={accounts} allTx={allTx}
            selectedMaand={selectedMaand} setSelectedMaand={setSelectedMaand}
            maandFilter={maandFilter} setMaandFilter={setMaandFilter}
            onUploadMore={handleFiles}
          />
        )}

        {/* ── TRANSACTIES ── */}
        {!noData && view === "transacties" && (
          <ViewTransacties
            filtered={filtered} maanden={maanden} accounts={accounts}
            maandFilter={maandFilter} setMaandFilter={setMaandFilter}
            catFilter={catFilter} setCatFilter={setCatFilter}
            rekeningFilter={rekeningFilter} setRekeningFilter={setRekeningFilter}
            zoekterm={zoekterm} setZoekterm={setZoekterm}
            editCat={editCat} setEditCat={setEditCat}
            catOverrides={catOverrides} setCatOverrides={setCatOverrides}
          />
        )}

        {/* ── CATEGORIEËN ── */}
        {!noData && view === "categorieen" && (
          <ViewCategorien
            catStats={catStats} totalUitgaven={totalUitgaven}
            aantalMaanden={aantalMaanden} maandFilter={maandFilter}
            setMaandFilter={setMaandFilter} maanden={maanden}
            catFilter={catFilter} setCatFilter={setCatFilter}
            setView={setView}
          />
        )}

        {/* ── SPAREN ── */}
        {!noData && view === "sparen" && (
          <ViewSparen
            gemInkomen={gemInkomen} gemUitgaven={gemUitgaven} gemSaldo={gemSaldo}
            savingsGoal={savingsGoal} setSavingsGoal={setSavingsGoal}
            simStats={simStats} reducSliders={reducSliders} setReducSliders={setReducSliders}
            aantalMaanden={aantalMaanden}
          />
        )}

      </main>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: OVERZICHT
// ══════════════════════════════════════════════════════════════════════════
function ViewOverzicht({ gemInkomen, gemUitgaven, gemSaldo, maandenPos, aantalMaanden,
  maandStats, catStats, totalUitgaven, accounts, allTx,
  selectedMaand, setSelectedMaand, maandFilter, setMaandFilter, onUploadMore }) {

  const maxCat = catStats[0]?.totaal || 1;
  const top5   = catStats.slice(0, 6);
  const recentTx = [...allTx].sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 8);

  const saldoColor = gemSaldo >= 0 ? "#0a7c5c" : "#C62828";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KPICard label="Gem. inkomen/maand"  icon="💰" value={fmt(gemInkomen)}  color="#0a7c5c" sub={`over ${aantalMaanden} maand${aantalMaanden !== 1 ? "en" : ""}`} />
        <KPICard label="Gem. uitgaven/maand" icon="💸" value={fmt(gemUitgaven)} color={C.teal}   sub="excl. interne transfers" />
        <KPICard label="Gem. saldo/maand"    icon="📊" value={fmt(gemSaldo)}    color={saldoColor} sub={gemSaldo < 0 ? "⚠ meer uit dan in" : "positief saldo"} />
        <KPICard label="Maanden positief"    icon="✅" value={`${maandenPos}/${aantalMaanden}`} color="#0277BD" sub="inkomen > uitgaven" />
      </div>

      {/* Grafiek + top categorieën */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>

        {/* Maandgrafiek */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>Maandoverzicht</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Klik op een maand om in te zoomen</div>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: C.muted }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#34a37e", borderRadius: 2, marginRight: 4 }} />Inkomen</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.teal2, borderRadius: 2, marginRight: 4 }} />Uitgaven</span>
            </div>
          </div>
          {maandStats.length > 0
            ? <MaandGrafiek maanden={maandStats} selected={maandFilter} onSelect={m => { setMaandFilter(m); setSelectedMaand(m); }} />
            : <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 40 }}>Nog geen data</div>
          }
          {maandFilter && (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.teal, fontWeight: 600 }}>Gefilterd: {maandFilter}</span>
              <button onClick={() => setMaandFilter(null)} style={{ fontSize: 10, padding: "2px 8px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "#fff", color: C.muted }}>✕ Wis filter</button>
            </div>
          )}
        </div>

        {/* Top categorieën */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Top uitgavencategorieën</div>
          {top5.length === 0 && <div style={{ color: C.muted, fontSize: 12 }}>Geen data</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {top5.map(cs => {
              const cat = CATEGORIES[cs.cat] || CATEGORIES.overige;
              return (
                <div key={cs.cat}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: C.text }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: cat.color }}>{fmt(cs.totaal / aantalMaanden)}<span style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>/mnd</span></span>
                  </div>
                  <MiniBar value={cs.totaal} max={maxCat} color={cat.color} />
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 11, color: C.muted, display: "flex", justifyContent: "space-between" }}>
            <span>Totaal uitgaven</span>
            <span style={{ fontWeight: 700, color: C.teal }}>{fmt(totalUitgaven / aantalMaanden)}/mnd</span>
          </div>
        </div>
      </div>

      {/* Rekeningen + recente transacties */}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>

        {/* Rekeningen */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Ingeladen rekeningen</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(accounts).map(([iban, acc]) => {
              const txCount = allTx.filter(t => t.rekening === iban).length;
              return (
                <div key={iban} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f7fbfc", borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.kleur, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.label}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{txCount} transacties</div>
                  </div>
                </div>
              );
            })}
          </div>
          <label style={{ display: "block", marginTop: 14 }}>
            <div style={{ fontSize: 11, color: C.teal, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: ".3px" }}>Meer bestanden laden</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0fdf4", border: `1px solid #86efac`, borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#15803d", fontWeight: 600 }}>
              <input type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => onUploadMore(Array.from(e.target.files))} />
              ＋ CSV toevoegen
            </label>
          </label>
        </div>

        {/* Recente transacties */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Recente transacties</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentTx.map(tx => (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#f9fafb", border: `1px solid ${C.border}` }}>
                <div style={{ width: 34, fontSize: 16, textAlign: "center", flexShrink: 0 }}>{CATEGORIES[tx.categorie]?.icon || "❓"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.merchant || tx.tegenpartijNaam}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{tx.datum} · {DEFAULT_FAMILY_ACCOUNTS[tx.rekening]?.eigenaar || tx.rekening}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: tx.bedrag >= 0 ? "#0a7c5c" : C.teal, whiteSpace: "nowrap" }}>
                  {tx.bedrag >= 0 ? "+" : ""}{fmt(tx.bedrag)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: TRANSACTIES
// ══════════════════════════════════════════════════════════════════════════
function ViewTransacties({ filtered, maanden, accounts, maandFilter, setMaandFilter,
  catFilter, setCatFilter, rekeningFilter, setRekeningFilter,
  zoekterm, setZoekterm, editCat, setEditCat, catOverrides, setCatOverrides }) {

  const [page, setPage] = useState(0);
  const PER_PAGE = 50;
  const sorted = [...filtered].sort((a, b) => b.datum.localeCompare(a.datum));
  const paged  = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pages  = Math.ceil(sorted.length / PER_PAGE);

  const selectW = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.card, color: C.text, fontFamily: "inherit", cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Filters */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={zoekterm} onChange={e => { setZoekterm(e.target.value); setPage(0); }}
            placeholder="🔍 Zoek op merchant, beschrijving..." style={{ ...selectW, flex: "1 1 200px" }} />
          <select value={maandFilter || ""} onChange={e => { setMaandFilter(e.target.value || null); setPage(0); }} style={selectW}>
            <option value="">Alle maanden</option>
            {maanden.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={catFilter || ""} onChange={e => { setCatFilter(e.target.value || null); setPage(0); }} style={selectW}>
            <option value="">Alle categorieën</option>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select value={rekeningFilter || ""} onChange={e => { setRekeningFilter(e.target.value || null); setPage(0); }} style={selectW}>
            <option value="">Alle rekeningen</option>
            {Object.entries(accounts).map(([iban, acc]) => <option key={iban} value={iban}>{acc.label}</option>)}
          </select>
          {(zoekterm || maandFilter || catFilter || rekeningFilter) && (
            <button onClick={() => { setZoekterm(""); setMaandFilter(null); setCatFilter(null); setRekeningFilter(null); setPage(0); }}
              style={{ padding: "7px 12px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
              ✕ Wis alles
            </button>
          )}
          <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{filtered.length} resultaten</span>
        </div>
      </div>

      {/* Tabel */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px 120px 110px", gap: 0, padding: "8px 14px", background: "#f1f8f9", borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          <span>Datum</span><span>Merchant / Beschrijving</span><span>Rekening</span><span>Categorie</span><span style={{ textAlign: "right" }}>Bedrag</span>
        </div>
        {paged.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>Geen transacties gevonden</div>
        )}
        {paged.map((tx, i) => {
          const cat = CATEGORIES[tx.categorie] || CATEGORIES.overige;
          const acc = accounts[tx.rekening];
          const isEditing = editCat === tx.id;
          return (
            <div key={tx.id} style={{ display: "grid", gridTemplateColumns: "90px 1fr 140px 120px 110px", gap: 0, padding: "9px 14px", borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "#fff" : "#fbfcfd", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.muted }}>{tx.datum}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.merchant}</div>
                {tx.mededeling && <div style={{ fontSize: 10, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.mededeling}</div>}
              </div>
              <span style={{ fontSize: 10, color: C.muted }}>{acc?.eigenaar || "—"}</span>
              <div>
                {isEditing
                  ? <select autoFocus value={tx.categorie} onChange={e => { setCatOverrides(prev => ({ ...prev, [tx.id]: e.target.value })); setEditCat(null); }}
                      onBlur={() => setEditCat(null)}
                      style={{ fontSize: 10, border: `1px solid ${C.teal}`, borderRadius: 6, padding: "2px 4px", width: "100%" }}>
                      {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                    </select>
                  : <span onClick={() => setEditCat(tx.id)} title="Klik om categorie te wijzigen" style={{ cursor: "pointer" }}>
                      <CatBadge cat={tx.categorie} />
                    </span>
                }
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: tx.bedrag >= 0 ? "#0a7c5c" : C.teal, textAlign: "right" }}>
                {tx.bedrag >= 0 ? "+" : ""}{fmt(tx.bedrag)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Paginering */}
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, background: C.card }}>← Vorige</button>
          <span style={{ padding: "6px 14px", fontSize: 12, color: C.muted }}>Pagina {page + 1} / {pages}</span>
          <button disabled={page === pages - 1} onClick={() => setPage(p => p + 1)}
            style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, background: C.card }}>Volgende →</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: CATEGORIEËN
// ══════════════════════════════════════════════════════════════════════════
function ViewCategorien({ catStats, totalUitgaven, aantalMaanden, maandFilter, setMaandFilter,
  maanden, catFilter, setCatFilter, setView }) {

  const [expanded, setExpanded] = useState(null);
  const donutSeg = catStats.slice(0, 8).map(c => ({ value: c.totaal, color: CATEGORIES[c.cat]?.color || "#9E9E9E" }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Filter balk */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
        <select value={maandFilter || ""} onChange={e => setMaandFilter(e.target.value || null)}
          style={{ padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.card, fontFamily: "inherit" }}>
          <option value="">Alle maanden (gemiddeld/maand)</option>
          {maanden.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {maandFilter && <button onClick={() => setMaandFilter(null)} style={{ padding: "5px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, cursor: "pointer" }}>✕ Alle periodes</button>}
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
          {maandFilter ? `Totaal: ${fmt(totalUitgaven)}` : `Gem. totaal: ${fmt(totalUitgaven / aantalMaanden)}/mnd`}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>

        {/* Donut + legenda */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <DonutChart segments={donutSeg} size={160} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {catStats.slice(0, 8).map(cs => {
              const cat = CATEGORIES[cs.cat] || CATEGORIES.overige;
              const p = pct(cs.totaal, totalUitgaven);
              return (
                <div key={cs.cat} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  onClick={() => { setCatFilter(cs.cat); setView("transacties"); }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: cat.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{cat.icon} {cat.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: cat.color }}>{p}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail bars */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {catStats.map(cs => {
            const cat = CATEGORIES[cs.cat] || CATEGORIES.overige;
            const avgMnd = cs.totaal / aantalMaanden;
            const isExp = expanded === cs.cat;
            const topMerchants = Object.entries(cs.merchants)
              .sort((a, b) => b[1] - a[1]).slice(0, 5);

            return (
              <div key={cs.cat} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                  onClick={() => setExpanded(isExp ? null : cs.cat)}>
                  <span style={{ fontSize: 20 }}>{cat.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cat.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>
                        {maandFilter ? fmt(cs.totaal) : <>{fmt(avgMnd)}<span style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>/mnd</span></>}
                      </span>
                    </div>
                    <MiniBar value={cs.totaal} max={catStats[0]?.totaal || 1} color={cat.color} />
                  </div>
                  <div style={{ textAlign: "right", minWidth: 60 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>{pct(cs.totaal, totalUitgaven)}% van totaal</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{cs.count} tx</div>
                  </div>
                  <span style={{ color: C.muted, fontSize: 12 }}>{isExp ? "▲" : "▼"}</span>
                </div>
                {isExp && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", background: "#f9fbfc" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Top merchants</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {topMerchants.map(([name, amt]) => (
                        <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: C.text, marginBottom: 2 }}>{name}</div>
                            <MiniBar value={amt} max={topMerchants[0][1]} color={cat.color} height={5} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: cat.color, minWidth: 70, textAlign: "right" }}>{fmt(amt)}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setCatFilter(cs.cat); setView("transacties"); }}
                      style={{ marginTop: 10, padding: "5px 12px", background: cat.bg, border: `1px solid ${cat.color}30`, borderRadius: 8, fontSize: 11, color: cat.color, cursor: "pointer", fontWeight: 600 }}>
                      Alle transacties bekijken →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: SPAAR SIMULATOR
// ══════════════════════════════════════════════════════════════════════════
function ViewSparen({ gemInkomen, gemUitgaven, gemSaldo, savingsGoal, setSavingsGoal,
  simStats, reducSliders, setReducSliders, aantalMaanden }) {

  const { reducible, huidigeSparing, extraBesparing, gesimuleerdSaldo } = simStats;
  const goal = parseFloat(savingsGoal) || 0;
  const gap  = goal - huidigeSparing;
  const metSim = gesimuleerdSaldo;
  const simGap = goal - metSim;
  const goalBereikt = metSim >= goal;
  const progressPct = goal > 0 ? Math.min(100, Math.round((metSim / goal) * 100)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Intro + goal input */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, marginBottom: 6 }}>🐷 Spaar Simulator</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Geef je gewenste maandelijkse sparing in. De simulator toont je welke uitgavencategorieën je
          kunt verminderen en met hoeveel — totdat het doel bereikt is.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", display: "block", marginBottom: 6 }}>Spaardoel per maand (€)</label>
            <input type="number" value={savingsGoal} onChange={e => setSavingsGoal(e.target.value)} min="0" step="50"
              style={{ padding: "10px 14px", fontSize: 20, fontWeight: 700, color: C.teal, border: `2px solid ${C.teal}`, borderRadius: 10, width: 160, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[200, 300, 500, 750, 1000].map(v => (
              <button key={v} onClick={() => setSavingsGoal(v)}
                style={{ padding: "7px 12px", border: `1px solid ${savingsGoal == v ? C.teal : C.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer", background: savingsGoal == v ? C.teal : C.card, color: savingsGoal == v ? "#fff" : C.text }}>
                €{v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Situatie */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KPICard label="Gem. inkomen" icon="💰" value={fmt(gemInkomen)} color="#0a7c5c" sub={`over ${aantalMaanden} maand${aantalMaanden !== 1 ? "en" : ""}`} />
        <KPICard label="Gem. uitgaven" icon="💸" value={fmt(gemUitgaven)} color={C.teal} />
        <KPICard label="Huidig saldo" icon="📊" value={fmt(huidigeSparing)} color={huidigeSparing >= 0 ? "#0a7c5c" : "#C62828"} sub={huidigeSparing < 0 ? "⚠ negatief" : "gemiddeld"} />
        <KPICard label="Spaardoel" icon="🎯" value={fmt(goal)} color="#6A1B9A" />
      </div>

      {/* Voortgangsbalk */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>
            {goalBereikt ? "✅ Spaardoel bereikt!" : `📍 Gesimuleerd saldo: ${fmt(metSim)} / ${fmt(goal)}`}
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: goalBereikt ? "#0a7c5c" : "#C62828" }}>
            {progressPct}%
          </span>
        </div>
        <div style={{ background: "#e9eeef", borderRadius: 8, height: 16, overflow: "hidden" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: goalBereikt ? "#0a7c5c" : C.teal, borderRadius: 8, transition: "width .4s" }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {goalBereikt
            ? `Je spaart ${fmt(metSim - goal)} meer dan je doel. Goed bezig!`
            : simGap > 0
              ? `Nog ${fmt(simGap)} extra te besparen via de sliders hieronder.`
              : `Huidig saldo dekt al het doel (${fmt(huidigeSparing)} > ${fmt(goal)}).`}
        </div>
        {extraBesparing > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#0a7c5c", fontWeight: 600 }}>
            + {fmt(extraBesparing)} extra besparing via geselecteerde aanpassingen
          </div>
        )}
      </div>

      {/* Reductiesliders */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>Aanpasbare uitgavencategorieën</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
          Schuif de sliders om te simuleren wat een vermindering doet voor je maandbudget.
          Vaste kosten (huur, energie, gezondheid) zijn niet aanpasbaar.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {reducible.map(r => {
            const cat = CATEGORIES[r.cat] || CATEGORIES.overige;
            const saving = r.avgPerMaand * r.slider / 100;
            const newAmt = r.avgPerMaand - saving;
            return (
              <div key={r.cat} style={{ padding: "14px 16px", background: cat.bg, borderRadius: 10, border: `1px solid ${cat.color}22` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{cat.icon} {cat.label}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      Huidig: {fmt(r.avgPerMaand)}/mnd · Max reduceerbaar: {r.maxReduc}%
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: r.slider > 0 ? "#0a7c5c" : C.muted }}>
                      {fmt(newAmt)}<span style={{ fontSize: 10, fontWeight: 400 }}>/mnd</span>
                    </div>
                    {r.slider > 0 && <div style={{ fontSize: 11, color: "#0a7c5c" }}>− {fmt(saving)}</div>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 10, color: C.muted, minWidth: 20 }}>0%</span>
                  <input type="range" min={0} max={r.maxReduc} value={r.slider}
                    onChange={e => setReducSliders(prev => ({ ...prev, [r.cat]: parseInt(e.target.value) }))}
                    style={{ flex: 1, accentColor: cat.color, cursor: "pointer" }} />
                  <span style={{ fontSize: 10, color: C.muted, minWidth: 30 }}>{r.maxReduc}%</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cat.color, minWidth: 40, textAlign: "right" }}>{r.slider}%</span>
                </div>
              </div>
            );
          })}
          {reducible.length === 0 && (
            <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 20 }}>
              Geen reduceerbare categorieën gevonden in de data.
            </div>
          )}
        </div>
        {reducible.some(r => r.slider > 0) && (
          <button onClick={() => setReducSliders({})}
            style={{ marginTop: 14, padding: "7px 14px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer", background: "#fff", color: C.muted }}>
            ↩ Reset alle sliders
          </button>
        )}
      </div>

      {/* Tips */}
      <div style={{ background: "#fef9ee", border: `1px solid ${C.gold}44`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 12 }}>💡 Concrete bespartips op basis van je uitgaven</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { icon: "🍽️", tip: "Restaurant & café", detail: "Plan 2 momenten minder per maand uit eten. Gemiddelde besparing: €40–80/mnd." },
            { icon: "🛒", tip: "Boodschappen", detail: "Weekmenu plannen + vaste winkellijst vermijdt impulsaankopen. Besparing: 15–20%." },
            { icon: "🛍️", tip: "Shopping", detail: "Wachtlijst van 48u voor niet-essentiële aankopen. Veel verdwijnt vanzelf." },
            { icon: "🏧", tip: "Kleine kaartbetalingen", detail: "Kaartbetalingen < €10 tellen snel op. Bijhouden geeft bewustzijn en remming." },
          ].map((t, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 14, marginBottom: 4 }}>{t.icon} <strong style={{ fontSize: 12, color: C.teal }}>{t.tip}</strong></div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{t.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
