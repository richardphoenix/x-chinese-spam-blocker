import { expect, test } from "vitest";
import { clientIp } from "@/lib/ratelimit";

test("clientIp prefers x-forwarded-for first hop", () => {
  const h = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
  expect(clientIp(h)).toBe("1.2.3.4");
});

test("clientIp falls back to a constant when header absent", () => {
  expect(clientIp(new Headers())).toBe("unknown");
});
