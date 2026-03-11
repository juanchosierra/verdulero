-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "image" TEXT
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerName" TEXT,
    "phoneNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoreConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "horaCorte" TEXT NOT NULL DEFAULT '14:00',
    "emailAdmin" TEXT NOT NULL DEFAULT 'ventas@elverdulero.com.co',
    "emailsCopia" TEXT NOT NULL DEFAULT '',
    "diasFestivos" TEXT NOT NULL DEFAULT '[]',
    "mensajeBienvenida" TEXT NOT NULL DEFAULT '¡Qué tal, marchante! Bienvenido a la plaza digital. Soy El Verdulero, ¿qué le vamos a poner a la canasta hoy?',
    "personalidad" TEXT NOT NULL DEFAULT 'Eres El Verdulero, un asistente carismático...',
    "wcUrl" TEXT,
    "wcConsumerKey" TEXT,
    "wcConsumerSecret" TEXT,
    "geminiApiKey" TEXT,
    "intervencionManual" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_StoreConfig" ("diasFestivos", "emailAdmin", "emailsCopia", "horaCorte", "id", "mensajeBienvenida") SELECT "diasFestivos", "emailAdmin", "emailsCopia", "horaCorte", "id", "mensajeBienvenida" FROM "StoreConfig";
DROP TABLE "StoreConfig";
ALTER TABLE "new_StoreConfig" RENAME TO "StoreConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
