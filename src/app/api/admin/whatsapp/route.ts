import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { parseCityRules, calculateShippingAmount } from "@/lib/store-rules";
import { DEFAULT_QUICK_REPLIES, parseQuickReplies, serializeQuickReplies } from "@/lib/quick-replies";

export async function GET(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const config = await prisma.storeConfig.findFirst();
    return NextResponse.json({
      quickReplies: parseQuickReplies(config?.respuestasRapidas),
      cities: parseCityRules(config?.ciudadesOperacion),
      supportWhatsapp: config?.supportWhatsapp || "573176778089",
      envioGratisDesde: Number(config?.envioGratisDesde || 69900)
    });
  } catch {
    return NextResponse.json(
      {
        quickReplies: DEFAULT_QUICK_REPLIES,
        cities: [],
        supportWhatsapp: "573176778089"
      },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const quickReplies = parseQuickReplies(body?.quickReplies);

    const config = await prisma.storeConfig.upsert({
      where: { id: 1 },
      update: {
        respuestasRapidas: serializeQuickReplies(quickReplies)
      },
      create: {
        id: 1,
        respuestasRapidas: serializeQuickReplies(quickReplies)
      }
    });

    return NextResponse.json({
      ok: true,
      quickReplies: parseQuickReplies(config.respuestasRapidas)
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "No se pudieron guardar las respuestas rápidas" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const customerName = String(body?.customerName || "").trim();
    const customerPhone = String(body?.customerPhone || "").trim();
    const customerAddress = String(body?.customerAddress || "").trim();
    const customerCity = String(body?.customerCity || "").trim();
    const customerEmail = String(body?.customerEmail || "").trim() || null;
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!customerName || !customerPhone || !customerAddress || !customerCity || items.length === 0) {
      return NextResponse.json({ error: "Faltan datos del cliente o del carrito" }, { status: 400 });
    }

    const normalizedItems = items
      .map((item: any) => ({
        product_id: Number(item.product_id || item.id || 0),
        name: String(item.name || "").trim(),
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || "und").trim() || "und",
        price: Number(item.price || 0),
        image: typeof item.image === "string" ? item.image : undefined
      }))
      .filter((item: any) => item.product_id && item.name && item.quantity > 0 && item.price >= 0);

    if (normalizedItems.length === 0) {
      return NextResponse.json({ error: "El carrito no tiene productos válidos" }, { status: 400 });
    }

    const config = await prisma.storeConfig.findFirst();
    const subtotal = normalizedItems.reduce((acc: number, item: any) => acc + item.quantity * item.price, 0);
    const shipping = calculateShippingAmount(subtotal, customerCity, config || undefined);
    const total = subtotal + shipping;

    const order = await prisma.order.create({
      data: {
        customerName,
        customerPhone,
        customerAddress,
        customerCity,
        customerEmail,
        items: JSON.stringify(normalizedItems),
        subtotal,
        shipping,
        total,
        status: "Pendiente"
      }
    });

    if (customerPhone) {
      await prisma.customer.upsert({
        where: { phone: customerPhone },
        update: {
          name: customerName,
          email: customerEmail,
          lastAddress: customerAddress,
          lastCity: customerCity
        },
        create: {
          phone: customerPhone,
          name: customerName,
          email: customerEmail,
          lastAddress: customerAddress,
          lastCity: customerCity
        }
      });
    }

    return NextResponse.json({
      ok: true,
      order: {
        id: order.id,
        subtotal,
        shipping,
        total
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "No se pudo crear el pedido manual" }, { status: 500 });
  }
}
