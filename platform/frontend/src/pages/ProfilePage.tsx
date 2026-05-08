import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, BookOpen, Calendar, CheckCircle2, Code2, Play, TrendingUp, User, Zap } from "lucide-react";
import { toast } from "sonner";
import api from "@/api/client";
import { Container } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface UserProfile {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  date_joined: string;
}

interface Stats {
  total_modules: number;
  modules_completed: number;
  objectives_checked: number;
  exercises_passed: number;
  completion_pct: number;
  achievements: string[];
}

const ACHIEVEMENT_META: Record<string, { icon: React.ElementType; label: string; description: string }> = {
  first_run:    { icon: Play,         label: "First Run",       description: "Executed your first Zig program" },
  first_pass:   { icon: CheckCircle2, label: "First Pass",      description: "Passed your first exercise test" },
  first_module: { icon: BookOpen,     label: "Module Complete", description: "Completed your first full module" },
  all_modules:  { icon: Zap,          label: "Systems Master",  description: "Completed all 18 modules" },
};

export default function ProfilePage() {
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ["profile"],
    queryFn: () => api.get("/auth/profile/").then((r) => r.data),
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => api.get("/progress/stats/").then((r) => r.data),
  });

  const [form, setForm] = useState({ username: "", first_name: "", last_name: "" });

  useEffect(() => {
    if (profile) {
      setForm({
        username: profile.username,
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }, [profile]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: (data: typeof form) => api.patch("/auth/profile/", data).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: () => toast.error("Failed to update profile"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save(form);
  }

  const initials = profile?.username
    ? profile.username.slice(0, 2).toUpperCase()
    : "??";

  const joinedDate = profile
    ? new Date(profile.date_joined).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "…";

  return (
    <div className="min-h-screen">
      <div className="border-b border-border bg-card">
        <Container className="py-7">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <User className="h-3.5 w-3.5" />
            <span>Profile</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex w-14 h-14 rounded-full bg-primary items-center justify-center shrink-0">
              <span className="text-lg font-black text-primary-foreground">{initials}</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {profile?.first_name
                  ? `${profile.first_name} ${profile.last_name}`.trim()
                  : profile?.username ?? "…"}
              </h1>
              <p className="text-sm text-muted-foreground">@{profile?.username ?? "…"}</p>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3" />
                <span>Joined {joinedDate}</span>
              </div>
            </div>
          </div>
        </Container>
      </div>

      <Container className="py-8 space-y-8">
        {/* Stats */}
        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-4">Progress</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: BookOpen, label: "Completed", value: `${stats?.modules_completed ?? 0}/${stats?.total_modules ?? 19}` },
              { icon: TrendingUp, label: "Progress", value: `${stats?.completion_pct ?? 0}%` },
              { icon: CheckCircle2, label: "Objectives", value: stats?.objectives_checked ?? 0 },
              { icon: Code2, label: "Exercises", value: stats?.exercises_passed ?? 0 },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <div className="text-xl font-bold text-foreground">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Achievements */}
        {stats && stats.achievements.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-4 flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" />
              Achievements
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.achievements.map((key) => {
                const meta = ACHIEVEMENT_META[key];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <div key={key} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
                    <div className="flex w-9 h-9 rounded-lg bg-primary/10 items-center justify-center">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground">{meta.label}</p>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{meta.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Separator />

        {/* Edit profile */}
        <div>
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-4">Account</h2>
          <div className="rounded-xl border border-border bg-card p-6 max-w-lg">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email</Label>
                <Input
                  id="email"
                  value={profile?.email ?? ""}
                  disabled
                  className="bg-secondary/40 text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-sm font-semibold text-foreground">Username</Label>
                <Input
                  id="username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="username"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name" className="text-sm font-semibold text-foreground">First name</Label>
                  <Input
                    id="first_name"
                    value={form.first_name}
                    onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name" className="text-sm font-semibold text-foreground">Last name</Label>
                  <Input
                    id="last_name"
                    value={form.last_name}
                    onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
              </div>
              <Button type="submit" disabled={isPending || isLoading} className="h-10">
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </div>
        </div>
      </Container>
    </div>
  );
}
