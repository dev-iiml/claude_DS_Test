import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-22 sm:px-8 sm:pt-26" role="status" aria-label="Loading step">
      <Skeleton className="h-1 w-full" />
      <Skeleton className="mt-10 h-3 w-32" />
      <Skeleton className="mt-4 h-9 w-72" />
      <Skeleton className="mt-10 h-11 w-full" />
      <Skeleton className="mt-6 h-11 w-full" />
    </div>
  );
}
