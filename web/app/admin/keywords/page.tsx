import { auth } from "@/auth";
import { readKeywords } from "@/lib/github";
import { KeywordEditor } from "./keyword-editor";

export const dynamic = "force-dynamic";

export default async function KeywordsPage() {
  const session = await auth();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  let content = "";
  let error = "";
  try {
    if (token) content = await readKeywords(token);
    else error = "未获取到 GitHub 授权";
  } catch {
    error = "读取 spam-keywords.txt 失败";
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white">
          关键词
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          编辑 <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-zinc-300">spam-keywords.txt</code>
          ，保存即提交到 GitHub。每行一个，<span className="text-zinc-400">#</span> 开头为注释。
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          {error}
        </p>
      ) : (
        <KeywordEditor initial={content} />
      )}
    </>
  );
}
