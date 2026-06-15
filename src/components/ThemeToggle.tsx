import { useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  function toggle() {
    const html = document.documentElement;
    const next = !isDark;
    html.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    setIsDark(next);
  }

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={
        isDark
          ? "cursor-pointer rounded-lg border border-white/20 bg-white/10 p-2 text-white transition-colors hover:border-yellow-400/60 hover:bg-yellow-400/20 hover:text-yellow-300"
          : "cursor-pointer rounded-lg border border-gray-300 bg-gray-100 p-2 text-gray-700 transition-colors hover:border-indigo-400/60 hover:bg-indigo-100 hover:text-indigo-600"
      }
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
