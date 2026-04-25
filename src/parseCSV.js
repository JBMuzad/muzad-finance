// ── CSV Parser voor Belgisch ING-formaat (puntkomma-gescheiden) ──

export function parseCSV(text) {
  const rawLines = text.trim().split(/\r?\n/);
  if (rawLines.length < 2) return [];

  const headers = rawLines[0].split(";").map(h => h.trim().replace(/^"|"$/g, ""));

  return rawLines
    .slice(1)
    .map(line => {
      // Split on semicolon but respect quoted fields
      const fields = splitLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (fields[i] || "").trim().replace(/^"|"$/g, "");
      });

      const rawBedrag = obj["Bedrag"] || "0";
      const bedrag = parseFloat(rawBedrag.replace(",", ".").replace(/\s/g, ""));

      const rawDatum = obj["Uitvoeringsdatum"] || "01/01/2000";
      const parts = rawDatum.split("/");
      const d = (parts[0] || "01").padStart(2, "0");
      const m = (parts[1] || "01").padStart(2, "0");
      const y = parts[2] || "2000";

      return {
        id: `${obj["Rekeningnummer"]}_${obj["Volgnummer"]}`,
        volgnummer: obj["Volgnummer"],
        datum: `${y}-${m}-${d}`,
        maand: `${y}-${m}`,
        bedrag: isNaN(bedrag) ? 0 : bedrag,
        rekening: obj["Rekeningnummer"],
        type: obj["Type verrichting"],
        tegenpartij: obj["Tegenpartij"],
        tegenpartijNaam: obj["Naam van de tegenpartij"],
        mededeling: obj["Mededeling"],
        details: obj["Details"],
        status: obj["Status"],
        categorie: null,   // filled by categorize()
        merchant: null,    // filled by extractMerchant()
      };
    })
    .filter(t => t.status === "Geaccepteerd" && t.bedrag !== 0);
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
