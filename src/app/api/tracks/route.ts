import { db } from "@/db";
import { tracks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { TRACK_FIELDS, getOwner, noOwner, pick } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const rows = await db.select().from(tracks).where(eq(tracks.owner, owner)).orderBy(desc(tracks.createdAt));
  return Response.json(rows.map(({ owner: _o, ...r }) => r));
}

export async function POST(req: Request) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id) return Response.json({ error: "id required" }, { status: 400 });
  const values = { ...pick(body, TRACK_FIELDS), owner } as typeof tracks.$inferInsert;
  const [row] = await db.insert(tracks).values(values).returning();
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}
