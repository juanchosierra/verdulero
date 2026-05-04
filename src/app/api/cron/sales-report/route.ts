import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendDailySalesReport, shouldSendSalesReportNow } from "@/lib/sales-report";

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    try {
        const config = await prisma.storeConfig.findFirst();
        if (!config?.reportesVentasActivos) {
            return NextResponse.json({ ok: true, skipped: true, reason: "Reportes automáticos desactivados" });
        }

        if (!shouldSendSalesReportNow(config.reportesVentasHora)) {
            return NextResponse.json({
                ok: true,
                skipped: true,
                reason: `Todavía no es la hora de envío (${config.reportesVentasHora || "18:00"})`
            });
        }

        const result = await sendDailySalesReport();
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        console.error("Sales report cron error:", error);
        return NextResponse.json({ error: "No pude ejecutar el cron de reportes." }, { status: 500 });
    }
}
