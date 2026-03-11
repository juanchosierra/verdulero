"use strict";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    await prisma.storeConfig.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            horaCorte: "14:00",
            emailAdmin: "ventas@elverdulero.com.co",
            mensajeBienvenida: "¡Qué tal, marchante! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué le vamos a poner a la canasta hoy?"
        },
    });
    console.log("Database seeded with default config");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
