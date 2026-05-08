import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { Container } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";

interface Module {
  id: number;
  number: number;
  title: string;
  slug: string;
  is_capstone: boolean;
}

interface Section {
  id: number;
  number: number;
  title: string;
  slug: string;
  modules: Module[];
}

export default function CoursePage() {
  const { data: sections, isLoading, isError } = useQuery<Section[]>({
    queryKey: ["sections"],
    queryFn: () =>
      api.get("/curriculum/sections/").then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.results ?? []);
      }),
  });

  const totalModules = sections?.reduce((sum, s) => sum + s.modules.length, 0) ?? 0;

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="border-b border-border bg-card">
        <Container className="py-10">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <BookOpen className="h-3.5 w-3.5" />
                <span>Curriculum</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground leading-tight">
                The Craft of<br />Systems Programming
              </h1>
              <p className="mt-3 text-sm text-muted-foreground max-w-md leading-relaxed">
                From binary representation to distributed consensus — using Zig 0.16.0 as your tool of thought.
              </p>
              <div className="mt-5 flex items-center gap-4 text-xs text-muted-foreground">
                <span>{totalModules || 18} modules</span>
                <div className="w-px h-3 bg-border" />
                <span className="font-mono">Zig 0.16.0</span>
                <div className="w-px h-3 bg-border" />
                <span>{sections?.length || 6} sections</span>
              </div>
            </div>
            <div className="hidden sm:flex w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 items-center justify-center shrink-0">
              <span className="font-mono text-2xl font-black text-primary">Zig</span>
            </div>
          </div>
        </Container>
      </div>

      <main>
        <Container className="py-8">
          {isLoading && (
            <div className="space-y-8">
              {["s1", "s2", "s3"].map((k) => (
                <div key={k} className="space-y-2">
                  <div className="h-4 w-36 rounded bg-secondary animate-pulse mb-4" />
                  {["m1", "m2", "m3"].map((m) => (
                    <div key={m} className="h-14 rounded-lg bg-secondary animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-16">
              <p className="text-sm font-medium text-foreground">Could not load curriculum</p>
              <p className="text-xs text-muted-foreground mt-1">
                Check that the backend is running and try refreshing.
              </p>
            </div>
          )}

          {!isLoading && !isError && (
            <div className="space-y-10">
              {sections?.map((section) => (
                <div key={section.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Section {section.number}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[11px] text-muted-foreground">
                      {section.modules.length} modules
                    </span>
                  </div>
                  <p className="text-base font-semibold text-foreground mb-4">{section.title}</p>

                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {section.modules.map((mod, idx) => (
                      <Link
                        key={mod.id}
                        to={`/module/${mod.slug}`}
                        className={[
                          "group flex items-center gap-4 px-5 py-4 hover:bg-secondary/60 transition-colors no-underline",
                          idx !== section.modules.length - 1 ? "border-b border-border" : "",
                        ].join(" ")}
                      >
                        <span className="font-mono text-xs font-bold text-muted-foreground w-6 shrink-0 tabular-nums">
                          {String(mod.number).padStart(2, "0")}
                        </span>
                        <span className="text-sm font-medium text-foreground flex-1 leading-snug group-hover:text-primary transition-colors">
                          {mod.title}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {mod.is_capstone && (
                            <Badge variant="default" className="text-[10px]">capstone</Badge>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Container>
      </main>
    </div>
  );
}
