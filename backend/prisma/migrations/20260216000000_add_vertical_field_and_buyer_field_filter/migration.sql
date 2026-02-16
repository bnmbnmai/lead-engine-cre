-- CreateEnum
CREATE TYPE "FilterOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'CONTAINS', 'STARTS_WITH');

-- CreateTable
CREATE TABLE "VerticalField" (
    "id" TEXT NOT NULL,
    "verticalId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT[],
    "placeholder" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "isBiddable" BOOLEAN NOT NULL DEFAULT true,
    "isPii" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerticalField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerFieldFilter" (
    "id" TEXT NOT NULL,
    "preferenceSetId" TEXT NOT NULL,
    "verticalFieldId" TEXT NOT NULL,
    "operator" "FilterOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerFieldFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerticalField_verticalId_idx" ON "VerticalField"("verticalId");

-- CreateIndex
CREATE INDEX "VerticalField_key_idx" ON "VerticalField"("key");

-- CreateIndex
CREATE INDEX "VerticalField_isFilterable_isBiddable_isPii_idx" ON "VerticalField"("isFilterable", "isBiddable", "isPii");

-- CreateIndex
CREATE UNIQUE INDEX "VerticalField_verticalId_key_key" ON "VerticalField"("verticalId", "key");

-- CreateIndex
CREATE INDEX "BuyerFieldFilter_preferenceSetId_isActive_idx" ON "BuyerFieldFilter"("preferenceSetId", "isActive");

-- CreateIndex
CREATE INDEX "BuyerFieldFilter_verticalFieldId_idx" ON "BuyerFieldFilter"("verticalFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerFieldFilter_preferenceSetId_verticalFieldId_key" ON "BuyerFieldFilter"("preferenceSetId", "verticalFieldId");

-- AddForeignKey
ALTER TABLE "VerticalField" ADD CONSTRAINT "VerticalField_verticalId_fkey" FOREIGN KEY ("verticalId") REFERENCES "Vertical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerFieldFilter" ADD CONSTRAINT "BuyerFieldFilter_preferenceSetId_fkey" FOREIGN KEY ("preferenceSetId") REFERENCES "BuyerPreferenceSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerFieldFilter" ADD CONSTRAINT "BuyerFieldFilter_verticalFieldId_fkey" FOREIGN KEY ("verticalFieldId") REFERENCES "VerticalField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
