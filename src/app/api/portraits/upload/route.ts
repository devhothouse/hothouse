import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";

// POST /api/portraits/upload — saves uploaded image files into
// public/portrait-library/ (the library that characters choose profile
// photos from). Accepts multipart/form-data with one or more "file"
// fields. Files are NOT scanned/tagged here — run the Portrait Library
// Tools' "Scan Portrait Folder" + "Process Unprocessed Photos" steps
// (or the First-Time Setup's image step) afterwards.
const VALID_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("file").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: "No file uploaded" }, { status: 400 });
    }

    const libraryDir = join(process.cwd(), "public", "portrait-library");
    if (!existsSync(libraryDir)) {
      await mkdir(libraryDir, { recursive: true });
    }

    const saved: string[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      if (!VALID_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
        rejected.push(file.name);
        continue;
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Keep a readable hint of the original name, uniquified.
      const dot = file.name.lastIndexOf(".");
      const rawBase = dot > 0 ? file.name.slice(0, dot) : file.name;
      const ext = (dot > 0 ? file.name.slice(dot) : ".png").toLowerCase();
      const safeExt = VALID_EXTENSIONS.includes(ext) ? ext : ".png";
      const safeBase = rawBase.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "portrait";
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const filename = `${safeBase}_${uniqueSuffix}${safeExt}`;

      await writeFile(join(libraryDir, filename), buffer);
      saved.push(filename);
    }

    return NextResponse.json({
      success: saved.length > 0,
      saved,
      rejected,
      message: `Uploaded ${saved.length} image(s) to the portrait library.`,
    });
  } catch (error: any) {
    console.error("Portrait library upload API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}