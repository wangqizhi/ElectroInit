export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16">
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            ElectroInit
          </p>
          <h1 className="mt-3 text-3xl font-semibold">
            React + Vite + Tailwind + shadcn/ui
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Frontend scaffold is ready. Run the dev script to enable hot reload.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Primary Action
            </button>
            <button className="rounded-md border px-4 py-2 text-sm font-medium">
              Secondary
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
