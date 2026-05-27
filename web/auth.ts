import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "@/lib/env";
import type { GitHubProfile } from "@auth/core/providers/github";

// Use lazy initialization so env vars are not read at module load time (build phase).
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
      authorization: { params: { scope: "read:user public_repo" } },
    }),
  ],
  callbacks: {
    // Only the allowlisted maintainer may sign in.
    async signIn({ profile }) {
      return (profile as GitHubProfile | undefined)?.login === env.ADMIN_GITHUB_LOGIN;
    },
    // Persist the GitHub access token + login so we can commit as the maintainer.
    async jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile) token.login = (profile as unknown as GitHubProfile).login;
      return token;
    },
    async session({ session, token }) {
      (session as { accessToken?: string }).accessToken = token.accessToken as string | undefined;
      (session as { login?: string }).login = token.login as string | undefined;
      return session;
    },
  },
}));
