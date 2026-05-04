const DEFAULT_LOGO_URL =
  "https://elverdulero.com.co/wp-content/uploads/2026/01/verdulerologo@4x-1400x389.png";

const DEFAULT_SUPPORT_WHATSAPP = "573176778089";
const DEFAULT_SITE_URL = "https://elverdulero.com.co";
const DEFAULT_STORE_NAME = "El Verdulero";

type EmailOrderItem = {
  name: string;
  quantity: number;
  unit: string;
  price: number;
  image?: string;
};

type EmailCustomerData = {
  nombre?: string;
  telefono?: string;
  correo?: string;
  direccion?: string;
  ciudad?: string;
};

type OrderEmailOptions = {
  orderId: number;
  customer: EmailCustomerData;
  items: EmailOrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  deliveryFullDate: string;
  deliveryWindow: string;
  supportWhatsapp?: string;
  supportWhatsappLabel?: string;
  siteUrl?: string;
  logoUrl?: string;
  storeName?: string;
  adminView?: boolean;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCop(value: number) {
  return `$${Math.round(value).toLocaleString("es-CO")}`;
}

function unitLabel(unit?: string) {
  const normalized = (unit || "").toLowerCase();
  if (normalized === "lb") return "lb";
  if (normalized === "kg") return "kg";
  if (normalized === "und") return "und";
  if (normalized === "bja") return "bja";
  if (normalized === "atado") return "atado";
  if (normalized === "lts") return "lts";
  if (normalized === "carton") return "cartón";
  if (normalized === "bidon") return "bidón";
  if (normalized === "canastilla") return "canastilla";
  return normalized || "und";
}

function whatsappHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function normalizeUrl(url?: string) {
  if (!url) return DEFAULT_SITE_URL;
  return url.replace(/\/+$/, "");
}

function companyBlock(siteUrl: string, storeName: string) {
  return `
    <div style="font-size:12px;line-height:1.6;color:#5f6c7b;">
      <div><strong>${escapeHtml(storeName)}</strong></div>
      <div>Pago contra entrega</div>
      <div>Bucaramanga, Floridablanca, Girón, Piedecuesta y Ruitoque</div>
      <div><a href="${siteUrl}" style="color:#15803d;text-decoration:none;">${siteUrl.replace(/^https?:\/\//, "")}</a></div>
    </div>
  `;
}

export function buildOrderEmailHtml(options: OrderEmailOptions) {
  const {
    orderId,
    customer,
    items,
    subtotal,
    shipping,
    total,
    deliveryFullDate,
    deliveryWindow,
    supportWhatsapp = DEFAULT_SUPPORT_WHATSAPP,
    supportWhatsappLabel = DEFAULT_SUPPORT_WHATSAPP,
    siteUrl,
    logoUrl = DEFAULT_LOGO_URL,
    storeName = DEFAULT_STORE_NAME,
    adminView = false
  } = options;

  const safeSiteUrl = normalizeUrl(siteUrl);
  const safeLogoUrl = escapeHtml(logoUrl || DEFAULT_LOGO_URL);
  const safeStoreName = storeName || DEFAULT_STORE_NAME;
  const customerName = escapeHtml(customer.nombre || "veci");
  const deliveryDate = escapeHtml(deliveryFullDate);
  const deliveryRange = escapeHtml(deliveryWindow);
  const shippingText = shipping === 0 ? "Gratis" : formatCop(shipping);
  const heading = adminView
    ? `Nuevo pedido #${orderId}`
    : `Tu pedido #${orderId} quedó confirmado`;
  const intro = adminView
    ? `Te compartimos la tirilla completa del pedido de <strong>${customerName}</strong>.`
    : `Hola <strong>${customerName}</strong>, ya recibimos tu pedido y te lo dejamos resumido aquí para que lo tengas a la mano.`;

  const rows = items
    .map((item) => {
      const itemSubtotal = item.quantity * item.price;
      const imageCell = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid #dcfce7;" />`
        : `<div style="width:64px;height:64px;border-radius:14px;background:#f0fdf4;border:1px solid #dcfce7;"></div>`;

      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            ${imageCell}
          </td>
          <td style="padding:14px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-size:16px;font-weight:800;color:#0f172a;">${escapeHtml(item.name)}</div>
            <div style="font-size:13px;color:#64748b;margin-top:4px;">
              ${escapeHtml(String(item.quantity))} ${escapeHtml(unitLabel(item.unit))} · ${formatCop(item.price)} c/u
            </div>
          </td>
          <td style="padding:14px 0;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:right;">
            <div style="font-size:16px;font-weight:800;color:#166534;">${formatCop(itemSubtotal)}</div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
  <!doctype html>
  <html lang="es">
    <body style="margin:0;padding:0;background:#f7f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;padding:24px 16px;">
        <div style="background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 18px 50px rgba(15,23,42,0.08);">
          <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#ffffff 0%,#f0fdf4 100%);border-bottom:1px solid #e5e7eb;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align:middle;">
                  <img src="${safeLogoUrl}" alt="${escapeHtml(safeStoreName)}" style="display:block;width:220px;max-width:100%;height:auto;" />
                </td>
                <td style="text-align:right;vertical-align:middle;">
                  <div style="display:inline-block;padding:10px 14px;border-radius:16px;background:#f0fdf4;border:1px solid #86efac;font-size:12px;font-weight:800;color:#166534;letter-spacing:0.08em;text-transform:uppercase;">
                    Pedido #${orderId}
                  </div>
                </td>
              </tr>
            </table>
            <h1 style="margin:22px 0 10px;font-size:34px;line-height:1.05;color:#0f172a;">${heading}</h1>
            <p style="margin:0;font-size:16px;line-height:1.7;color:#475569;">${intro}</p>
          </div>

          <div style="padding:24px 28px;">
            <div style="border:1px solid #86efac;background:#f0fdf4;border-radius:22px;padding:20px 22px;margin-bottom:24px;">
              <div style="font-size:12px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:#166534;margin-bottom:8px;">Entrega estimada</div>
              <div style="font-size:30px;line-height:1.15;font-weight:900;color:#166534;">${deliveryDate}</div>
              <div style="margin-top:6px;font-size:15px;color:#166534;">Horario de entrega: ${deliveryRange}</div>
              <div style="margin-top:10px;font-size:14px;color:#166534;">Pago contra entrega al recibir tu mercado.</div>
            </div>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;">
              <tr>
                <td style="padding:0 0 16px;font-size:13px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">Datos del pedido</td>
              </tr>
              <tr>
                <td style="padding:0 0 6px;font-size:15px;color:#0f172a;"><strong>Cliente:</strong> ${customerName}</td>
              </tr>
              <tr>
                <td style="padding:0 0 6px;font-size:15px;color:#0f172a;"><strong>Correo:</strong> ${escapeHtml(customer.correo || "No registrado")}</td>
              </tr>
              <tr>
                <td style="padding:0 0 6px;font-size:15px;color:#0f172a;"><strong>WhatsApp:</strong> ${escapeHtml(customer.telefono || "Pendiente")}</td>
              </tr>
              <tr>
                <td style="padding:0 0 6px;font-size:15px;color:#0f172a;"><strong>Dirección:</strong> ${escapeHtml(customer.direccion || "Pendiente")}</td>
              </tr>
              <tr>
                <td style="padding:0;font-size:15px;color:#0f172a;"><strong>Ciudad:</strong> ${escapeHtml(customer.ciudad || "Pendiente")}</td>
              </tr>
            </table>

            <div style="font-size:13px;font-weight:900;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin:0 0 14px;">Tu mercado</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              ${rows}
            </table>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;border-top:1px solid #e5e7eb;padding-top:18px;">
              <tr>
                <td style="padding:6px 0;font-size:15px;color:#475569;">Subtotal mercado</td>
                <td style="padding:6px 0;font-size:15px;color:#0f172a;text-align:right;font-weight:700;">${formatCop(subtotal)}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:15px;color:#475569;">Envío</td>
                <td style="padding:6px 0;font-size:15px;color:#0f172a;text-align:right;font-weight:700;">${shippingText}</td>
              </tr>
              <tr>
                <td style="padding:12px 0 0;font-size:18px;color:#0f172a;font-weight:900;">Total a pagar</td>
                <td style="padding:12px 0 0;font-size:24px;color:#166534;text-align:right;font-weight:900;">${formatCop(total)}</td>
              </tr>
            </table>

            <div style="margin-top:28px;padding:22px;border-radius:22px;background:#0f172a;color:#ffffff;">
              <div style="font-size:18px;font-weight:900;margin-bottom:8px;">¿Te quedó alguna duda del pedido?</div>
              <div style="font-size:14px;line-height:1.7;color:#cbd5e1;margin-bottom:18px;">
                Escríbenos y te ayudamos de una con cualquier ajuste o consulta.
              </div>
              <a href="${whatsappHref(supportWhatsapp)}" style="display:inline-block;padding:14px 20px;border-radius:16px;background:#22c55e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:900;">
                Hablar por WhatsApp
              </a>
              <div style="margin-top:12px;font-size:13px;color:#cbd5e1;">WhatsApp pedidos: ${escapeHtml(supportWhatsappLabel)}</div>
            </div>
          </div>

          <div style="padding:20px 28px;border-top:1px solid #e5e7eb;background:#ffffff;">
            ${companyBlock(safeSiteUrl, safeStoreName)}
          </div>
        </div>
      </div>
    </body>
  </html>`;
}

export function buildOrderEmailText(options: OrderEmailOptions) {
  const {
    orderId,
    customer,
    items,
    subtotal,
    shipping,
    total,
    deliveryFullDate,
    deliveryWindow,
    supportWhatsapp = DEFAULT_SUPPORT_WHATSAPP,
    siteUrl,
    storeName = DEFAULT_STORE_NAME
  } = options;

  const productLines = items
    .map((item) => `- ${item.quantity} ${unitLabel(item.unit)} de ${item.name} @ ${formatCop(item.price)} = ${formatCop(item.quantity * item.price)}`)
    .join("\n");

  return [
    `${storeName.toUpperCase()} — Pedido #${orderId}`,
    ``,
    `Cliente: ${customer.nombre || "veci"}`,
    `Correo: ${customer.correo || "No registrado"}`,
    `WhatsApp: ${customer.telefono || "Pendiente"}`,
    `Dirección: ${customer.direccion || "Pendiente"}`,
    `Ciudad: ${customer.ciudad || "Pendiente"}`,
    ``,
    `Entrega: ${deliveryFullDate} (${deliveryWindow})`,
    `Pago: Contra entrega`,
    ``,
    productLines,
    ``,
    `Subtotal mercado: ${formatCop(subtotal)}`,
    `Envío: ${shipping === 0 ? "Gratis" : formatCop(shipping)}`,
    `Total a pagar: ${formatCop(total)}`,
    ``,
    `Si necesitas ayuda con tu pedido, escríbenos por WhatsApp: ${supportWhatsapp}`,
    normalizeUrl(siteUrl)
  ].join("\n");
}
