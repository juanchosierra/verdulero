import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const orders = await prisma.order.findMany();
        const chats = await prisma.chatSession.findMany();

        const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
        const pendingOrders = orders.filter(o => o.status === 'Pendiente').length;
        const activeChats = chats.filter(c => c.isActive).length;

        // Mock data for a chart since we might not have much historical data yet
        const chartData = [
            { day: 'Lun', sales: Math.floor(Math.random() * 500000) },
            { day: 'Mar', sales: Math.floor(Math.random() * 500000) },
            { day: 'Mie', sales: Math.floor(Math.random() * 500000) },
            { day: 'Jue', sales: Math.floor(Math.random() * 500000) },
            { day: 'Vie', sales: Math.floor(Math.random() * 500000) },
            { day: 'Sab', sales: Math.floor(Math.random() * 500000) },
            { day: 'Dom', sales: totalSales },
        ];

        return NextResponse.json({
            totals: {
                sales: totalSales,
                pending: pendingOrders,
                chats: activeChats,
                conversion: chats.length > 0 ? (orders.length / chats.length * 100).toFixed(1) : 0
            },
            chart: chartData
        });
    } catch (error) {
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
    }
}
