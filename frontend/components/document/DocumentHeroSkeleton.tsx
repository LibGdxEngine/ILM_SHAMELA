export default function DocumentHeroSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="landing-shell border-b border-border px-6 sm:px-10 lg:px-16 pt-10 pb-12 relative overflow-hidden"
    >
      <div className="mx-auto max-w-5xl relative z-10 animate-pulse">
        <div className="mb-8 h-5 w-24 rounded bg-white/[0.04]" />
        <div className="grid grid-cols-12 gap-6 md:gap-10">
          <div className="col-span-4 md:col-span-3">
            <div className="mx-auto aspect-[3/4] max-w-[170px] rounded-[14px] bg-white/[0.05] md:max-w-none" />
          </div>
          <div className="col-span-8 md:col-span-9 flex flex-col gap-5">
            <div className="space-y-3">
              <div className="h-3 w-16 rounded bg-white/[0.05]" />
              <div className="h-9 w-3/4 rounded bg-white/[0.05]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="h-7 w-24 rounded-full bg-white/[0.04]" />
              <div className="h-7 w-20 rounded-full bg-white/[0.04]" />
              <div className="h-7 w-16 rounded-full bg-white/[0.04]" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full rounded bg-white/[0.04]" />
              <div className="h-3 w-11/12 rounded bg-white/[0.04]" />
              <div className="h-3 w-5/6 rounded bg-white/[0.04]" />
            </div>
            <div className="flex gap-2 pt-1">
              <div className="h-11 w-36 rounded-full bg-white/[0.05]" />
              <div className="h-11 w-32 rounded-full bg-white/[0.04]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
