import { useMemo } from "react";
import { CATEGORIES } from "./categorize.js";

const C = {
  teal: "#0D4A52", teal2: "#1A6B7C", white: "#FFFFFF", bg: "#f0f5f6", card: "#FFFFFF",
  border: "rgba(13,74,82,0.13)", muted: "#5a7a80", text: "#1A2B2F",
};
const fmt = n => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(n);
const maandLabel = m => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return new Date(parseInt(y), parseInt(mo) - 1, 1).toLocaleDateString("nl-BE", { month: "short", year: "2-digit" });
};

const JAN_IBANS    = new Set(["BE12290019028892", "BE08034404717913"]);
const SANDRA_IBANS = new Set(["BE34290019028690", "BE66290786264843"]);
const SOFIE_IBAN   = "BE95001677814858";

function isLaura(tx) {
  const n = `${tx.tegenpartijNaam || ""} ${tx.merchant || ""} ${tx.mededeling || ""}`.toLowerCase();
  return (n.includes("laura") && n.includes("buytaert")) || n.includes("buytaert laura") || n.includes("laura p2p");
}

const JAN_CLR    = "#0D4A52";
const SANDRA_CLR = "#1A6B7C";
const LAURA_CLR  = "#6A1B9A";
const SOFIE_CLR  = "#E65100";

function PersonCard({ name, color, initials, totaal, inkTotaal, cats, nMaanden, allCategories, weergave, ibans, goToTx }) {
  const gem    = totaal / nMaanden;
  const saldo  = inkTotaal / nMaanden - gem;
  const isGem  = weergave !== "eff";
  const suffix = isGem ? "/mnd" : "";
  const disp   = v => fmt(isGem ? v / nMaanden : v);
  // Use first IBAN as rekening filter (transactions view filters by rekening)
  const primaryIban = ibans ? [...ibans][0] : null;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, flex: 1, minWidth: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{name}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{isGem ? `gem. ${fmt(gem)}/maand uitgaven` : `totaal ${fmt(totaal)} over ${nMaanden} mnd`}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { l: isGem ? "Gem. uitgaven" : "Totaal",      v: disp(totaal),         col: color },
          { l: isGem ? "Gem. inkomen"  : "Tot. inkomen", v: disp(inkTotaal),      col: "#0a7c5c" },
          { l: isGem ? "Gem. saldo"    : "Tot. saldo",   v: fmt(isGem ? saldo : saldo * nMaanden), col: saldo >= 0 ? "#0a7c5c" : "#C62828" },
        ].map(k => (
          <div key={k.l} style={{ background: "#f7fbfc", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: k.col }}>{k.v}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 2, textTransform: "uppercase", letterSpacing: ".3px" }}>{k.l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Top uitgaven</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {cats.slice(0, 6).map(([cat, amt]) => {
          const c = allCategories[cat] || CATEGORIES.overige;
          const w = Math.min(100, (amt / (cats[0]?.[1] || 1)) * 100);
          return (
            <div key={cat} onClick={() => goToTx?.({ cat, rekening: primaryIban })} style={{ cursor: goToTx ? "pointer" : "default" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: C.text }}>{c.icon} {c.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color }}>{fmt(isGem ? amt/nMaanden : amt)}{isGem && <span style={{ fontSize: 9, color: C.muted }}>/mnd</span>}</span>
              </div>
              <div style={{ background: "#e9eeef", borderRadius: 3, height: 5 }}>
                <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 3 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KindCard({ name, color, initials, ontvangenTotaal, eigenTotaal, eigenCats, maandMap, nMaanden, alleM, allCategories, weergave }) {
  const isGem   = weergave !== "eff";
  const gem     = (ontvangenTotaal + eigenTotaal) / nMaanden;
  const recentM = alleM.slice(-6);
  const maxBar  = Math.max(...recentM.map(m => maandMap[m] || 0), 1);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, flex: 1, minWidth: 280 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{name}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{isGem ? `gem. ${fmt(gem)}/maand` : `totaal ${fmt(ontvangenTotaal + eigenTotaal)}`}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {ontvangenTotaal > 0 && (
          <div style={{ flex: 1, background: color + "18", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color }}>{fmt(isGem ? ontvangenTotaal/nMaanden : ontvangenTotaal)}{isGem && <span style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>/mnd</span>}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>ontvangen van Jan/Sandra</div>
          </div>
        )}
        {eigenTotaal > 0 && (
          <div style={{ flex: 1, background: "#f7fbfc", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.teal }}>{fmt(isGem ? eigenTotaal/nMaanden : eigenTotaal)}{isGem && <span style={{ fontSize: 10, fontWeight: 400, color: C.muted }}>/mnd</span>}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>eigen uitgaven</div>
          </div>
        )}
      </div>
      {recentM.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Laatste 6 maanden</div>
          <div style={{ display: "flex", gap: 4, height: 65, alignItems: "flex-end", marginBottom: 14 }}>
            {recentM.map(m => {
              const h = Math.round(((maandMap[m] || 0) / maxBar) * 50);
              return (
                <div key={m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <div style={{ width: "100%", height: h, background: color, borderRadius: "3px 3px 0 0", minHeight: (maandMap[m] || 0) > 0 ? 2 : 0 }} />
                  <span style={{ fontSize: 8, color: C.muted }}>{maandLabel(m)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {eigenCats.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Eigen uitgaven per categorie</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {eigenCats.slice(0, 5).map(([cat, amt]) => {
              const c = allCategories[cat] || CATEGORIES.overige;
              return (
                <div key={cat} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: C.text }}>{c.icon} {c.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>{fmt(amt)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
      {ontvangenTotaal === 0 && eigenTotaal === 0 && (
        <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
          Geen transacties gevonden.<br />
          <span style={{ fontSize: 11 }}>Upload de CSV van deze rekening voor meer detail.</span>
        </div>
      )}
    </div>
  );
}

export default function ViewPersonen({ allTx, maanden, allCategories, filterVan, filterTot, weergave, goToTx }) {
  const EXCL     = new Set(["inkomen", "familie", "sparen"]);
  const alleM    = [...maanden].sort();

  // Periodefilter: als actief, hanteer alleen maanden in de periode
  const inPeriode = m => (!filterVan || m >= filterVan) && (!filterTot || m <= filterTot);
  const filteredM  = alleM.filter(inPeriode);
  const nMaanden   = Math.max(filteredM.length, 1);

  function catBreak(txList) {
    const map = {};
    txList.forEach(t => { map[t.categorie] = (map[t.categorie] || 0) + Math.abs(t.bedrag); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }
  function maandBreak(txList) {
    const map = {};
    txList.forEach(t => { map[t.maand] = (map[t.maand] || 0) + Math.abs(t.bedrag); });
    return map;
  }

  const janUitg    = useMemo(() => allTx.filter(t => JAN_IBANS.has(t.rekening)    && t.bedrag < 0 && !EXCL.has(t.categorie) && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const sandraUitg = useMemo(() => allTx.filter(t => SANDRA_IBANS.has(t.rekening) && t.bedrag < 0 && !EXCL.has(t.categorie) && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const janInk     = useMemo(() => allTx.filter(t => JAN_IBANS.has(t.rekening)    && t.categorie === "inkomen" && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const sandraInk  = useMemo(() => allTx.filter(t => SANDRA_IBANS.has(t.rekening) && t.categorie === "inkomen" && inPeriode(t.maand)), [allTx, filterVan, filterTot]);

  const janCats     = useMemo(() => catBreak(janUitg),    [janUitg]);
  const sandraCats  = useMemo(() => catBreak(sandraUitg), [sandraUitg]);
  const janMaand    = useMemo(() => maandBreak(janUitg),    [janUitg]);
  const sandraMaand = useMemo(() => maandBreak(sandraUitg), [sandraUitg]);

  const janTotaal       = janUitg.reduce((s, t) => s + Math.abs(t.bedrag), 0);
  const sandraTotaal    = sandraUitg.reduce((s, t) => s + Math.abs(t.bedrag), 0);
  const janInkTotaal    = janInk.reduce((s, t) => s + t.bedrag, 0);
  const sandraInkTotaal = sandraInk.reduce((s, t) => s + t.bedrag, 0);

  const lauraTx    = useMemo(() => allTx.filter(t => isLaura(t) && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const lauraTotaal= lauraTx.reduce((s, t) => s + Math.abs(t.bedrag), 0);
  const lauraMaand = useMemo(() => maandBreak(lauraTx), [lauraTx]);

  const sofieOntvangen       = useMemo(() => allTx.filter(t => t.tegenpartij === SOFIE_IBAN && t.bedrag < 0 && (JAN_IBANS.has(t.rekening) || SANDRA_IBANS.has(t.rekening)) && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const sofieEigenUitg       = useMemo(() => allTx.filter(t => t.rekening === SOFIE_IBAN && t.bedrag < 0 && !EXCL.has(t.categorie) && inPeriode(t.maand)), [allTx, filterVan, filterTot]);
  const sofieCats            = useMemo(() => catBreak(sofieEigenUitg), [sofieEigenUitg]);
  const sofieOntvangenTotaal = sofieOntvangen.reduce((s, t) => s + Math.abs(t.bedrag), 0);
  const sofieEigenTotaal     = sofieEigenUitg.reduce((s, t) => s + Math.abs(t.bedrag), 0);
  const sofieMaand           = useMemo(() => {
    const m = maandBreak(sofieOntvangen);
    sofieEigenUitg.forEach(t => { m[t.maand] = (m[t.maand] || 0) + Math.abs(t.bedrag); });
    return m;
  }, [sofieOntvangen, sofieEigenUitg]);

  const maxMaandBedrag = Math.max(...filteredM.map(m => Math.max(janMaand[m]||0, sandraMaand[m]||0)), 1);

  const allCats  = [...new Set([...janCats.map(([c]) => c), ...sandraCats.map(([c]) => c)])];
  const janCatMap    = Object.fromEntries(janCats);
  const sandraCatMap = Object.fromEntries(sandraCats);
  const maxCat  = Math.max(...allCats.map(c => Math.max(janCatMap[c]||0, sandraCatMap[c]||0)), 1);
  const topCats = allCats
    .map(c => ({ cat: c, jan: janCatMap[c]||0, sandra: sandraCatMap[c]||0 }))
    .sort((a, b) => (b.jan + b.sandra) - (a.jan + a.sandra))
    .slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Jan & Sandra eigen verbruik */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, marginBottom: 14 }}>👫 Jan & Sandra — eigen verbruik</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <PersonCard name="Jan"    initials="J" color={JAN_CLR}    totaal={janTotaal}    inkTotaal={janInkTotaal}    cats={janCats}    nMaanden={nMaanden} allCategories={allCategories} weergave={weergave} ibans={JAN_IBANS}    goToTx={goToTx} />
          <PersonCard name="Sandra" initials="S" color={SANDRA_CLR} totaal={sandraTotaal} inkTotaal={sandraInkTotaal} cats={sandraCats} nMaanden={nMaanden} allCategories={allCategories} weergave={weergave} ibans={SANDRA_IBANS} goToTx={goToTx} />
        </div>
      </div>

      {/* Categorie-vergelijking */}
      {topCats.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>📊 Wie geeft meer uit per categorie?</div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginBottom: 18 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: JAN_CLR,    borderRadius: 2, marginRight: 4 }} />Jan</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: SANDRA_CLR, borderRadius: 2, marginRight: 4 }} />Sandra</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {topCats.map(({ cat, jan, sandra }) => {
              const c    = allCategories[cat] || CATEGORIES.overige;
              const janW = Math.min(100, (jan/maxCat)*100);
              const sanW = Math.min(100, (sandra/maxCat)*100);
              return (
                <div key={cat}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: C.text }}>{c.icon} {c.label}</span>
                    <span>
                      <span style={{ color: JAN_CLR,    fontWeight: 700 }}>{fmt(weergave !== "eff" ? jan/nMaanden : jan)}</span>
                      {" · "}
                      <span style={{ color: SANDRA_CLR, fontWeight: 700 }}>{fmt(weergave !== "eff" ? sandra/nMaanden : sandra)}</span>
                      {weergave !== "eff" && <span style={{ fontSize: 10, color: C.muted }}> /mnd</span>}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ background: "#e9eeef", borderRadius: 3, height: 7 }}><div style={{ width: `${janW}%`, height: "100%", background: JAN_CLR, borderRadius: 3 }} /></div>
                    <div style={{ background: "#e9eeef", borderRadius: 3, height: 7 }}><div style={{ width: `${sanW}%`, height: "100%", background: SANDRA_CLR, borderRadius: 3 }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Maandvergelijking grafiek */}
      {filteredM.length > 1 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 4 }}>📅 Verbruik per maand</div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted, marginBottom: 16 }}>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: JAN_CLR,    borderRadius: 2, marginRight: 4 }} />Jan</span>
            <span><span style={{ display: "inline-block", width: 10, height: 10, background: SANDRA_CLR, borderRadius: 2, marginRight: 4 }} />Sandra</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, overflowX: "auto" }}>
            {filteredM.slice(-24).map(m => {
              const j  = janMaand[m] || 0;
              const s  = sandraMaand[m] || 0;
              const jH = Math.round((j/maxMaandBedrag)*110);
              const sH = Math.round((s/maxMaandBedrag)*110);
              return (
                <div key={m} style={{ flex: "0 0 auto", minWidth: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 110 }}>
                    <div style={{ width: 14, height: jH, background: JAN_CLR,    borderRadius: "3px 3px 0 0", minHeight: j>0?2:0 }} title={`Jan: ${fmt(j)}`} />
                    <div style={{ width: 14, height: sH, background: SANDRA_CLR, borderRadius: "3px 3px 0 0", minHeight: s>0?2:0 }} title={`Sandra: ${fmt(s)}`} />
                  </div>
                  <span style={{ fontSize: 8, color: C.muted, whiteSpace: "nowrap" }}>{maandLabel(m)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Laura & Sofie */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, marginBottom: 14 }}>👧 Laura & Sofie</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <KindCard name="Laura" initials="L" color={LAURA_CLR}
            ontvangenTotaal={lauraTotaal}          eigenTotaal={0}               eigenCats={[]}     maandMap={lauraMaand}
            nMaanden={nMaanden} alleM={filteredM} allCategories={allCategories} weergave={weergave} />
          <KindCard name="Sofie" initials="S" color={SOFIE_CLR}
            ontvangenTotaal={sofieOntvangenTotaal} eigenTotaal={sofieEigenTotaal} eigenCats={sofieCats} maandMap={sofieMaand}
            nMaanden={nMaanden} alleM={filteredM} allCategories={allCategories} weergave={weergave} />
        </div>
      </div>

      {/* Samenvatting */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.teal, marginBottom: 14 }}>
          📋 Samenvatting — {weergave !== "eff" ? "gemiddeld per maand" : "effectief totaal"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {[
            { naam: "Jan",    kleur: JAN_CLR,    totaal: janTotaal },
            { naam: "Sandra", kleur: SANDRA_CLR, totaal: sandraTotaal },
            { naam: "Laura",  kleur: LAURA_CLR,  totaal: lauraTotaal },
            { naam: "Sofie",  kleur: SOFIE_CLR,  totaal: sofieOntvangenTotaal + sofieEigenTotaal },
          ].map(p => (
            <div key={p.naam} style={{ padding: "14px 16px", background: p.kleur+"12", borderRadius: 10, border: `1px solid ${p.kleur}30`, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: p.kleur, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>{p.naam}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: p.kleur }}>
                {weergave !== "eff" ? fmt(p.totaal/nMaanden) : fmt(p.totaal)}
              </div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                {weergave !== "eff" ? "/maand gemiddeld" : `totaal · gem. ${fmt(p.totaal/nMaanden)}/mnd`}
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
