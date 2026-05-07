import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { buildDailySalesReport } from "@/lib/sales-report";

function startOfBogotaDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Bogota",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((p) => p.type === type)?.value || "0");
    return new Date(Date.UTC(read("year"), read("month") - 1, read("day"), 5, 0, 0));
}

function dayLabel(date: Date) {
    return new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        weekday: "short"
    }).format(date).replace(".", "");
}

function parseOrderItems(raw: unknown) {
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function computedMerchandiseTotal(order: { items: unknown }) {
    return parseOrderItems(order.items).reduce((sum: number, item: any) => {
        const quantity = Number(item?.quantity || 0);
        const price = Number(item?.price || 0);
        if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
        return sum + quantity * price;
    }, 0);
}

function isOperationalOrder(order: { total: number; subtotal: number; shipping: number; items: unknown }) {
    const items = parseOrderItems(order.items);
    if (items.length === 0) return false;

    const hasInvalidItem = items.some((item: any) => {
        const quantity = Number(item?.quantity || 0);
        const price = Number(item?.price || 0);
        if (!Number.isFinite(quantity) || !Number.isFinite(price)) return true;
        if (quantity <= 0 || price < 0) return true;
        if (quantity > 500) return true;
        if (quantity * price > 5_000_000) return true;
        return false;
    });
    if (hasInvalidItem) return false;

    const computedTotal = computedMerchandiseTotal(order) + Number(order.shipping || 0);
    const storedTotal = Number(order.total || 0);
    if (!Number.isFinite(storedTotal) || storedTotal <= 0) return false;
    if (storedTotal > 5_000_000) return false;

    const delta = Math.abs(storedTotal - computedTotal);
    return delta <= 5_000 || delta / Math.max(computedTotal, 1) <= 0.05;
}

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const [orders, chats, config, lastDispatch, reportPreview] = await Promise.all([
            prisma.order.findMany({ orderBy: { createdAt: "asc" } }),
            prisma.chatSession.findMany(),
            prisma.storeConfig.findFirst(),
            prisma.salesReportDispatch.findFirst({ orderBy: { createdAt: "desc" } }),
            buildDailySalesReport()
        ]);

        const validOrders = orders.filter(isOperationalOrder);
        const excludedOrders = orders.length - validOrders.length;

        const totalSales = validOrders.reduce((sum, o) => sum + o.total, 0);
        const pendingOrders = validOrders.filter((o) => o.status === "Pendiente").length;
        const completedOrders = validOrders.filter((o) => o.status === "Completado").length;
        const activeChats = chats.filter((c) => c.isActive).length;

        const startToday = startOfBogotaDay();
        const endToday = new Date(startToday);
        endToday.setUTCDate(endToday.getUTCDate() + 1);

        const salesToday = validOrders
            .filter((o) => new Date(o.createdAt) >= startToday && new Date(o.createdAt) < endToday)
            .reduce((sum, o) => sum + o.total, 0);

        const chatCount = chats.length;
        const orderCount = validOrders.length;
        const conversion = chatCount > 0 ? Number(((orderCount / chatCount) * 100).toFixed(1)) : 0;

        const weekStart = new Date(startToday);
        weekStart.setUTCDate(weekStart.getUTCDate() - 6);
        const chartData = [];
        for (let i = 0; i < 7; i += 1) {
            const dayStart = new Date(weekStart);
            dayStart.setUTCDate(weekStart.getUTCDate() + i);
            const dayEnd = new Date(dayStart);
            dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
            const dayOrders = validOrders.filter((o) => new Date(o.createdAt) >= dayStart && new Date(o.createdAt) < dayEnd);
            const daySales = dayOrders.reduce((sum, o) => sum + o.total, 0);
            chartData.push({
                day: dayLabel(dayStart),
                sales: daySales,
                orders: dayOrders.length
            });
        }

        return NextResponse.json({
            totals: {
                salesToday,
                sales: totalSales,
                pending: pendingOrders,
                chats: activeChats,
                orders: orderCount,
                completed: completedOrders,
                conversion,
                excludedOrders
            },
            operations: {
                aiPaused: config?.intervencionManual ?? false,
                cutoffHour: config?.horaCorte || "14:00",
                adminEmail: config?.emailAdmin || "",
                copyEmails: config?.emailsCopia || "",
                wooConfigured: Boolean(config?.wcUrl),
                promptConfigured: Boolean(config?.personalidad?.trim()),
                greetingConfigured: Boolean(config?.mensajeBienvenida?.trim())
            },
            chart: chartData,
            reports: {
                enabled: config?.reportesVentasActivos || false,
                hour: config?.reportesVentasHora || "18:00",
                emails: config?.reportesVentasEmails || "",
                recipientsCount: reportPreview.recipients.length,
                todaySales: reportPreview.totalSales,
                todayOrders: reportPreview.orders.length,
                lastDispatch
            }
        });
    } catch {
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const body = await req.json().catch(() => ({}));
        if (body?.action !== "reset") {
            return NextResponse.json({ error: "Invalid action" }, { status: 400 });
        }

        await prisma.$transaction([
            prisma.message.deleteMany({}),
            prisma.chatSession.deleteMany({}),
            prisma.orderDraft.deleteMany({}),
            prisma.order.deleteMany({}),
            prisma.customer.deleteMany({}),
            prisma.errorReport.deleteMany({}),
            prisma.learningEvent.deleteMany({}),
            prisma.salesReportDispatch.deleteMany({})
        ]);
        await prisma.$executeRawUnsafe('DELETE FROM "LearnedRule"');
        await prisma.$executeRawUnsafe('DELETE FROM "LearningRun"');

        return NextResponse.json({ ok: true, message: "Datos operativos reiniciados a cero." });
    } catch (error) {
        return NextResponse.json({ error: "Failed to reset stats" }, { status: 500 });
    }
}
