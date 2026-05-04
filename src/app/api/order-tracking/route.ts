import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function GET(req: Request) {
    try {
        const rate = checkRateLimit(req, "order-tracking", 12, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: "Demasiadas consultas. Intenta de nuevo en un momento." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
        }

        const { searchParams } = new URL(req.url);
        const email = String(searchParams.get("email") || "").trim().toLowerCase();

        if (!isValidEmail(email)) {
            return NextResponse.json({ error: "Correo inválido." }, { status: 400 });
        }

        const orders = await prisma.order.findMany({
            where: { customerEmail: email },
            orderBy: { createdAt: "desc" },
            take: 5
        });

        return NextResponse.json({
            found: orders.length > 0,
            orders: orders.map((order) => {
                let items: any[] = [];
                try {
                    items = typeof order.items === "string" ? JSON.parse(order.items) : [];
                } catch {
                    items = [];
                }

                return {
                    id: order.id,
                    createdAt: order.createdAt,
                    customerName: order.customerName,
                    customerCity: order.customerCity,
                    customerAddress: order.customerAddress,
                    status: order.status,
                    total: order.total,
                    items: items.map((item) => ({
                        name: item.name,
                        quantity: item.quantity,
                        unit: item.unit,
                        price: item.price,
                        image: item.image || null
                    }))
                };
            })
        });
    } catch (error) {
        console.error("Order tracking lookup error:", error);
        return NextResponse.json({ error: "No pude consultar tus pedidos." }, { status: 500 });
    }
}
