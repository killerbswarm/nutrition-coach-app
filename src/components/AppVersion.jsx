import React, { useEffect, useState } from "react";
import { APP_VERSION } from "../version";

export default function AppVersion() {
  const [latest, setLatest] = useState(APP_VERSION);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && data?.version) setLatest(String(data.version));
      } catch {
        /* ignore */
      }
    };
    check();
    const id = setInterval(check, 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const stale = latest && latest !== APP_VERSION;

  return (
    <div className="px-1 space-y-2">
      <div className="text-[10px] text-slate-500 font-mono">v{APP_VERSION}</div>
      {stale && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full text-left px-2 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold"
        >
          New version {latest}. Tap to refresh.
        </button>
      )}
    </div>
  );
}