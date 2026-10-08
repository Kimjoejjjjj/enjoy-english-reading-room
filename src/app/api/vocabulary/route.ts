// src/app/api/vocabulary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserId } from '@/lib/auth';

// GET /api/vocabulary — list all words for current user
export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const learned = searchParams.get('learned');

    const where: Record<string, unknown> = { userId };
    if (learned !== null) {
      where.learned = learned === 'true';
    }

    const items = await prisma.vocabulary.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error('Vocabulary GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/vocabulary — create a new word
export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { word, meaning, translation, example, pronunciation, notes } = body;

    if (!word || !word.trim()) {
      return NextResponse.json(
        { error: 'Word is required' },
        { status: 400 }
      );
    }

    // Check if word already exists for this user
    const existing = await prisma.vocabulary.findFirst({
      where: { userId, word: word.trim().toLowerCase() },
    });

    if (existing) {
      // Update existing word
      const updated = await prisma.vocabulary.update({
        where: { id: existing.id },
        data: {
          ...(meaning !== undefined && { meaning: meaning || null }),
          ...(translation !== undefined && { translation: translation || null }),
          ...(example !== undefined && { example: example || null }),
          ...(pronunciation !== undefined && { pronunciation: pronunciation || null }),
          ...(notes !== undefined && { notes: notes || null }),
        },
      });
      return NextResponse.json(updated);
    }

    const item = await prisma.vocabulary.create({
      data: {
        userId,
        word: word.trim(),
        meaning: meaning || null,
        translation: translation || null,
        example: example || null,
        pronunciation: pronunciation || null,
        notes: notes || null,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error('Vocabulary POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/vocabulary?id=:id — update a word
export async function PATCH(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { error: 'Word ID is required' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { word, translation, example, pronunciation, notes, learned, meaning } = body;

    const existing = await prisma.vocabulary.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updated = await prisma.vocabulary.update({
      where: { id },
      data: {
        ...(word !== undefined && { word: word.trim() }),
        ...(meaning !== undefined && { meaning: meaning || null }),
        ...(translation !== undefined && { translation: translation || null }),
        ...(example !== undefined && { example: example || null }),
        ...(pronunciation !== undefined && { pronunciation: pronunciation || null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(learned !== undefined && { learned }),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Vocabulary PATCH error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/vocabulary?id=:id — delete a word
export async function DELETE(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { error: 'Word ID is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.vocabulary.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.vocabulary.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Vocabulary DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
