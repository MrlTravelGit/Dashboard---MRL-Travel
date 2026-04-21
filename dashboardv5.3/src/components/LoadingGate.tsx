import React from "react";
import { Loader2 } from "lucide-react";
import { resetSessionAndReload } from "@/utils/resetSession";

type Props = {
  label?: string;
};

export function LoadingGate({ label = "Carregando..." }: Props) {
  const [showReset, setShowReset] = React.useState(false);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const lastKnownAdmin = localStorage.getItem("lastKnownAdmin");
        if (lastKnownAdmin === "1") setShowReset(true);
      } catch {
        // ignore
      }
    }, 10000);

    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="text-sm text-muted-foreground">{label}</div>

        {showReset ? (
          <button
            type="button"
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            onClick={() => void resetSessionAndReload()}
          >
            Reiniciar cookies e sessão
          </button>
        ) : null}
      </div>
    </div>
  );
}
