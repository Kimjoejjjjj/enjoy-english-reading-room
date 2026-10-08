// src/app/dashboard/library/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Filter, Grid, List, Music, Video, BookOpen, Film } from "lucide-react";

interface MediaItem {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  type: 'AUDIO' | 'VIDEO' | 'IMAGE';
  url: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  duration?: number | null;
  mimeType: string;
  category?: string | null;
  createdAt: string;
  updatedAt: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  AUDIO: <Music size={20} />,
  VIDEO: <Video size={20} />,
  IMAGE: <BookOpen size={20} />,
};

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

export default function LibraryPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categories = ["All", "Audio", "Video", "Ebook", "Courses"];

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/media?category=${encodeURIComponent(selectedCategory)}`);
      if (!res.ok) throw new Error('Failed to load media');
      const data = await res.json();
      setItems(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const filteredItems = items.filter(item => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return item.title.toLowerCase().includes(q) ||
           (item.description?.toLowerCase().includes(q)) ||
           (item.category?.toLowerCase().includes(q));
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground text-sm">Loading library...</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Library</h1>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
            <Filter size={16} />
            Filter
          </button>
          <button
            onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {viewMode === "grid" ? <List size={16} /> : <Grid size={16} />}
            {viewMode === "grid" ? "List" : "Grid"}
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search library..."
            className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              selectedCategory === category
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Results count */}
      <p className="mb-4 text-sm text-muted-foreground">
        {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        {searchQuery && ` matching "${searchQuery}"`}
      </p>

      {/* Media Grid/List */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
          <Film className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            {searchQuery ? "No results match your search." : "No media files yet."}
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="group cursor-pointer rounded-xl border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md"
            >
              <div className="mb-3 aspect-video w-full rounded-lg bg-muted flex items-center justify-center">
                {typeIcons[item.type] || <Film size={24} />}
              </div>
              <h3 className="mb-1 font-medium text-foreground truncate">{item.title}</h3>
              <p className="text-xs text-muted-foreground">
                {item.duration ? formatDuration(item.duration) : formatFileSize(item.fileSize)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-sm transition-all hover:shadow-md cursor-pointer"
            >
              <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-muted">
                {typeIcons[item.type] || <Film size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-foreground truncate">{item.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {item.duration ? formatDuration(item.duration) : formatFileSize(item.fileSize)}
                  {item.category && ` · ${item.category}`}
                </p>
              </div>
              <button className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}