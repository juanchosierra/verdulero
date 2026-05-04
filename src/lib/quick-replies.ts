export type QuickReply = {
  id: string;
  title: string;
  text: string;
};

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    id: "saludo",
    title: "Saludo inicial",
    text: "¡Qué tal, veci! Ya te ayudo con tu pedido. Cuéntame qué te anoto y yo te lo voy armando."
  },
  {
    id: "confirmar-direccion",
    title: "Confirmar datos",
    text: "Perfecto. Para cerrarte el pedido, regálame nombre, dirección, ciudad, teléfono y correo."
  },
  {
    id: "pedido-en-camino",
    title: "Pedido en camino",
    text: "Tu pedido ya va en camino. Si necesitas algo adicional, te ayudamos por aquí mismo."
  },
  {
    id: "sin-producto",
    title: "No lo manejo",
    text: "Ese producto no lo estoy viendo en el catálogo en este momento. Si quieres, te propongo una alternativa parecida."
  },
  {
    id: "cierre",
    title: "Cierre amable",
    text: "Listo, veci. Ya te dejo eso armado. Cualquier duda con tu pedido, aquí quedamos pendientes."
  }
];

export function parseQuickReplies(raw?: string | QuickReply[] | null): QuickReply[] {
  const source = Array.isArray(raw)
    ? raw
    : (() => {
        try {
          const parsed = JSON.parse(String(raw || "[]"));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  const replies = source
    .map((item: any, index: number) => ({
      id: String(item?.id || `reply-${index + 1}`),
      title: String(item?.title || "").trim(),
      text: String(item?.text || "").trim()
    }))
    .filter((item) => item.title && item.text);

  return replies.length ? replies : DEFAULT_QUICK_REPLIES;
}

export function serializeQuickReplies(replies?: QuickReply[] | null) {
  return JSON.stringify(parseQuickReplies(replies || DEFAULT_QUICK_REPLIES));
}
