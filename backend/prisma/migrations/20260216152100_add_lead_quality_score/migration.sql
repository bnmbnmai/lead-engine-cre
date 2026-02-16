-- AlterTable: Add qualityScore column to Lead
-- CRE quality score (0-10000), set by CREVerifier at creation time.
-- NULL means score has not been computed yet (pre-NFT leads show "Pending CRE").
ALTER TABLE "Lead" ADD COLUMN "qualityScore" INTEGER;
