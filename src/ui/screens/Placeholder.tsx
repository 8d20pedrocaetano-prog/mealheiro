export function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <div className="flex flex-col gap-2 py-10 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-ink-2">Arrives in {milestone}.</p>
    </div>
  );
}
