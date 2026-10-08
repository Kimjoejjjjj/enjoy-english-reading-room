// src/app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getUserId } from '@/lib/auth';

// GET /api/chat — get chat history for current user
export async function GET(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error('Chat GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/chat — send a message (save to DB + simulate AI reply)
const AI_RESPONSES = [
  "That's a great question! Let me help you with that.",
  "Here's a tip: practicing regularly is the key to language learning. Try to use new words in sentences!",
  "Good effort! Here's a more natural way to say that:\n\n\"I've been studying English for two years.\"",
  "Let me explain this concept in simpler terms. Think of it like this...",
  "Interesting! This reminds me of a common pattern in English. The key difference is...",
];

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { content } = body;

    if (!content || !content.trim()) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    // Save user message
    const userMsg = await prisma.chatMessage.create({
      data: {
        userId,
        role: 'user',
        content: content.trim(),
      },
    });

    // Simulate AI response (keep setTimeout for UX feel)
    const aiReply = AI_RESPONSES[Math.floor(Math.random() * AI_RESPONSES.length)];
    const aiMsg = await prisma.chatMessage.create({
      data: {
        userId,
        role: 'assistant',
        content: aiReply,
      },
    });

    return NextResponse.json(
      { userMessage: userMsg, aiMessage: aiMsg },
      { status: 201 }
    );
  } catch (error) {
    console.error('Chat POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
