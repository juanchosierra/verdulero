const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();

async function main() {
    const hashedPassword = await bcrypt.hash("verdulero2026", 10);

    const user = await prisma.user.upsert({
        where: { email: "admin@elverdulero.com.co" },
        update: {
            password: hashedPassword
        },
        create: {
            email: "admin@elverdulero.com.co",
            password: hashedPassword,
            name: "Super Admin"
        },
    });

    console.log("Admin user created/updated:", user.email);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
