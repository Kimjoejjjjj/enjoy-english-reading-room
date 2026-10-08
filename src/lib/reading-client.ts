export interface ReadingBinding { userId: string; sessionId: string; sectionId: string; contentId: string }
const bindings = new Map<string, ReadingBinding>();
export function setReadingBinding(contentId: string, binding: ReadingBinding | null) {
  if (binding) bindings.set(contentId, binding); else bindings.delete(contentId);
}
export function getReadingBinding(contentId: string) { return bindings.get(contentId) || null; }

export interface ReadingDelta {
  deltaId: string; sessionId: string; contentId: string; sectionId: string;
  ownerToken: string; fencingVersion: number; seconds: number;
}

export class ReadingDeltaQueue {
  items: ReadingDelta[];
  private inFlight: Promise<boolean> | null = null;
  constructor(items: ReadingDelta[], private persist: (items: ReadingDelta[]) => void) { this.items = items; }
  append(delta: ReadingDelta) { if (this.items.some((item) => item.deltaId === delta.deltaId)) return; this.items.push(delta); this.persist(this.items); }
  acknowledge(ids: string[]) {
    const accepted = new Set(ids);
    this.items = this.items.filter((item) => !accepted.has(item.deltaId));
    this.persist(this.items);
  }
  flush(send: (delta: ReadingDelta) => Promise<boolean>): Promise<boolean> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        while (this.items.length) {
          const delta = this.items[0];
          if (!await send(delta)) return false;
          this.acknowledge([delta.deltaId]);
        }
        return true;
      } catch { return false; }
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
}

// Duplicate tabs can copy sessionStorage. An exclusive browser lock detects that copy.
export async function claimReadingTab(contentId: string) {
  const key = `enjoy-reading-tab:v2:${contentId}`;
  let id = sessionStorage.getItem(key) || crypto.randomUUID();
  if (!navigator.locks) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return { id, release: () => {} };
  }
  const claim = (candidate: string) => new Promise<(() => void) | null>((resolve) => {
    void navigator.locks.request(`enjoy-reading-tab:${candidate}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return; }
      await new Promise<void>((release) => resolve(release));
    });
  });
  let release = await claim(id);
  if (!release) { id = crypto.randomUUID(); release = await claim(id); }
  if (!release) throw new Error("Cannot reserve reading tab");
  sessionStorage.setItem(key, id);
  return { id, release };
}
