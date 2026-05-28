import { expect, test } from "vitest";
import { buildBlocklistEntry, upsertBlocklistEntry } from "@/lib/blocklist";

const review = {
  user_id: "1234567890",
  screen_name: "spam_acct",
  display_name: "锦颖🌸 寻固炮 🌸",
  category: "寻固炮",
  reason: "典型寻固炮模板",
  evidence: "https://x.com/spam_acct/status/1",
};

test("buildBlocklistEntry maps review fields to blocklist schema", () => {
  const e = buildBlocklistEntry(review, "2026-05-27");
  expect(e).toEqual({
    user_id: "1234567890",
    screen_name: "spam_acct",
    name: "锦颖🌸 寻固炮 🌸",
    reason: "典型寻固炮模板",
    category: "寻固炮",
    added: "2026-05-27",
    evidence: "https://x.com/spam_acct/status/1",
  });
});

test("upsert appends a new entry", () => {
  const entry = buildBlocklistEntry(review, "2026-05-27");
  const result = upsertBlocklistEntry([], entry);
  expect(result.added).toBe(true);
  expect(result.list).toHaveLength(1);
});

test("upsert is a no-op when screen_name already present (case-insensitive)", () => {
  const entry = buildBlocklistEntry(review, "2026-05-27");
  // same screen_name, different case + different user_id → still a duplicate
  const existing = [{ ...entry, reason: "old", screen_name: "SPAM_ACCT", user_id: "999" }];
  const result = upsertBlocklistEntry(existing, entry);
  expect(result.added).toBe(false);
  expect(result.list).toHaveLength(1);
  expect(result.list[0].reason).toBe("old");
});
