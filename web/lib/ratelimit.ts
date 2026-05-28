import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

// Lazily constructed so that importing this module (e.g. to use clientIp in
// tests) does NOT trigger env validation or Redis/Ratelimit construction.
let _submitRatelimit: Ratelimit | undefined;

export function getSubmitRatelimit(): Ratelimit {
  if (!_submitRatelimit) {
    _submitRatelimit = new Ratelimit({
      redis: new Redis({
        url: env.KV_REST_API_URL,
        token: env.KV_REST_API_TOKEN,
      }),
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "submit",
    });
  }
  return _submitRatelimit;
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
