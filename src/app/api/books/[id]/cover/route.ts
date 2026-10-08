import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteStoredCover, detectRasterCover, saveBookCover } from "@/lib/book-cover";
import { regenerateBookCover } from "@/lib/book-cover-service";

type Context = { params: Promise<{ id: string }> };
const MAX_CUSTOM_COVER_SIZE = 10 * 1024 * 1024;

async function ownedBook(req: NextRequest, params: Context["params"]) {
  const userId = getUserId(req);
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id } = await params;
  const book = await prisma.content.findFirst({ where: { id, userId } });
  if (!book) return { error: NextResponse.json({ error: "Book not found" }, { status: 404 }) };
  return { book };
}

export async function POST(req: NextRequest, { params }: Context) {
  const access = await ownedBook(req, params);
  if (access.error) return access.error;
  try {
    const coverUrl = await regenerateBookCover(access.book);
    return NextResponse.json({ coverUrl });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "封面生成失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(req: NextRequest, { params }: Context) {
  const access = await ownedBook(req, params);
  if (access.error) return access.error;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择封面图片" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_CUSTOM_COVER_SIZE) {
    return NextResponse.json({ error: "封面必须小于 10MB" }, { status: 400 });
  }
  const detected = detectRasterCover(Buffer.from(await file.arrayBuffer()));
  if (!detected) return NextResponse.json({ error: "仅支持 JPG、PNG 或 WebP 封面" }, { status: 400 });

  const nextUrl = await saveBookCover(detected);
  try {
    await prisma.content.update({ where: { id: access.book.id }, data: { coverUrl: nextUrl } });
  } catch (cause) {
    await deleteStoredCover(nextUrl);
    throw cause;
  }
  await deleteStoredCover(access.book.coverUrl);
  return NextResponse.json({ coverUrl: nextUrl });
}
