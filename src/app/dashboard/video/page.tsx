// src/app/dashboard/video/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Play, Pause, Video as VideoIcon, Search, Maximize, Plus } from "lucide-react";
import UploadModal from "@/components/media/UploadModal";

interface VideoItem {
  id: string;
  title: string;
  description?: string | null;
  url: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
  createdAt: string;
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function VideoPage() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/media?category=Video");
      if (!res.ok) throw new Error("Failed to load videos");
      const data = await res.json();
      setVideos(data);
      if (data.length > 0) {
        setCurrentId(data[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  const currentVideo = videos.find(v => v.id === currentId);

  const filteredVideos = videos.filter(v => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return v.title.toLowerCase().includes(q) ||
           (v.description?.toLowerCase().includes(q));
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground text-sm">Loading videos...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Video Library</h1>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Upload Video
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search videos..."
          className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Video Player */}
        <div className="lg:col-span-2">
          {currentVideo ? (
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              <div className="aspect-video w-full bg-black">
                <video
                  src={currentVideo.url}
                  controls
                  autoPlay={false}
                  className="h-full w-full object-contain"
                  poster={currentVideo.thumbnailUrl || undefined}
                >
                  Your browser does not support video.
                </video>
              </div>
              <div className="p-4">
                <h2 className="text-lg font-semibold text-foreground">{currentVideo.title}</h2>
                {currentVideo.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{currentVideo.description}</p>
                )}
                <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                  {currentVideo.duration && <span>{formatDuration(currentVideo.duration)}</span>}
                  <span>{new Date(currentVideo.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-xl border border-border bg-card shadow-sm">
              <div className="text-center">
                <VideoIcon size={48} className="mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No videos available</p>
              </div>
            </div>
          )}
        </div>

        {/* Video List */}
        <div className="space-y-2">
          <h3 className="mb-2 text-sm font-semibold text-foreground">Up Next</h3>
          {filteredVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground">No videos match your search.</p>
          ) : (
            filteredVideos.map((video) => (
              <div
                key={video.id}
                onClick={() => setCurrentId(video.id)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all ${
                  currentId === video.id
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                  {currentId === video.id ? (
                    <Play size={16} className="text-primary" />
                  ) : (
                    <VideoIcon size={16} className="text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-medium text-foreground">{video.title}</h4>
                  {video.duration && (
                    <p className="text-xs text-muted-foreground">{formatDuration(video.duration)}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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
          }).then(() => loadVideos());
        }}
      />
    </div>
  );
}
