import { readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

// MIME types for the media extensions the app stores on disk.
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

// Serves runtime-created media files from a folder under public/ (e.g.
// "uploads" or "portrait-library"). Needed because `next start` does not
// serve files that were added to public/ after the production build — and
// user avatars, runtime-uploaded portraits, and generated images are all
// created at runtime. Build-time files keep being served by the public
// folder directly; requests that miss it fall through to these routes.
// Path segments are sanitized (alphanumeric/._- only, no traversal).
export async function serveRuntimeMedia(segments: unknown, baseRel: string): Promise<Response> {
  if (!Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const safe = segments
    .map((s) => String(s).replace(/[^a-zA-Z0-9._-]/g, ""))
    .filter((s) => s.length > 0);
  if (safe.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const baseDir = path.join(process.cwd(), "public", ...baseRel.split("/"));
  const target = path.join(baseDir, ...safe);
  if (!target.startsWith(baseDir + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const st = await stat(target);
    if (!st.isFile()) throw new Error("not a file");
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}