// src/app/api/media/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserId } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

const LEGACY_MEDIA_ENABLED = false;

// GET /api/media — list media files for current user (with optional category filter)
export async function GET(req: NextRequest) {
  if (!LEGACY_MEDIA_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');

    const where: Record<string, unknown> = { userId };
    if (category && category !== 'All') {
      // Map UI categories to DB type values
      const typeMap: Record<string, string> = {
        Audio: 'AUDIO',
        Video: 'VIDEO',
        Ebook: 'IMAGE',
      };
      where.type = typeMap[category] || category;
    }

    const items = await prisma.mediaFile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('Media GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/media — register a media file record
export async function POST(req: NextRequest) {
  if (!LEGACY_MEDIA_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { title, description, type, url, thumbnailUrl, fileSize, duration, mimeType, category, totalPages } = body;

    if (!title || !type || !url) {
      return NextResponse.json(
        { error: 'Title, type, and url are required' },
        { status: 400 }
      );
    }

    const item = await prisma.mediaFile.create({
      data: {
        userId,
        title,
        description: description || null,
        type,
        url,
        thumbnailUrl: thumbnailUrl || null,
        fileSize: fileSize || 0,
        duration: duration || null,
        mimeType: mimeType || '',
        category: category || null,
      ...(totalPages !== undefined && { totalPages }),
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('Media POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/media?id=:id — delete a media file record and its physical file
export async function DELETE(req: NextRequest) {
  if (!LEGACY_MEDIA_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const item = await prisma.mediaFile.findUnique({ where: { id } });
    if (!item) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Only allow deleting own files
    if (item.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Delete physical file from disk
    if (item.url) {
      const filePath = path.join(process.cwd(), 'public', item.url.replace(/^\//, ''));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await prisma.mediaFile.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Media DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
