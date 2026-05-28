import { auth } from "@/auth";

// next-auth's auth() wrapper returns the actual handler. Next.js 16 statically
// requires the middleware module to export a recognizable function declaration,
// so we wrap the handler in a named default function rather than the
// `export default auth(...)` form (a call expression), which Next 16 rejects.
const handler = auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL("/login", req.nextUrl.origin));
  }
});

export default function middleware(...args: Parameters<typeof handler>) {
  return handler(...args);
}

export const config = { matcher: ["/admin/:path*"] };
