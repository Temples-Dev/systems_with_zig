import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(t);
  localStorage.setItem("theme", t);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme") as Theme | null;
    return stored ?? "light";
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  function toggle() {
    setThemeState((prev) => {
      const next: Theme = prev === "light" ? "dark" : "light";
      return next;
    });
  }

  return { theme, setTheme, toggle };
}

// Call once at app startup to prevent flash of wrong theme
export function initTheme() {
  const stored = localStorage.getItem("theme") as Theme | null;
  const t = stored ?? "light";
  document.documentElement.classList.add(t);
}
