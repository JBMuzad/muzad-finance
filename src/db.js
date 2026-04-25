import { supabase } from "./supabase.js";

// ── Transacties ───────────────────────────────────────────────────────────

export async function dbLoadTransactions() {
  const { data, error } = await supabase
    .from("finance_transactions")
    .select("*")
    .order("datum", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Upsert: voegt nieuwe toe, overschrijft bestaande NIET (categorie bewaren)
export async function dbUpsertTransactions(transactions) {
  if (!transactions.length) return;
  const { error } = await supabase
    .from("finance_transactions")
    .upsert(
      transactions.map(({ details, ...t }) => ({   // strip details voor DB
        id:              t.id,
        volgnummer:      t.volgnummer,
        datum:           t.datum,
        maand:           t.maand,
        bedrag:          t.bedrag,
        rekening:        t.rekening,
        type:            t.type,
        tegenpartij:     t.tegenpartij,
        tegenpartij_naam: t.tegenpartijNaam,
        mededeling:      t.mededeling,
        categorie:       t.categorie,
        merchant:        t.merchant,
      })),
      { onConflict: "id", ignoreDuplicates: true }  // bestaande rijen niet overschrijven
    );
  if (error) throw error;
}

// Update categorie voor één of meerdere transacties
export async function dbUpdateCategorie(ids, categorie) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("finance_transactions")
    .update({ categorie })
    .in("id", ids);
  if (error) throw error;
}

// ── Instellingen ──────────────────────────────────────────────────────────

export async function dbLoadSetting(key, defaultValue = null) {
  const { data, error } = await supabase
    .from("finance_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return defaultValue;
  return data.value;
}

export async function dbSaveSetting(key, value) {
  const { error } = await supabase
    .from("finance_settings")
    .upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

// Laad alle instellingen in één keer
export async function dbLoadAllSettings() {
  const { data, error } = await supabase
    .from("finance_settings")
    .select("key, value");
  if (error) return {};
  return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}
