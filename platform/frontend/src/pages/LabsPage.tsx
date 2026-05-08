import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FlaskConical } from "lucide-react";
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
  exercises: { id: number }[];
}

interface Section {
  id: number;
  number: number;
  title: string;
  modules: Module[];
}

export default function LabsPage() {
  const { data: sections, isLoading, isError } = useQuery<Section[]>({
    queryKey: ["sections-labs"],
    queryFn: () =>
      api.get("/curriculum/sections/").then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.results ?? []);
      }),
  });

  const modulesWithExercises = sections?.flatMap((s) =>
    s.modules.filter((m) => (m.exercises?.length ?? 0) > 0)
  ) ?? [];

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card">
        <Container className="py-7">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <FlaskConical className="h-3.5 w-3.5" />
            <span>Labs</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Code Labs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hands-on exercises — write real Zig, run it, see the output.
          </p>
        </Container>
      </div>

      <Container className="py-8">
        {isLoading && (
          <div className="space-y-2">
            {["a", "b", "c", "d", "e"].map((k) => (
              <div key={k} className="h-16 rounded-lg bg-secondary animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Could not load labs — check the backend is running.
          </p>
        )}

        {!isLoading && !isError && (
          <div className="space-y-10">
            {sections?.map((section) => {
              const labModules = section.modules.filter(
                (m) => (m.exercises?.length ?? 0) > 0
              );
              if (labModules.length === 0) return null;

              return (
                <div key={section.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      Section {section.number}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <p className="text-base font-semibold text-foreground mb-4">{section.title}</p>

                  <div className="rounded-xl border border-border bg-card overflow-hidden">
                    {labModules.map((mod, idx) => (
                      <Link
                        key={mod.id}
                        to={`/labs/${mod.slug}`}
                        className={[
                          "group flex items-center gap-4 px-5 py-4 hover:bg-secondary/60 transition-colors no-underline",
                          idx !== labModules.length - 1 ? "border-b border-border" : "",
                        ].join(" ")}
                      >
                        <span className="font-mono text-xs font-bold text-muted-foreground w-6 shrink-0">
                          {String(mod.number).padStart(2, "0")}
                        </span>
                        <div className="flex-1">
                          <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                            {mod.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-[10px]">
                            {mod.exercises?.length ?? 0} labs
                          </Badge>
                          {mod.is_capstone && (
                            <Badge variant="default" className="text-[10px]">capstone</Badge>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}

            {modulesWithExercises.length === 0 && (
              <div className="text-center py-16">
                <FlaskConical className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm font-medium text-foreground">No labs yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Labs will appear here once exercises have starter code.
                </p>
              </div>
            )}
          </div>
        )}
      </Container>
    </div>
  );
}
