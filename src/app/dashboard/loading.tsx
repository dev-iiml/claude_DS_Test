import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8" role="status" aria-label="Loading dashboard">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-10 w-72" />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}
