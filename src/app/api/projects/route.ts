import { db } from "@/db";
import { projects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { PROJECT_FIELDS, getOwner, noOwner, pick } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const rows = await db.select().from(projects).where(eq(projects.owner, owner)).orderBy(desc(projects.updatedAt));
  return Response.json(rows.map(({ owner: _o, ...r }) => r));
}

export async function POST(req: Request) {
  const owner = getOwner(req);
  if (!owner) return noOwner();
  const body = (await req.json()) as Record<string, unknown>;
  if (typeof body.id !== "string" || !body.id) return Response.json({ error: "id required" }, { status: 400 });
  const values = { ...pick(body, PROJECT_FIELDS), owner } as typeof projects.$inferInsert;
  const [row] = await db.insert(projects).values(values).returning();
  const { owner: _o, ...rest } = row;
  return Response.json(rest);
}
