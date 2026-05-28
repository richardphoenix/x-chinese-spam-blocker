import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 blur-[120px]"
      />
      <div className="reveal w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="font-[family-name:var(--font-display)] text-xl font-extrabold tracking-tight text-amber-300">
          🛡️ Spam 审核台
        </div>
        <p className="mt-2 text-sm text-zinc-500">X 中文 spam 黑名单提交与审核后台</p>
        <form
          className="mt-7"
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/admin" });
          }}
        >
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
          >
            用 GitHub 登录
          </button>
        </form>
        <p className="mt-4 text-xs text-zinc-600">仅限维护者账号</p>
      </div>
    </main>
  );
}
