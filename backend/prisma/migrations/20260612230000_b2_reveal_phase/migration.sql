-- Phase B2: true commit-reveal sealed bids
-- Add REVEAL to AuctionPhase: bidding has ended but the resolver holds the
-- auction open for the configured reveal window so buyers can reveal
-- commit-only sealed bids before ranking.

ALTER TYPE "AuctionPhase" ADD VALUE IF NOT EXISTS 'REVEAL';
