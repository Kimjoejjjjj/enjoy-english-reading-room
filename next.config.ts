import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse resolves pdf.js worker files at runtime. Keeping it external prevents
  // Turbopack from moving the worker away from the package's expected location.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }];
  },
};

export default nextConfig;
