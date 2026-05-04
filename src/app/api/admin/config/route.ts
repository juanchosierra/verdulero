import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { parseCityRules, serializeCityRules } from "@/lib/store-rules";

export async function GET(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const config = await prisma.storeConfig.findFirst();
        if (!config) return NextResponse.json({});
        const effectiveWcUrl = config.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co";

        // Mask sensitive fields
        const maskedConfig = {
            ...config,
            wcUrl: effectiveWcUrl,
            ciudadesOperacion: parseCityRules(config.ciudadesOperacion),
            wcConsumerKey: config.wcConsumerKey ? `${config.wcConsumerKey.slice(0, 4)}...${config.wcConsumerKey.slice(-4)}` : null,
            wcConsumerSecret: config.wcConsumerSecret ? `********` : null,
            geminiApiKey: config.geminiApiKey ? `${config.geminiApiKey.slice(0, 4)}...${config.geminiApiKey.slice(-4)}` : null,
        };

        return NextResponse.json(maskedConfig);
    } catch {
        return NextResponse.json({ error: "Failed to fetch config" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authError = await requireAdmin(req);
    if (authError) return authError;

    try {
        const body = await req.json();

        // Filter valid fields
        const validFields = [
            "wcUrl", "wcConsumerKey", "wcConsumerSecret", "geminiApiKey",
            "nombreTienda", "siteUrl", "logoUrl", "supportWhatsapp", "deliveryWindow",
            "personalidad", "mensajeBienvenida", "horaCorte", "emailAdmin",
            "emailsCopia", "intervencionManual", "perfilConversacional",
            "reportesVentasActivos", "reportesVentasHora", "reportesVentasEmails",
            "pedidoMinimo", "envioGratisDesde", "ciudadesOperacion"
        ];

        const data: any = {};
        validFields.forEach(field => {
            const val = body[field];
            if (val !== undefined) {
                // If it looks masked (contains '...' or '****'), do NOT save it to DB
                // This allows the FE to send back the truncated values without corrupting the DB
                const isMaskedVal = (field === 'wcConsumerKey' || field === 'wcConsumerSecret' || field === 'geminiApiKey') 
                    && (String(val).includes('...') || String(val).includes('***'));

                if (!isMaskedVal) {
                    data[field] = field === "ciudadesOperacion" ? serializeCityRules(val) : val;
                }
            }
        });

        // We use ID 1 as the single record for configuration
        const config = await prisma.storeConfig.upsert({
            where: { id: 1 },
            update: data,
            create: {
                id: 1,
                ...data,
                // Ensure other non-null fields have values if 'data' is incomplete
                nombreTienda: data.nombreTienda || "El Verdulero",
                siteUrl: data.siteUrl || "https://elverdulero.com.co",
                logoUrl: data.logoUrl || "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
                supportWhatsapp: data.supportWhatsapp || "573176778089",
                wcUrl: data.wcUrl || process.env.NEXT_PUBLIC_WC_URL || "https://elverdulero.com.co",
                horaCorte: data.horaCorte || "14:00",
                deliveryWindow: data.deliveryWindow || "10:00 AM a 5:00 PM",
                emailAdmin: data.emailAdmin || "ventas@elverdulero.com.co",
                pedidoMinimo: Number.isFinite(Number(data.pedidoMinimo)) ? Number(data.pedidoMinimo) : 0,
                envioGratisDesde: Number.isFinite(Number(data.envioGratisDesde)) ? Number(data.envioGratisDesde) : 69900,
                ciudadesOperacion: data.ciudadesOperacion || serializeCityRules(undefined),
                reportesVentasHora: data.reportesVentasHora || "18:00",
                reportesVentasEmails: data.reportesVentasEmails || "",
                mensajeBienvenida: data.mensajeBienvenida || "¡Bienvenido a El Verdulero!",
                personalidad: data.personalidad || "Eres El Verdulero..."
            }
        });

        return NextResponse.json(config);
    } catch (error: any) {
        console.error("Config Update Error:", { code: error?.code });
        return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
    }
}
