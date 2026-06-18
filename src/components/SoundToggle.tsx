import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { isSoundMuted, setSoundMuted } from "@/lib/sounds";

export default function SoundToggle() {
  const [muted, setMuted] = useState(() => isSoundMuted());

  function toggle() {
    const next = !muted;
    setSoundMuted(next);
    setMuted(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={muted ? "Turn sounds on" : "Mute sounds"}
      title={muted ? "Turn sounds on" : "Mute sounds"}
      aria-pressed={muted}
      className={
        muted
          ? "cursor-pointer rounded-lg border border-gray-300 bg-gray-100 p-2 text-gray-500 transition-colors hover:border-blue-400/60 hover:bg-blue-100 hover:text-blue-600 dark:border-white/20 dark:bg-white/10 dark:text-blue-100/50 dark:hover:border-blue-300/60 dark:hover:bg-blue-500/20 dark:hover:text-blue-200"
          : "cursor-pointer rounded-lg border border-gray-300 bg-gray-100 p-2 text-gray-700 transition-colors hover:border-emerald-400/60 hover:bg-emerald-100 hover:text-emerald-600 dark:border-white/20 dark:bg-white/10 dark:text-white dark:hover:border-emerald-300/60 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-200"
      }
    >
      {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
    </button>
  );
}
