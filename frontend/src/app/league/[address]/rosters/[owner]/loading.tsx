export default function Loading() {
  return (
    <div className="px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="h-6 w-40 rounded bg-white/10 animate-pulse" />
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-white/10 bg-white/[0.05] animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
