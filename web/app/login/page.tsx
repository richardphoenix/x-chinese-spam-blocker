import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/admin" });
        }}
      >
        <Button type="submit">用 GitHub 登录</Button>
      </form>
    </main>
  );
}
