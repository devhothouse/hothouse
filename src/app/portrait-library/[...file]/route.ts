// Serves runtime-created files from public/portrait-library (uploaded portraits,
// AI-generated portraits in /generated, imported characters in /imported).
import { serveRuntimeMedia } from "@/lib/media";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  return serveRuntimeMedia(file, "portrait-library");
}