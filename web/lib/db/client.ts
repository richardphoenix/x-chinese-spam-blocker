import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Lazily constructed so that importing this module does NOT trigger env
// validation at module load time (e.g. during Next.js build page-data collection).
let _db: NeonHttpDatabase<typeof schema> | undefined;

export const db: NeonHttpDatabase<typeof schema> = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    if (!_db) {
      const sql = neon(env.DATABASE_URL);
      _db = drizzle(sql, { schema });
    }
    return Reflect.get(_db, prop, receiver);
  },
});
