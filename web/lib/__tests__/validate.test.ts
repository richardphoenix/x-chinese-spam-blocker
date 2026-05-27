import { expect, test } from "vitest";
import { validateSubmission } from "@/lib/validate";

test("accepts a valid submission and normalizes optional fields", () => {
  const r = validateSubmission({
    user_id: "1234567890",
    screen_name: "spam_acct",
    display_name: "锦颖🌸 寻固炮 🌸",
    tweet_text: "🌸 寻固炮 🌸 点击主页",
    source_url: "https://x.com/spam_acct/status/1",
    detected_reasons: ["keyword:寻固炮"],
    detected_score: 73,
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.user_id).toBe("1234567890");
    expect(r.value.detected_reasons).toEqual(["keyword:寻固炮"]);
  }
});

test("rejects non-numeric user_id", () => {
  const r = validateSubmission({ user_id: "abc" });
  expect(r.ok).toBe(false);
});

test("rejects missing user_id", () => {
  const r = validateSubmission({});
  expect(r.ok).toBe(false);
});

test("defaults optional fields", () => {
  const r = validateSubmission({ user_id: "42" });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.detected_reasons).toEqual([]);
    expect(r.value.screen_name).toBe("");
    expect(r.value.detected_score).toBe(0);
  }
});
