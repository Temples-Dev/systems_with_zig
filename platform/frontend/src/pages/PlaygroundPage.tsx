import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ChevronsLeft, ChevronsRight, Link2, Play, RotateCcw, Terminal, XCircle } from "lucide-react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, usePanelRef } from "react-resizable-panels";
import { toast } from "sonner";
import api from "@/api/client";
import { FileTree, type ProjectFile } from "@/components/FileTree";
const CodeEditor = lazy(() => import("@/components/CodeEditor").then((m) => ({ default: m.CodeEditor })));
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { streamRun } from "@/lib/streamRun";

const BUILD_ZIG = `const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "playground",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| run_cmd.addArgs(args);

    const run_step = b.step("run", "Run the app");
    run_step.dependOn(&run_cmd.step);

    const exe_tests = b.addTest(.{ .root_module = exe.root_module });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_exe_tests.step);
}
`;

const MAIN_ZIG = `const std = @import("std");

pub fn main() void {
    std.debug.print("Hello from Zig!\\n", .{});

    const x: u32 = 42;
    const y: u32 = 8;
    std.debug.print("{d} + {d} = {d}\\n", .{ x, y, x + y });
}

test "basic" {
    try std.testing.expectEqual(50, 42 + 8);
}
`;

const DEFAULT_PROJECT: ProjectFile[] = [
  { id: "build", path: "build.zig", content: BUILD_ZIG },
  { id: "main", path: "src/main.zig", content: MAIN_ZIG },
];

const STORAGE_KEY = "playground_session";

type Mode = "debug" | "release_fast" | "test";

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  status: "running" | "complete" | "failed";
}

interface SavedSession {
  files: ProjectFile[];
  selectedId: string;
  mode: Mode;
}

const MODES: { value: Mode; label: string }[] = [
  { value: "debug", label: "Debug" },
  { value: "release_fast", label: "ReleaseFast" },
  { value: "test", label: "Test" },
];

let nextId = 10;

function loadSession(): Partial<SavedSession> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export default function PlaygroundPage() {
  const { theme } = useTheme();
  const saved = useRef(loadSession());
  const treePanelRef = usePanelRef();
  const outputPanelRef = usePanelRef();

  const [files, setFiles] = useState<ProjectFile[]>(saved.current.files ?? DEFAULT_PROJECT);
  const [selectedId, setSelectedId] = useState<string>(saved.current.selectedId ?? "main");
  const [mode, setMode] = useState<Mode>(saved.current.mode ?? "debug");
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ files, selectedId, mode }));
    } catch { /* quota */ }
  }, [files, selectedId, mode]);

  const selectedFile = files.find((f) => f.id === selectedId) ?? files[0];
  const success = result?.exit_code === 0 && result?.status !== "running";

  const [isPending, setIsPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (isPending) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsPending(true);
    setResult({ stdout: "", stderr: "", exit_code: -1, duration_ms: 0, status: "running" });

    let stdoutAcc = "";
    let stderrAcc = "";

    try {
      await streamRun(
        { files: files.map((f) => ({ path: f.path, content: f.content })), mode },
        (event) => {
          if (event.type === "stdout") {
            stdoutAcc += event.text! + "\n";
            setResult((r) => r ? { ...r, stdout: stdoutAcc.trimEnd() } : r);
          } else if (event.type === "stderr") {
            stderrAcc += event.text! + "\n";
            setResult((r) => r ? { ...r, stderr: stderrAcc.trimEnd() } : r);
          } else if (event.type === "done") {
            const final: ExecutionResult = {
              stdout: stdoutAcc.trimEnd(),
              stderr: stderrAcc.trimEnd(),
              exit_code: event.exit_code!,
              duration_ms: event.duration_ms!,
              status: event.exit_code === 0 ? "complete" : "failed",
            };
            setResult(final);
            setIsPending(false);
            if (event.exit_code === 0) toast.success(`Ran in ${event.duration_ms}ms`);
            else toast.error("Build failed");
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
  }, [files, mode, isPending]);

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

  function toggleTree() {
    if (treeCollapsed) {
      treePanelRef.current?.expand();
      setTreeCollapsed(false);
    } else {
      treePanelRef.current?.collapse();
      setTreeCollapsed(true);
    }
  }

  function toggleOutput() {
    if (outputCollapsed) {
      outputPanelRef.current?.expand();
      setOutputCollapsed(false);
    } else {
      outputPanelRef.current?.collapse();
      setOutputCollapsed(true);
    }
  }

  function updateFile(id: string, content: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, content } : f)));
  }

  const addFile = useCallback((path: string) => {
    const id = String(nextId++);
    setFiles((prev) => [...prev, {
      id,
      path: path.endsWith(".zig") ? path : `${path}.zig`,
      content: `const std = @import("std");\n`,
    }]);
    setSelectedId(id);
  }, []);

  function deleteFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(files[0]?.id ?? "");
  }

  function reset() {
    setFiles(DEFAULT_PROJECT);
    setSelectedId("main");
    setResult(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function share() {
    setSharing(true);
    try {
      const { data } = await api.post("/execution/share/", {
        files: files.map((f) => ({ path: f.path, content: f.content })),
      });
      const url = `${window.location.origin}/share/${data.slug}`;
      await navigator.clipboard.writeText(url);
      toast.success("Link copied! Valid for 7 days.");
    } catch {
      toast.error("Failed to create share link");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5">
          <Terminal className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">Playground</span>
          <span className="text-xs text-muted-foreground hidden sm:block">
            — {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={[
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === m.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary",
                ].join(" ")}
              >
                {m.label}
              </button>
            ))}
          </div>
          <Button onClick={run} disabled={isPending} size="sm" className="gap-2 h-8" title="Run (Ctrl+Enter)">
            <Play className="h-3.5 w-3.5 fill-primary-foreground" />
            {isPending ? "Building…" : "Run"}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={share} disabled={sharing} title="Share (copies link)">
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} title="Reset project">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Resizable panels */}
      <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
        {/* File tree */}
        <Panel
          id="tree"
          panelRef={treePanelRef}
          defaultSize={15}
          minSize={10}
          collapsible
          collapsedSize={0}
          onResize={(s) => setTreeCollapsed(s.asPercentage === 0)}
          className="hidden sm:block"
        >
          <FileTree
            files={files}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={addFile}
            onDelete={deleteFile}
          />
        </Panel>

        {/* Resize + tree collapse toggle */}
        <div className="hidden sm:flex flex-col items-center relative z-10">
          <PanelResizeHandle className="w-1 h-full bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
          <button
            onClick={toggleTree}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center w-4 h-8 rounded-sm bg-border hover:bg-primary/30 text-muted-foreground hover:text-foreground transition-colors"
            title={treeCollapsed ? "Show files" : "Hide files"}
          >
            {treeCollapsed ? <ChevronsRight className="h-3 w-3" /> : <ChevronsLeft className="h-3 w-3" />}
          </button>
        </div>

        {/* Editor */}
        <Panel id="editor" defaultSize={55} minSize={30}>
          <div className="h-full overflow-hidden">
            {selectedFile && (
              <Suspense fallback={<div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">Loading editor…</div>}>
                <CodeEditor
                  key={`${selectedFile.id}-${theme}`}
                  value={selectedFile.content}
                  onChange={(val) => updateFile(selectedFile.id, val ?? "")}
                  darkMode={theme === "dark"}
                />
              </Suspense>
            )}
          </div>
        </Panel>

        {/* Resize + output collapse toggle */}
        <div className="hidden lg:flex flex-col items-center relative z-10">
          <PanelResizeHandle className="w-1 h-full bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
          <button
            onClick={toggleOutput}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center w-4 h-8 rounded-sm bg-border hover:bg-primary/30 text-muted-foreground hover:text-foreground transition-colors"
            title={outputCollapsed ? "Show output" : "Hide output"}
          >
            {outputCollapsed ? <ChevronsLeft className="h-3 w-3" /> : <ChevronsRight className="h-3 w-3" />}
          </button>
        </div>

        {/* Output */}
        <Panel
          id="output"
          panelRef={outputPanelRef}
          defaultSize={30}
          minSize={12}
          collapsible
          collapsedSize={0}
          onResize={(s) => setOutputCollapsed(s.asPercentage === 0)}
          className="hidden lg:flex flex-col bg-card border-l border-border"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              {result && result.status !== "running" && (
                success
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  : <XCircle className="h-3.5 w-3.5 text-destructive" />
              )}
              <span className="text-xs font-semibold text-foreground">Output</span>
            </div>
            {result && result.status !== "running" && (
              <div className="flex items-center gap-2">
                <Badge variant={success ? "success" : "error"} className="text-[10px]">
                  exit {result.exit_code}
                </Badge>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {result.duration_ms}ms
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {!result && !isPending && (
              <p className="text-muted-foreground italic">
                Run to see output.
                <span className="block mt-1 text-[10px]">Ctrl+Enter to run</span>
              </p>
            )}
            {isPending && !result?.stdout && !result?.stderr && (
              <p className="text-muted-foreground animate-pulse">Building…</p>
            )}
            {result?.stdout && (
              <div className="mb-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">stdout</p>
                <pre className="text-foreground whitespace-pre-wrap">{result.stdout}</pre>
              </div>
            )}
            {result?.stderr && (
              <div>
                <p className={[
                  "text-[10px] font-bold uppercase mb-1",
                  success ? "text-muted-foreground" : "text-destructive",
                ].join(" ")}>
                  {success ? "output" : "stderr"}
                </p>
                <pre className={success ? "text-foreground whitespace-pre-wrap" : "text-destructive whitespace-pre-wrap"}>
                  {result.stderr}
                </pre>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
