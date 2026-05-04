import { prisma } from "@/lib/prisma";
import { jsPDF } from "jspdf";
import nodemailer from "nodemailer";
import { DELIVERY_TIMEZONE } from "@/lib/delivery";

function startOfBogotaDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DELIVERY_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
    return new Date(Date.UTC(read("year"), read("month") - 1, read("day"), 5, 0, 0));
}

function endOfBogotaDay(date = new Date()) {
    const start = startOfBogotaDay(date);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
}

function dateKeyBogota(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: DELIVERY_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function bogotaTimeParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: DELIVERY_TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
    return { hour: read("hour"), minute: read("minute") };
}

export function normalizeReportHour(raw?: string | null) {
    const value = (raw || "18:00").trim();
    if (!/^\d{2}:\d{2}$/.test(value)) return "18:00";
    return value;
}

export function shouldSendSalesReportNow(reportHour?: string | null, now = new Date()) {
    const normalized = normalizeReportHour(reportHour);
    const [targetHour, targetMinute] = normalized.split(":").map(Number);
    const current = bogotaTimeParts(now);
    return current.hour === targetHour && current.minute >= targetMinute && current.minute < targetMinute + 15;
}

function parseRecipients(config: { emailAdmin?: string | null; emailsCopia?: string | null; reportesVentasEmails?: string | null }) {
    const raw = [
        config.reportesVentasEmails || "",
        config.emailAdmin || "",
        config.emailsCopia || ""
    ].join(",");

    return Array.from(new Set(
        raw
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ));
}

export async function buildDailySalesReport(date = new Date()) {
    const [config, orders] = await Promise.all([
        prisma.storeConfig.findFirst(),
        prisma.order.findMany({
            where: {
                createdAt: {
                    gte: startOfBogotaDay(date),
                    lt: endOfBogotaDay(date)
                }
            },
            orderBy: { createdAt: "desc" }
        })
    ]);

    const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
    const pending = orders.filter((order) => order.status === "Pendiente").length;
    const completed = orders.filter((order) => order.status === "Completado").length;
    const inTransit = orders.filter((order) => order.status === "En Camino").length;
    const recipients = parseRecipients(config || {});
    const dateLabel = new Intl.DateTimeFormat("es-CO", {
        timeZone: DELIVERY_TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(date);

    return {
        config,
        orders,
        totalSales,
        pending,
        completed,
        inTransit,
        recipients,
        dateKey: dateKeyBogota(date),
        dateLabel
    };
}

export function buildSalesReportPdf(report: Awaited<ReturnType<typeof buildDailySalesReport>>) {
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("El Verdulero", 14, 18);
    doc.setFontSize(11);
    doc.text(`Reporte de ventas - ${report.dateLabel}`, 14, 26);

    doc.setFontSize(10);
    doc.text(`Ventas del dia: $${report.totalSales.toLocaleString("es-CO")}`, 14, 38);
    doc.text(`Pedidos: ${report.orders.length}`, 14, 44);
    doc.text(`Pendientes: ${report.pending}`, 70, 44);
    doc.text(`En camino: ${report.inTransit}`, 110, 44);
    doc.text(`Completados: ${report.completed}`, 155, 44);

    let y = 58;
    doc.setFont("helvetica", "bold");
    doc.text("Pedido", 14, y);
    doc.text("Cliente", 34, y);
    doc.text("Ciudad", 90, y);
    doc.text("Estado", 128, y);
    doc.text("Total", 170, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    for (const order of report.orders) {
        if (y > 275) {
            doc.addPage();
            y = 18;
        }
        doc.text(`#${order.id}`, 14, y);
        doc.text(order.customerName.slice(0, 28), 34, y);
        doc.text(order.customerCity.slice(0, 20), 90, y);
        doc.text(order.status.slice(0, 16), 128, y);
        doc.text(`$${order.total.toLocaleString("es-CO")}`, 170, y, { align: "right" });
        y += 6;
    }

    return Buffer.from(doc.output("arraybuffer"));
}

export async function sendDailySalesReport(options?: { force?: boolean; now?: Date }) {
    const now = options?.now || new Date();
    const report = await buildDailySalesReport(now);

    if (!report.config?.reportesVentasActivos && !options?.force) {
        return { skipped: true, reason: "Reportes automáticos desactivados" };
    }

    if (report.recipients.length === 0) {
        return { skipped: true, reason: "No hay correos configurados para reportes" };
    }

    if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        return { skipped: true, reason: "SMTP no configurado" };
    }

    const existing = await prisma.salesReportDispatch.findUnique({
        where: { dateKey: report.dateKey }
    });

    if (existing && !options?.force) {
        return { skipped: true, reason: "El reporte de hoy ya fue enviado", dispatch: existing };
    }

    const pdf = buildSalesReportPdf(report);
    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT),
        secure: Number(process.env.EMAIL_PORT) === 465,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    try {
        await transporter.sendMail({
            from: `"El Verdulero" <${process.env.EMAIL_USER}>`,
            to: report.recipients[0],
            cc: report.recipients.slice(1).join(","),
            subject: `Reporte de ventas El Verdulero - ${report.dateLabel}`,
            text: `Reporte diario de ventas.\nVentas del dia: $${report.totalSales.toLocaleString("es-CO")}\nPedidos: ${report.orders.length}\nPendientes: ${report.pending}\nEn camino: ${report.inTransit}\nCompletados: ${report.completed}`,
            html: `
                <div style="font-family:Arial,sans-serif;padding:24px;color:#0f172a">
                  <h1 style="margin:0 0 12px;color:#166534">Reporte de ventas</h1>
                  <p style="margin:0 0 16px">Fecha: <strong>${report.dateLabel}</strong></p>
                  <table style="border-collapse:collapse;width:100%;max-width:560px">
                    <tr><td style="padding:8px;border:1px solid #e5e7eb">Ventas del día</td><td style="padding:8px;border:1px solid #e5e7eb"><strong>$${report.totalSales.toLocaleString("es-CO")}</strong></td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb">Pedidos</td><td style="padding:8px;border:1px solid #e5e7eb">${report.orders.length}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb">Pendientes</td><td style="padding:8px;border:1px solid #e5e7eb">${report.pending}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb">En camino</td><td style="padding:8px;border:1px solid #e5e7eb">${report.inTransit}</td></tr>
                    <tr><td style="padding:8px;border:1px solid #e5e7eb">Completados</td><td style="padding:8px;border:1px solid #e5e7eb">${report.completed}</td></tr>
                  </table>
                  <p style="margin-top:16px">Adjunto encontrarás el PDF con el resumen del día.</p>
                </div>
            `,
            attachments: [{
                filename: `reporte-ventas-${report.dateKey}.pdf`,
                content: pdf
            }]
        });

        const dispatch = await prisma.salesReportDispatch.upsert({
            where: { dateKey: report.dateKey },
            update: {
                recipients: report.recipients.join(","),
                status: "sent",
                summary: `Ventas: $${report.totalSales.toLocaleString("es-CO")} | Pedidos: ${report.orders.length}`
            },
            create: {
                dateKey: report.dateKey,
                period: report.dateLabel,
                recipients: report.recipients.join(","),
                status: "sent",
                summary: `Ventas: $${report.totalSales.toLocaleString("es-CO")} | Pedidos: ${report.orders.length}`
            }
        });

        return { skipped: false, dispatch, report };
    } catch (error: any) {
        const dispatch = await prisma.salesReportDispatch.upsert({
            where: { dateKey: report.dateKey },
            update: {
                recipients: report.recipients.join(","),
                status: "failed",
                summary: error?.message?.slice(0, 180) || "Fallo SMTP"
            },
            create: {
                dateKey: report.dateKey,
                period: report.dateLabel,
                recipients: report.recipients.join(","),
                status: "failed",
                summary: error?.message?.slice(0, 180) || "Fallo SMTP"
            }
        });

        return { skipped: false, failed: true, dispatch, report, error: error?.message || "Fallo SMTP" };
    }
}
