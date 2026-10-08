import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveCoverPath } from "@/lib/app-storage";

export const runtime = "nodejs";

const coverNamePattern = /^cover_[a-f0-9]+\.(png|jpg|webp|svg)$/;
const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { filename } = await params;
  if (!coverNamePattern.test(filename)) return NextResponse.json({ error: "Cover not found" }, { status: 404 });

  const accessible = await prisma.content.findFirst({
    where: {
      coverUrl: { in: [`/uploads/books/covers/${filename}`, `/api/book-covers/${filename}`] },
      OR: [{ userId }, { userId: null, source: "SAMPLE" }],
    },
    select: { id: true },
  });
  if (!accessible) return NextResponse.json({ error: "Cover not found" }, { status: 404 });

  try {
    const file = await readFile(await resolveCoverPath(filename));
    const extension = filename.slice(filename.lastIndexOf(".") + 1);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": contentTypes[extension] || "application/octet-stream",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Cover not found" }, { status: 404 });
  }
}
