"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Search } from "lucide-react";
import type { BomLocation } from "@/lib/weather/location-forecast";
import { cn } from "@/lib/utils";

type Props = {
  initialQuery?: string;
  compact?: boolean;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  onSelect?: (location: BomLocation) => void;
};

export function LocationSearch({
  initialQuery = "",
  compact = false,
  className,
  inputClassName,
  autoFocus = false,
  onSelect,
}: Props) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<BomLocation[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  function updateMenuPos() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, compact ? 220 : 280),
    });
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/weather/locations?q=${encodeURIComponent(q)}`,
          { signal: ac.signal, cache: "no-store" },
        );
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as { locations: BomLocation[] };
        if (ac.signal.aborted) return;
        setResults(data.locations || []);
        setActive(0);
        setOpen(true);
        updateMenuPos();
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setResults([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Search failed");
        setOpen(true);
        updateMenuPos();
      }
    }, 220);
    return () => {
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    function onReposition() {
      updateMenuPos();
    }
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, compact]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      const menu = document.getElementById(listId);
      if (menu?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [listId]);

  function choose(loc: BomLocation) {
    setQuery(loc.name);
    setOpen(false);
    if (onSelect) {
      onSelect(loc);
      return;
    }
    router.push(`/forecast/${encodeURIComponent(loc.geohash)}`);
  }

  const showMenu =
    mounted && open && menuPos && (results.length > 0 || !!error || loading);

  const menu =
    showMenu && menuPos
      ? createPortal(
          <ul
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
            className="z-[9999] max-h-72 overflow-auto border border-white/20 bg-[#002766] text-white shadow-xl"
          >
            {loading && results.length === 0 && !error ? (
              <li className="px-3 py-2 text-sm text-white/70">Searching…</li>
            ) : null}
            {error ? (
              <li className="px-3 py-2 text-sm text-white/80">{error}</li>
            ) : null}
            {results.map((loc, i) => (
              <li
                key={loc.id || loc.geohash}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-white hover:bg-white/10",
                    i === active && "bg-white/10",
                  )}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    // Prevent input blur-close before click registers.
                    e.preventDefault();
                    choose(loc);
                  }}
                >
                  <MapPin
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bom-yellow)]"
                    aria-hidden
                  />
                  <span>
                    <span className="font-semibold text-white">{loc.name}</span>
                    <span className="text-white/70">
                      {" "}
                      · {loc.state}
                      {loc.postcode ? ` ${loc.postcode}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!loading && !error && results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-white/70">
                No locations found
              </li>
            ) : null}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <label className="relative block">
        <span className="sr-only">Search locations</span>
        <Search
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 text-white/70",
            compact ? "left-2.5 h-3.5 w-3.5" : "left-3 h-4 w-4",
          )}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={Boolean(showMenu)}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Search suburb, town or postcode…"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            updateMenuPos();
          }}
          onFocus={() => {
            setOpen(true);
            updateMenuPos();
          }}
          onKeyDown={(e) => {
            if (!open || results.length === 0) {
              if (e.key === "Enter" && results[0]) {
                e.preventDefault();
                choose(results[0]);
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const loc = results[active] || results[0];
              if (loc) choose(loc);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={cn(
            compact
              ? "h-8 w-full border-0 bg-[var(--page)] pl-8 pr-8 text-sm text-white outline-none placeholder:text-white/50"
              : "h-11 w-full border border-white/20 bg-[var(--bom-blue-mid)] pl-10 pr-10 text-sm text-white outline-none placeholder:text-white/50 focus:border-[var(--bom-yellow)]",
            inputClassName,
          )}
        />
        {loading ? (
          <Loader2
            className={cn(
              "absolute top-1/2 -translate-y-1/2 animate-spin text-white/60",
              compact ? "right-2 h-3.5 w-3.5" : "right-3 h-4 w-4",
            )}
            aria-hidden
          />
        ) : null}
      </label>
      {menu}
    </div>
  );
}
