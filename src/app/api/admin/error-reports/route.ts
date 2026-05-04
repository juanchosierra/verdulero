import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";
import { learnFromResolvedErrorReport } from "@/lib/learning";

const VALID_ERROR_STATUSES = ["nuevo", "revisando", "resuelto"];

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const reports = await prisma.errorReport.findMany({
            orderBy: { createdAt: "desc" }
        });
        return NextResponse.json(reports);
    } catch {
        return NextResponse.json({ error: "No pude traer los reportes de error." }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { id, status } = await req.json();
        if (!id || !status) {
            return NextResponse.json({ error: "Faltan datos para actualizar el reporte." }, { status: 400 });
        }
        if (!VALID_ERROR_STATUSES.includes(status)) {
            return NextResponse.json({ error: `Estado inválido. Valores permitidos: ${VALID_ERROR_STATUSES.join(', ')}` }, { status: 400 });
        }

        const previous = await prisma.errorReport.findUnique({
            where: { id }
        });

        const report = await prisma.errorReport.update({
            where: { id },
            data: { status, updatedAt: new Date() }
        });

        let learning = null;
        if (status === "resuelto" && previous?.status !== "resuelto") {
            learning = await learnFromResolvedErrorReport({
                id: report.id,
                messageContent: report.messageContent,
                reporterNote: report.reporterNote,
                conversationSlice: report.conversationSlice
            });
        }

        return NextResponse.json({ ...report, learning });
    } catch {
        return NextResponse.json({ error: "No pude actualizar el reporte." }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get("id");
        if (!id) {
            return NextResponse.json({ error: "Falta el ID del reporte para eliminar." }, { status: 400 });
        }

        await prisma.errorReport.delete({
            where: { id }
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: "No pude eliminar el reporte." }, { status: 500 });
    }
}
