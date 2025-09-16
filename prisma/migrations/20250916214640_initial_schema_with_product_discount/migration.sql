-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `state` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `scope` VARCHAR(191) NULL,
    `expires` DATETIME(3) NULL,
    `accessToken` VARCHAR(191) NOT NULL,
    `userId` BIGINT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `accountOwner` BOOLEAN NOT NULL DEFAULT false,
    `locale` VARCHAR(191) NULL,
    `collaborator` BOOLEAN NULL DEFAULT false,
    `emailVerified` BOOLEAN NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `discount_metafield_rules` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `discountId` VARCHAR(191) NOT NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `discountTitle` VARCHAR(191) NOT NULL,
    `metafieldNamespace` VARCHAR(191) NOT NULL,
    `metafieldKey` VARCHAR(191) NOT NULL,
    `metafieldValue` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `discountValue` VARCHAR(191) NULL,
    `discountValueType` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `productsCount` INTEGER NOT NULL DEFAULT 0,
    `lastRan` DATETIME(3) NULL,

    UNIQUE INDEX `discount_metafield_rules_shop_discountId_key`(`shop`, `discountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shop` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `shopifyId` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `title` VARCHAR(191) NOT NULL,
    `handle` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `productType` VARCHAR(191) NULL,
    `vendor` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `variantsCount` INTEGER NOT NULL DEFAULT 0,
    `imagesCount` INTEGER NOT NULL DEFAULT 0,
    `tags` VARCHAR(191) NULL,
    `activeDiscounts` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `lastFetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `products_shop_shopifyId_key`(`shop`, `shopifyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_discounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `discountId` INTEGER NOT NULL,
    `shop` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `product_discounts_productId_discountId_key`(`productId`, `discountId`),
    INDEX `product_discounts_shop_isActive_idx`(`shop`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_discounts` ADD CONSTRAINT `product_discounts_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_discounts` ADD CONSTRAINT `product_discounts_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount_metafield_rules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;




