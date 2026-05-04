import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isProtectedAdminPath(pathname: string) {
    if (pathname.startsWith("/admin") && pathname !== "/admin/login") return true;
    if (pathname.startsWith("/api/admin")) return true;
    return false;
}

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (!isProtectedAdminPath(pathname)) {
        return NextResponse.next();
    }

    const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET
    });

    if (token) {
        return NextResponse.next();
    }

    if (pathname.startsWith("/api/admin")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/admin/:path*", "/api/admin/:path*"]
};
