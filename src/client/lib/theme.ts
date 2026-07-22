import { useEffect, useState } from "react";

export const themes = ["lavender", "mint", "sky", "amber", "rose", "graphite"] as const;
export const modes = ["system", "light", "dark"] as const;
export type Theme = typeof themes[number];
export type Mode = typeof modes[number];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
}

function apply(theme: Theme, mode: Mode): void {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.resolvedMode = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => stored("dropiku-theme", themes, "lavender"));
  const [mode, setModeState] = useState<Mode>(() => stored("dropiku-mode", modes, "system"));
  const [reduceMotion, setReduceMotionState] = useState(() => localStorage.getItem("dropiku-reduce-motion") === "true");
  useEffect(() => {
    apply(theme, mode);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply(theme, mode);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme, mode]);
  useEffect(() => { document.documentElement.dataset.reduceMotion = String(reduceMotion); }, [reduceMotion]);
  return {
    theme, mode, reduceMotion,
    setTheme(value: Theme) { localStorage.setItem("dropiku-theme", value); setThemeState(value); },
    setMode(value: Mode) { localStorage.setItem("dropiku-mode", value); setModeState(value); },
    setReduceMotion(value: boolean) { localStorage.setItem("dropiku-reduce-motion", String(value)); setReduceMotionState(value); },
  };
}
