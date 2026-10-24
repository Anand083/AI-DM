export default function Home() {
  const appName = process.env.APP_NAME ?? "SEO Platform";
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{appName}</h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        SEO tools and branded reports for your agency.
      </p>
    </main>
  );
}
