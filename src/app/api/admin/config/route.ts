import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
    try {
        const config = await prisma.storeConfig.findFirst();
        return NextResponse.json(config || {});
    } catch (error) {
        console.error("Config Fetch Error:", error);
        return NextResponse.json({ error: "Failed to fetch config" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        console.log("Config POST Body:", body);

        // Filter valid fields
        const validFields = [
            "wcUrl", "wcConsumerKey", "wcConsumerSecret", "geminiApiKey",
            "personalidad", "mensajeBienvenida", "horaCorte", "emailAdmin",
            "intervencionManual"
        ];

        const data: any = {};
        validFields.forEach(field => {
            if (body[field] !== undefined) {
                data[field] = body[field];
            }
        });

        console.log("Upserting StoreConfig with data:", data);

        // We use ID 1 as the single record for configuration
        const config = await prisma.storeConfig.upsert({
            where: { id: 1 },
            update: data,
            create: {
                id: 1,
                ...data,
                // Ensure other non-null fields have values if 'data' is incomplete
                horaCorte: data.horaCorte || "14:00",
                emailAdmin: data.emailAdmin || "ventas@elverdulero.com.co",
                mensajeBienvenida: data.mensajeBienvenida || "¡Bienvenido a El Verdulero!",
                personalidad: data.personalidad || "Eres El Verdulero..."
            }
        });

        console.log("Upsert Success:", config.id);
        return NextResponse.json(config);
    } catch (error: any) {
        console.error("Config Update Error Detailed:", {
            message: error.message,
            code: error.code,
            meta: error.meta,
            stack: error.stack
        });
        return NextResponse.json({
            error: "Failed to update config",
            details: error.message
        }, { status: 500 });
    }
}
