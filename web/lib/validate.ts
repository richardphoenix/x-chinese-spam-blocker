import { z } from "zod";

const schema = z.object({
  user_id: z.string().regex(/^\d{1,25}$/, "user_id must be numeric"),
  screen_name: z.string().max(50).optional().default(""),
  display_name: z.string().max(200).optional().default(""),
  tweet_text: z.string().max(2000).optional().default(""),
  source_url: z.string().max(500).optional().default(""),
  detected_reasons: z.array(z.string().max(200)).max(50).optional().default([]),
  detected_score: z.number().int().min(0).max(100).optional().default(0),
});

export type ValidSubmission = z.infer<typeof schema>;

export type ValidateResult =
  | { ok: true; value: ValidSubmission }
  | { ok: false; errors: string[] };

export function validateSubmission(input: unknown): ValidateResult {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
}
