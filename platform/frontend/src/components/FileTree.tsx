import { useRef, useState } from "react";
import { FileCode, FilePlus, Package, Settings, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectFile {
  id: string;
  path: string;
  content: string;
}

interface Props {
  files: ProjectFile[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (path: string) => void;
  onDelete: (id: string) => void;
}

function fileIcon(path: string) {
  if (path === "build.zig" || path === "build.zig.zon") return Settings;
  if (path.endsWith(".zon")) return Package;
  return FileCode;
}

export function FileTree({ files, selectedId, onSelect, onAdd, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const groups: Record<string, ProjectFile[]> = {};
  for (const file of files) {
    const parts = file.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(file);
  }

  function startAdding() {
    setAdding(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function commitAdd() {
    const p = newPath.trim();
    if (p) onAdd(p);
    setNewPath("");
    setAdding(false);
  }

  function cancelAdd() {
    setNewPath("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col h-full bg-card border-r border-border select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Project
        </span>
        <button
          onClick={startAdding}
          className="text-muted-foreground hover:text-primary transition-colors p-0.5 rounded"
          title="New file"
        >
          <FilePlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inline new-file input — appears at the top of the list */}
      {adding && (
        <div className="px-3 py-2 border-b border-border bg-secondary/40 shrink-0">
          <input
            ref={inputRef}
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              else if (e.key === "Escape") cancelAdd();
            }}
            onBlur={() => {
              if (newPath.trim()) commitAdd();
              else cancelAdd();
            }}
            placeholder="src/new_file.zig"
            className="w-full px-2 py-1 text-xs font-mono bg-card border border-input rounded focus:outline-none focus:border-ring text-foreground placeholder:text-muted-foreground"
          />
          <p className="text-[10px] text-muted-foreground mt-1">↵ confirm · Esc cancel</p>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1 text-xs">
        {Object.entries(groups).map(([dir, dirFiles]) => (
          <div key={dir}>
            {dir && (
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-[10px] text-muted-foreground font-mono">{dir}/</span>
              </div>
            )}
            {dirFiles.map((file) => {
              const Icon = fileIcon(file.path);
              const name = file.path.split("/").pop() ?? file.path;
              const isSelected = selectedId === file.id;
              return (
                <div
                  key={file.id}
                  onClick={() => onSelect(file.id)}
                  className={cn(
                    "group flex items-center gap-2 cursor-pointer py-1.5 pr-2 transition-colors",
                    dir ? "pl-6" : "pl-3",
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                  <span className="flex-1 truncate font-mono">{name}</span>
                  {!["build.zig", "build.zig.zon"].includes(file.path) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all rounded p-0.5"
                      title="Delete file"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
