import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Edit2, ExternalLink, FileText, List, Loader2,
  Play, PlaySquare, Plus, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/api/client";
import { Container } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Resource {
  id: number;
  title: string;
  url: string;
  description: string;
  resource_type: "video" | "playlist" | "article" | "docs";
  topic: string;
  module: number | null;
  module_title: string | null;
  is_featured: boolean;
  added_by_username: string | null;
  created_at: string;
}

interface Module {
  id: number;
  number: number;
  title: string;
  slug: string;
}

interface Section {
  modules: Module[];
}

const TYPE_ICON: Record<string, React.ElementType> = {
  video: Play,
  playlist: PlaySquare,
  article: FileText,
  docs: BookOpen,
};

const TYPE_LABEL: Record<string, string> = {
  video: "Video",
  playlist: "Playlist",
  article: "Article",
  docs: "Docs",
};

function youTubeVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return m ? m[1] : null;
}

function isPlaylist(url: string) {
  return url.includes("youtube.com") && url.includes("list=");
}

function ResourceCard({
  res,
  isStaff,
  onEdit,
  onDelete,
}: {
  res: Resource;
  isStaff: boolean;
  onEdit: (r: Resource) => void;
  onDelete: (id: number) => void;
}) {
  const [embedOpen, setEmbedOpen] = useState(false);
  const Icon = TYPE_ICON[res.resource_type] ?? FileText;
  const videoId = youTubeVideoId(res.url);
  const canEmbed = res.resource_type === "video" && videoId && !isPlaylist(res.url);
  const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col hover:border-primary/30 transition-colors">
      {/* Thumbnail / type banner */}
      {thumb ? (
        <div className="relative aspect-video bg-secondary overflow-hidden">
          <img src={thumb} alt="" className="w-full h-full object-cover" />
          {canEmbed && (
            <button
              onClick={() => setEmbedOpen(true)}
              className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/50 transition-colors group"
            >
              <div className="flex w-12 h-12 rounded-full bg-primary items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <Play className="h-5 w-5 text-primary-foreground fill-primary-foreground ml-0.5" />
              </div>
            </button>
          )}
          {res.is_featured && (
            <span className="absolute top-2 left-2 text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
              Featured
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center h-20 bg-secondary/40 border-b border-border">
          <Icon className="h-8 w-8 text-muted-foreground/40" />
        </div>
      )}

      {/* Embed modal */}
      {embedOpen && videoId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEmbedOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setEmbedOpen(false)}
              className="absolute top-2 right-2 z-10 text-white/70 hover:text-white bg-black/40 rounded-full p-1"
            >
              <X className="h-4 w-4" />
            </button>
            <iframe
              src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              className="w-full h-full border-0"
            />
          </div>
        </div>
      )}

      <div className="p-4 flex flex-col flex-1 gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{res.title}</p>
            {res.module_title && (
              <p className="text-[10px] text-primary font-medium mt-0.5 truncate">↳ {res.module_title}</p>
            )}
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0 capitalize">{TYPE_LABEL[res.resource_type]}</Badge>
        </div>

        {res.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{res.description}</p>
        )}

        <div className="flex items-center gap-2 mt-auto pt-1">
          <span className="text-[10px] bg-secondary text-muted-foreground px-2 py-0.5 rounded-full capitalize">{res.topic}</span>
          <div className="ml-auto flex items-center gap-1.5">
            {isStaff && (
              <>
                <button
                  onClick={() => onEdit(res)}
                  className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                  title="Edit"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onDelete(res.id)}
                  className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <a
              href={res.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
              title="Open link"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

const BLANK_FORM = {
  title: "",
  url: "",
  description: "",
  resource_type: "video" as Resource["resource_type"],
  topic: "",
  module: "" as string | number,
  is_featured: false,
};

function ResourceForm({
  initial,
  modules,
  onSave,
  onCancel,
  saving,
}: {
  initial: typeof BLANK_FORM;
  modules: Module[];
  onSave: (data: typeof BLANK_FORM) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-4">
        <h2 className="text-sm font-bold text-foreground">
          {initial.title ? "Edit Resource" : "Add Resource"}
        </h2>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Title</Label>
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Digital Electronics — Ben Eater" required />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">URL</Label>
          <Input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" type="url" required />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Brief description…"
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Type</Label>
            <select
              value={form.resource_type}
              onChange={(e) => set("resource_type", e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="video">Video</option>
              <option value="playlist">Playlist</option>
              <option value="article">Article</option>
              <option value="docs">Docs</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Topic</Label>
            <Input value={form.topic} onChange={(e) => set("topic", e.target.value)} placeholder="e.g. compilers" required />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold">Module <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <select
            value={form.module ?? ""}
            onChange={(e) => set("module", e.target.value ? Number(e.target.value) : "")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— none —</option>
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                M{String(m.number).padStart(2, "0")} — {m.title}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.is_featured}
            onChange={(e) => set("is_featured", e.target.checked)}
            className="rounded border-input"
          />
          <span className="text-xs text-foreground">Mark as featured</span>
        </label>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            disabled={saving || !form.title || !form.url || !form.topic}
            onClick={() => onSave(form)}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const queryClient = useQueryClient();
  const [topicFilter, setTopicFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/auth/me/").then((r) => r.data),
  });

  const { data: resources = [], isLoading } = useQuery<Resource[]>({
    queryKey: ["resources", topicFilter, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (topicFilter) params.set("topic", topicFilter);
      if (typeFilter) params.set("type", typeFilter);
      return api.get(`/resources/?${params}`).then((r) => r.data.results ?? r.data);
    },
  });

  const { data: topics = [] } = useQuery<string[]>({
    queryKey: ["resource-topics"],
    queryFn: () => api.get("/resources/topics/").then((r) => r.data),
  });

  const { data: sections = [] } = useQuery<Section[]>({
    queryKey: ["sections"],
    queryFn: () => api.get("/curriculum/sections/").then((r) => r.data),
  });

  const modules: Module[] = sections.flatMap((s) => s.modules ?? []);

  const { mutate: createResource, isPending: creating } = useMutation({
    mutationFn: (data: typeof BLANK_FORM) =>
      api.post("/resources/", { ...data, module: data.module || null }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      queryClient.invalidateQueries({ queryKey: ["resource-topics"] });
      setFormOpen(false);
      toast.success("Resource added");
    },
    onError: () => toast.error("Failed to add resource"),
  });

  const { mutate: updateResource, isPending: updating } = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof BLANK_FORM }) =>
      api.patch(`/resources/${id}/`, { ...data, module: data.module || null }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      queryClient.invalidateQueries({ queryKey: ["resource-topics"] });
      setEditing(null);
      toast.success("Resource updated");
    },
    onError: () => toast.error("Failed to update resource"),
  });

  const { mutate: deleteResource } = useMutation({
    mutationFn: (id: number) => api.delete(`/resources/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      queryClient.invalidateQueries({ queryKey: ["resource-topics"] });
      toast.success("Resource removed");
    },
    onError: () => toast.error("Failed to delete resource"),
  });

  const isStaff = !!user?.is_staff;

  function handleDelete(id: number) {
    if (confirm("Remove this resource?")) deleteResource(id);
  }

  const editInitial = editing
    ? {
        title: editing.title,
        url: editing.url,
        description: editing.description,
        resource_type: editing.resource_type,
        topic: editing.topic,
        module: editing.module ?? ("" as string | number),
        is_featured: editing.is_featured,
      }
    : BLANK_FORM;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <Container className="py-7">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <List className="h-3.5 w-3.5" />
            <span>Resources</span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-foreground">Curated Resources</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Videos, playlists, articles, and docs to reinforce your studies.
              </p>
            </div>
            {isStaff && (
              <Button size="sm" className="gap-2 shrink-0" onClick={() => setFormOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add resource
              </Button>
            )}
          </div>
        </Container>
      </div>

      <Container className="py-8">
        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => { setTopicFilter(""); setTypeFilter(""); }}
            className={[
              "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
              !topicFilter && !typeFilter
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground",
            ].join(" ")}
          >
            All
          </button>
          {topics.map((t) => (
            <button
              key={t}
              onClick={() => setTopicFilter(topicFilter === t ? "" : t)}
              className={[
                "px-3 py-1 rounded-full text-xs font-medium transition-colors border capitalize",
                topicFilter === t
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
          <div className="ml-auto flex gap-1.5">
            {(["video", "playlist", "article", "docs"] as const).map((type) => {
              const Icon = TYPE_ICON[type];
              return (
                <button
                  key={type}
                  onClick={() => setTypeFilter(typeFilter === type ? "" : type)}
                  title={TYPE_LABEL[type]}
                  className={[
                    "p-1.5 rounded-lg border transition-colors",
                    typeFilter === type
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-card text-muted-foreground border-border hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="aspect-video bg-secondary animate-pulse" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-secondary animate-pulse" />
                  <div className="h-3 w-full rounded bg-secondary animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : resources.length === 0 ? (
          <div className="text-center py-20">
            <List className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {topicFilter || typeFilter ? "No resources match this filter." : "No resources yet."}
            </p>
            {isStaff && !topicFilter && !typeFilter && (
              <button
                onClick={() => setFormOpen(true)}
                className="text-xs text-primary hover:underline mt-2 block mx-auto"
              >
                Add the first one →
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {resources.map((res) => (
              <ResourceCard
                key={res.id}
                res={res}
                isStaff={isStaff}
                onEdit={setEditing}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </Container>

      {/* Add form */}
      {formOpen && (
        <ResourceForm
          initial={BLANK_FORM}
          modules={modules}
          onSave={(data) => createResource(data)}
          onCancel={() => setFormOpen(false)}
          saving={creating}
        />
      )}

      {/* Edit form */}
      {editing && (
        <ResourceForm
          initial={editInitial}
          modules={modules}
          onSave={(data) => updateResource({ id: editing.id, data })}
          onCancel={() => setEditing(null)}
          saving={updating}
        />
      )}
    </div>
  );
}
