"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-6xl font-bold text-muted-foreground">
          500
        </span>
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-sm text-muted-foreground text-sm">
          An unexpected error occurred. Please try again.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button asChild variant="ghost">
          <a href="/">Go home</a>
        </Button>
      </div>
    </div>
  );
}
