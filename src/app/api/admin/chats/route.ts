import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
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
    } catch (error) {
        console.error("Chats Fetch Error:", error);
        return NextResponse.json({ error: "Failed to fetch chats" }, { status: 500 });
    }
}

export async function PATCH(req: Request) {
    try {
        const { id, isActive } = await req.json();
        const chat = await prisma.chatSession.update({
            where: { id },
            data: { isActive, updatedAt: new Date() }
        });
        return NextResponse.json(chat);
    } catch (error) {
        return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
    }
}

export async function POST(req: Request) {
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
    } catch (error) {
        console.error("Operator Message Error:", error);
        return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }
}
