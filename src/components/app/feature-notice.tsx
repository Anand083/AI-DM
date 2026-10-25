/** Shown on a page whose feature the current data source cannot give yet. */
export function FeatureNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-medium">Not available yet</p>
      <p>{message} Existing results stay visible, but new checks cannot be started.</p>
    </div>
  );
}
