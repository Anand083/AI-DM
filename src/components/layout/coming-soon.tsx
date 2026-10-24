import { EmptyState } from "@/components/ui/empty-state";

/** Page body for menu items whose feature is built in a later step. */
export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <EmptyState className="mt-6" title="Coming soon" description={description} />
    </>
  );
}
