export type BlocklistEntry = {
  user_id: string;
  screen_name: string;
  name: string;
  reason: string;
  category: string;
  added: string;
  evidence: string;
};

export type ReviewInput = {
  user_id: string;
  screen_name: string;
  display_name: string;
  category: string;
  reason: string;
  evidence: string;
};

export function buildBlocklistEntry(r: ReviewInput, addedDate: string): BlocklistEntry {
  return {
    user_id: r.user_id,
    screen_name: r.screen_name,
    name: r.display_name,
    reason: r.reason,
    category: r.category,
    added: addedDate,
    evidence: r.evidence,
  };
}

export function upsertBlocklistEntry(
  list: BlocklistEntry[],
  entry: BlocklistEntry,
): { list: BlocklistEntry[]; added: boolean } {
  // Dedup by screen_name (case-insensitive) — the reliable identity. user_id is
  // vestigial (avatar image id) and not unique per account.
  const key = String(entry.screen_name || "").toLowerCase();
  if (key && list.some((e) => String(e.screen_name || "").toLowerCase() === key)) {
    return { list, added: false };
  }
  return { list: [...list, entry], added: true };
}
