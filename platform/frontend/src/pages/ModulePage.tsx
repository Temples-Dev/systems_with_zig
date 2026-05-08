import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Code2, Eye, FlaskConical } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { common } from "lowlight";
import zigLang from "@/lib/zig-hljs";
import api from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface Objective {
  id: number;
  text: string;
  order: number;
}

interface Exercise {
  id: number;
  title: string;
  description: string;
  exercise_type: "implementation" | "observation" | "analysis";
  order: number;
  is_required: boolean;
}

interface Module {
  id: number;
  number: number;
  title: string;
  slug: string;
  objectives: Objective[];
  exercises: Exercise[];
}

const exerciseIcon = { implementation: Code2, observation: Eye, analysis: FlaskConical };

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function extractToc(markdown: string): { text: string; id: string }[] {
  const lines = markdown.split("\n");
  const toc: { text: string; id: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^## (.+)$/);
    if (m) toc.push({ text: m[1], id: slugify(m[1]) });
  }
  return toc;
}

// Custom heading renderer that adds anchor IDs
function HeadingH2({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const text = typeof children === "string" ? children : String(children);
  const id = slugify(text);
  return (
    <h2 id={id} className="text-xl font-bold text-foreground mt-10 mb-4 scroll-mt-20 border-b border-border pb-2" {...props}>
      {children}
    </h2>
  );
}

function HeadingH3({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className="text-base font-semibold text-foreground mt-6 mb-3" {...props}>
      {children}
    </h3>
  );
}

export default function ModulePage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [activeSection, setActiveSection] = useState<string>("");

  const { data: mod, isLoading, isError } = useQuery<Module>({
    queryKey: ["module", slug],
    queryFn: () => api.get(`/curriculum/modules/${slug}/`).then((r) => r.data),
    enabled: !!slug,
  });

  const { data: contentData } = useQuery<{ content: string; title: string; number: number }>({
    queryKey: ["module-content", slug],
    queryFn: () => api.get(`/curriculum/modules/${slug}/content/`).then((r) => r.data),
    enabled: !!slug,
    staleTime: Infinity,
  });

  const { data: objStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["obj-status", slug],
    queryFn: () => api.get(`/progress/modules/${slug}/objectives/`).then((r) => r.data),
    enabled: !!slug,
  });

  useEffect(() => {
    if (objStatus) {
      const mapped: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(objStatus)) mapped[Number(k)] = v as boolean;
      setChecked(mapped);
    }
  }, [objStatus]);

  const { mutate: startModule } = useMutation({
    mutationFn: (s: string) => api.post(`/progress/modules/${s}/`, { state: "in_progress" }),
  });
  useEffect(() => { if (slug) startModule(slug); }, [slug]);

  const { mutate: toggleObj } = useMutation({
    mutationFn: (data: { objective_id: number; checked: boolean }) =>
      api.post("/progress/objectives/toggle/", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stats"] }),
  });

  function handleCheck(objectiveId: number, val: boolean) {
    setChecked((c) => ({ ...c, [objectiveId]: val }));
    toggleObj({ objective_id: objectiveId, checked: val });
  }

  const toc = useMemo(
    () => (contentData?.content ? extractToc(contentData.content) : []),
    [contentData?.content]
  );

  // Highlight active section while scrolling
  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    function onScroll() {
      const headings = container!.querySelectorAll("h2[id]");
      let current = "";
      for (const h of headings) {
        if ((h as HTMLElement).offsetTop - 80 <= container!.scrollTop) {
          current = h.id;
        }
      }
      setActiveSection(current);
    }
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [contentData]);

  const checkedCount = Object.values(checked).filter(Boolean).length;
  const totalObjs = mod?.objectives.length ?? 0;

  if (isError) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-foreground">Module not found.</p>
        <Link to="/curriculum" className="text-xs text-primary hover:underline mt-1 block">← Curriculum</Link>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar: TOC + objectives */}
      <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border bg-card overflow-y-auto">
        {/* Back + module info */}
        <div className="px-4 py-4 border-b border-border shrink-0">
          <Link
            to="/curriculum"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground no-underline transition-colors mb-3"
          >
            <ArrowLeft className="h-3 w-3" />
            Curriculum
          </Link>
          {isLoading ? (
            <div className="h-5 w-40 rounded bg-secondary animate-pulse" />
          ) : (
            <>
              <span className="font-mono text-[10px] font-bold text-primary tracking-widest uppercase block mb-1">
                Module {String(mod?.number ?? 0).padStart(2, "0")}
              </span>
              <p className="text-sm font-bold text-foreground leading-snug">{mod?.title}</p>
            </>
          )}
        </div>

        {/* Objectives */}
        {mod && mod.objectives.length > 0 && (
          <div className="px-4 py-4 border-b border-border shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Objectives</span>
              <span className="text-[10px] text-primary font-medium">{checkedCount}/{totalObjs}</span>
            </div>
            <div className="h-1 w-full rounded-full bg-secondary mb-3 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${totalObjs > 0 ? (checkedCount / totalObjs) * 100 : 0}%` }}
              />
            </div>
            <div className="space-y-2">
              {mod.objectives.map((obj) => (
                <div key={obj.id} className="flex items-start gap-2">
                  <Checkbox
                    id={`obj-${obj.id}`}
                    checked={!!checked[obj.id]}
                    onCheckedChange={(v) => handleCheck(obj.id, !!v)}
                    className="mt-0.5 shrink-0 h-3.5 w-3.5"
                  />
                  <Label
                    htmlFor={`obj-${obj.id}`}
                    className={[
                      "text-xs leading-snug cursor-pointer font-normal transition-colors",
                      checked[obj.id] ? "line-through text-muted-foreground" : "text-foreground",
                    ].join(" ")}
                  >
                    {obj.text}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TOC */}
        {toc.length > 0 && (
          <div className="px-4 py-4 flex-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2">Contents</span>
            <nav className="space-y-0.5">
              {toc.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className={[
                    "w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors truncate",
                    activeSection === item.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                  ].join(" ")}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Labs link */}
        {mod && (
          <div className="px-4 py-4 border-t border-border shrink-0">
            <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-2" asChild>
              <Link to={`/labs/${mod.slug}`}>
                <Code2 className="h-3.5 w-3.5" />
                Open in Labs
              </Link>
            </Button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        {/* Mobile header */}
        <div className="lg:hidden border-b border-border bg-card px-5 py-4">
          <Link
            to="/curriculum"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground no-underline transition-colors mb-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Curriculum
          </Link>
          {isLoading ? (
            <div className="h-6 w-64 rounded bg-secondary animate-pulse" />
          ) : (
            <h1 className="text-lg font-bold text-foreground">{mod?.title}</h1>
          )}
        </div>

        {/* Markdown content */}
        {contentData ? (
          <div className="max-w-3xl mx-auto px-6 py-10">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { languages: { ...common, zig: zigLang }, aliases: { zig: ["zig"] } }]]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-3xl font-bold text-foreground mb-2 mt-0">{children}</h1>
                ),
                h2: HeadingH2,
                h3: HeadingH3,
                h4: ({ children }) => (
                  <h4 className="text-sm font-semibold text-foreground mt-5 mb-2">{children}</h4>
                ),
                p: ({ children }) => (
                  <p className="text-sm text-foreground leading-relaxed mb-4">{children}</p>
                ),
                code: ({ children, className }) => {
                  const isBlock = className?.includes("hljs") || className?.startsWith("language-");
                  if (isBlock) {
                    return (
                      <code className={`hljs-block block bg-[#0d1117] border border-border rounded-lg px-4 py-3 font-mono text-xs overflow-x-auto whitespace-pre ${className ?? ""}`}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className="bg-secondary/80 border border-border rounded px-1.5 py-0.5 font-mono text-xs text-primary">
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => <div className="mb-4 rounded-lg overflow-hidden">{children}</div>,
                ul: ({ children }) => (
                  <ul className="list-disc list-outside pl-5 mb-4 space-y-1 text-sm text-foreground">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-outside pl-5 mb-4 space-y-1 text-sm text-foreground">{children}</ol>
                ),
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-primary pl-4 italic text-muted-foreground text-sm mb-4">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="border-border my-8" />,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                em: ({ children }) => <em className="italic text-muted-foreground">{children}</em>,
                a: ({ children, href }) => (
                  <a href={href} className="text-primary underline hover:text-primary/80 transition-colors">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-sm border-collapse border border-border rounded-lg overflow-hidden">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="bg-secondary px-4 py-2 text-left text-xs font-bold text-foreground border border-border">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-2 text-xs text-foreground border border-border">{children}</td>
                ),
              }}
            >
              {contentData.content}
            </ReactMarkdown>

            {/* Exercises at bottom */}
            {mod && mod.exercises.length > 0 && (
              <section className="mt-12 pt-8 border-t border-border">
                <h2 className="text-xl font-bold text-foreground mb-6">Exercises</h2>
                <div className="space-y-3">
                  {mod.exercises.map((ex) => {
                    const Icon = exerciseIcon[ex.exercise_type];
                    return (
                      <div key={ex.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-all">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2.5">
                            <div className="flex w-7 h-7 rounded-md bg-primary/10 shrink-0 items-center justify-center">
                              <Icon className="h-3.5 w-3.5 text-primary" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">{ex.title}</h3>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="outline" className="text-[10px] capitalize">{ex.exercise_type}</Badge>
                            {!ex.is_required && <Badge variant="outline" className="text-[10px]">optional</Badge>}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed pl-9 mb-3">{ex.description}</p>
                        <div className="pl-9">
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" asChild>
                            <Link to={`/labs/${mod.slug}`}>
                              <Code2 className="h-3 w-3" />
                              Open in Labs
                            </Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        ) : isLoading ? (
          <div className="max-w-3xl mx-auto px-6 py-10 space-y-4">
            {[80, 60, 90, 50, 70, 55, 85].map((w, i) => (
              <div key={i} className="h-4 rounded bg-secondary animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
