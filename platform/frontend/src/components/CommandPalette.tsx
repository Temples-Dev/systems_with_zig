import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Code2, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";

interface SearchResult {
  type: "module" | "exercise";
  id: number;
  title: string;
  slug?: string;
  number?: number;
  module_slug?: string;
  module_title?: string;
  module_number?: number;
}

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQ = useDebounce(query, 200);

  const { data: results = [] } = useQuery<SearchResult[]>({
    queryKey: ["search", debouncedQ],
    queryFn: () => api.get(`/curriculum/search/?q=${encodeURIComponent(debouncedQ)}`).then((r) => r.data),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setCursor(0); }, [results]);

  function go(item: SearchResult) {
    onClose();
    if (item.type === "module") {
      navigate(`/module/${item.slug}`);
    } else {
      navigate(`/labs/${item.module_slug}`);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && results[cursor]) { go(results[cursor]); }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Panel */}
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search modules and exercises…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-secondary text-muted-foreground border border-border">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((item, i) => (
              <li key={`${item.type}-${item.id}`}>
                <button
                  className={[
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    i === cursor
                      ? "bg-primary/10 text-foreground"
                      : "text-foreground hover:bg-secondary",
                  ].join(" ")}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(item)}
                >
                  <div className={[
                    "flex w-6 h-6 shrink-0 rounded-md items-center justify-center",
                    item.type === "module" ? "bg-primary/10" : "bg-secondary",
                  ].join(" ")}>
                    {item.type === "module"
                      ? <BookOpen className="h-3.5 w-3.5 text-primary" />
                      : <Code2 className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{item.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {item.type === "module"
                        ? `Module ${String(item.number).padStart(2, "0")}`
                        : `M${String(item.module_number).padStart(2, "0")} — ${item.module_title}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground capitalize">
                    {item.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {debouncedQ.length >= 2 && results.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results for &ldquo;{debouncedQ}&rdquo;
          </p>
        )}

        {debouncedQ.length < 2 && (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            Type to search modules and exercises
          </p>
        )}

        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
