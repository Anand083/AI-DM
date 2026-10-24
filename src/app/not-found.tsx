import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/app" className="mt-6 text-sm underline">
        Go to the app
      </Link>
    </main>
  );
}
