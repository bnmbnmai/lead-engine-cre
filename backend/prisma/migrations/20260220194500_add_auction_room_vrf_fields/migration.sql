-- BUG-09: VRF tie-breaker provenance fields on AuctionRoom
-- vrfRequestId: the on-chain VRF requestId emitted when a tie is detected
-- vrfWinner:    the wallet address selected by the VRF callback
--
-- Populated asynchronously by startVrfResolutionWatcher() after closure.
-- Surface these in Judge View / demo panel to showcase Chainlink VRF provenance.

ALTER TABLE "AuctionRoom"
  ADD COLUMN IF NOT EXISTS "vrfRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "vrfWinner"    TEXT;
