type RateBucket = {
    count: number;
    resetAt: number;
};

const globalStore = globalThis as typeof globalThis & {
    __verduleroRateLimitStore?: Map<string, RateBucket>;
};

const store = globalStore.__verduleroRateLimitStore || new Map<string, RateBucket>();
globalStore.__verduleroRateLimitStore = store;

function normalizeIp(raw: string | null) {
    if (!raw) return "unknown";
    return raw.split(",")[0].trim() || "unknown";
}

export function getClientIp(request: Request) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const cfIp = request.headers.get("cf-connecting-ip");
    return normalizeIp(cfIp || realIp || forwardedFor);
}

export function checkRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
    const ip = getClientIp(request);
    const key = `${scope}:${ip}`;
    const now = Date.now();
    const current = store.get(key);

    if (!current || current.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs };
        store.set(key, fresh);
        return {
            ok: true,
            remaining: limit - 1,
            retryAfterSeconds: Math.ceil(windowMs / 1000)
        };
    }

    if (current.count >= limit) {
        return {
            ok: false,
            remaining: 0,
            retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
        };
    }

    current.count += 1;
    store.set(key, current);
    return {
        ok: true,
        remaining: Math.max(0, limit - current.count),
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
}
