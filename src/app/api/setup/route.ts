import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    // Deshabilitado en todos los ambientes. Usuario admin se gestiona directamente en BD.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
}
