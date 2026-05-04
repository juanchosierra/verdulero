import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getInventoryPredictionSnapshot } from "@/lib/inventory-prediction";

export async function GET(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const snapshot = await getInventoryPredictionSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Inventory analytics GET error:", error);
    return NextResponse.json({ error: "No pude calcular el inventario predictivo." }, { status: 500 });
  }
}
