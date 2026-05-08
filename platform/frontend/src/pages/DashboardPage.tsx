import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BookOpen, CheckCircle2, Code2,
  LayoutDashboard, TrendingUp,
} from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { Container } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Stats {
  total_modules: number;
  modules_started: number;
  modules_completed: number;
  objectives_checked: number;
  exercises_passed: number;
  completion_pct: number;
  last_module: { slug: string; title: string; number: number; state: string } | null;
}

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
  modules: Module[];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${accent ? "bg-primary/15" : "bg-secondary"}`}>
          <Icon className={`h-4 w-4 ${accent ? "text-primary" : "text-muted-foreground"}`} />
        </div>
      </div>
      <div className="text-2xl font-bold text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/auth/me/").then((r) => r.data),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => api.get("/progress/stats/").then((r) => r.data),
  });

  const { data: sections } = useQuery<Section[]>({
    queryKey: ["sections"],
    queryFn: () =>
      api.get("/curriculum/sections/").then((r) => {
        const d = r.data;
        return Array.isArray(d) ? d : (d?.results ?? []);
      }),
  });

  const completionPct = stats?.completion_pct ?? 0;

  return (
    <div className="min-h-screen">
      {/* Page header */}
      <div className="border-b border-border bg-card">
        <Container className="py-7">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>Dashboard</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome back, {user?.username ?? "…"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's where you left off on your systems programming journey.
          </p>

          {/* Overall progress bar */}
          <div className="mt-5 max-w-sm">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">Course progress</span>
              <span className="text-xs font-bold text-primary">{completionPct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        </Container>
      </div>

      <Container className="py-8 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={BookOpen}
            label="Modules"
            value={`${stats?.modules_completed ?? 0}/${stats?.total_modules ?? 19}`}
            sub="completed"
            accent
          />
          <StatCard
            icon={TrendingUp}
            label="Started"
            value={stats?.modules_started ?? 0}
            sub="in progress"
          />
          <StatCard
            icon={CheckCircle2}
            label="Objectives"
            value={stats?.objectives_checked ?? 0}
            sub="checked off"
          />
          <StatCard
            icon={Code2}
            label="Exercises"
            value={stats?.exercises_passed ?? 0}
            sub="passed"
          />
        </div>

        {/* Continue learning */}
        {stats?.last_module ? (
          <div>
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">
              Continue Learning
            </h2>
            <Link
              to={`/module/${stats.last_module.slug}`}
              className="group block rounded-xl border border-border bg-card p-5 hover:border-primary/40 hover:shadow-sm transition-all no-underline"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      Module {String(stats.last_module.number).padStart(2, "0")}
                    </span>
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {stats.last_module.state.replace("_", " ")}
                    </Badge>
                  </div>
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                    {stats.last_module.title}
                  </h3>
                </div>
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
                  <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>
          </div>
        ) : (
          <div>
            <h2 className="text-sm font-bold text-foreground mb-3 uppercase tracking-wide">
              Start Learning
            </h2>
            <Link
              to="/curriculum"
              className="group block rounded-xl border border-primary/30 bg-primary/5 p-5 hover:border-primary/60 transition-all no-underline"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-foreground">Begin the Course</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Start from Module 01 — Bits, Bytes and Memory Models
                  </p>
                </div>
                <ArrowRight className="h-5 w-5 text-primary group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          </div>
        )}

        {/* Quick curriculum overview */}
        {sections && sections.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">Curriculum</h2>
              <Button variant="ghost" size="sm" asChild className="text-xs h-7">
                <Link to="/curriculum">View all</Link>
              </Button>
            </div>
            <div className="space-y-2">
              {sections.slice(0, 4).map((section) => (
                <div
                  key={section.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground w-6">
                      S{section.number}
                    </span>
                    <span className="text-sm font-medium text-foreground">{section.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {section.modules.length} modules
                  </span>
                </div>
              ))}
              {sections.length > 4 && (
                <p className="text-xs text-muted-foreground text-center pt-1">
                  +{sections.length - 4} more sections in{" "}
                  <Link to="/curriculum" className="text-primary hover:underline">Curriculum</Link>
                </p>
              )}
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}
