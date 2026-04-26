// ── CSV Parser voor Belgisch ING-formaat (puntkomma-gescheiden) ──

export function parseCSV(text) {
  // Strip BOM (Byte Order Mark) — ING voegt dit soms toe aan CSV-exports
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  const rawLines = cleaned.split(/\r?\n/);
  if (rawLines.length < 2) return [];

  const headers = rawLines[0].split(";").map(h => h.trim().replace(/^"|"$/g, ""));

  // Bouw een case-insensitive header-index voor veerkrachtigheid
  const hIdx = {};
  headers.forEach((h, i) => { hIdx[h.toLowerCase()] = i; });

  function col(obj, ...names) {
    for (const n of names) {
      const v = obj[n];
      if (v !== undefined && v !== "") return v;
      // probeer lowercase-match
      const lk = Object.keys(obj).find(k => k.toLowerCase() === n.toLowerCase());
      if (lk && obj[lk] !== "") return obj[lk];
    }
    return "";
  }

  const rows = rawLines
    .slice(1)
    .filter(line => line.trim() !== "")
    .map(line => {
      const fields = splitLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (fields[i] || "").trim().replace(/^"|"$/g, "");
      });

      // Bedrag — komma als decimaalteken, punten als duizendtallen
      const rawBedrag = col(obj, "Bedrag", "Amount") || "0";
      const bedrag = parseFloat(rawBedrag.replace(/\./g, "").replace(",", ".").replace(/\s/g, ""));

      // Datum — DD/MM/YYYY of YYYY-MM-DD
      const rawDatum = col(obj, "Uitvoeringsdatum", "Datum", "Date", "Boekdatum") || "01/01/2000";
      let datum = "2000-01-01";
      let maand = "2000-01";
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDatum)) {
        // DD/MM/YYYY
        const [d, m, y] = rawDatum.split("/");
        datum = `${y}-${m}-${d}`;
        maand = `${y}-${m}`;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDatum)) {
        // YYYY-MM-DD
        datum = rawDatum;
        maand = rawDatum.slice(0, 7);
      }

      const rekening   = col(obj, "Rekeningnummer", "Account", "IBAN");
      const volgnummer = col(obj, "Volgnummer", "Sequence", "Nr");
      const status     = col(obj, "Status").toLowerCase().trim();

      return {
        id: `${rekening}_${volgnummer || datum + "_" + Math.abs(bedrag)}`,
        volgnummer,
        datum,
        maand,
        bedrag: isNaN(bedrag) ? 0 : bedrag,
        rekening,
        type:           col(obj, "Type verrichting", "Type", "Transactietype"),
        tegenpartij:    col(obj, "Tegenpartij", "Counterpart", "Tegenrekening"),
        tegenpartijNaam: col(obj, "Naam van de tegenpartij", "Naam tegenpartij", "Naam"),
        mededeling:     col(obj, "Mededeling", "Omschrijving", "Description", "Beschrijving"),
        details:        col(obj, "Details"),
        status:         col(obj, "Status"),
        categorie: null,
        merchant:  null,
      };
    })
    .filter(t => {
      if (t.bedrag === 0) return false;
      if (!t.rekening)    return false;
      // Verwerp enkel expliciet geannuleerde transacties
      const s = t.status.toLowerCase().trim();
      if (s === "geannuleerd" || s === "geweigerd" || s === "cancelled" || s === "rejected") return false;
      return true;
    });

  return rows;
}

function splitLine(line) {
  const fields = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ";" && !inQuote) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}
