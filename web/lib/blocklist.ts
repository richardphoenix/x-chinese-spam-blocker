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
  if (list.some((e) => String(e.user_id) === String(entry.user_id))) {
    return { list, added: false };
  }
  return { list: [...list, entry], added: true };
}
