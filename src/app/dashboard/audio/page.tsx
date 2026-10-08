// src/app/dashboard/audio/page.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, Pause, Headphones, Search, Plus, Trash2 } from "lucide-react";
import UploadModal from "@/components/media/UploadModal";

interface AudioItem {
  id: string;
  title: string;
  description?: string | null;
  url: string;
  duration?: number | null;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

export default function AudioPage() {
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadAudios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/media?category=Audio");
      if (!res.ok) throw new Error("Failed to load audios");
      const data = await res.json();
      setAudios(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudios();
  }, [loadAudios]);

  // Handle audio element events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentId(null);
    };

    const handleError = () => {
      console.error("Audio playback error:", audio.error);
      setIsPlaying(false);
      setError("Failed to load audio file.");
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, []);

  // Play audio when currentId changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentId) return;

    const item = audios.find(a => a.id === currentId);
    if (!item) return;

    audio.src = item.url;
    audio.load();
    audio.play().catch(err => {
      console.error("Play failed:", err);
      setError("Failed to play audio: " + err.message);
      setIsPlaying(false);
    });
    setIsPlaying(true);
  }, [currentId, audios]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(err => {
        console.error("Play failed:", err);
        setError("Failed to play audio: " + err.message);
      });
      setIsPlaying(true);
    }
  };

  const deleteAudio = async (id: string) => {
    try {
      const res = await fetch(`/api/media?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      if (currentId === id) {
        setCurrentId(null);
        setIsPlaying(false);
      }
      setAudios(prev => prev.filter(a => a.id !== id));
    } catch (e: any) {
      alert("Delete failed: " + e.message);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const filteredAudios = audios.filter(a => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.title.toLowerCase().includes(q) ||
           (a.description?.toLowerCase().includes(q));
  });

  const currentAudio = audios.find(a => a.id === currentId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground text-sm">Loading audios...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Audio Library</h1>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Upload Audio
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search audios..."
          className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => setError(null)} className="mt-2 text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Now Playing */}
      {currentAudio && (
        <div className="mb-6 rounded-xl border border-primary/50 bg-card p-4 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Headphones size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{currentAudio.title}</p>
              <p className="text-xs text-muted-foreground">Now Playing</p>
            </div>
            <button
              onClick={togglePlayPause}
              className="rounded-full bg-primary p-2 text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Track List */}
      {filteredAudios.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <Headphones className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            {searchQuery ? "No results match your search." : "No audio files yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAudios.map((audio) => (
            <div
              key={audio.id}
              className={`flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm transition-all ${
                currentId === audio.id ? "border-primary/50 bg-primary/5" : "hover:bg-muted/50"
              }`}
            >
              <div
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded bg-muted transition-colors hover:bg-primary/10"
                onClick={() => {
                  if (currentId === audio.id) {
                    togglePlayPause();
                  } else {
                    setCurrentId(audio.id);
                  }
                }}
              >
                {currentId === audio.id && isPlaying ? (
                  <Pause size={16} className="text-primary" />
                ) : (
                  <Play size={16} className="text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground truncate">{audio.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {audio.duration ? formatDuration(audio.duration) : formatFileSize(audio.fileSize)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {audio.mimeType.split('/')[1]?.toUpperCase()}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmId(audio.id === deleteConfirmId ? null : audio.id);
                }}
                className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
              {deleteConfirmId === audio.id && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAudio(audio.id);
                    }}
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(null);
                    }}
                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden audio element — always mounted so ref is always available */}
      <audio ref={audioRef} preload="metadata" style={{ display: 'none' }} />

      {/* Upload Modal */}
      <UploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(url, title, type, mimeType, fileSize) => {
          fetch("/api/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              type,
              url,
              fileSize,
              mimeType,
            }),
          }).then(() => loadAudios());
        }}
      />
    </div>
  );
}
