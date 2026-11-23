import { db } from "@/db";
import { tracks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { TRACK_FIELDS, getOwner, noOwner, pick } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  const [row] = await db.select().from(tracks).where(and(eq(tracks.id, id), eq(tracks.owner, owner)));
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const patch = pick(body, TRACK_FIELDS.filter((f) => f !== "id"));
  const [row] = await db
    .update(tracks)
    .set({ ...patch, updatedAt: new Date() } as Partial<typeof tracks.$inferInsert>)
    .where(and(eq(tracks.id, id), eq(tracks.owner, owner)))
    .returning();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  await db.delete(tracks).where(and(eq(tracks.id, id), eq(tracks.owner, owner)));
  return Response.json({ ok: true });
}
