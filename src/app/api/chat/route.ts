import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { wcApi } from "@/lib/woocommerce";
import { jsPDF } from "jspdf";
import nodemailer from "nodemailer";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_SYSTEM_PROMPT = `ROL: Eres "El Verdulero", el asistente experto y carismático de una tienda de frutas y verduras frescas en línea. Tu objetivo es tomar pedidos de forma eficiente, amable y sin errores. Hablas con la calidez de un tendero de confianza: cercano, servicial, conocedor de la calidad del campo, pero siempre profesional.

CONTEXTO OPERATIVO:
Tienes acceso a productos de WooCommerce. No inventas productos; si no está en la base de datos, no existe.

1. PERSONALIDAD Y TONO
Saludo: Siempre saluda con entusiasmo. Ej: "¡Qué tal, marchante! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué le vamos a poner a la canasta hoy?"
Lenguaje: Usa términos como "fresquito", "de cosecha", "la mejor calidad", "marchante", "pedido".
Eficiencia: No des rodeos innecesarios. Si el cliente pide algo, búscalo y confirma.

2. PROTOCOLO DE TOMA DE PEDIDO (FLUJO OBLIGATORIO)
FASE A: Identificación de Producto
- El cliente dice: "Quiero piña".
- ACCIÓN: Llama a get_products buscando "piña".
- RESPUESTA:
  - Si hay: "¡Claro que sí! Tengo [nombre] a $[precio] la unidad/kg. ¿Cuántos le empaco?"
  - Si no hay: "Ay, me va a perdonar, pero hoy no nos llegó piña de la buena. ¿Le provoca llevar mango o papaya que están dulcesitos?"

FASE B: Cuantificación y Carrito
- El cliente dice la cantidad (ej: "4").
- ACCIÓN: Suma al carrito interno.
- RESPUESTA: "Listo, anotadas las 4. ¿Qué más le hace falta? ¿Cebollita, tomate, alguna fruta para el jugo?"

FASE C: Cierre y Datos de Envío
- Cuando el cliente diga "Nada más" o "Ya terminamos":
- Validación de Horarios: Si la hora actual es después de la configurada (ej: 14:00), informa que llega mañana.
- Recolección de Datos (Pide uno por uno): Nombre completo, Ciudad y Dirección exacta, Teléfono de contacto.

3. REGLAS DE CÁLCULO Y PAGO
Totalización: Presenta resumen claro con TOTAL A PAGAR.
Método de Pago: Contra entrega (efectivo o transferencia).

4. GENERACIÓN DE PEDIDO Y TIRILLA
Una vez confirmado:
- ACCIÓN: Llama a create_order.
- DESPEDIDA: "¡Listo, marchante! Pedido confirmado. Ya mismo le mando su tirilla al correo. ¡Muchas gracias!"`;

const TOOLS: Anthropic.Tool[] = [
    {
        name: "get_products",
        description: "Busca productos en el inventario de WooCommerce por nombre. Úsala SIEMPRE que el cliente mencione un producto.",
        input_schema: {
            type: "object",
            properties: {
                search_term: {
                    type: "string",
                    description: "Nombre del producto a buscar (ej: 'piña', 'tomate', 'mango')"
                }
            },
            required: ["search_term"]
        }
    },
    {
        name: "create_order",
        description: "Registra el pedido final en la base de datos y envía la tirilla por correo. Úsala SOLO cuando el cliente haya confirmado todos sus datos.",
        input_schema: {
            type: "object",
            properties: {
                customer_data: {
                    type: "object",
                    properties: {
                        nombre: { type: "string" },
                        direccion: { type: "string" },
                        ciudad: { type: "string" },
                        telefono: { type: "string" }
                    },
                    required: ["nombre", "direccion", "ciudad", "telefono"]
                },
                items: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            product_id: { type: "integer" },
                            name: { type: "string" },
                            quantity: { type: "integer" },
                            price: { type: "number" }
                        },
                        required: ["name", "quantity", "price"]
                    }
                },
                total: { type: "number" }
            },
            required: ["customer_data", "items", "total"]
        }
    }
];

async function executeGetProducts(searchTerm: string) {
    try {
        const response = await wcApi.get("products", {
            search: searchTerm,
            status: "publish",
            per_page: 10
        });
        const products = response.data.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: parseFloat(p.price),
            stock_status: p.stock_status
        }));
        return products.length > 0 ? products : { message: "No se encontraron productos con ese nombre" };
    } catch (error) {
        console.error("WooCommerce error:", error);
        return { error: "No se pudo consultar el inventario" };
    }
}

async function executeCreateOrder(customerData: any, items: any[], total: number) {
    const order = await prisma.order.create({
        data: {
            customerName: customerData.nombre,
            customerPhone: customerData.telefono,
            customerAddress: customerData.direccion,
            customerCity: customerData.ciudad,
            items: JSON.stringify(items),
            total,
            status: "Pendiente"
        }
    });

    // Generate PDF tirilla
    const doc = new jsPDF({ unit: "mm", format: [80, 200] });
    doc.setFontSize(12);
    doc.text("EL VERDULERO", 40, 10, { align: "center" });
    doc.setFontSize(8);
    doc.text("Frescura en su puerta", 40, 15, { align: "center" });
    doc.text("--------------------------------", 40, 20, { align: "center" });
    doc.text(`PEDIDO: #${order.id}`, 10, 25);
    doc.text(`FECHA: ${new Date().toLocaleString()}`, 10, 30);
    doc.text("--------------------------------", 40, 35, { align: "center" });
    doc.text(`CLIENTE: ${customerData.nombre}`, 10, 40);
    doc.text(`TEL: ${customerData.telefono}`, 10, 45);
    doc.text(`DIR: ${customerData.direccion}, ${customerData.ciudad}`, 10, 50, { maxWidth: 60 });
    doc.text("--------------------------------", 40, 60, { align: "center" });
    doc.text("CANT  PRODUCTO         SUBT", 10, 65);

    let y = 70;
    items.forEach((item: any) => {
        doc.text(`${item.quantity}  ${item.name}`, 10, y, { maxWidth: 45 });
        doc.text(`$${item.price * item.quantity}`, 65, y);
        y += 5;
    });

    doc.text("--------------------------------", 40, y + 5, { align: "center" });
    doc.text(`TOTAL A PAGAR: $${total}`, 10, y + 10);
    doc.text("PAGO: CONTRA ENTREGA", 10, y + 15);
    doc.text("--------------------------------", 40, y + 20, { align: "center" });
    doc.text("¡Gracias por preferirnos!", 40, y + 25, { align: "center" });

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));

    try {
        const config = await prisma.storeConfig.findFirst();
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT),
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
        });
        await transporter.sendMail({
            from: `"El Verdulero" <${process.env.EMAIL_USER}>`,
            to: config?.emailAdmin || "ventas@elverdulero.com.co",
            cc: config?.emailsCopia || "",
            subject: `🍎 NUEVO PEDIDO #${order.id} - ${customerData.nombre} - $${total}`,
            text: `Nuevo pedido de ${customerData.nombre}. Adjunto tirilla.`,
            attachments: [{ filename: `pedido-${order.id}.pdf`, content: pdfBuffer }]
        });
    } catch (emailError) {
        console.error("Email error (pedido guardado):", emailError);
    }

    return { success: true, orderId: order.id };
}

export async function POST(req: Request) {
    try {
        const { messages, sessionId: providedSessionId, customerName } = await req.json();

        // 1. Config & Manual Intervention check
        const config = await prisma.storeConfig.findFirst() as any;
        if (config?.intervencionManual) {
            return NextResponse.json({
                content: "Ay, marchante, en este momento estoy atendiendo a unos clientes aquí en el puesto. Un compañero humano le va a responder en un momentico, ¡téngame paciencia!",
                role: "assistant",
                isPaused: true
            });
        }

        // 2. Ensure session exists
        const sessionId = providedSessionId;
        if (sessionId) {
            await prisma.chatSession.upsert({
                where: { id: sessionId },
                update: { updatedAt: new Date(), customerName: customerName || undefined },
                create: { id: sessionId, customerName: customerName || "Cliente Web", isActive: true }
            });
        }

        // 3. Save user message
        const lastUserMessage = messages[messages.length - 1];
        if (sessionId && lastUserMessage.role === "user") {
            await prisma.message.create({
                data: { sessionId, role: "user", content: lastUserMessage.content }
            });
        }

        // 4. Build Anthropic messages (simple text history)
        const anthropicMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content as string
        }));

        const systemPrompt = config?.personalidad || DEFAULT_SYSTEM_PROMPT;

        // 5. Agentic tool-use loop
        let responseText = "";
        while (true) {
            const response = await client.messages.create({
                model: "claude-opus-4-6",
                max_tokens: 4096,
                system: systemPrompt,
                tools: TOOLS,
                messages: anthropicMessages
            });

            // Extract any text from this response
            const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
            if (textBlock) responseText = textBlock.text;

            if (response.stop_reason === "end_turn") {
                break;
            }

            if (response.stop_reason === "tool_use") {
                // Add Claude's response (including tool_use blocks) to messages
                anthropicMessages.push({ role: "assistant", content: response.content });

                // Execute all tool calls and collect results
                const toolResults: Anthropic.ToolResultBlockParam[] = [];
                for (const block of response.content) {
                    if (block.type !== "tool_use") continue;

                    let result: any;
                    if (block.name === "get_products") {
                        result = await executeGetProducts((block.input as any).search_term);
                    } else if (block.name === "create_order") {
                        const input = block.input as any;
                        result = await executeCreateOrder(input.customer_data, input.items, input.total);
                    } else {
                        result = { error: "Función desconocida" };
                    }

                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: block.id,
                        content: JSON.stringify(result)
                    });
                }

                anthropicMessages.push({ role: "user", content: toolResults });
            } else {
                // pause_turn or unexpected — break to avoid infinite loop
                break;
            }
        }

        // 6. Save assistant response
        if (sessionId && responseText) {
            await prisma.message.create({
                data: { sessionId, role: "assistant", content: responseText }
            });
        }

        return NextResponse.json({ content: responseText, role: "assistant" });

    } catch (error) {
        console.error("Chat error:", error);
        return NextResponse.json({ error: "Ocurrió un error en el chat" }, { status: 500 });
    }
}
