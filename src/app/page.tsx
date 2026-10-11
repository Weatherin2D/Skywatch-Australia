import { Suspense } from "react";
import { WarningsListPage } from "@/components/warnings/warnings-list-page";

export const dynamic = "force-dynamic";

export default function WarningsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--page)] text-white/70">
          Loading warnings…
        </div>
      }
    >
      <WarningsListPage />
    </Suspense>
  );
}
