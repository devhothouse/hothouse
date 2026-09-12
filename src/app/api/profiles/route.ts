import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Get all profiles
export async function GET() {
  try {
    console.log("Fetching profiles from DB...");
    const profiles = await prisma.profile.findMany({
      orderBy: { createdAt: "desc" },
    });
    console.log(`Found ${profiles.length} profiles.`);
    return NextResponse.json({ success: true, profiles });
  } catch (error: any) {
    console.error("CRITICAL Profile GET Error:", error);
    return NextResponse.json({ success: false, error: String(error), profiles: [] }, { status: 500 });
  }
}

// Create a new profile
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, bio, avatar, gender, lookingFor } = body;

    if (!name || !gender || !lookingFor) {
      return NextResponse.json({ success: false, error: "Name, gender, and looking for are required." }, { status: 400 });
    }

    // Set other profiles to inactive
    await prisma.profile.updateMany({
      data: { isActive: false },
    });

    const newProfile = await prisma.profile.create({
      data: {
        name,
        bio: bio || "",
        avatar: avatar || "A nice person",
        gender,
        lookingFor,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, profile: newProfile });
  } catch (error: any) {
    console.error("Profile POST Error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// Update or Switch active profile
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, action, name, bio, avatar, gender, lookingFor } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Profile ID is required." }, { status: 400 });
    }

    if (action === "switch") {
      // Set all other profiles to inactive
      await prisma.profile.updateMany({
        where: { id: { not: id } },
        data: { isActive: false },
      });

      // Set current to active
      const updated = await prisma.profile.update({
        where: { id },
        data: { isActive: true },
      });

      return NextResponse.json({ success: true, profile: updated });
    } else {
      // Edit profile details
      const updated = await prisma.profile.update({
        where: { id },
        data: {
          name,
          bio,
          avatar,
          gender,
          lookingFor,
        },
      });

      return NextResponse.json({ success: true, profile: updated });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Permanently delete a profile and ALL of its associated data. Interaction rows
// (and their Messages) plus UserReview rows reference the profile with
// onDelete: Cascade in the Prisma schema, so a single profile.delete() purges
// every match, chat message, and gossip post. The per-profile preference-reset
// marker (Danger Zone bookkeeping) is removed explicitly. If the deleted
// profile was active, the most recent remaining profile is promoted to active.
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("profileId");
    if (!id) {
      return NextResponse.json({ success: false, error: "Profile ID is required." }, { status: 400 });
    }

    const profile = await prisma.profile.findUnique({ where: { id } });
    if (!profile) {
      return NextResponse.json({ success: false, error: "Profile not found." }, { status: 404 });
    }

    await prisma.profile.delete({ where: { id } });

    await prisma.systemSetting.deleteMany({
      where: { key: `preferences_reset_at_${id}` },
    });

    let activatedProfileId: string | null = null;
    if (profile.isActive) {
      const remaining = await prisma.profile.findMany({ orderBy: { createdAt: "desc" }, take: 1 });
      if (remaining.length > 0) {
        const activated = await prisma.profile.update({
          where: { id: remaining[0].id },
          data: { isActive: true },
        });
        activatedProfileId = activated.id;
      }
    }

    return NextResponse.json({ success: true, activatedProfileId });
  } catch (error: any) {
    console.error("Profile DELETE Error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
