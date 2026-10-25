import Link from "next/link";

export function SiteFooter({ appName }: { appName: string }) {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-zinc-600 dark:text-zinc-400">
        <p>{appName}</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link href="/contact" className="underline-offset-4 hover:underline">
            Contact
          </Link>
          <Link href="/login" className="underline-offset-4 hover:underline">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
