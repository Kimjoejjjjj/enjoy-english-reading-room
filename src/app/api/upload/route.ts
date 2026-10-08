// src/app/api/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getUserId } from '@/lib/auth';

const LEGACY_MEDIA_ENABLED = false;

/**
 * Extract PDF page count using pdf-parse library.
 */
async function getPdfPageCount(filePath: string): Promise<number> {
  try {
    const buffer = fs.readFileSync(filePath);
    // pdf-parse v2 exports a class directly
    // Legacy code remains unreachable while the media feature is disabled.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFParse = require('pdf-parse').PDFParse;
    const parser = new PDFParse(buffer);
    const info = await parser.getInfo();
    return Math.max(1, info.total || info.pages || 1);
  } catch (err) {
    console.warn('pdf-parse failed, falling back to /Count field:', err);
    try {
      const buffer = fs.readFileSync(filePath);
      const text = buffer.toString('latin1');
      const countMatch = text.match(/\/Count\s+(\d+)/);
      if (countMatch) return Math.max(1, parseInt(countMatch[1], 10));
    } catch {}
    return 1;
  }
}

export async function POST(req: NextRequest) {
  if (!LEGACY_MEDIA_ENABLED) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const userId = getUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { fileName, mimeType, base64Data, fileSize } = body;

    if (!fileName || !mimeType || !base64Data) {
      return NextResponse.json(
        { error: 'fileName, mimeType, and base64Data are required' },
        { status: 400 }
      );
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    const providedSize = fileSize || Math.ceil(Buffer.byteLength(base64Data, 'base64') * 0.75);
    if (providedSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is 50MB.` },
        { status: 400 }
      );
    }

    const ALLOWED_TYPES = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/webm',
      'video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo',
      'application/pdf',
    ]);
    if (!ALLOWED_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: 'File type not allowed. Allowed: images, audio, video, PDF.' },
        { status: 400 }
      );
    }

    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const ext = path.extname(fileName) || '.bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const safeName = path.parse(fileName).name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueName = `${safeName}_${hash}${ext}`;
    const filePath = path.join(uploadsDir, uniqueName);

    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const url = `/uploads/${uniqueName}`;

    let totalPages: number | undefined;
    if (mimeType === 'application/pdf') {
      totalPages = await getPdfPageCount(filePath);
    }

    return NextResponse.json({
      success: true,
      url,
      fileName: uniqueName,
      fileSize: buffer.length,
      mimeType,
      totalPages,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
