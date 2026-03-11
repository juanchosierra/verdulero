-- CreateTable
CREATE TABLE "StoreConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "horaCorte" TEXT NOT NULL DEFAULT '14:00',
    "emailAdmin" TEXT NOT NULL DEFAULT 'ventas@elverdulero.com.co',
    "emailsCopia" TEXT NOT NULL DEFAULT '',
    "diasFestivos" TEXT NOT NULL DEFAULT '[]',
    "mensajeBienvenida" TEXT NOT NULL DEFAULT '¡Qué tal, marchante! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué le vamos a poner a la canasta hoy?'
);

-- CreateTable
CREATE TABLE "Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerAddress" TEXT NOT NULL,
    "customerCity" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "total" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pendiente',
    "pdfUrl" TEXT
);

-- CreateTable
CREATE TABLE "Customer" (
    "phone" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "lastAddress" TEXT,
    "lastCity" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
