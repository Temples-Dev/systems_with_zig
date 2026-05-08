import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet } from "react-router-dom";
import {
  BookOpen, FlaskConical, LayoutDashboard,
  Library, LogOut, Menu, Moon, Search, Sun, Terminal, User, X, Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import api from "@/api/client";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";

interface NavItemProps {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
}

function NavItem({ to, icon: Icon, label, end = false }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors no-underline",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function AppLayout() {
  const { token, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "?" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/auth/me/").then((r) => r.data),
    enabled: !!token,
  });

  if (!token) return <Navigate to="/login" replace />;

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : "??";

  const sidebar = (
    <aside className="flex h-full w-60 flex-col bg-card border-r border-border">
      {/* Brand + theme toggle */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="flex w-8 h-8 rounded-lg bg-primary items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-primary-foreground fill-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-foreground leading-tight truncate">Systems with Zig</div>
          <div className="text-[10px] text-muted-foreground font-mono">v0.16.0</div>
        </div>
        <button
          onClick={toggle}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
        >
          {theme === "dark"
            ? <Sun className="h-3.5 w-3.5" />
            : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {/* Search shortcut button */}
        <button
          onClick={() => setCmdOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors mb-1"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground border border-border">
            ⌘K
          </kbd>
        </button>
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" end />
        <NavItem to="/curriculum" icon={BookOpen} label="Curriculum" />
        <NavItem to="/playground" icon={Terminal} label="Playground" />
        <NavItem to="/labs" icon={FlaskConical} label="Labs" />
        <NavItem to="/resources" icon={Library} label="Resources" />
        <div className="mt-2 pt-2 border-t border-border">
          <NavItem to="/profile" icon={User} label="Profile" />
        </div>
      </nav>

      {/* User card */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="flex w-8 h-8 shrink-0 rounded-full bg-primary items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-foreground truncate">
              {user?.username ?? "…"}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {user?.email ?? "…"}
            </div>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:w-60 lg:shrink-0">
        {sidebar}
      </div>

      {/* Mobile drawer */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-60 lg:hidden">
            <div className="absolute right-2 top-3">
              <button
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {sidebar}
          </div>
        </>
      )}

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Mobile topbar */}
        <div className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex w-6 h-6 rounded-md bg-primary items-center justify-center">
              <Zap className="h-3 w-3 text-primary-foreground fill-primary-foreground" />
            </div>
            <span className="font-bold text-sm text-foreground">Systems with Zig</span>
          </div>
          <button onClick={toggle} className="ml-auto text-muted-foreground hover:text-foreground">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        {/* Page content — scrollable by default; full-screen pages use h-full internally */}
        <main className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
