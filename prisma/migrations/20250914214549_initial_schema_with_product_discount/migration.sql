-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "discount_metafield_rules" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL DEFAULT 'unknown',
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

-- CreateTable
CREATE TABLE "products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL DEFAULT 'unknown',
    "shopifyId" TEXT NOT NULL DEFAULT 'unknown',
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "description" TEXT,
    "productType" TEXT,
    "vendor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "variantsCount" INTEGER NOT NULL DEFAULT 0,
    "imagesCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT,
    "activeDiscounts" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastFetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "product_discounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "productId" INTEGER NOT NULL,
    "discountId" INTEGER NOT NULL,
    "shop" TEXT NOT NULL DEFAULT 'unknown',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "product_discounts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_discounts_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "discount_metafield_rules" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_metafield_rules_shop_discountId_key" ON "discount_metafield_rules"("shop", "discountId");

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_shopifyId_key" ON "products"("shop", "shopifyId");

-- CreateIndex
CREATE INDEX "product_discounts_shop_isActive_idx" ON "product_discounts"("shop", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_discounts_productId_discountId_key" ON "product_discounts"("productId", "discountId");
