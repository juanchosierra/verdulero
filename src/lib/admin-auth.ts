import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Verifica que la request tenga un JWT de admin válido.
 * Retorna null si el token es válido, o una NextResponse 401 si no lo es.
 * Úsalo al inicio de cada handler de /api/admin/*.
 */
export async function requireAdmin(req: Request): Promise<NextResponse | null> {
    const token = await getToken({
        req: req as NextRequest,
        secret: process.env.NEXTAUTH_SECRET,
    });
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return null;
}
