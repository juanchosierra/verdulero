import { jsPDF } from 'jspdf';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildOrderEmailHtml, buildOrderEmailText, formatCop } from '@/lib/order-email';
import { buildDeliverySchedule } from '@/lib/delivery';
import { calculateShippingAmount, minimumOrderThreshold } from '@/lib/store-rules';

const MAX_ORDER_ITEM_QUANTITY = 500;
const MAX_ORDER_ITEM_SUBTOTAL = 5_000_000;

function areOrderItemsPlausible(items: any[]) {
    return items.every((item) => {
        const quantity = Number(item?.quantity || 0);
        const price = Number(item?.price || 0);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_ORDER_ITEM_QUANTITY) return false;
        if (!Number.isFinite(price) || price < 0) return false;
        if (quantity * price > MAX_ORDER_ITEM_SUBTOTAL) return false;
        return true;
    });
}

export async function POST(req: Request) {
    try {
        if (process.env.NODE_ENV === "production" && process.env.ENABLE_PUBLIC_ORDER_API !== "true") {
            return NextResponse.json({ error: "Public order endpoint disabled" }, { status: 403 });
        }

        const rate = checkRateLimit(req, "public-orders", 5, 60_000);
        if (!rate.ok) {
            return NextResponse.json(
                { error: "Demasiadas solicitudes de pedido. Intenta de nuevo en un momento." },
                { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
            );
        }

        const { customer_data, items } = await req.json();
        if (!customer_data?.nombre || !customer_data?.telefono || !customer_data?.direccion || !customer_data?.ciudad) {
            return NextResponse.json({ error: "Customer data incomplete" }, { status: 400 });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: "Order items required" }, { status: 400 });
        }
        if (!areOrderItemsPlausible(items)) {
            return NextResponse.json({ error: "Order items out of allowed range" }, { status: 400 });
        }
        const subtotal = items.reduce((acc: number, item: any) => acc + (Number(item.quantity || 0) * Number(item.price || 0)), 0);
        if (!Number.isFinite(subtotal) || subtotal <= 0) {
            return NextResponse.json({ error: "Invalid total" }, { status: 400 });
        }

        const config = await prisma.storeConfig.findFirst();
        const pedidoMinimo = minimumOrderThreshold(config);
        if (subtotal < pedidoMinimo) {
            return NextResponse.json(
                { error: `Pedido mínimo no alcanzado. Faltan $${pedidoMinimo - subtotal}.`, pedidoMinimo },
                { status: 400 }
            );
        }
        const shipping = calculateShippingAmount(subtotal, customer_data.ciudad, config);
        const total = subtotal + shipping;

        // 1. Save to database
        const order = await prisma.order.create({
            data: {
                customerName: customer_data.nombre,
                customerEmail: customer_data.correo || null,
                customerPhone: customer_data.telefono,
                customerAddress: customer_data.direccion,
                customerCity: customer_data.ciudad,
                items: JSON.stringify(items),
                subtotal,
                shipping,
                total: total,
                status: 'Pendiente'
            }
        });

        // 2. Generate PDF (Tirilla POS)
        const doc = new jsPDF({
            unit: 'mm',
            format: [80, 200]
        });

        doc.setFontSize(12);
        doc.text('EL VERDULERO', 40, 10, { align: 'center' });
        doc.setFontSize(8);
        doc.text('Frescura en su puerta', 40, 15, { align: 'center' });
        doc.text('--------------------------------', 40, 20, { align: 'center' });
        doc.text(`PEDIDO: #${order.id}`, 10, 25);
        doc.text(`FECHA: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, 10, 30);
        doc.text('--------------------------------', 40, 35, { align: 'center' });
        doc.text(`CLIENTE: ${customer_data.nombre}`, 10, 40);
        doc.text(`TEL: ${customer_data.telefono}`, 10, 45);
        doc.text(`DIR: ${customer_data.direccion}, ${customer_data.ciudad}`, 10, 50, { maxWidth: 60 });
        doc.text('--------------------------------', 40, 60, { align: 'center' });
        doc.text('CANT  PRODUCTO         SUBT', 10, 65);

        let y = 70;
        items.forEach((item: any) => {
            doc.text(`${item.quantity}  ${item.name}`, 10, y, { maxWidth: 45 });
            doc.text(`$${item.price * item.quantity}`, 65, y);
            y += 5;
        });

        doc.text('--------------------------------', 40, y + 5, { align: 'center' });
        doc.text(`TOTAL A PAGAR: $${total}`, 10, y + 10);
        doc.text('PAGO: CONTRA ENTREGA 💵', 10, y + 15);
        doc.text('--------------------------------', 40, y + 20, { align: 'center' });
        doc.text('¡Gracias por preferirnos!', 40, y + 25, { align: 'center' });

        const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

        // 3. Send Email
        const deliverySchedule = buildDeliverySchedule(config?.horaCorte, new Date(), config?.deliveryWindow);
        const deliveryFullDate = deliverySchedule.fullDateLabel;
        const deliveryWindow = deliverySchedule.window;
        const siteUrl = config?.siteUrl || config?.wcUrl || process.env.NEXT_PUBLIC_WC_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://elverdulero.com.co';
        const supportWhatsapp = String(config?.supportWhatsapp || '573176778089').replace(/\D/g, '') || '573176778089';
        const storeName = config?.nombreTienda || 'El Verdulero';

        if (!process.env.EMAIL_HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('Email config missing: skipping order email send.');
            return NextResponse.json({ success: true, orderId: order.id, adminEmailSent: false, customerEmailSent: false });
        }

        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT),
            secure: Number(process.env.EMAIL_PORT) === 465,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const emailData = {
            orderId: order.id,
            customer: customer_data,
            items,
            subtotal,
            shipping,
            total,
            deliveryFullDate,
            deliveryWindow,
            supportWhatsapp,
            supportWhatsappLabel: supportWhatsapp,
            siteUrl,
            logoUrl: config?.logoUrl || undefined,
            storeName
        };

        const mailOptions = {
            from: `"${storeName}" <${process.env.EMAIL_USER}>`,
            to: config?.emailAdmin || "ventas@elverdulero.com.co",
            cc: config?.emailsCopia || "",
            subject: `🍎 NUEVO PEDIDO #${order.id} - ${customer_data.nombre} - ${formatCop(total)}`,
            text: buildOrderEmailText({ ...emailData, adminView: true }),
            html: buildOrderEmailHtml({ ...emailData, adminView: true }),
            attachments: [{
                filename: `pedido-${order.id}.pdf`,
                content: pdfBuffer
            }]
        };

        await transporter.sendMail(mailOptions);
        let customerEmailSent = false;

        if (customer_data?.correo) {
            await transporter.sendMail({
                from: `"${storeName}" <${process.env.EMAIL_USER}>`,
                to: customer_data.correo,
                subject: `✅ Confirmación de pedido #${order.id} - ${storeName}`,
                text: buildOrderEmailText(emailData),
                html: buildOrderEmailHtml(emailData),
                attachments: [{
                    filename: `pedido-${order.id}.pdf`,
                    content: pdfBuffer
                }]
            });
            customerEmailSent = true;
        }

        return NextResponse.json({ success: true, orderId: order.id, adminEmailSent: true, customerEmailSent });
    } catch (error) {
        console.error('Order creation error:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
