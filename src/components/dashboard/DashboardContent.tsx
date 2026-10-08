import { BarChart3, PlayCircle, Film, Headphones } from "lucide-react";

export default function DashboardContent() {
  return (
    <main className="flex-1 overflow-y-auto p-6">
      {/* Breadcrumb / Page Title */}
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <span>Home</span>
      </div>

      {/* Learning Statistics */}
      <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-foreground">
          <BarChart3 size={20} />
          Learning Statistics
        </h2>

        <div className="grid grid-cols-3 gap-4">
          {/* Today */}
          <div className="rounded-lg border border-border/50 bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">Today</p>
            <p className="mt-1 text-2xl font-bold text-foreground">0m</p>
            <p className="text-xs text-muted-foreground">0 Recordings</p>
          </div>

          {/* This Week */}
          <div className="rounded-lg border border-border/50 bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">This Week</p>
            <p className="mt-1 text-2xl font-bold text-foreground">0m</p>
            <p className="text-xs text-muted-foreground">0 Recordings</p>
          </div>

          {/* This Month */}
          <div className="rounded-lg border border-border/50 bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">This Month</p>
            <p className="mt-1 text-2xl font-bold text-foreground">0m</p>
            <p className="text-xs text-muted-foreground">0 Recordings</p>
          </div>
        </div>
      </section>

      {/* Activity */}
      <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Activity</h2>
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <p className="text-sm text-muted-foreground">No records found</p>
        </div>
      </section>

      {/* Recent Videos */}
      <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Film size={20} />
            Recent Videos
          </h2>
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            View All
            <PlayCircle size={14} />
          </button>
        </div>
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Film size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No media found</p>
            <button className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              Add Media
            </button>
          </div>
        </div>
      </section>

      {/* Recent Audios */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Headphones size={20} />
            Recent Audios
          </h2>
          <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            View All
            <PlayCircle size={14} />
          </button>
        </div>
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <div className="text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Headphones size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No media found</p>
            <button className="mt-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
              Add Media
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
