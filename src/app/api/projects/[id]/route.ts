import { db } from "@/db";
import { projects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { PROJECT_FIELDS, getOwner, noOwner, pick } from "@/lib/server";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.owner, owner)));
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}

export async function PUT(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;
  const patch = pick(body, PROJECT_FIELDS.filter((f) => f !== "id"));
  const [row] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() } as Partial<typeof projects.$inferInsert>)
    .where(and(eq(projects.id, id), eq(projects.owner, owner)))
    .returning();
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}

export async function DELETE(req: Request, { params }: Ctx) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const { id } = await params;
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.owner, owner)));
  return Response.json({ ok: true });
}
