"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin", label: "审核队列" },
  { href: "/admin/keywords", label: "关键词" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-full px-3 py-1 text-sm transition ${
              active
                ? "bg-amber-400/15 text-amber-200"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
