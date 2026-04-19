export default function DocumentHeroSkeleton() {
  return (
    <section
      aria-hidden="true"
      className="border-b border-border-cream bg-gradient-to-b from-ivory via-ivory to-parchment/60 px-4 pt-10 pb-8 md:px-8"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 h-5 w-24 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-12 gap-6 md:gap-8">
          <div className="col-span-4 md:col-span-3">
            <div className="mx-auto aspect-[3/4] max-w-[160px] animate-pulse rounded-2xl bg-gray-200 md:max-w-none" />
          </div>
          <div className="col-span-8 md:col-span-9 flex flex-col gap-4">
            <div className="h-8 w-3/4 animate-pulse rounded bg-gray-200" />
            <div className="flex flex-wrap gap-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-gray-200" />
              <div className="h-6 w-16 animate-pulse rounded-full bg-gray-200" />
              <div className="h-6 w-24 animate-pulse rounded-full bg-gray-200" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-11/12 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="flex gap-2">
              <div className="h-10 w-32 animate-pulse rounded-xl bg-gray-200" />
              <div className="h-10 w-28 animate-pulse rounded-xl bg-gray-200" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
