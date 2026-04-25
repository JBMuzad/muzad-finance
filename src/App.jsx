import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseCSV } from "./parseCSV.js";
import { CATEGORIES, DEFAULT_FAMILY_ACCOUNTS, processTxList, detectAccounts } from "./categorize.js";
import { dbLoadTransactions, dbUpsertTransactions, dbUpdateCategorie, dbLoadAllSettings, dbSaveSetting } from "./db.js";
import ViewPersonen from "./ViewPersonen.jsx";

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
const maandLabel = m => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return new Date(parseInt(y), parseInt(mo) - 1, 1)
    .toLocaleDateString("nl-BE", { month: "short", year: "2-digit" });
};
function pct(part, total) { return total === 0 ? 0 : Math.round((part / total) * 100); }

// ── Persistence ───────────────────────────────────────────────────────────
// details-veld is ~300 tekens per tx en niet meer nodig na verwerking → strippen
const LS_KEY     = "muzad_finance_v3";
const LS_KEY_OLD = "muzad_finance_v2";

function hasUsefulData(parsed) {
  if (!parsed) return false;
  return (parsed.transactions?.length > 0)
    || Object.keys(parsed.catOverrides || {}).length > 0
    || Object.keys(parsed.learnedRules?.merchant || {}).length > 0
    || Object.keys(parsed.learnedRules?.iban || {}).length > 0
    || Object.keys(parsed.customCategories || {}).length > 0;
}

function loadState() {
  try {
    const v3raw = localStorage.getItem(LS_KEY);
    const v3    = v3raw ? JSON.parse(v3raw) : null;

    const v2raw = localStorage.getItem(LS_KEY_OLD);
    const v2    = v2raw ? JSON.parse(v2raw) : null;

    // Gebruik v2 als v3 leeg is maar v2 nuttige data heeft
    const source = (hasUsefulData(v3) ? v3 : null)
                || (hasUsefulData(v2) ? v2 : null)
                || v3
                || {};

    // Strip details-veld als die er nog in zit (v2-erfenis)
    if (source.transactions) {
      source.transactions = source.transactions.map(({ details, ...rest }) => rest);
    }

    // Altijd opslaan als v3 en v2 opruimen
    try { localStorage.setItem(LS_KEY, JSON.stringify(source)); } catch {}
    try { if (v2raw) localStorage.removeItem(LS_KEY_OLD); } catch {}

    return source;
  } catch { return {}; }
}

function lsSize() {
  try { return new Blob([localStorage.getItem(LS_KEY) || ""]).size; } catch { return 0; }
}

function saveState(s) {
  try {
    // Strip details-veld: merchant is al geëxtraheerd, details niet meer nodig
    const lean = {
      ...s,
      transactions: (s.transactions || []).map(({ details, ...rest }) => rest),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(lean));
  } catch {
    // Fallback: sla alles op behalve transacties (instellingen + regels bewaren)
    try {
      const { transactions, ...rest } = s;
      localStorage.setItem(LS_KEY, JSON.stringify(rest));
      console.warn("Muzad Finance: transacties te groot voor localStorage, enkel instellingen bewaard.");
    } catch {}
  }
}

// ── MiniBar ───────────────────────────────────────────────────────────────
function MiniBar({ value, max, color, height = 8 }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#e9eeef", borderRadius: 4, height, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
    </div>
  );
}

// ── Maandgrafiek ─────────────────────────────────────────────────────────
function MaandGrafiek({ maanden, selected, onSelect }) {
  const maxVal = Math.max(...maanden.map(m => Math.max(m.inkomen, m.uitgaven)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 130, padding: "0 4px" }}>
      {maanden.map(m => {
        const incH = Math.round((m.inkomen / maxVal) * 110);
        const uitH = Math.round((m.uitgaven / maxVal) * 110);
        const isSel = selected === m.maand;
        return (
          <div key={m.maand} onClick={() => onSelect(isSel ? null : m.maand)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", opacity: selected && !isSel ? 0.45 : 1, transition: "opacity .2s" }}>
            <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 110, gap: 2 }}>
              <div style={{ height: incH, background: isSel ? "#0a7c5c" : "#34a37e", borderRadius: "3px 3px 0 0", minHeight: m.inkomen > 0 ? 2 : 0 }} />
              <div style={{ height: uitH, background: isSel ? C.teal : C.teal2, borderRadius: "3px 3px 0 0", minHeight: m.uitgaven > 0 ? 2 : 0 }} />
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
  const r = 42, cx = 50, cy = 50, stroke = 14, circ = 2 * Math.PI * r;
  let offset = 0;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e9eeef" strokeWidth={stroke} />
      {segments.map((seg, i) => {
        const dash = (seg.value / total) * circ;
        const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}
          style={{ transformOrigin: "50% 50%", transform: "rotate(-90deg)" }} />;
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
function CatBadge({ cat, allCats }) {
  const cats = allCats || CATEGORIES;
  const c = cats[cat] || CATEGORIES.overige;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600,
      padding: "2px 7px", borderRadius: 10, background: c.bg || "#f5f5f5", color: c.color, whiteSpace: "nowrap" }}>
      {c.icon} {c.label}
    </span>
  );
}

// ── FilterBar ─────────────────────────────────────────────────────────────
function FilterBar({ maanden, filterVan, filterTot, setFilterVan, setFilterTot }) {
  const isFiltered = filterVan || filterTot;

  function clearFilter() { setFilterVan(null); setFilterTot(null); }

  function setPreset(nMnd) {
    if (nMnd === null) { clearFilter(); return; }
    const d = new Date();
    d.setMonth(d.getMonth() - nMnd + 1);
    const van = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setFilterVan(van);
    setFilterTot(null);
  }

  function setThisYear() {
    setFilterVan(`${new Date().getFullYear()}-01`);
    setFilterTot(null);
  }

  function setLastYear() {
    const y = new Date().getFullYear() - 1;
    setFilterVan(`${y}-01`);
    setFilterTot(`${y}-12`);
  }

  const sw = { padding: "5px 8px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, background: C.card, color: C.text, fontFamily: "inherit", cursor: "pointer" };

  function PresetBtn({ label, onClick }) {
    return (
      <button onClick={onClick} style={{ ...sw, color: C.muted, padding: "5px 10px" }}>{label}</button>
    );
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginRight: 2, whiteSpace: "nowrap" }}>Periode:</span>
      <button onClick={() => clearFilter()} style={{ ...sw, ...((!isFiltered) ? { background: C.teal, color: "#fff", border: `1px solid ${C.teal}`, fontWeight: 600 } : {}) }}>Alles</button>
      <PresetBtn label="3 mnd" onClick={() => setPreset(3)} />
      <PresetBtn label="6 mnd" onClick={() => setPreset(6)} />
      <PresetBtn label="Dit jaar" onClick={setThisYear} />
      <PresetBtn label="Vorig jaar" onClick={setLastYear} />
      <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px", flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>Van:</span>
      <select value={filterVan || ""} onChange={e => setFilterVan(e.target.value || null)} style={sw}>
        <option value="">Begin</option>
        {maanden.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>Tot:</span>
      <select value={filterTot || ""} onChange={e => setFilterTot(e.target.value || null)} style={sw}>
        <option value="">Heden</option>
        {[...maanden].reverse().map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      {isFiltered && (
        <>
          <button onClick={clearFilter} style={{ ...sw, background: "#fee2e2", color: "#b91c1c", border: "none", fontWeight: 600 }}>✕ Wis</button>
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.teal, fontWeight: 600, whiteSpace: "nowrap" }}>
            {filterVan || "begin"} → {filterTot || "nu"}
          </span>
        </>
      )}
    </div>
  );
}

// ── UploadZone ────────────────────────────────────────────────────────────
function UploadZone({ onFiles, compact = false }) {
  const [over, setOver] = useState(false);
  const handle = files => { if (files.length) onFiles(Array.from(files)); };
  if (compact) {
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "#f0fdf4", border: `1px solid #86efac`, borderRadius: 8, cursor: "pointer", fontSize: 12, color: "#15803d", fontWeight: 600 }}>
        <input type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => handle(e.target.files)} />
        ＋ CSV toevoegen
      </label>
    );
  }
  return (
    <label onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, border: `2px dashed ${over ? C.gold : C.teal3}`, borderRadius: 16, padding: "40px 20px",
        cursor: "pointer", transition: "all .2s", background: over ? "#fef9ee" : "#f7fbfc" }}>
      <input type="file" accept=".csv" multiple style={{ display: "none" }} onChange={e => handle(e.target.files)} />
      <span style={{ fontSize: 40 }}>📂</span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.teal }}>Sleep CSV-bestanden hierheen</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>of klik om te selecteren · meerdere bestanden tegelijk</div>
      </div>
      <div style={{ fontSize: 11, color: C.muted, background: "#e8f2f4", padding: "4px 12px", borderRadius: 8 }}>
        ING-formaat (puntkomma-gescheiden)
      </div>
    </label>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// HOOFD APP
// ══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [loading,           setLoading]            = useState(true);
  const [transactions,      setTransactions]        = useState([]);
  const [catOverrides,      setCatOverrides]        = useState({});
  const [learnedRules,      setLearnedRules]        = useState({ merchant: {}, iban: {} });
  const [customCategories,  setCustomCategories]    = useState({});
  const [savingsGoal,       setSavingsGoal]         = useState(500);
  const [view,              setView]               = useState("overzicht");
  const [filterVan,         setFilterVan]          = useState(null);
  const [filterTot,         setFilterTot]          = useState(null);
  const [catFilter,         setCatFilter]          = useState(null);
  const [rekeningFilter,    setRekeningFilter]     = useState(null);
  const [zoekterm,          setZoekterm]           = useState("");
  const [editCat,           setEditCat]            = useState(null);
  const [reducSliders,      setReducSliders]       = useState({});

  // ── Laden uit Supabase bij opstart ───────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const [txRows, settings] = await Promise.all([
          dbLoadTransactions(),
          dbLoadAllSettings(),
        ]);
        setTransactions(txRows.map(r => ({
          id: r.id, volgnummer: r.volgnummer, datum: r.datum, maand: r.maand,
          bedrag: r.bedrag, rekening: r.rekening, type: r.type,
          tegenpartij: r.tegenpartij, tegenpartijNaam: r.tegenpartij_naam,
          mededeling: r.mededeling, categorie: r.categorie, merchant: r.merchant,
        })));
        if (settings.catOverrides)        setCatOverrides(settings.catOverrides);
        if (settings.learnedRules)        setLearnedRules(settings.learnedRules);
        if (settings.customCategories)    setCustomCategories(settings.customCategories);
        if (settings.savingsGoal != null) setSavingsGoal(settings.savingsGoal);
      } catch (err) {
        console.error("Supabase laden mislukt, val terug op localStorage:", err);
        const stored = loadState();
        setTransactions(stored.transactions || []);
        setCatOverrides(stored.catOverrides || {});
        setLearnedRules(stored.learnedRules || { merchant: {}, iban: {} });
        setCustomCategories(stored.customCategories || {});
        setSavingsGoal(stored.savingsGoal || 500);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // ── Instellingen opslaan naar Supabase (debounced 1.5s) ─────────────
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      Promise.all([
        dbSaveSetting("catOverrides",     catOverrides),
        dbSaveSetting("learnedRules",     learnedRules),
        dbSaveSetting("customCategories", customCategories),
        dbSaveSetting("savingsGoal",      savingsGoal),
      ]).catch(err => console.error("Instellingen opslaan mislukt:", err));
    }, 1500);
  }, [catOverrides, learnedRules, customCategories, savingsGoal, loading]);

  // ── localStorage als snelle lokale backup ───────────────────────────
  useEffect(() => {
    if (!loading) {
      saveState({ transactions, catOverrides, learnedRules, customCategories, savingsGoal });
    }
  }, [transactions, catOverrides, learnedRules, customCategories, savingsGoal, loading]);

  // ── Alle categorieën (standaard + eigen) ────────────────────────────
  const allCategories = useMemo(() => ({ ...CATEGORIES, ...customCategories }), [customCategories]);

  // ── Family IBANs ─────────────────────────────────────────────────────
  const familyIBANs = useMemo(() => new Set(Object.keys(DEFAULT_FAMILY_ACCOUNTS)), []);

  // ── CSV inladen ──────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files) => {
    const newTxs = [];
    for (const file of files) {
      const text = await file.text();
      newTxs.push(...parseCSV(text));
    }
    if (!newTxs.length) return;
    setTransactions(prev => {
      const existing = new Set(prev.map(t => t.id));
      const toAdd = newTxs.filter(t => !existing.has(t.id));
      if (!toAdd.length) return prev;
      const merged = processTxList([...prev, ...toAdd], familyIBANs);
      // Sla alleen de nieuwe transacties op in Supabase (ignoreDuplicates beschermt bestaande)
      const newProcessed = merged.filter(t => !existing.has(t.id));
      dbUpsertTransactions(newProcessed).catch(err => console.error("Transacties opslaan mislukt:", err));
      return merged;
    });
    setView("overzicht");
  }, [familyIBANs]);

  // ── Categorie wijzigen + leereffect ──────────────────────────────────
  // Prioriteit: catOverrides > learnedRules.iban > learnedRules.merchant > built-in
  function handleCategoryChange(tx, newCat) {
    // 1. Override voor deze specifieke transactie
    setCatOverrides(prev => ({ ...prev, [tx.id]: newCat }));

    // 2. Leer: sla merchant + IBAN op → geldt voor toekomstige CSV uploads
    setLearnedRules(prev => {
      const updated = { ...prev, merchant: { ...prev.merchant }, iban: { ...prev.iban } };
      if (tx.merchant && tx.merchant !== "Onbekend" && tx.merchant.length > 3) {
        updated.merchant[tx.merchant.toLowerCase()] = newCat;
      }
      if (tx.tegenpartij) {
        updated.iban[tx.tegenpartij] = newCat;
      }
      return updated;
    });

    // 3. Pas ook toe op ALLE bestaande transacties met dezelfde merchant/IBAN
    //    (zodat niet elke transactie apart moet worden aangepast)
    setTransactions(prev => prev.map(t => {
      if (t.id === tx.id) return t; // handled by catOverrides
      const sameIban = tx.tegenpartij && t.tegenpartij === tx.tegenpartij;
      const sameMerchant = tx.merchant && tx.merchant !== "Onbekend"
        && t.merchant?.toLowerCase() === tx.merchant.toLowerCase();
      if (sameIban || sameMerchant) {
        return { ...t, categorie: newCat };
      }
      return t;
    }));

    // 4. Sla categorie op in Supabase voor alle overeenkomende transacties
    const matchIds = [tx.id, ...transactions
      .filter(t => t.id !== tx.id && (
        (tx.tegenpartij && t.tegenpartij === tx.tegenpartij) ||
        (tx.merchant && tx.merchant !== "Onbekend" &&
          t.merchant?.toLowerCase() === tx.merchant.toLowerCase())
      ))
      .map(t => t.id),
    ];
    dbUpdateCategorie(matchIds, newCat).catch(err => console.error("Categorie opslaan mislukt:", err));

    setEditCat(null);
  }

  // ── Geleerde regel verwijderen ────────────────────────────────────────
  function deleteLearnedMerchant(key) {
    setLearnedRules(prev => {
      const m = { ...prev.merchant };
      delete m[key];
      return { ...prev, merchant: m };
    });
  }
  function deleteLearnedIban(key) {
    setLearnedRules(prev => {
      const ib = { ...prev.iban };
      delete ib[key];
      return { ...prev, iban: ib };
    });
  }

  // ── Custom categorie toevoegen/verwijderen ────────────────────────────
  function addCustomCategory(label, icon, color) {
    const key = `custom_${Date.now()}`;
    setCustomCategories(prev => ({
      ...prev,
      [key]: { label, icon, color, bg: color + "22", reducible: true, maxReduc: 50 },
    }));
  }
  function deleteCustomCategory(key) {
    setCustomCategories(prev => { const c = { ...prev }; delete c[key]; return c; });
  }

  // ── Transacties met alle regels toegepast ─────────────────────────────
  const allTx = useMemo(() =>
    transactions.map(t => {
      const override = catOverrides[t.id];
      const byIban   = t.tegenpartij ? learnedRules.iban?.[t.tegenpartij] : null;
      const byMerch  = t.merchant ? learnedRules.merchant?.[t.merchant?.toLowerCase()] : null;
      return { ...t, categorie: override || byIban || byMerch || t.categorie };
    }),
    [transactions, catOverrides, learnedRules]
  );

  // ── Rekeningen ────────────────────────────────────────────────────────
  const accounts = useMemo(() => detectAccounts(allTx), [allTx]);
  const maanden  = useMemo(() => [...new Set(allTx.map(t => t.maand))].sort(), [allTx]);

  // ── Periodefilter helper ──────────────────────────────────────────────
  const inPeriode = useCallback((m) =>
    (!filterVan || m >= filterVan) && (!filterTot || m <= filterTot),
    [filterVan, filterTot]);

  // ── Gefilterde transacties ─────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = zoekterm.toLowerCase();
    return allTx.filter(t =>
      inPeriode(t.maand) &&
      (!catFilter || t.categorie === catFilter) &&
      (!rekeningFilter || t.rekening === rekeningFilter) &&
      (!needle || `${t.merchant} ${t.tegenpartijNaam} ${t.mededeling}`.toLowerCase().includes(needle))
    );
  }, [allTx, inPeriode, catFilter, rekeningFilter, zoekterm]);

  // ── Externe transacties (excl. intern, periode-gefilterd) ─────────────
  const externe = useMemo(() =>
    allTx.filter(t => t.categorie !== "familie" && inPeriode(t.maand)),
    [allTx, inPeriode]);

  // ── Stats per maand ────────────────────────────────────────────────────
  const maandStats = useMemo(() => {
    const map = {};
    externe.forEach(t => {
      if (!map[t.maand]) map[t.maand] = { maand: t.maand, inkomen: 0, uitgaven: 0 };
      if (t.categorie === "inkomen") map[t.maand].inkomen += t.bedrag;
      else if (t.bedrag < 0) map[t.maand].uitgaven += Math.abs(t.bedrag);
    });
    return Object.values(map).sort((a, b) => a.maand.localeCompare(b.maand));
  }, [externe]);

  const aantalMaanden = Math.max(maandStats.length, 1);
  const gemInkomen    = maandStats.reduce((s, m) => s + m.inkomen, 0) / aantalMaanden;
  const gemUitgaven   = maandStats.reduce((s, m) => s + m.uitgaven, 0) / aantalMaanden;
  const gemSaldo      = gemInkomen - gemUitgaven;
  const maandenPos    = maandStats.filter(m => m.inkomen > m.uitgaven).length;

  // ── Stats per categorie ────────────────────────────────────────────────
  const catStats = useMemo(() => {
    const map = {};
    externe.filter(t => t.bedrag < 0 && t.categorie !== "familie").forEach(t => {
      if (!map[t.categorie]) map[t.categorie] = { cat: t.categorie, totaal: 0, count: 0, merchants: {} };
      map[t.categorie].totaal += Math.abs(t.bedrag);
      map[t.categorie].count++;
      const m = t.merchant || "Onbekend";
      map[t.categorie].merchants[m] = (map[t.categorie].merchants[m] || 0) + Math.abs(t.bedrag);
    });
    return Object.values(map).sort((a, b) => b.totaal - a.totaal);
  }, [externe]);

  const totalUitgaven = catStats.reduce((s, c) => s + c.totaal, 0);

  // ── Savings Simulator ─────────────────────────────────────────────────
  const simStats = useMemo(() => {
    const reducible = catStats.filter(c => allCategories[c.cat]?.reducible);
    const perMaand  = reducible.map(c => ({
      cat: c.cat, avgPerMaand: c.totaal / aantalMaanden,
      maxReduc: allCategories[c.cat]?.maxReduc || 50, slider: reducSliders[c.cat] || 0,
    }));
    const extraBesparing   = perMaand.reduce((s, r) => s + (r.avgPerMaand * r.slider / 100), 0);
    const gesimuleerdSaldo = gemSaldo + extraBesparing;
    return { reducible: perMaand, extraBesparing, gesimuleerdSaldo };
  }, [catStats, aantalMaanden, gemSaldo, reducSliders, allCategories]);

  // ── Leerstatistieken ──────────────────────────────────────────────────
  const learnedCount = Object.keys(learnedRules.merchant || {}).length + Object.keys(learnedRules.iban || {}).length;

  function resetData() {
    if (!confirm("Alle transacties verwijderen?")) return;
    setTransactions([]); setCatOverrides({}); setFilterVan(null); setFilterTot(null);
    setCatFilter(null); setZoekterm(""); setRekeningFilter(null);
  }

  function exportBackup() {
    const data = { transactions, catOverrides, learnedRules, customCategories, savingsGoal, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `muzad-finance-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.transactions && !data.catOverrides) { alert("Ongeldig backupbestand."); return; }
        if (!confirm(`Backup van ${data.exportedAt?.slice(0,10) || "onbekende datum"} herstellen?\nDit overschrijft je huidige data.`)) return;
        setTransactions(data.transactions || []);
        setCatOverrides(data.catOverrides || {});
        setLearnedRules(data.learnedRules || { merchant: {}, iban: {} });
        setCustomCategories(data.customCategories || {});
        setSavingsGoal(data.savingsGoal || 500);
        setView("overzicht");
      } catch { alert("Kon het bestand niet lezen."); }
    };
    reader.readAsText(file);
  }

  const noData = transactions.length === 0;
  const TABS = [
    { key: "overzicht",    label: "Overzicht" },
    { key: "transacties",  label: "Transacties" },
    { key: "categorieen",  label: "Categorieën" },
    { key: "analyse",      label: "Analyse" },
    { key: "personen",     label: "Personen" },
    { key: "sparen",       label: "Spaar Simulator" },
    { key: "instellingen", label: `Instellingen${learnedCount > 0 ? ` (${learnedCount})` : ""}` },
  ];

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 52 }}>💳</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.teal, marginTop: 14 }}>Muzad Finance</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Verbinding maken met database…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>

      {/* Header */}
      <header style={{ background: `linear-gradient(135deg, ${C.teal} 0%, ${C.teal2} 60%, ${C.teal} 100%)`, borderBottom: `3px solid ${C.gold}`, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 40, height: 40, background: C.gold, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: C.teal, letterSpacing: 1, flexShrink: 0 }}>MF</div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.white }}>Muzad Finance</div>
            <div style={{ fontSize: 11, color: C.gold2 }}>Family Buytaert — privé financieel overzicht</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {!noData && <span style={{ fontSize: 11, color: "#7AAAB4" }}>{allTx.length} transacties · {maanden.length} maanden · 💾 {Math.round(lsSize()/1024)}KB bewaard</span>}
            {!noData && <button onClick={exportBackup} style={{ padding: "5px 10px", background: "rgba(201,146,42,.25)", border: "1px solid rgba(201,146,42,.5)", borderRadius: 8, color: C.gold2, fontSize: 11, cursor: "pointer" }}>↓ Backup</button>}
            {!noData && <button onClick={resetData} style={{ padding: "5px 10px", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 8, color: "#fff", fontSize: 11, cursor: "pointer" }}>✕ Reset</button>}
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px", display: "flex", gap: 2 }}>
          {(noData ? [TABS[TABS.length - 1]] : TABS).map(t => (
            <button key={t.key} onClick={() => setView(t.key)}
              style={{ padding: "7px 16px", border: "none", borderBottom: view === t.key ? `2px solid ${C.gold}` : "2px solid transparent",
                background: "transparent", color: view === t.key ? C.gold2 : "rgba(255,255,255,.65)",
                fontFamily: "inherit", fontSize: 13, fontWeight: view === t.key ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap" }}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 20px" }}>

        {/* Lege staat */}
        {noData && (
          <div style={{ maxWidth: 560, margin: "40px auto" }}>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 32 }}>💳</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: C.teal, marginTop: 8 }}>Welkom bij Muzad Finance</h1>
              <p style={{ color: C.muted, fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                Upload je bankuittreksels (ING CSV-formaat) om te starten.<br />
                Je gegevens worden enkel lokaal opgeslagen.
              </p>
            </div>
            <UploadZone onFiles={handleFiles} />
          </div>
        )}

        {/* Globale periodefilter — zichtbaar op alle tabs behalve instellingen */}
        {!noData && view !== "instellingen" && maanden.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <FilterBar maanden={maanden} filterVan={filterVan} filterTot={filterTot}
              setFilterVan={setFilterVan} setFilterTot={setFilterTot} />
          </div>
        )}

        {!noData && view === "overzicht" && (
          <ViewOverzicht gemInkomen={gemInkomen} gemUitgaven={gemUitgaven} gemSaldo={gemSaldo}
            maandenPos={maandenPos} aantalMaanden={aantalMaanden} maandStats={maandStats}
            catStats={catStats} totalUitgaven={totalUitgaven} accounts={accounts} allTx={allTx}
            filterVan={filterVan} filterTot={filterTot}
            setFilterVan={setFilterVan} setFilterTot={setFilterTot}
            allCategories={allCategories} onUploadMore={handleFiles} />
        )}

        {!noData && view === "transacties" && (
          <ViewTransacties filtered={filtered} accounts={accounts}
            catFilter={catFilter} setCatFilter={setCatFilter}
            rekeningFilter={rekeningFilter} setRekeningFilter={setRekeningFilter}
            zoekterm={zoekterm} setZoekterm={setZoekterm}
            editCat={editCat} setEditCat={setEditCat}
            allCategories={allCategories} onCategoryChange={handleCategoryChange} />
        )}

        {!noData && view === "categorieen" && (
          <ViewCategorien catStats={catStats} totalUitgaven={totalUitgaven}
            aantalMaanden={aantalMaanden}
            catFilter={catFilter} setCatFilter={setCatFilter}
            setView={setView} allCategories={allCategories} filterVan={filterVan} filterTot={filterTot} />
        )}

        {!noData && view === "analyse" && (
          <ViewAnalyse allTx={allTx} maanden={maanden} allCategories={allCategories} />
        )}

        {!noData && view === "personen" && (
          <ViewPersonen allTx={allTx} maanden={maanden} allCategories={allCategories}
            filterVan={filterVan} filterTot={filterTot} />
        )}

        {!noData && view === "sparen" && (
          <ViewSparen gemInkomen={gemInkomen} gemUitgaven={gemUitgaven} gemSaldo={gemSaldo}
            savingsGoal={savingsGoal} setSavingsGoal={setSavingsGoal}
            simStats={simStats} reducSliders={reducSliders} setReducSliders={setReducSliders}
            aantalMaanden={aantalMaanden} allCategories={allCategories} />
        )}

        {view === "instellingen" && (
          <ViewInstellingen
            learnedRules={learnedRules} allCategories={allCategories}
            onDeleteMerchant={deleteLearnedMerchant} onDeleteIban={deleteLearnedIban}
            onClearLearned={() => setLearnedRules({ merchant: {}, iban: {} })}
            customCategories={customCategories}
            onAddCategory={addCustomCategory} onDeleteCategory={deleteCustomCategory}
            onUploadMore={handleFiles} noData={noData}
            onExportBackup={exportBackup} onImportBackup={importBackup} />
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
  filterVan, filterTot, setFilterVan, setFilterTot,
  allCategories, onUploadMore }) {

  const maxCat     = catStats[0]?.totaal || 1;
  const top5       = catStats.slice(0, 6);
  const recentTx   = [...allTx].sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 8);
  const saldoColor = gemSaldo >= 0 ? "#0a7c5c" : "#C62828";

  // Klik op maand in grafiek → stel periodefilter in op die ene maand
  const selectedMaand = (filterVan && filterVan === filterTot) ? filterVan : null;
  function handleSelectMaand(m) {
    if (m === null || selectedMaand === m) { setFilterVan(null); setFilterTot(null); }
    else { setFilterVan(m); setFilterTot(m); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KPICard label="Gem. inkomen/maand"  icon="💰" value={fmt(gemInkomen)}  color="#0a7c5c" sub={`over ${aantalMaanden} maand${aantalMaanden !== 1 ? "en" : ""}`} />
        <KPICard label="Gem. uitgaven/maand" icon="💸" value={fmt(gemUitgaven)} color={C.teal} sub="excl. interne transfers" />
        <KPICard label="Gem. saldo/maand"    icon="📊" value={fmt(gemSaldo)}    color={saldoColor} sub={gemSaldo < 0 ? "⚠ meer uit dan in" : "positief saldo"} />
        <KPICard label="Maanden positief"    icon="✅" value={`${maandenPos}/${aantalMaanden}`} color="#0277BD" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 }}>
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
            ? <MaandGrafiek maanden={maandStats} selected={selectedMaand} onSelect={handleSelectMaand} />
            : <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 40 }}>Nog geen data</div>}
          {selectedMaand && (
            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.teal, fontWeight: 600 }}>Gefilterd: {selectedMaand}</span>
              <button onClick={() => { setFilterVan(null); setFilterTot(null); }} style={{ fontSize: 10, padding: "2px 8px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", background: "#fff", color: C.muted }}>✕ Wis</button>
            </div>
          )}
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Top uitgavencategorieën</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {top5.map(cs => {
              const cat = allCategories[cs.cat] || CATEGORIES.overige;
              return (
                <div key={cs.cat}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Ingeladen rekeningen</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(accounts).map(([iban, acc]) => (
              <div key={iban} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#f7fbfc", borderRadius: 8, border: `1px solid ${C.border}` }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: acc.kleur, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.label}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{allTx.filter(t => t.rekening === iban).length} transacties</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}><UploadZone onFiles={onUploadMore} compact /></div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.teal, marginBottom: 14 }}>Recente transacties</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recentTx.map(tx => (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#f9fafb", border: `1px solid ${C.border}` }}>
                <div style={{ width: 34, fontSize: 16, textAlign: "center", flexShrink: 0 }}>{(allCategories[tx.categorie] || CATEGORIES.overige).icon}</div>
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
function ViewTransacties({ filtered, accounts,
  catFilter, setCatFilter, rekeningFilter, setRekeningFilter, zoekterm, setZoekterm,
  editCat, setEditCat, allCategories, onCategoryChange }) {

  const [page, setPage] = useState(0);
  const PER_PAGE = 50;
  const sorted = [...filtered].sort((a, b) => b.datum.localeCompare(a.datum));
  const paged  = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pages  = Math.ceil(sorted.length / PER_PAGE);

  const sw = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.card, color: C.text, fontFamily: "inherit", cursor: "pointer" };

  const unknownCount = filtered.filter(t => t.categorie === "overige").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={zoekterm} onChange={e => { setZoekterm(e.target.value); setPage(0); }}
            placeholder="🔍 Zoek op merchant, beschrijving..." style={{ ...sw, flex: "1 1 200px" }} />
          <select value={catFilter || ""} onChange={e => { setCatFilter(e.target.value || null); setPage(0); }} style={sw}>
            <option value="">Alle categorieën</option>
            {Object.entries(allCategories).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select value={rekeningFilter || ""} onChange={e => { setRekeningFilter(e.target.value || null); setPage(0); }} style={sw}>
            <option value="">Alle rekeningen</option>
            {Object.entries(accounts).map(([iban, acc]) => <option key={iban} value={iban}>{acc.label}</option>)}
          </select>
          {(zoekterm || catFilter || rekeningFilter) && (
            <button onClick={() => { setZoekterm(""); setCatFilter(null); setRekeningFilter(null); setPage(0); }}
              style={{ padding: "7px 12px", background: "#fee2e2", color: "#b91c1c", border: "none", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>
              ✕ Wis filters
            </button>
          )}
          <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{filtered.length} resultaten</span>
        </div>
        {unknownCount > 0 && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#FFF8E1", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, color: "#92400E", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚠</span>
            <span><strong>{unknownCount}</strong> transacties staan nog als "Overige". Klik op de categoriebadge om ze in te delen — het systeem onthoudt dit voor toekomstige uploads.</span>
            <button onClick={() => { setCatFilter("overige"); setPage(0); }} style={{ marginLeft: "auto", padding: "3px 10px", background: "#C9922A", color: "#fff", border: "none", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
              Bekijk
            </button>
          </div>
        )}
      </div>

      {/* Tabel */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 160px 110px", padding: "8px 14px", background: "#f1f8f9", borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>
          <span>Datum</span><span>Merchant / Beschrijving</span><span>Rekening</span>
          <span>Categorie <span style={{ color: C.gold, fontWeight: 400 }}>↑ klik om te wijzigen</span></span>
          <span style={{ textAlign: "right" }}>Bedrag</span>
        </div>

        {paged.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>Geen transacties gevonden</div>
        )}

        {paged.map((tx, i) => {
          const cat = allCategories[tx.categorie] || CATEGORIES.overige;
          const acc = accounts[tx.rekening];
          const isEditing = editCat === tx.id;
          const isOverige = tx.categorie === "overige";
          return (
            <div key={tx.id}
              style={{ display: "grid", gridTemplateColumns: "90px 1fr 120px 160px 110px", padding: "9px 14px",
                borderBottom: `1px solid ${C.border}`, background: isOverige ? "#FFFDF5" : (i % 2 === 0 ? "#fff" : "#fbfcfd"), alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.muted }}>{tx.datum}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.merchant}</div>
                {tx.mededeling && <div style={{ fontSize: 10, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.mededeling}</div>}
              </div>
              <span style={{ fontSize: 10, color: C.muted }}>{acc?.eigenaar || "—"}</span>
              <div>
                {isEditing ? (
                  <select autoFocus value={tx.categorie}
                    onChange={e => onCategoryChange(tx, e.target.value)}
                    onBlur={() => setEditCat(null)}
                    style={{ fontSize: 11, border: `2px solid ${C.gold}`, borderRadius: 8, padding: "4px 6px", width: "100%", fontFamily: "inherit", background: "#fffdf5" }}>
                    {Object.entries(allCategories).map(([k, v]) => (
                      <option key={k} value={k}>{v.icon} {v.label}</option>
                    ))}
                  </select>
                ) : (
                  <span onClick={() => setEditCat(tx.id)} title="Klik om categorie te wijzigen"
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <CatBadge cat={tx.categorie} allCats={allCategories} />
                    {isOverige && <span style={{ fontSize: 9, color: C.gold }}>✏</span>}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: tx.bedrag >= 0 ? "#0a7c5c" : C.teal, textAlign: "right" }}>
                {tx.bedrag >= 0 ? "+" : ""}{fmt(tx.bedrag)}
              </span>
            </div>
          );
        })}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, background: C.card }}>← Vorige</button>
          <span style={{ padding: "6px 14px", fontSize: 12, color: C.muted }}>Pagina {page + 1} / {pages}</span>
          <button disabled={page === pages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: "6px 14px", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, background: C.card }}>Volgende →</button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: CATEGORIEËN
// ══════════════════════════════════════════════════════════════════════════
function ViewCategorien({ catStats, totalUitgaven, aantalMaanden,
  catFilter, setCatFilter, setView, allCategories, filterVan, filterTot }) {

  const [expanded, setExpanded] = useState(null);
  const donutSeg = catStats.slice(0, 8).map(c => ({ value: c.totaal, color: (allCategories[c.cat] || CATEGORIES.overige).color }));
  const isFiltered = filterVan || filterTot;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.teal }}>
          {isFiltered ? `Periode: ${filterVan || "begin"} → ${filterTot || "nu"}` : `Alle periodes · ${aantalMaanden} maanden`}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
          {isFiltered && aantalMaanden === 1 ? `Totaal: ${fmt(totalUitgaven)}` : `Gem.: ${fmt(totalUitgaven / aantalMaanden)}/mnd · Totaal: ${fmt(totalUitgaven)}`}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
            <DonutChart segments={donutSeg} size={160} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {catStats.slice(0, 8).map(cs => {
              const cat = allCategories[cs.cat] || CATEGORIES.overige;
              return (
                <div key={cs.cat} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
                  onClick={() => { setCatFilter(cs.cat); setView("transacties"); }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: cat.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{cat.icon} {cat.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: cat.color }}>{pct(cs.totaal, totalUitgaven)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {catStats.map(cs => {
            const cat = allCategories[cs.cat] || CATEGORIES.overige;
            const avgMnd = cs.totaal / aantalMaanden;
            const isExp  = expanded === cs.cat;
            const topMerchants = Object.entries(cs.merchants).sort((a, b) => b[1] - a[1]).slice(0, 5);
            return (
              <div key={cs.cat} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                  onClick={() => setExpanded(isExp ? null : cs.cat)}>
                  <span style={{ fontSize: 20 }}>{cat.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{cat.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>
                        {(isFiltered && aantalMaanden === 1) ? fmt(cs.totaal) : <>{fmt(avgMnd)}<span style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>/mnd</span></>}
                      </span>
                    </div>
                    <MiniBar value={cs.totaal} max={catStats[0]?.totaal || 1} color={cat.color} />
                  </div>
                  <div style={{ textAlign: "right", minWidth: 60 }}>
                    <div style={{ fontSize: 10, color: C.muted }}>{pct(cs.totaal, totalUitgaven)}%</div>
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
                      style={{ marginTop: 10, padding: "5px 12px", background: cat.bg || "#f5f5f5", border: `1px solid ${cat.color}30`, borderRadius: 8, fontSize: 11, color: cat.color, cursor: "pointer", fontWeight: 600 }}>
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
  simStats, reducSliders, setReducSliders, aantalMaanden, allCategories }) {

  const { reducible, extraBesparing, gesimuleerdSaldo } = simStats;
  const goal        = parseFloat(savingsGoal) || 0;
  const progressPct = goal > 0 ? Math.min(100, Math.round((gesimuleerdSaldo / goal) * 100)) : 0;
  const goalBereikt = gesimuleerdSaldo >= goal;
  const simGap      = goal - gesimuleerdSaldo;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, marginBottom: 6 }}>🐷 Spaar Simulator</div>
        <p style={{ fontSize: 13, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
          Geef je gewenste maandelijkse sparing in. De simulator toont welke categorieën je kunt verminderen.
        </p>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", display: "block", marginBottom: 6 }}>Spaardoel per maand (€)</label>
            <input type="number" value={savingsGoal} onChange={e => setSavingsGoal(e.target.value)} min="0" step="50"
              style={{ padding: "10px 14px", fontSize: 20, fontWeight: 700, color: C.teal, border: `2px solid ${C.teal}`, borderRadius: 10, width: 160, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[200, 300, 500, 750, 1000].map(v => (
              <button key={v} onClick={() => setSavingsGoal(v)}
                style={{ padding: "7px 12px", border: `1px solid ${savingsGoal == v ? C.teal : C.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer", background: savingsGoal == v ? C.teal : C.card, color: savingsGoal == v ? "#fff" : C.text }}>
                €{v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KPICard label="Gem. inkomen"  icon="💰" value={fmt(gemInkomen)}  color="#0a7c5c" sub={`${aantalMaanden} maanden`} />
        <KPICard label="Gem. uitgaven" icon="💸" value={fmt(gemUitgaven)} color={C.teal} />
        <KPICard label="Huidig saldo"  icon="📊" value={fmt(gemSaldo)}    color={gemSaldo >= 0 ? "#0a7c5c" : "#C62828"} sub={gemSaldo < 0 ? "⚠ negatief" : "gemiddeld"} />
        <KPICard label="Spaardoel"     icon="🎯" value={fmt(goal)}        color="#6A1B9A" />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.teal }}>
            {goalBereikt ? "✅ Spaardoel bereikt!" : `Gesimuleerd: ${fmt(gesimuleerdSaldo)} / ${fmt(goal)}`}
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: goalBereikt ? "#0a7c5c" : "#C62828" }}>{progressPct}%</span>
        </div>
        <div style={{ background: "#e9eeef", borderRadius: 8, height: 16, overflow: "hidden" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: goalBereikt ? "#0a7c5c" : C.teal, borderRadius: 8, transition: "width .4s" }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
          {goalBereikt ? `Je spaart ${fmt(gesimuleerdSaldo - goal)} meer dan je doel!`
            : simGap > 0 ? `Nog ${fmt(simGap)} extra te besparen.`
            : "Huidig saldo dekt al het doel."}
        </div>
        {extraBesparing > 0 && <div style={{ marginTop: 6, fontSize: 12, color: "#0a7c5c", fontWeight: 600 }}>+ {fmt(extraBesparing)} via geselecteerde aanpassingen</div>}
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>Aanpasbare categorieën</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Vaste kosten (huur, energie, gezondheid) zijn niet aanpasbaar.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {reducible.map(r => {
            const cat = allCategories[r.cat] || CATEGORIES.overige;
            const saving = r.avgPerMaand * r.slider / 100;
            return (
              <div key={r.cat} style={{ padding: "14px 16px", background: cat.bg || "#f5f5f5", borderRadius: 10, border: `1px solid ${cat.color}22` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: cat.color }}>{cat.icon} {cat.label}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Huidig: {fmt(r.avgPerMaand)}/mnd · Max: {r.maxReduc}%</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: r.slider > 0 ? "#0a7c5c" : C.muted }}>{fmt(r.avgPerMaand - saving)}<span style={{ fontSize: 10, fontWeight: 400 }}>/mnd</span></div>
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
          {reducible.length === 0 && <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 20 }}>Geen reduceerbare categorieën gevonden.</div>}
        </div>
        {reducible.some(r => r.slider > 0) && (
          <button onClick={() => setReducSliders({})} style={{ marginTop: 14, padding: "7px 14px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, cursor: "pointer", background: "#fff", color: C.muted }}>
            ↩ Reset sliders
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: INSTELLINGEN
// ══════════════════════════════════════════════════════════════════════════
function ViewInstellingen({ learnedRules, allCategories, onDeleteMerchant, onDeleteIban, onClearLearned,
  customCategories, onAddCategory, onDeleteCategory, onUploadMore, noData,
  onExportBackup, onImportBackup }) {

  const [newLabel,  setNewLabel]  = useState("");
  const [newIcon,   setNewIcon]   = useState("📌");
  const [newColor,  setNewColor]  = useState("#0D4A52");
  const [addErr,    setAddErr]    = useState("");

  const merchantEntries = Object.entries(learnedRules.merchant || {});
  const ibanEntries     = Object.entries(learnedRules.iban || {});
  const totalLearned    = merchantEntries.length + ibanEntries.length;

  function handleAdd() {
    if (!newLabel.trim()) { setAddErr("Geef een naam in."); return; }
    onAddCategory(newLabel.trim(), newIcon, newColor);
    setNewLabel(""); setNewIcon("📌"); setNewColor("#0D4A52"); setAddErr("");
  }

  const card = { background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 0 };
  const sectionTitle = { fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 };
  const sectionSub   = { fontSize: 12, color: C.muted, marginBottom: 16 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

    {/* Backup & herstel */}
    <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>💾 Backup & herstel</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Download een backup van al je data (transacties, categorietoewijzingen, geleerde regels). Bewaar dit bestand lokaal als veiligheid.
        Bij een nieuw toestel of na dataverlies kan je de backup hier herstellen.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onExportBackup}
          style={{ padding: "10px 20px", background: C.teal, color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          ↓ Download backup (.json)
        </button>
        <label style={{ padding: "10px 20px", background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          <input type="file" accept=".json" style={{ display: "none" }} onChange={e => e.target.files[0] && onImportBackup(e.target.files[0])} />
          ↑ Herstel backup
        </label>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>

      {/* ── Geleerde regels ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={card}>
          <div style={sectionTitle}>🧠 Geleerde categoriseringsregels</div>
          <div style={sectionSub}>
            Elke keer je een categorie manueel toewijst, onthoudt de app de merchant-naam en het rekeningnummer.
            Bij een nieuwe CSV-upload worden die transacties automatisch correct ingedeeld.
          </div>

          {totalLearned === 0 && (
            <div style={{ padding: "16px 0", textAlign: "center", color: C.muted, fontSize: 13 }}>
              Nog geen geleerde regels.<br />
              <span style={{ fontSize: 11 }}>Klik op een categoriebadge in de Transacties-tab om te starten.</span>
            </div>
          )}

          {merchantEntries.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                Op merchant-naam ({merchantEntries.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                {merchantEntries.map(([merchant, cat]) => {
                  const c = allCategories[cat] || CATEGORIES.overige;
                  return (
                    <div key={merchant} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#f7fbfc", borderRadius: 8, border: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text, fontWeight: 500 }}>{merchant}</span>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>→</span>
                      <CatBadge cat={cat} allCats={allCategories} />
                      <button onClick={() => onDeleteMerchant(merchant)} title="Verwijder regel"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {ibanEntries.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
                Op rekeningnummer/IBAN ({ibanEntries.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {ibanEntries.map(([iban, cat]) => {
                  const c = allCategories[cat] || CATEGORIES.overige;
                  return (
                    <div key={iban} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "#f7fbfc", borderRadius: 8, border: `1px solid ${C.border}` }}>
                      <span style={{ fontSize: 10, flex: 1, color: C.muted, fontFamily: "monospace" }}>{iban}</span>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>→</span>
                      <CatBadge cat={cat} allCats={allCategories} />
                      <button onClick={() => onDeleteIban(iban)} title="Verwijder regel"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {totalLearned > 0 && (
            <button onClick={() => { if (confirm("Alle geleerde regels wissen?")) onClearLearned(); }}
              style={{ marginTop: 16, padding: "7px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, color: "#b91c1c", cursor: "pointer" }}>
              🗑 Wis alle geleerde regels
            </button>
          )}
        </div>

        {/* CSV upload */}
        {noData && (
          <div style={card}>
            <div style={sectionTitle}>📂 Bankuittreksels laden</div>
            <div style={sectionSub}>Upload je ING CSV-bestanden om te starten.</div>
            <UploadZone onFiles={onUploadMore} />
          </div>
        )}
      </div>

      {/* ── Categorieën beheren ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={card}>
          <div style={sectionTitle}>🏷️ Eigen categorieën toevoegen</div>
          <div style={sectionSub}>
            Maak aangepaste categorieën aan voor uitgaven die niet passen in de standaard indeling.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", background: "#f7fbfc", borderRadius: 10, border: `1px solid ${C.border}`, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".3px", display: "block", marginBottom: 4 }}>Icoon</label>
                <input value={newIcon} onChange={e => setNewIcon(e.target.value)} maxLength={2}
                  style={{ width: 52, textAlign: "center", fontSize: 20, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 4px", fontFamily: "inherit" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".3px", display: "block", marginBottom: 4 }}>Naam</label>
                <input value={newLabel} onChange={e => { setNewLabel(e.target.value); setAddErr(""); }}
                  placeholder="bv. Huisdieren, Hobby, ..." onKeyDown={e => e.key === "Enter" && handleAdd()}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".3px", display: "block", marginBottom: 4 }}>Kleur</label>
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
                  style={{ width: 52, height: 38, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", padding: 2 }} />
              </div>
            </div>
            {addErr && <div style={{ fontSize: 11, color: "#b91c1c" }}>{addErr}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ padding: "4px 10px", borderRadius: 10, background: newColor + "22", color: newColor, fontSize: 12, fontWeight: 600 }}>
                {newIcon} {newLabel || "Preview"}
              </div>
              <button onClick={handleAdd}
                style={{ marginLeft: "auto", padding: "8px 16px", background: C.teal, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                ＋ Toevoegen
              </button>
            </div>
          </div>

          {/* Eigen categorieën lijst */}
          {Object.keys(customCategories).length > 0 ? (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Eigen categorieën</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(customCategories).map(([key, cat]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: cat.bg || cat.color + "15", borderRadius: 8, border: `1px solid ${cat.color}30` }}>
                    <span style={{ fontSize: 18 }}>{cat.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: cat.color, flex: 1 }}>{cat.label}</span>
                    <button onClick={() => { if (confirm(`"${cat.label}" verwijderen?`)) onDeleteCategory(key); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 14, padding: "0 2px" }}>✕</button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: "10px 0" }}>Nog geen eigen categorieën.</div>
          )}
        </div>

        {/* Standaard categorieën overzicht */}
        <div style={card}>
          <div style={sectionTitle}>📋 Standaard categorieën</div>
          <div style={sectionSub}>Dit zijn de ingebouwde categorieën met hun automatische herkenningsregels.</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <span key={k} style={{ padding: "4px 10px", borderRadius: 10, background: v.bg || "#f5f5f5", color: v.color, fontSize: 11, fontWeight: 600 }}>
                {v.icon} {v.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>

    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// VIEW: ANALYSE & INZICHTEN
// ══════════════════════════════════════════════════════════════════════════
const TIPS = {
  hypotheek:    ["Herfinancier je hypotheek als de marktrente gedaald is — potentiële besparing honderden euro's/jaar.", "Extra aflossingen verminderen de rentelast op lange termijn.", "Vergelijk je huidige tarief met wat banken aanbieden aan nieuwe klanten."],
  wonen:        ["Vergelijk energieleveranciers via de VREG-vergelijkingsmodule — bespaar tot €300/jaar.", "Verlaag je thermostaat met 1°C — dat spaart ~7% op verwarmingskosten.", "Isoleer je dak en ramen — overheidssteun via Mijn VerbouwPremie beschikbaar."],
  voeding:      ["Kies vaker voor huismerken bij Colruyt of Lidl — tot 30% goedkoper dan merken.", "Plan maaltijden op voorhand en schrijf een lijstje — minder verspilling en impulsaankopen.", "Batch cooking op zondag spaart tijd én geld doordeweeks."],
  vervoer:      ["Elektrisch rijden verlaagt brandstofkosten significant bij dagelijks gebruik.", "Combineer ritten en fiets voor trajecten onder 3 km.", "Vergelijk parkings op voorhand via Google Maps — grote prijsverschillen in steden."],
  gezondheid:   ["Dien terugbetalingsdocumenten tijdig in bij je ziekenfonds — veel mensen missen dit.", "Generische geneesmiddelen zijn even effectief en tot 60% goedkoper.", "Preventieve zorg (tandarts, oogarts) is goedkoper dan curatief — plan regelmatige check-ups."],
  shopping:     ["Wacht 48 uur voor een aankoop — filtert impulsaankopen eruit.", "Check Vinted of 2dehands voor kleding — zelfde kwaliteit, lagere prijs.", "Maak een wishlist en koop enkel tijdens sales of met kortingscodes."],
  sport:        ["Vergelijk sportabonnementen — combineer activiteiten in één pakket.", "Boek evenementen vroeg — early bird prijzen zijn vaak 20-30% goedkoper.", "Zoek naar groepsabonnementen bij clubs voor vrienden of familie."],
  restaurant:   ["Beperk restaurantbezoeken tot 2–3 keer per maand en maak er een bewuste keuze van.", "Kies lunch i.p.v. diner bij hetzelfde restaurant — gemiddeld 40% goedkoper.", "Kook eens samen met vrienden in plaats van uit eten — gezelliger én goedkoper."],
  telecom:      ["Vergelijk bundelpakketten jaarlijks — telecommarkt verandert snel.", "Schakel over naar Mobile Vikings of Scarlet voor gsm — besparing tot €20/maand.", "Gebruik één provider voor internet + tv + gsm — bundels zijn goedkoper."],
  abonnementen: ["Maak een lijst van alle actieve abonnementen — velen betalen voor dingen ze vergeten zijn.", "Deel streaming-abonnementen via gezinsplan — goedkoper dan meerdere individuele.", "Schakel over naar jaarlijkse betaling i.p.v. maandelijks — typisch 15–20% korting."],
  financieel:   ["Vergelijk verzekeringspremies jaarlijks — trouwe klanten betalen soms meer dan nieuwelingen.", "Bundel verzekeringen bij één maatschappij — vaak korting bij meerdere polissen.", "Controleer of je DKV-polis nog overeenkomt met je huidige situatie."],
  huisdieren:   ["Dierenverzekering dekt onverwachte dierenartsfacturen — maandpremie is lager dan één operatie.", "Koop dierenvoeding in grote verpakkingen — significant goedkoper per kg.", "Vergelijk dierenapotheek online voor medicatie — tot 40% goedkoper dan de dierenarts."],
  verbouwing:   ["Vraag minimaal 3 offertes voor grote werken — prijsverschillen kunnen enorm zijn.", "Plan verbouwingen buiten het hoogseizoen (herfst/winter) — aannemers zijn dan goedkoper.", "Controleer welke premies beschikbaar zijn via Flanders (Mijn VerbouwPremie, REG-premies)."],
  donaties:     ["Giften boven €40 zijn fiscaal aftrekbaar — 45% teruggestort via belastingen.", "Stel een jaarlijks donatieplafond in als vast budgetpost.", "Domiciliëringen aan goede doelen zijn eenvoudig te pauzeren bij tijdelijke krapte."],
  overige:      ["Categoriseer onbekende uitgaven om inzicht te krijgen — het systeem onthoudt het daarna.", "Bekijk terugkerende onbekende bedragen — dit zijn vaak kleine abonnementen die vergeten zijn."],
};

function ViewAnalyse({ allTx, maanden, allCategories }) {
  const [refMaand, setRefMaand] = useState(null);
  const EXCL = new Set(["inkomen", "familie", "sparen", "muzad"]);
  const maandenLijst = [...maanden].sort();

  // Per maand per categorie: absolute uitgaven
  const maandCatMap = useMemo(() => {
    const map = {};
    allTx.filter(t => t.bedrag < 0 && !EXCL.has(t.categorie)).forEach(t => {
      if (!map[t.maand]) map[t.maand] = {};
      map[t.maand][t.categorie] = (map[t.maand][t.categorie] || 0) + Math.abs(t.bedrag);
    });
    return map;
  }, [allTx]);

  const nMaanden = Math.max(Object.keys(maandCatMap).length, 1);

  // Historisch gemiddelde per categorie
  const avgPerCat = useMemo(() => {
    const totals = {};
    Object.values(maandCatMap).forEach(m => {
      Object.entries(m).forEach(([cat, amt]) => { totals[cat] = (totals[cat] || 0) + amt; });
    });
    return Object.fromEntries(Object.entries(totals).map(([cat, tot]) => [cat, tot / nMaanden]));
  }, [maandCatMap, nMaanden]);

  // Referentiemaand = gekozen of meest recente
  const activeMaand = refMaand || maandenLijst[maandenLijst.length - 1];
  const refData  = maandCatMap[activeMaand] || {};
  const heeftRef = Object.keys(refData).length > 0;

  // Vergelijking per categorie
  const analyse = useMemo(() => Object.entries(avgPerCat)
    .map(([cat, avg]) => {
      const current = refData[cat] || 0;
      const diff    = current - avg;
      const pctDiff = avg > 5 ? (diff / avg) * 100 : 0;
      return { cat, avg, current, diff, pctDiff };
    })
    .sort((a, b) => b.pctDiff - a.pctDiff),
  [avgPerCat, refData]);

  const alarmen  = analyse.filter(a => a.pctDiff > 25  && a.current > 25);
  const positief = analyse.filter(a => a.pctDiff < -20 && a.avg > 20);
  const totalOver  = alarmen.reduce((s, a) => s + Math.max(0, a.diff), 0);
  const maxBar = Math.max(...analyse.map(a => Math.max(a.avg, a.current)), 1);

  const sw = { padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, background: C.card, fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header: maandkiezer + KPIs */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>Analyseer maand</div>
          <select value={refMaand || ""} onChange={e => setRefMaand(e.target.value || null)} style={sw}>
            <option value="">Meest recente ({maandenLijst[maandenLijst.length - 1]})</option>
            {[...maandenLijst].reverse().map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: C.muted, padding: "8px 14px", background: "#f7fbfc", borderRadius: 8, border: `1px solid ${C.border}` }}>
          Vergeleken met gemiddelde over <strong style={{ color: C.teal }}>{nMaanden} maanden</strong>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, flexWrap: "wrap" }}>
          {heeftRef && totalOver > 0 && (
            <div style={{ textAlign: "center", padding: "10px 18px", background: "#fff5f5", borderRadius: 10, border: "1px solid #fca5a5" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#C62828" }}>{fmt(totalOver)}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>boven gemiddelde</div>
            </div>
          )}
          {heeftRef && totalOver > 0 && (
            <div style={{ textAlign: "center", padding: "10px 18px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0a7c5c" }}>{fmt(totalOver)}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>extra spaarpotentieel</div>
            </div>
          )}
        </div>
      </div>

      {/* Alarmen: hoog boven gemiddelde */}
      {heeftRef && alarmen.length > 0 && (
        <div style={{ background: C.card, border: "1px solid #fca5a5", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#C62828", marginBottom: 4 }}>⚠️ Hoog verbruik in {activeMaand}</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
            Deze categorieën liggen meer dan 25% boven hun historisch maandgemiddelde.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {alarmen.map(a => {
              const cat  = allCategories[a.cat] || CATEGORIES.overige;
              const tips = TIPS[a.cat] || TIPS.overige;
              return (
                <div key={a.cat} style={{ padding: 16, borderRadius: 10, background: "#fff8f8", border: "1px solid #fecaca" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                    <span style={{ fontSize: 26, lineHeight: 1 }}>{cat.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{cat.label}</div>
                      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                        <span>Deze maand: <strong style={{ color: "#C62828", fontSize: 14 }}>{fmt(a.current)}</strong></span>
                        <span style={{ color: C.muted }}>Gemiddeld: {fmt(a.avg)}</span>
                        <span style={{ fontWeight: 700, color: "#C62828" }}>+{fmt(a.diff)} (+{Math.round(a.pctDiff)}%)</span>
                      </div>
                      {/* Mini progressbar */}
                      <div style={{ marginTop: 8, background: "#fee2e2", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, (a.avg / a.current) * 100)}%`, height: "100%", background: "#86efac", borderRadius: 4 }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.muted, marginTop: 2 }}>
                        <span>Gemiddeld</span><span>+{Math.round(a.pctDiff)}% te veel</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ paddingTop: 10, borderTop: "1px solid #fecaca" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#C62828", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Bespaarvoorstellen</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {tips.map((tip, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: C.text, lineHeight: 1.5 }}>
                          <span style={{ color: "#C62828", fontWeight: 700, flexShrink: 0 }}>→</span>
                          <span>{tip}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Positief nieuws */}
      {heeftRef && positief.length > 0 && (
        <div style={{ background: C.card, border: "1px solid #86efac", borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0a7c5c", marginBottom: 10 }}>✅ Goed bezig in {activeMaand}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {positief.map(a => {
              const cat = allCategories[a.cat] || CATEGORIES.overige;
              return (
                <div key={a.cat} style={{ padding: "10px 14px", borderRadius: 10, background: "#f0fdf4", border: "1px solid #86efac", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{cat.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0a7c5c" }}>{cat.label}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>
                      {fmt(a.current)} vs gem. {fmt(a.avg)}
                      <span style={{ fontWeight: 700, color: "#0a7c5c" }}> ({Math.round(Math.abs(a.pctDiff))}% lager)</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Volledige vergelijking — alle categorieën */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>
          📊 Alle categorieën — {activeMaand} vs historisch gemiddelde
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginBottom: 20, flexWrap: "wrap" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#c5d5d8", borderRadius: 2, marginRight: 4 }} />Gemiddelde</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: C.teal2, borderRadius: 2, marginRight: 4 }} />Huidige maand</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#C62828", borderRadius: 2, marginRight: 4 }} />Significant boven</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, background: "#0a7c5c", borderRadius: 2, marginRight: 4 }} />Onder gemiddelde</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {analyse.filter(a => a.avg > 10 || a.current > 10).map(a => {
            const cat     = allCategories[a.cat] || CATEGORIES.overige;
            const isOver  = a.pctDiff > 25;
            const isMid   = a.pctDiff > 5 && a.pctDiff <= 25;
            const isUnder = a.pctDiff < -10;
            const barColor = isOver ? "#C62828" : isMid ? "#E65100" : isUnder ? "#0a7c5c" : C.teal2;
            const avgW = Math.min(100, (a.avg / maxBar) * 100);
            const curW = Math.min(100, (a.current / maxBar) * 100);
            return (
              <div key={a.cat}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{cat.icon} {cat.label}</span>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: barColor }}>{fmt(a.current)}</span>
                    <span style={{ fontSize: 10, color: C.muted }}> · gem. {fmt(a.avg)}</span>
                    {a.avg > 5 && (
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700,
                        color: isOver ? "#C62828" : isUnder ? "#0a7c5c" : C.muted }}>
                        {a.pctDiff > 0 ? "+" : ""}{Math.round(a.pctDiff)}%
                      </span>
                    )}
                  </div>
                </div>
                {/* Dubbele balk: gemiddelde (licht) + huidig (gekleurd) */}
                <div style={{ position: "relative", height: 10, background: "#e9eeef", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${avgW}%`, background: "#c5d5d8", borderRadius: 5 }} />
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${curW}%`, background: barColor, borderRadius: 5, opacity: 0.82 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Structurele tips voor de grootste posten */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>💡 Structurele bespaarttips</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>Op basis van je grootste uitgavenposten over alle maanden.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {[...analyse].sort((a, b) => b.avg - a.avg)
            .filter(a => a.avg > 40)
            .slice(0, 8)
            .map(a => {
              const cat  = allCategories[a.cat] || CATEGORIES.overige;
              const tips = TIPS[a.cat] || TIPS.overige;
              return (
                <div key={a.cat} style={{ padding: 16, borderRadius: 10, background: cat.bg || "#f9f9f9", border: `1px solid ${cat.color}30` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cat.color }}>{cat.icon} {cat.label}</span>
                    <span style={{ fontSize: 12, color: C.muted }}>{fmt(a.avg)}/mnd</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {tips.slice(0, 2).map((tip, i) => (
                      <div key={i} style={{ display: "flex", gap: 7, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
                        <span style={{ color: cat.color, fontWeight: 700, flexShrink: 0 }}>·</span>
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

    </div>
  );
}
