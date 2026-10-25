import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
] as const;

export function SiteHeader({ appName }: { appName: string }) {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          {appName}
        </Link>
        <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="underline-offset-4 hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/login" className="underline-offset-4 hover:underline">
            Sign in
          </Link>
          <Link href="/signup" className={buttonClasses()}>
            Start free trial
          </Link>
        </div>
      </div>
    </header>
  );
}
