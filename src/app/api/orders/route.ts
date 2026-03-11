import { jsPDF } from 'jspdf';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { customer_data, items, total } = await req.json();

        // 1. Save to database
        const order = await prisma.order.create({
            data: {
                customerName: customer_data.nombre,
                customerPhone: customer_data.telefono,
                customerAddress: customer_data.direccion,
                customerCity: customer_data.ciudad,
                items: JSON.stringify(items),
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
        doc.text(`FECHA: ${new Date().toLocaleString()}`, 10, 30);
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
        const config = await prisma.storeConfig.findFirst();
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: Number(process.env.EMAIL_PORT),
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const mailOptions = {
            from: `"El Verdulero" <${process.env.EMAIL_USER}>`,
            to: config?.emailAdmin || "ventas@elverdulero.com.co",
            cc: config?.emailsCopia || "",
            subject: `🍎 NUEVO PEDIDO - ${customer_data.nombre} - $${total}`,
            text: `Se ha recibido un nuevo pedido de ${customer_data.nombre}. Adjunto encontrarás la tirilla POS.`,
            attachments: [{
                filename: `pedido-${order.id}.pdf`,
                content: pdfBuffer
            }]
        };

        await transporter.sendMail(mailOptions);

        return NextResponse.json({ success: true, orderId: order.id });
    } catch (error) {
        console.error('Order creation error:', error);
        return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }
}
