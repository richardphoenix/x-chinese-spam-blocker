import { expect, test } from "vitest";
import { parseEnv } from "@/lib/env";

const full = {
  DATABASE_URL: "postgres://x",
  AUTH_SECRET: "s",
  AUTH_GITHUB_ID: "id",
  AUTH_GITHUB_SECRET: "secret",
  ADMIN_GITHUB_LOGIN: "richardphoenix",
  UPSTASH_REDIS_REST_URL: "https://u",
  UPSTASH_REDIS_REST_TOKEN: "t",
  GITHUB_REPO_OWNER: "richardphoenix",
  GITHUB_REPO_NAME: "x-chinese-spam-blocker",
  GITHUB_BLOCKLIST_PATH: "blocklist/blocklist.json",
  GITHUB_BRANCH: "main",
};

test("parses a full env", () => {
  const env = parseEnv(full);
  expect(env.ADMIN_GITHUB_LOGIN).toBe("richardphoenix");
});

test("throws when a required var is missing", () => {
  const { DATABASE_URL, ...rest } = full;
  expect(() => parseEnv(rest)).toThrow();
});
