// ── Bekende familierekeningen (Buytaert) ──────────────────────────────────
export const DEFAULT_FAMILY_ACCOUNTS = {
  "BE12290019028892": { label: "Jan – Zichtrekening",   kleur: "#0D4A52", eigenaar: "Jan" },
  "BE34290019028690": { label: "Sandra – Zichtrekening",kleur: "#1A6B7C", eigenaar: "Sandra" },
  "BE66290786264843": { label: "Sandra – Rekening 2",   kleur: "#2A8A9C", eigenaar: "Sandra" },
  "BE08034404717913": { label: "Jan – Spaarrekening",   kleur: "#558B2F", eigenaar: "Jan" },
  "BE95001677814858": { label: "Sofie",                 kleur: "#E65100", eigenaar: "Sofie" },
};

// ── Categorieën ───────────────────────────────────────────────────────────
export const CATEGORIES = {
  inkomen:    { label: "Inkomsten",          icon: "💰", color: "#0a7c5c", bg: "#e6f4f1", reducible: false },
  wonen:      { label: "Wonen & Energie",    icon: "🏠", color: "#1565C0", bg: "#E3F2FD", reducible: false },
  voeding:    { label: "Voeding",            icon: "🛒", color: "#2E7D32", bg: "#E8F5E9", reducible: true,  maxReduc: 25 },
  vervoer:    { label: "Vervoer",            icon: "🚗", color: "#00838F", bg: "#E0F7FA", reducible: true,  maxReduc: 20 },
  gezondheid: { label: "Gezondheid",         icon: "🏥", color: "#C62828", bg: "#FFEBEE", reducible: false },
  shopping:   { label: "Shopping",           icon: "🛍️",  color: "#6A1B9A", bg: "#F3E5F5", reducible: true,  maxReduc: 60 },
  sport:      { label: "Sport & Vrije tijd", icon: "🎾", color: "#E65100", bg: "#FBE9E7", reducible: true,  maxReduc: 35 },
  restaurant: { label: "Restaurant & Café",  icon: "🍽️",  color: "#F57F17", bg: "#FFF8E1", reducible: true,  maxReduc: 70 },
  telecom:    { label: "Telecom & Media",    icon: "📱", color: "#0277BD", bg: "#E1F5FE", reducible: false },
  financieel: { label: "Financieel",         icon: "🏦", color: "#37474F", bg: "#ECEFF1", reducible: false },
  sparen:     { label: "Sparen",             icon: "🐷", color: "#33691E", bg: "#F1F8E9", reducible: false },
  familie:    { label: "Intern (familie)",   icon: "👨‍👩‍👧", color: "#757575", bg: "#F5F5F5", reducible: false },
  muzad:      { label: "Muzad",              icon: "💼", color: "#C9922A", bg: "#FDF5E6", reducible: false },
  overige:    { label: "Overige",            icon: "❓", color: "#9E9E9E", bg: "#FAFAFA", reducible: true,  maxReduc: 50 },
};

// ── Categorisatieregels ───────────────────────────────────────────────────
// Gematch op: details + tegenpartijNaam + mededeling (allemaal lowercase)
const RULES = [
  // Sparen eerst (hogere prioriteit)
  { kw: ["spaarabonnement", "spaarrekening", "spaargeld", "BE08 0344 0471 7913".toLowerCase()], cat: "sparen" },

  // Wonen & Energie
  { kw: ["eneco", "luminus", "eandis", "fluvius", "farys", "nuon", "huur ", "hypotheek",
          "homeserve", "syndi", "water ", "energi", "stroom", "gas "], cat: "wonen" },

  // Voeding
  { kw: ["colruyt", "lidl", "carrefour", "aldi", "delhaize", "spar ", "okay ", "albert heijn",
          "bakkerij", "boulangerie", "bakker ", "slagerij", "boucherie",
          "proxy riva", "vanzo supply", "night shop", "bio-planet", "bioplanet", "jumbo",
          "traiteur", "supermarkt", "supermarché", "frituur", "friterie", "appel 9090",
          "biowinkel", "gb shop"], cat: "voeding" },

  // Vervoer
  { kw: ["esso", "shell", "total ", "q8 ", "texaco", "benzine", "diesel", "tanken",
          "parking", "mivb", "stib", "de lijn", "nmbs", "sncb", "eurostar", "thalys",
          "taxi", "uber ", "bolt ", "velo ", "carpark", "interparking", "mobib"], cat: "vervoer" },

  // Gezondheid
  { kw: ["apotheek", "pharmacie", "farmacie", "dokter", "médecin", "dentius", "tandarts",
          "dentiste", "kinesist", "kiné", "helan", "cm ziekenfonds", "mutualit",
          "ziekenfonds", "riziv", "hospital", "ziekenhuis", "specialist",
          "opticien", "optiek", "finesse", "labo ", "radiolog", "dermatol"], cat: "gezondheid" },

  // Restaurant & Café
  { kw: ["restaurant", "brasserie", "bistro", "taverne", "estaminet",
          "herman teirlinck", "belpaire", "wijnendaele", "cafe ", "café "], cat: "restaurant" },

  // Sport & Vrije tijd
  { kw: ["padel", "padelclub", "ls fit", "fitness", "zwembad", "piscine", "tennis",
          "voetbal", "squash", "yoga", "pilates", "bioscoop", "cinema",
          "theater", "concert", "ticketmaster", "eventbrite",
          "hotel ", "booking.com", "airbnb", "camping", "sporthal", "tc "], cat: "sport" },

  // Shopping
  { kw: ["bol.com", "bolcom", "zalando", "h&m ", " hm ", "zara", "primark", "jbc ",
          "kiabi", "c&a", "fnac", "mediamarkt", "coolblue", "amazon", "ikea",
          "brico", "action ", "zeeman", "fashion", "kledij", "marc p2p"], cat: "shopping" },

  // Telecom
  { kw: ["proximus", "orange ", "telenet", "scarlet", "voo ", "mobile viking",
          "gsm abonnement", "internet abonnement"], cat: "telecom" },

  // Financieel
  { kw: ["verzekering", "assurance", "kbc ", "belfius", "argenta", "axa ",
          "ag insurance", "mensura", "allianz", "baloise", "fidea", "vivium",
          "bankkosten", "beheerskost", "dossierkosten", "commissie bank"], cat: "financieel" },

  // Muzad
  { kw: ["muzad"], cat: "muzad" },
];

// ── Merchant naam extraheren ──────────────────────────────────────────────
export function getMerchantName(tx) {
  if (tx.type === "Kaartbetaling") {
    // Format: "...BETALING MET DEBETKAART NUMMER 4871 04XX XXXX 4761 MERCHANT 9090 CITY DD/MM/YYYY..."
    const m = tx.details.match(/XXXX\s+\d{4}\s+(.+?)(?:\s+\d{4,5}\s+[A-Z]|\s+\d{1,2}\/\d{2}\/\d{4}|$)/);
    if (m) return m[1].trim();
    const m2 = tx.details.match(/XXXX \d{4} ([A-Z].+?)(?:\s+\d{4,5}|\s+\d{1,2}\/|$)/);
    if (m2) return m2[1].trim();
  }
  if (tx.type === "Domiciliëring") {
    const m = tx.details.match(/EUROPESE DOMICILIERING VAN (.+?) MANDAAT/i);
    if (m) return m[1].trim();
  }
  if (tx.tegenpartijNaam) return tx.tegenpartijNaam;
  if (tx.mededeling) return tx.mededeling.slice(0, 60);
  return tx.details.slice(0, 60) || "Onbekend";
}

// ── Categoriseer een transactie ───────────────────────────────────────────
export function categorize(tx, familyIBANs) {
  const haystack = `${tx.details} ${tx.tegenpartijNaam} ${tx.mededeling}`.toLowerCase();

  const tegenInFamily = familyIBANs.has(tx.tegenpartij);
  const rekeningInFamily = familyIBANs.has(tx.rekening);

  // Intern familietransfer (beide kanten zijn familierekeningen)
  if (tegenInFamily && rekeningInFamily) {
    if (haystack.includes("spaar")) return "sparen";
    return "familie";
  }

  // Inkomsten (positief + niet van familierekening)
  if (tx.bedrag > 0 && !tegenInFamily) return "inkomen";
  // Positief van familierekening = intern ontvangen
  if (tx.bedrag > 0) return "familie";

  // Categoriseringsregels
  for (const rule of RULES) {
    if (rule.kw.some(k => haystack.includes(k))) return rule.cat;
  }

  return "overige";
}

// ── Verwerk een batch transacties ─────────────────────────────────────────
export function processTxList(txList, familyIBANs) {
  return txList.map(tx => ({
    ...tx,
    merchant: getMerchantName(tx),
    categorie: categorize(tx, familyIBANs),
  }));
}

// ── Auto-detecteer rekeningen die aanwezig zijn in de data ────────────────
export function detectAccounts(txList) {
  const found = {};
  txList.forEach(tx => {
    if (tx.rekening && !found[tx.rekening]) {
      found[tx.rekening] = DEFAULT_FAMILY_ACCOUNTS[tx.rekening] || {
        label: tx.rekening,
        kleur: "#9E9E9E",
        eigenaar: "Onbekend",
      };
    }
  });
  return found;
}
