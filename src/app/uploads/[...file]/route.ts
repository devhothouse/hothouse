// Serves runtime-created files from public/uploads (user avatars, chat-generated
// images). Next.js production does not serve files added to public/ after the
// build, so requests that miss the static handler land here and are streamed
// from disk.
import { serveRuntimeMedia } from "@/lib/media";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  return serveRuntimeMedia(file, "uploads");
}