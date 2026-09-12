import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Review id is required." }, { status: 400 });
    }

    const review = await prisma.userReview.update({
      where: { id },
      data: {
        upvotes: { increment: 1 },
      },
    });

    return NextResponse.json({ success: true, upvotes: review.upvotes });
  } catch (error: any) {
    console.error("Gossip Upvote Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
