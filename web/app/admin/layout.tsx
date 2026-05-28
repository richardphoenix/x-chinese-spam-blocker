import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { AdminNav } from "./nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  const login = (session as { login?: string }).login;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0c10]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-5 py-3">
          <span className="flex items-center gap-1.5 font-[family-name:var(--font-display)] text-base font-extrabold tracking-tight text-amber-300">
            <span aria-hidden>🛡️</span>
            <span>Spam 审核台</span>
          </span>
          <AdminNav />
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-400">
            {login ? <span className="font-mono">@{login}</span> : null}
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-white/10 px-3 py-1 text-zinc-300 transition hover:border-white/25 hover:text-white"
              >
                登出
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">{children}</main>
    </div>
  );
}
