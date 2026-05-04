import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildDailySalesReport, sendDailySalesReport } from "@/lib/sales-report";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const [preview, lastDispatch, config] = await Promise.all([
            buildDailySalesReport(),
            prisma.salesReportDispatch.findFirst({ orderBy: { createdAt: "desc" } }),
            prisma.storeConfig.findFirst()
        ]);

        return NextResponse.json({
            preview: {
                dateLabel: preview.dateLabel,
                totalSales: preview.totalSales,
                orders: preview.orders.length,
                pending: preview.pending,
                inTransit: preview.inTransit,
                completed: preview.completed,
                recipients: preview.recipients
            },
            config: {
                enabled: config?.reportesVentasActivos || false,
                hour: config?.reportesVentasHora || "18:00",
                emails: config?.reportesVentasEmails || ""
            },
            lastDispatch
        });
    } catch (error) {
        console.error("Admin sales report GET error:", error);
        return NextResponse.json({ error: "No pude cargar la programación de reportes." }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const body = await req.json().catch(() => ({}));

        if (body?.action === "send-now") {
            const result = await sendDailySalesReport({ force: true });
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    } catch (error: any) {
        console.error("Admin sales report POST error:", error);
        return NextResponse.json({ error: error?.message || "No pude enviar el reporte ahora." }, { status: 500 });
    }
}
