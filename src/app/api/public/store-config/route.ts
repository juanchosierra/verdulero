import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildDeliverySchedule, DEFAULT_CUTOFF, DEFAULT_DELIVERY_WINDOW } from "@/lib/delivery";
import { buildCoverageLabel, freeShippingThreshold, getActiveCityRules, minimumOrderThreshold } from "@/lib/store-rules";

export async function GET() {
    try {
        const config = await prisma.storeConfig.findFirst();
        const horaCorte = config?.horaCorte || DEFAULT_CUTOFF;
        const deliveryWindow = config?.deliveryWindow || DEFAULT_DELIVERY_WINDOW;
        const schedule = buildDeliverySchedule(horaCorte, new Date(), deliveryWindow);

        return NextResponse.json({
            nombreTienda: config?.nombreTienda || "El Verdulero",
            siteUrl: config?.siteUrl || config?.wcUrl || "https://elverdulero.com.co",
            logoUrl: config?.logoUrl || "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
            supportWhatsapp: config?.supportWhatsapp || "573176778089",
            horaCorte,
            pedidoMinimo: minimumOrderThreshold(config),
            envioGratisDesde: freeShippingThreshold(config),
            ciudades: getActiveCityRules(config?.ciudadesOperacion),
            cobertura: buildCoverageLabel(config?.ciudadesOperacion),
            deliveryWindow,
            mensajeBienvenida: config?.mensajeBienvenida || "¡Qué tal, veci! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué te vamos a poner en la canasta hoy?",
            delivery: schedule
        });
    } catch {
        const schedule = buildDeliverySchedule(DEFAULT_CUTOFF, new Date(), DEFAULT_DELIVERY_WINDOW);
        return NextResponse.json({
            nombreTienda: "El Verdulero",
            siteUrl: "https://elverdulero.com.co",
            logoUrl: "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png",
            supportWhatsapp: "573176778089",
            horaCorte: DEFAULT_CUTOFF,
            pedidoMinimo: minimumOrderThreshold(undefined),
            envioGratisDesde: freeShippingThreshold(undefined),
            ciudades: getActiveCityRules(undefined),
            cobertura: buildCoverageLabel(undefined),
            deliveryWindow: DEFAULT_DELIVERY_WINDOW,
            mensajeBienvenida: "¡Qué tal, veci! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué te vamos a poner en la canasta hoy?",
            delivery: schedule
        });
    }
}
