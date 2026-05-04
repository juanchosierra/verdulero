import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const chats = await prisma.chatSession.findMany({
            include: {
                messages: {
                    orderBy: {
                        createdAt: 'asc'
                    }
                }
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });
        return NextResponse.json(chats);
    } catch {
        return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { id, isActive } = await req.json();
        const chat = await prisma.chatSession.update({
            where: { id },
            data: { isActive, updatedAt: new Date() }
        });
        return NextResponse.json(chat);
    } catch {
        return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const { sessionId, content } = await req.json();

        const message = await prisma.message.create({
            data: {
                sessionId,
                role: 'assistant',
                content
            }
        });

        await prisma.chatSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() }
        });

        return NextResponse.json(message);
    } catch {
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
