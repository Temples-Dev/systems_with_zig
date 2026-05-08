import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Terminal } from "lucide-react";
import api from "@/api/client";
import { type ProjectFile } from "@/components/FileTree";
import { useTheme } from "@/hooks/useTheme";

const CodeEditor = lazy(() => import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor })));

interface Snippet {
  files: Array<{ path: string; content: string }>;
  created_at: string;
}

export default function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const { theme } = useTheme();

  const { data, isLoading, isError } = useQuery<Snippet>({
    queryKey: ["share", slug],
    queryFn: () => api.get(`/execution/share/${slug}/`).then((r) => r.data),
    enabled: !!slug,
    staleTime: Infinity,
  });

  const files: ProjectFile[] = (data?.files ?? []).map((f, i) => ({
    id: String(i),
    path: f.path,
    content: f.content,
  }));

  const mainFile = files.find((f) => f.path === "src/main.zig") ?? files[0];

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading snippet…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-foreground">Snippet not found or has expired (7-day TTL).</p>
        <Link to="/playground" className="text-xs text-primary hover:underline">← Open Playground</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Shared Snippet</span>
          <span className="font-mono text-xs text-muted-foreground">{slug}</span>
        </div>
        <Link to="/playground" className="text-xs text-primary hover:underline">
          Open in Playground →
        </Link>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* File list */}
        {files.length > 1 && (
          <aside className="w-48 shrink-0 border-r border-border bg-card overflow-y-auto hidden sm:block">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 py-3">Files</p>
            {files.map((f) => (
              <div key={f.id} className="px-4 py-1.5 text-xs text-muted-foreground truncate">{f.path}</div>
            ))}
          </aside>
        )}
        {/* Read-only editor */}
        <div className="flex-1 overflow-hidden">
          {mainFile && (
            <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading editor…</div>}>
              <CodeEditor
                key={`${mainFile.id}-${theme}`}
                value={mainFile.content}
                darkMode={theme === "dark"}
                readOnly
              />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
