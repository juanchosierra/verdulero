import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin-auth";

type ProductAggregate = {
    name: string;
    quantity: number;
    times: number;
    revenue: number;
    lastOrderedAt: string;
};

type CustomerAggregate = {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    lastAddress: string | null;
    source: Set<"contacto" | "chat" | "compra">;
    firstContactAt: Date | null;
    lastContactAt: Date | null;
    lastPurchaseAt: Date | null;
    totalOrders: number;
    totalSpent: number;
    orders: any[];
    chats: any[];
    productMap: Map<string, ProductAggregate>;
    weekdayMap: Map<string, number>;
};

function normalizeText(raw: unknown) {
    return String(raw || "").trim();
}

function normalizePhone(raw: unknown) {
    const digits = normalizeText(raw).replace(/\D/g, "");
    return digits || null;
}

function normalizeEmail(raw: unknown) {
    const email = normalizeText(raw).toLowerCase();
    return email && email.includes("@") ? email : null;
}

function keyForContact(input: { phone?: unknown; email?: unknown; sessionId?: unknown }) {
    const phone = normalizePhone(input.phone);
    if (phone) return `phone:${phone}`;
    const email = normalizeEmail(input.email);
    if (email) return `email:${email}`;
    return `session:${normalizeText(input.sessionId) || crypto.randomUUID()}`;
}

function parseItems(raw: unknown) {
    try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function touchDates(customer: CustomerAggregate, date: Date | null | undefined) {
    if (!date) return;
    if (!customer.firstContactAt || date < customer.firstContactAt) customer.firstContactAt = date;
    if (!customer.lastContactAt || date > customer.lastContactAt) customer.lastContactAt = date;
}

function mergeString(current: string | null, next: unknown) {
    const value = normalizeText(next);
    return current || value || null;
}

function getOrCreate(map: Map<string, CustomerAggregate>, key: string): CustomerAggregate {
    const existing = map.get(key);
    if (existing) return existing;
    const created: CustomerAggregate = {
        id: key,
        name: "Cliente sin nombre",
        phone: null,
        email: null,
        city: null,
        lastAddress: null,
        source: new Set(),
        firstContactAt: null,
        lastContactAt: null,
        lastPurchaseAt: null,
        totalOrders: 0,
        totalSpent: 0,
        orders: [],
        chats: [],
        productMap: new Map(),
        weekdayMap: new Map()
    };
    map.set(key, created);
    return created;
}

function getOrCreateContact(map: Map<string, CustomerAggregate>, input: { phone?: unknown; email?: unknown; sessionId?: unknown }) {
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const directPhone = phone ? map.get(`phone:${phone}`) : null;
    if (directPhone) return directPhone;
    const directEmail = email ? map.get(`email:${email}`) : null;
    if (directEmail) return directEmail;

    const existing = Array.from(map.values()).find((customer) => {
        return (phone && customer.phone === phone) || (email && customer.email === email);
    });
    if (existing) return existing;

    return getOrCreate(map, keyForContact(input));
}

function weekdayLabel(date: Date) {
    return new Intl.DateTimeFormat("es-CO", {
        weekday: "long",
        timeZone: "America/Bogota"
    }).format(date);
}

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const [customers, orders, chats] = await Promise.all([
            prisma.customer.findMany({ orderBy: { updatedAt: "desc" } }),
            prisma.order.findMany({ orderBy: { createdAt: "desc" } }),
            prisma.chatSession.findMany({
                include: {
                    messages: {
                        orderBy: { createdAt: "asc" }
                    }
                },
                orderBy: { updatedAt: "desc" }
            })
        ]);

        const map = new Map<string, CustomerAggregate>();

        for (const row of customers) {
            const customer = getOrCreateContact(map, { phone: row.phone, email: row.email });
            customer.source.add("contacto");
            customer.name = normalizeText(row.name) || customer.name;
            customer.phone = normalizePhone(row.phone) || customer.phone;
            customer.email = normalizeEmail(row.email) || customer.email;
            customer.city = mergeString(customer.city, row.lastCity);
            customer.lastAddress = mergeString(customer.lastAddress, row.lastAddress);
            touchDates(customer, row.createdAt);
            touchDates(customer, row.updatedAt);
        }

        for (const chat of chats) {
            const customer = getOrCreateContact(map, {
                phone: chat.phoneNumber,
                email: chat.customerEmail,
                sessionId: chat.id
            });
            customer.source.add("chat");
            customer.name = normalizeText(chat.customerName) || customer.name;
            customer.phone = normalizePhone(chat.phoneNumber) || customer.phone;
            customer.email = normalizeEmail(chat.customerEmail) || customer.email;
            customer.city = mergeString(customer.city, chat.customerCity);
            customer.lastAddress = mergeString(customer.lastAddress, chat.customerAddress);
            touchDates(customer, chat.createdAt);
            touchDates(customer, chat.updatedAt);
            customer.chats.push({
                id: chat.id,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                isActive: chat.isActive,
                messageCount: chat.messages.length,
                lastMessage: chat.messages.at(-1)?.content || null,
                messages: chat.messages.map((message) => ({
                    id: message.id,
                    role: message.role,
                    content: message.content,
                    createdAt: message.createdAt
                }))
            });
        }

        for (const order of orders) {
            const customer = getOrCreateContact(map, {
                phone: order.customerPhone,
                email: order.customerEmail
            });
            customer.source.add("compra");
            customer.name = normalizeText(order.customerName) || customer.name;
            customer.phone = normalizePhone(order.customerPhone) || customer.phone;
            customer.email = normalizeEmail(order.customerEmail) || customer.email;
            customer.city = mergeString(customer.city, order.customerCity);
            customer.lastAddress = mergeString(customer.lastAddress, order.customerAddress);
            touchDates(customer, order.createdAt);
            if (!customer.lastPurchaseAt || order.createdAt > customer.lastPurchaseAt) {
                customer.lastPurchaseAt = order.createdAt;
            }
            customer.totalOrders += 1;
            customer.totalSpent += Number(order.total || 0);
            customer.weekdayMap.set(weekdayLabel(order.createdAt), (customer.weekdayMap.get(weekdayLabel(order.createdAt)) || 0) + 1);

            const items = parseItems(order.items);
            customer.orders.push({
                id: order.id,
                createdAt: order.createdAt,
                status: order.status,
                subtotal: order.subtotal,
                shipping: order.shipping,
                total: order.total,
                customerAddress: order.customerAddress,
                customerCity: order.customerCity,
                items
            });

            for (const item of items) {
                const name = normalizeText(item?.name);
                if (!name) continue;
                const key = name.toLowerCase();
                const quantity = Number(item?.quantity || 0);
                const price = Number(item?.price || 0);
                const current = customer.productMap.get(key) || {
                    name,
                    quantity: 0,
                    times: 0,
                    revenue: 0,
                    lastOrderedAt: order.createdAt.toISOString()
                };
                current.quantity += Number.isFinite(quantity) ? quantity : 0;
                current.times += 1;
                current.revenue += (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(price) ? price : 0);
                if (new Date(current.lastOrderedAt) < order.createdAt) {
                    current.lastOrderedAt = order.createdAt.toISOString();
                }
                customer.productMap.set(key, current);
            }
        }

        const result = Array.from(map.values())
            .map((customer) => {
                const favoriteProducts = Array.from(customer.productMap.values())
                    .sort((a, b) => b.times - a.times || b.quantity - a.quantity || b.revenue - a.revenue)
                    .slice(0, 8);
                const preferredDay = Array.from(customer.weekdayMap.entries())
                    .sort((a, b) => b[1] - a[1])[0]?.[0] || null;

                return {
                    id: customer.id,
                    name: customer.name,
                    phone: customer.phone,
                    email: customer.email,
                    city: customer.city,
                    lastAddress: customer.lastAddress,
                    sources: Array.from(customer.source),
                    firstContactAt: customer.firstContactAt?.toISOString() || null,
                    lastContactAt: customer.lastContactAt?.toISOString() || null,
                    lastPurchaseAt: customer.lastPurchaseAt?.toISOString() || null,
                    totalOrders: customer.totalOrders,
                    totalSpent: customer.totalSpent,
                    averageOrder: customer.totalOrders > 0 ? Math.round(customer.totalSpent / customer.totalOrders) : 0,
                    chatCount: customer.chats.length,
                    messageCount: customer.chats.reduce((sum, chat) => sum + chat.messageCount, 0),
                    favoriteProducts,
                    preferences: {
                        preferredDay,
                        usualCity: customer.city,
                        lastAddress: customer.lastAddress
                    },
                    orders: customer.orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
                    chats: customer.chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                };
            })
            .sort((a, b) => {
                const bDate = new Date(b.lastContactAt || b.lastPurchaseAt || 0).getTime();
                const aDate = new Date(a.lastContactAt || a.lastPurchaseAt || 0).getTime();
                return bDate - aDate;
            });

        return NextResponse.json({
            summary: {
                totalCustomers: result.length,
                contacted: result.filter((customer) => customer.sources.includes("contacto") || customer.sources.includes("chat")).length,
                chatted: result.filter((customer) => customer.chatCount > 0).length,
                buyers: result.filter((customer) => customer.totalOrders > 0).length,
                totalRevenue: result.reduce((sum, customer) => sum + customer.totalSpent, 0)
            },
            customers: result
        });
    } catch (error) {
        console.error("Admin customers error:", error);
        return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
    }
}
