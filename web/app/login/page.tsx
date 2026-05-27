import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/admin" });
        }}
      >
        <button type="submit">用 GitHub 登录</button>
      </form>
    </main>
  );
}
