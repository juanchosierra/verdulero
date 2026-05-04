export const DELIVERY_TIMEZONE = "America/Bogota";
export const DEFAULT_CUTOFF = "14:00";
export const DEFAULT_DELIVERY_WINDOW = "10:00 AM a 5:00 PM";

type BogotaParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
};

export type DeliverySchedule = {
    cutoff: string;
    isOpen: boolean;
    fullDateLabel: string;
    dateLabel: string;
    fullWindowLabel: string;
    window: string;
    note: string;
    countdownLabel: string;
    statusLabel: string;
    minutesUntilCutoff: number;
};

function safeNumber(value: string | undefined, fallback = 0) {
    const parsed = Number(value || "");
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCutoff(raw?: string | null) {
    const match = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match?.[1] || !match?.[2]) return DEFAULT_CUTOFF;
    const hours = Math.min(Math.max(safeNumber(match[1]), 0), 23);
    const minutes = Math.min(Math.max(safeNumber(match[2]), 0), 59);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function getBogotaNowParts(now = new Date()): BogotaParts {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: DELIVERY_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(now);

    const read = (type: string) => safeNumber(parts.find((p) => p.type === type)?.value);
    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour: read("hour"),
        minute: read("minute")
    };
}

function normalizeDeliveryWindow(raw?: string | null) {
    const value = String(raw || "").trim();
    return value || DEFAULT_DELIVERY_WINDOW;
}

export function buildDeliverySchedule(cutoffRaw?: string | null, now = new Date(), deliveryWindowRaw?: string | null): DeliverySchedule {
    const cutoff = normalizeCutoff(cutoffRaw);
    const deliveryWindow = normalizeDeliveryWindow(deliveryWindowRaw);
    const [cutoffHour, cutoffMinute] = cutoff.split(":").map((part) => safeNumber(part));
    const bogota = getBogotaNowParts(now);
    const currentMinutes = (bogota.hour * 60) + bogota.minute;
    const cutoffMinutes = (cutoffHour * 60) + cutoffMinute;
    const isOpen = currentMinutes < cutoffMinutes;
    const minutesUntilCutoff = Math.max(cutoffMinutes - currentMinutes, 0);

    const target = new Date(Date.UTC(bogota.year, bogota.month - 1, bogota.day, 12, 0, 0));
    target.setUTCDate(target.getUTCDate() + (isOpen ? 1 : 2));

    const weekday = new Intl.DateTimeFormat("es-CO", {
        timeZone: DELIVERY_TIMEZONE,
        weekday: "long"
    }).format(target);
    const dateLabel = new Intl.DateTimeFormat("es-CO", {
        timeZone: DELIVERY_TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    }).format(target);
    const weekdayCap = weekday.charAt(0).toUpperCase() + weekday.slice(1);

    const hoursRemaining = Math.floor(minutesUntilCutoff / 60);
    const minsRemaining = minutesUntilCutoff % 60;
    const countdownLabel = isOpen
        ? `Pide en ${hoursRemaining}h ${String(minsRemaining).padStart(2, "0")}m para entrega de ${weekdayCap.toLowerCase()}.`
        : `El corte de hoy ya cerró. Lo nuevo llega ${weekdayCap.toLowerCase()}.`;

    const statusLabel = isOpen
        ? `Recibimos pedidos hoy hasta las ${cutoff}.`
        : `El corte de hoy fue a las ${cutoff}.`;

    return {
        cutoff,
        isOpen,
        fullDateLabel: `${weekdayCap} ${dateLabel}`,
        dateLabel,
        fullWindowLabel: `${weekdayCap} ${dateLabel} de ${deliveryWindow}`,
        window: deliveryWindow,
        note: `Fecha de entrega: ${weekdayCap} ${dateLabel} (${deliveryWindow}).`,
        countdownLabel,
        statusLabel,
        minutesUntilCutoff
    };
}
