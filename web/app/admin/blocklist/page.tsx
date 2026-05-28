import { auth } from "@/auth";
import { listBlocklistEntries } from "@/lib/github";
import { BlocklistManager } from "./blocklist-manager";

export const dynamic = "force-dynamic";

export default async function BlocklistPage() {
  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  let entries: Awaited<ReturnType<typeof listBlocklistEntries>> = [];
  let error = "";
  try {
    if (token) entries = await listBlocklistEntries(token);
    else error = "未获取到 GitHub 授权";
  } catch {
    error = "读取 blocklist.json 失败";
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white">
          黑名单
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          已收录的账号。误收的可移除（会从 <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-300">blocklist.json</code> 删除并提交）。
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      ) : (
        <BlocklistManager entries={entries} />
      )}
    </>
  );
}
