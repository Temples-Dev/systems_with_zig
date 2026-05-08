import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Clock, Code2, Edit2, Eye, FileText, FlaskConical,
  MonitorPlay, Play, TestTube2, XCircle,
} from "lucide-react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import api from "@/api/client";
import { FileTree, type ProjectFile } from "@/components/FileTree";
const CodeEditor = lazy(() => import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor })));
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { streamRun } from "@/lib/streamRun";

interface Exercise {
  id: number;
  title: string;
  description: string;
  exercise_type: "implementation" | "observation" | "analysis";
  order: number;
  is_required: boolean;
  starter_code: string;
}

interface Module {
  id: number;
  number: number;
  title: string;
  exercises: Exercise[];
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  status: "running" | "complete" | "failed";
}

const typeIcon = { implementation: Code2, observation: Eye, analysis: FlaskConical };

const BUILD_ZIG = (name: string) => `const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "${name}",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);

    const exe_tests = b.addTest(.{ .root_module = exe.root_module });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_exe_tests.step);
}
`;

const DEFAULT_MAIN = `const std = @import("std");

pub fn main() void {
    std.debug.print("Hello, Zig!\\n", .{});
}
`;

let nextId = 100;

function makeProject(exerciseName: string, starterCode: string): ProjectFile[] {
  const slug = exerciseName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  return [
    { id: "build", path: "build.zig", content: BUILD_ZIG(slug || "lab") },
    { id: "main", path: "src/main.zig", content: starterCode || DEFAULT_MAIN },
  ];
}

export default function LabPage() {
  const { slug } = useParams<{ slug: string }>();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(0);
  const [projects, setProjects] = useState<Record<number, ProjectFile[]>>({});
  const [selectedFileId, setSelectedFileId] = useState<string>("main");
  const [results, setResults] = useState<Record<number, ExecutionResult>>({});
  const [passed, setPassed] = useState<Record<number, boolean>>({});
  const [runMode, setRunMode] = useState<"debug" | "test">("debug");
  const [isPending, setIsPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Mobile tab: "exercise" | "code" | "output"
  const [mobileTab, setMobileTab] = useState<"exercise" | "code" | "output">("code");
  // Notes
  const [noteContent, setNoteContent] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Admin inline editing
  const [editField, setEditField] = useState<"title" | "description" | "starter_code" | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data: user } = useQuery<{ is_staff: boolean }>({
    queryKey: ["me"],
    queryFn: () => api.get("/auth/me/").then((r) => r.data),
  });

  const { data: mod, isLoading, isError } = useQuery<Module>({
    queryKey: ["module", slug],
    queryFn: () => api.get(`/curriculum/modules/${slug}/`).then((r) => r.data),
    enabled: !!slug,
  });

  // Load persisted pass status from backend
  const { data: passStatus } = useQuery<Record<string, boolean>>({
    queryKey: ["exercise-pass-status", slug],
    queryFn: () => api.get(`/progress/exercises/modules/${slug}/`).then((r) => r.data),
    enabled: !!slug,
  });

  useEffect(() => {
    if (passStatus) {
      const mapped: Record<number, boolean> = {};
      for (const [k, v] of Object.entries(passStatus)) mapped[Number(k)] = v as boolean;
      setPassed((prev) => ({ ...mapped, ...prev }));
    }
  }, [passStatus]);

  useEffect(() => {
    if (!mod) return;
    setProjects((prev) => {
      const next = { ...prev };
      for (const ex of mod.exercises) {
        if (!(ex.id in next)) {
          next[ex.id] = makeProject(ex.title, ex.starter_code);
        }
      }
      return next;
    });
  }, [mod]);

  const activeEx = mod?.exercises[selected];

  // Notes — load when exercise changes
  useEffect(() => {
    if (!activeEx) return;
    setNoteContent("");
    api.get(`/progress/notes/${activeEx.id}/`).then((r) => setNoteContent(r.data.content)).catch(() => {});
  }, [activeEx?.id]);

  function saveNote(content: string) {
    if (!activeEx) return;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(() => {
      api.patch(`/progress/notes/${activeEx.id}/`, { content }).catch(() => {});
    }, 800);
  }

  function handleNoteChange(content: string) {
    setNoteContent(content);
    saveNote(content);
  }

  // Admin exercise editor
  const { mutate: saveExercise } = useMutation({
    mutationFn: ({ id, field, value }: { id: number; field: string; value: string }) =>
      api.patch(`/curriculum/exercises/${id}/`, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["module", slug] });
      setEditField(null);
    },
  });

  function startEdit(field: "title" | "description" | "starter_code", value: string) {
    setEditField(field);
    setEditValue(value);
  }

  function commitEdit() {
    if (!editField || !activeEx) return;
    saveExercise({ id: activeEx.id, field: editField, value: editValue });
  }
  const activeProject = activeEx ? (projects[activeEx.id] ?? []) : [];
  const activeSelectedFile = activeProject.find((f) => f.id === selectedFileId) ?? activeProject[0];
  const activeResult = activeEx ? results[activeEx.id] : null;
  const Icon = activeEx ? typeIcon[activeEx.exercise_type] : Code2;
  const activeSuccess = activeResult?.exit_code === 0 && activeResult?.status !== "running";

  function updateFile(exId: number, fileId: string, content: string) {
    setProjects((prev) => ({
      ...prev,
      [exId]: (prev[exId] ?? []).map((f) => f.id === fileId ? { ...f, content } : f),
    }));
  }

  function addFile(exId: number, path: string) {
    const id = String(nextId++);
    setProjects((prev) => ({
      ...prev,
      [exId]: [...(prev[exId] ?? []), {
        id,
        path: path.endsWith(".zig") ? path : `${path}.zig`,
        content: `const std = @import("std");\n`,
      }],
    }));
    setSelectedFileId(id);
  }

  function deleteFile(exId: number, fileId: string) {
    setProjects((prev) => ({
      ...prev,
      [exId]: (prev[exId] ?? []).filter((f) => f.id !== fileId),
    }));
    if (selectedFileId === fileId) setSelectedFileId("main");
  }

  const run = useCallback(async () => {
    if (isPending || !activeEx) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsPending(true);

    const exId = activeEx.id;
    const project = projects[exId] ?? [];
    setResults((r) => ({
      ...r,
      [exId]: { stdout: "", stderr: "", exit_code: -1, duration_ms: 0, status: "running" },
    }));

    let stdoutAcc = "";
    let stderrAcc = "";

    try {
      await streamRun(
        { files: project.map((f) => ({ path: f.path, content: f.content })), mode: runMode },
        (event) => {
          if (event.type === "stdout") {
            stdoutAcc += event.text! + "\n";
            setResults((r) => ({
              ...r,
              [exId]: { ...(r[exId] ?? { stderr: "", exit_code: -1, duration_ms: 0, status: "running" }), stdout: stdoutAcc.trimEnd() },
            }));
          } else if (event.type === "stderr") {
            stderrAcc += event.text! + "\n";
            setResults((r) => ({
              ...r,
              [exId]: { ...(r[exId] ?? { stdout: "", exit_code: -1, duration_ms: 0, status: "running" }), stderr: stderrAcc.trimEnd() },
            }));
          } else if (event.type === "done") {
            const exitCode = event.exit_code!;
            const durationMs = event.duration_ms!;
            const final: ExecutionResult = {
              stdout: stdoutAcc.trimEnd(),
              stderr: stderrAcc.trimEnd(),
              exit_code: exitCode,
              duration_ms: durationMs,
              status: exitCode === 0 ? "complete" : "failed",
            };
            setResults((r) => ({ ...r, [exId]: final }));
            setIsPending(false);

            if (exitCode === 0) {
              if (runMode === "test") {
                setPassed((p) => ({ ...p, [exId]: true }));
                toast.success(`All tests passed in ${durationMs}ms`);
                // Persist to backend
                const code = project.find((f) => f.path === "src/main.zig")?.content ?? "";
                api.post(`/progress/exercises/${exId}/pass/`, { code }).then(() => {
                  queryClient.invalidateQueries({ queryKey: ["stats"] });
                  queryClient.invalidateQueries({ queryKey: ["exercise-pass-status", slug] });
                }).catch(() => {/* non-critical */});
              } else {
                toast.success(`Built in ${durationMs}ms`);
              }
            } else {
              toast.error(runMode === "test" ? "Tests failed" : "Build failed");
            }
          } else if (event.type === "error") {
            setIsPending(false);
            toast.error(event.text ?? "Execution failed");
          }
        },
        abortRef.current.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        toast.error("Execution failed — is the backend running?");
      }
      setIsPending(false);
    }
  }, [isPending, activeEx, projects, runMode, slug, queryClient]);

  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runRef.current();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-full">
        <div className="border-b border-border bg-card px-6 py-7">
          <div className="h-4 w-24 rounded bg-secondary animate-pulse mb-3" />
          <div className="h-7 w-72 rounded bg-secondary animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !mod) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-foreground">Module not found.</p>
        <Link to="/labs" className="text-xs text-primary hover:underline mt-2 block">← Labs</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-5 py-3">
          <Link
            to="/labs"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground no-underline transition-colors mb-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Labs
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-sm font-bold text-foreground">
              M{String(mod.number).padStart(2, "0")} — {mod.title}
            </h1>
            <Badge variant="outline" className="text-xs hidden sm:flex">
              {mod.exercises.length} exercises
            </Badge>
          </div>
        </div>
      </div>

      {/* Mobile tab bar */}
      <div className="sm:hidden flex border-b border-border bg-card shrink-0">
        {(["exercise", "code", "output"] as const).map((tab) => {
          const labels = { exercise: "Exercise", code: "Code", output: "Output" };
          const icons = { exercise: Eye, code: MonitorPlay, output: TestTube2 };
          const TabIcon = icons[tab];
          return (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={[
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors",
                mobileTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {labels[tab]}
            </button>
          );
        })}
      </div>

      <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
        {/* Exercise list */}
        <Panel defaultSize={13} minSize={8} maxSize={22} className={["flex flex-col bg-card border-r border-border overflow-y-auto", mobileTab === "exercise" ? "flex" : "hidden sm:flex"].join(" ")}>
          <div className="px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 mb-2">
              Exercises
            </p>
            <div className="space-y-0.5">
              {mod.exercises.map((ex, idx) => {
                const ExIcon = typeIcon[ex.exercise_type];
                const res = results[ex.id];
                const hasPassed = passed[ex.id];
                return (
                  <button
                    key={ex.id}
                    onClick={() => { setSelected(idx); setSelectedFileId("main"); }}
                    className={[
                      "w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors",
                      selected === idx
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    <ExIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-xs">{ex.title}</span>
                    {hasPassed
                      ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                      : res && res.exit_code !== 0
                        ? <XCircle className="h-3 w-3 text-destructive shrink-0" />
                        : null}
                  </button>
                );
              })}
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize hidden sm:block" />

        {/* File tree */}
        <Panel defaultSize={10} minSize={7} maxSize={18} className="hidden lg:block">
          {activeEx && (
            <FileTree
              files={activeProject}
              selectedId={activeSelectedFile?.id ?? null}
              onSelect={setSelectedFileId}
              onAdd={(path) => addFile(activeEx.id, path)}
              onDelete={(id) => deleteFile(activeEx.id, id)}
            />
          )}
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize hidden lg:block" />

        {/* Editor column */}
        <Panel defaultSize={47} minSize={25} className={["flex-col overflow-hidden border-l border-border", mobileTab === "code" ? "flex" : "hidden sm:flex"].join(" ")}>
          {/* Exercise toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex w-7 h-7 shrink-0 rounded-md bg-primary/10 items-center justify-center">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              {editField === "title" ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditField(null); }}
                  className="text-sm font-semibold bg-secondary rounded px-1.5 py-0.5 outline-none border border-primary/40 min-w-0 flex-1"
                />
              ) : (
                <p className="text-sm font-semibold text-foreground truncate">
                  {activeEx?.title ?? "Select an exercise"}
                </p>
              )}
              {activeEx && passed[activeEx.id] && (
                <Badge variant="success" className="text-[10px] shrink-0">Passed</Badge>
              )}
              {user?.is_staff && activeEx && editField !== "title" && (
                <button onClick={() => startEdit("title", activeEx.title)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Edit title">
                  <Edit2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setNoteOpen((v) => !v)}
                className={["p-1.5 rounded-md transition-colors", noteOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary"].join(" ")}
                title="Notes"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
              {/* Run mode toggle */}
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => setRunMode("debug")}
                  className={[
                    "px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1",
                    runMode === "debug"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary",
                  ].join(" ")}
                  title="Run program (Ctrl+Enter)"
                >
                  <Play className="h-3 w-3" />
                  Run
                </button>
                <button
                  onClick={() => setRunMode("test")}
                  className={[
                    "px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1",
                    runMode === "test"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary",
                  ].join(" ")}
                  title="Run tests (Ctrl+Enter)"
                >
                  <TestTube2 className="h-3 w-3" />
                  Test
                </button>
              </div>
              <Button
                size="sm" className="gap-1.5 h-8 shrink-0"
                onClick={run}
                disabled={isPending || !activeEx}
              >
                {runMode === "test"
                  ? <TestTube2 className="h-3.5 w-3.5" />
                  : <Play className="h-3.5 w-3.5 fill-primary-foreground" />}
                {isPending ? "Running…" : runMode === "test" ? "Test" : "Run"}
              </Button>
            </div>
          </div>

          {/* Problem description */}
          {activeEx?.description && (
            <div className="px-5 py-3 bg-secondary/30 border-b border-border shrink-0 max-h-32 overflow-y-auto prose prose-sm prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed relative group">
              {editField === "description" ? (
                <div className="space-y-1.5">
                  <textarea
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    rows={4}
                    className="w-full text-xs bg-secondary rounded p-2 outline-none border border-primary/40 font-mono resize-none"
                  />
                  <div className="flex gap-1.5">
                    <button onClick={commitEdit} className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground">Save</button>
                    <button onClick={() => setEditField(null)} className="text-[10px] px-2 py-0.5 rounded bg-secondary text-muted-foreground">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <ReactMarkdown>{activeEx.description}</ReactMarkdown>
                  {user?.is_staff && (
                    <button
                      onClick={() => startEdit("description", activeEx.description)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all"
                      title="Edit description"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Notes panel */}
          {noteOpen && (
            <div className="px-4 py-2 border-b border-border bg-secondary/20 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Notes</p>
              <textarea
                value={noteContent}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="Personal notes for this exercise…"
                rows={3}
                className="w-full text-xs bg-card rounded-md border border-border p-2 outline-none focus:border-primary/40 resize-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
          )}

          {/* Monaco editor */}
          <div className="flex-1 overflow-hidden">
            {activeSelectedFile ? (
              <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading editor…</div>}>
                <CodeEditor
                  key={`${activeEx?.id}-${activeSelectedFile.id}-${theme}`}
                  value={activeSelectedFile.content}
                  onChange={(val) =>
                    activeEx && updateFile(activeEx.id, activeSelectedFile.id, val ?? "")
                  }
                  darkMode={theme === "dark"}
                  stderr={activeResult?.stderr}
                  exitCode={activeResult?.exit_code}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Select a file to edit
              </div>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border hover:bg-primary/40 transition-colors cursor-col-resize hidden xl:block" />

        {/* Output panel */}
        <Panel defaultSize={20} minSize={12} className={["flex-col bg-card border-l border-border", mobileTab === "output" ? "flex" : "hidden xl:flex"].join(" ")}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              {activeResult && activeResult.status !== "running" && (
                activeSuccess
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  : <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              <span className="text-xs font-semibold text-foreground">Output</span>
            </div>
            {activeResult && activeResult.status !== "running" && (
              <div className="flex items-center gap-2">
                <Badge variant={activeSuccess ? "success" : "error"} className="text-[10px]">
                  exit {activeResult.exit_code}
                </Badge>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {activeResult.duration_ms}ms
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {!activeResult && !isPending && (
              <p className="text-muted-foreground italic">
                Run to see output.
                <span className="block mt-1 text-[10px]">Ctrl+Enter to run</span>
              </p>
            )}
            {isPending && !activeResult?.stdout && !activeResult?.stderr && (
              <p className="text-muted-foreground animate-pulse">Building…</p>
            )}
            {activeResult?.stdout && (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">stdout</p>
                <pre className="text-foreground whitespace-pre-wrap">{activeResult.stdout}</pre>
              </div>
            )}
            {activeResult?.stderr && (
              <div>
                <p className={[
                  "text-[10px] font-bold uppercase mb-1",
                  activeSuccess ? "text-muted-foreground" : "text-destructive",
                ].join(" ")}>
                  {activeSuccess ? "output" : "stderr"}
                </p>
                <pre className={activeSuccess ? "text-foreground whitespace-pre-wrap" : "text-destructive whitespace-pre-wrap"}>
                  {activeResult.stderr}
                </pre>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
