import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

function clampText(value: unknown, maxLength: number) {
    return String(value || "").trim().slice(0, maxLength);
}

export async function POST(req: Request) {
    try {
        const rate = checkRateLimit(req, "error-reports", 20, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: "Demasiados reportes seguidos. Intenta de nuevo en un momento." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
        }

        const body = await req.json();
        const {
            sessionId,
            messageIndex,
            messageRole,
            messageContent,
            reporterNote,
            previousMessage,
            nextMessage,
            conversationSlice,
            pageUrl
        } = body || {};

        const normalizedRole = clampText(messageRole, 20);
        const normalizedMessage = clampText(messageContent, 4000);
        const normalizedConversation = clampText(conversationSlice, 12000);
        const normalizedNote = clampText(reporterNote, 2000);
        const normalizedPrevious = clampText(previousMessage, 2000);
        const normalizedNext = clampText(nextMessage, 2000);
        const normalizedUrl = clampText(pageUrl, 500);
        const normalizedSessionId = clampText(sessionId, 120);

        if (!normalizedSessionId || !normalizedRole || !normalizedMessage || !normalizedConversation) {
            return NextResponse.json({ error: "Datos incompletos para reportar el error." }, { status: 400 });
        }

        if (!["user", "assistant"].includes(normalizedRole)) {
            return NextResponse.json({ error: "Rol de mensaje inválido." }, { status: 400 });
        }

        const report = await prisma.errorReport.create({
            data: {
                sessionId: normalizedSessionId,
                messageIndex: typeof messageIndex === "number" ? messageIndex : null,
                messageRole: normalizedRole,
                messageContent: normalizedMessage,
                reporterNote: normalizedNote || null,
                previousMessage: normalizedPrevious || null,
                nextMessage: normalizedNext || null,
                conversationSlice: normalizedConversation,
                pageUrl: normalizedUrl || null
            }
        });

        return NextResponse.json({ ok: true, id: report.id });
    } catch (error) {
        console.error("Error report create error:", error);
        return NextResponse.json({ error: "No pude guardar el reporte ahora mismo." }, { status: 500 });
    }
}
