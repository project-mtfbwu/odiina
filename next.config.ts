import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const storageEndpoint =
      process.env.ODIINA_STORAGE_TUS_URL ??
      (process.env.SUPABASE_URL
        ? new URL(
            "/storage/v1/upload/resumable/sign",
            process.env.SUPABASE_URL,
          ).toString()
        : null);
    const storageOrigin = storageEndpoint
      ? new URL(storageEndpoint).origin
      : "";
    const scriptSource =
      process.env.NODE_ENV === "production"
        ? "'self' 'unsafe-inline'"
        : "'self' 'unsafe-inline' 'unsafe-eval'";

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src ${scriptSource}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "media-src 'self' blob:",
              "font-src 'self'",
              `connect-src 'self' ${storageOrigin}`.trim(),
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
        ],
      },
      {
        source: "/s/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};

export default nextConfig;
