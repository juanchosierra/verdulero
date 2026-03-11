import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST() {
    const existingUser = await prisma.user.findUnique({
        where: { email: "admin@elverdulero.com" }
    });

    if (!existingUser) {
        const hashedPassword = await bcrypt.hash("admin123", 10);
        await prisma.user.create({
            data: {
                email: "admin@elverdulero.com",
                password: hashedPassword,
                name: "Super Admin"
            }
        });
        return Response.json({ message: "Admin user created" });
    }
    return Response.json({ message: "Admin user already exists" });
}
