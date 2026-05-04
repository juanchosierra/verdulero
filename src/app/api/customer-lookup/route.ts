import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

function normalizeEmail(raw: string | null) {
    return String(raw || "").trim().toLowerCase();
}

function firstNameOf(name: string | null | undefined) {
    return String(name || "").trim().split(/\s+/)[0] || null;
}

export async function GET(request: Request) {
    try {
        const rate = checkRateLimit(request, "customer-lookup", 12, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: "Demasiadas consultas seguidas. Intenta otra vez en un momento." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
        }

        const { searchParams } = new URL(request.url);
        const email = normalizeEmail(searchParams.get("email"));

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return NextResponse.json({ found: false });
        }

        const customer = await prisma.customer.findFirst({
            where: {
                email: {
                    equals: email,
                    mode: "insensitive"
                }
            }
        });

        if (customer) {
            return NextResponse.json({
                found: true,
                customer: {
                    firstName: firstNameOf(customer.name)
                }
            });
        }

        const recentSession = await prisma.chatSession.findFirst({
            where: {
                customerEmail: {
                    equals: email,
                    mode: "insensitive"
                }
            },
            orderBy: {
                updatedAt: "desc"
            },
            select: {
                customerName: true
            }
        });

        if (!recentSession?.customerName) {
            return NextResponse.json({ found: false });
        }

        return NextResponse.json({
            found: true,
            customer: {
                firstName: firstNameOf(recentSession.customerName)
            }
        });
    } catch (error) {
        console.error("Customer lookup error:", error);
        return NextResponse.json({ error: "No pude consultar ese cliente ahora mismo." }, { status: 500 });
    }
}
