import { NextRequest, NextResponse } from "next/server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const readingRoomDisabledRoutes = ["/dashboard/audio", "/dashboard/video", "/dashboard/library"];
const existingLegacyRoutes = ["/dashboard/courses", "/dashboard/chat", "/dashboard/coach"];

export function proxy(request: NextRequest) {
  if (readingRoomDisabledRoutes.some((route) => request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(`${route}/`))) {
    return NextResponse.redirect(new URL("/dashboard/ebook", request.url));
  }
  if (existingLegacyRoutes.some((route) => request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(`${route}/`))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (request.nextUrl.pathname.startsWith("/uploads/books/")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!request.nextUrl.pathname.startsWith("/api/") || !UNSAFE_METHODS.has(request.method)) return NextResponse.next();
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    return NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 });
  }
  if (process.env.NODE_ENV === "production" && !origin) {
    return NextResponse.json({ error: "Request origin is required" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/uploads/books/:path*",
    "/dashboard/audio/:path*",
    "/dashboard/video/:path*",
    "/dashboard/library/:path*",
    "/dashboard/courses/:path*",
    "/dashboard/chat/:path*",
    "/dashboard/coach/:path*",
  ],
};
