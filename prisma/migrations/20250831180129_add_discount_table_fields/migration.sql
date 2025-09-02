-- CreateTable
CREATE TABLE "DiscountMetafieldRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discountId" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountTitle" TEXT NOT NULL,
    "metafieldNamespace" TEXT NOT NULL,
    "metafieldKey" TEXT NOT NULL,
    "metafieldValue" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "discountValue" TEXT,
    "discountValueType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "lastRan" DATETIME
);
