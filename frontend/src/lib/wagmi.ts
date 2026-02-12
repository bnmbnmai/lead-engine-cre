import { http } from 'wagmi';
import { mainnet, sepolia, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// ============================================
// Contract Addresses
// ============================================

export const CONTRACT_ADDRESSES = {
    sepolia: {
        marketplace: import.meta.env.VITE_MARKETPLACE_ADDRESS_SEPOLIA || '',
        leadNFT: import.meta.env.VITE_LEAD_NFT_ADDRESS_SEPOLIA || '',
        escrow: import.meta.env.VITE_ESCROW_ADDRESS_SEPOLIA || '',
        ace: import.meta.env.VITE_ACE_ADDRESS_SEPOLIA || '',
        verticalNFT: import.meta.env.VITE_VERTICAL_NFT_ADDRESS_SEPOLIA || '',
        usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    },
    baseSepolia: {
        marketplace: import.meta.env.VITE_MARKETPLACE_ADDRESS_BASE || '',
        leadNFT: import.meta.env.VITE_LEAD_NFT_ADDRESS_BASE || '',
        escrow: import.meta.env.VITE_ESCROW_ADDRESS_BASE || '',
        ace: import.meta.env.VITE_ACE_ADDRESS_BASE || '',
        verticalNFT: import.meta.env.VITE_VERTICAL_NFT_ADDRESS_BASE || '',
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
} as const;

// ============================================
// Wagmi Config
// ============================================

export const wagmiConfig = getDefaultConfig({
    appName: 'Lead Engine CRE',
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo',
    chains: [sepolia, baseSepolia, mainnet],
    transports: {
        [mainnet.id]: http(import.meta.env.VITE_RPC_URL_MAINNET || 'https://cloudflare-eth.com'),
        [sepolia.id]: http(import.meta.env.VITE_RPC_URL_SEPOLIA),
        [baseSepolia.id]: http(import.meta.env.VITE_RPC_URL_BASE_SEPOLIA || 'https://sepolia.base.org'),
    },
});

// ============================================
// Contract ABIs (Minimal for reads/writes)
// ============================================

export const MARKETPLACE_ABI = [
    'function createListing(uint256 tokenId, uint96 reservePrice, uint96 buyNowPrice, uint40 auctionDuration) external returns (uint256)',
    'function commitBid(uint256 listingId, bytes32 commitment) external',
    'function revealBid(uint256 listingId, uint96 amount, bytes32 salt) external',
    'function resolveAuction(uint256 listingId) external',
    'function getListing(uint256 listingId) external view returns (tuple(uint256 tokenId, address seller, uint96 reservePrice, uint96 buyNowPrice, uint96 highestBid, address highestBidder, uint40 startTime, uint40 endTime, uint8 status))',
    'event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, address indexed seller, uint96 reservePrice)',
    'event BidCommitted(uint256 indexed listingId, address indexed buyer)',
    'event BidRevealed(uint256 indexed listingId, address indexed buyer, uint96 amount)',
    'event AuctionResolved(uint256 indexed listingId, address indexed winner, uint96 amount)',
] as const;

export const LEAD_NFT_ABI = [
    'function mintLead(address to, bytes32 platformLeadId, bytes32 vertical, bytes32 geoHash, bytes32 piiHash, uint96 reservePrice, uint40 expiresAt, uint8 source, bool tcpaConsent, string uri) external returns (uint256)',
    'function getLead(uint256 tokenId) external view returns (tuple(bytes32 vertical, bytes32 geoHash, bytes32 piiHash, uint96 reservePrice, uint40 createdAt, uint40 expiresAt, uint40 soldAt, uint8 source, uint8 status, address seller, address buyer, bool isVerified, bool tcpaConsent))',
    'function approve(address to, uint256 tokenId) external',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function totalSupply() external view returns (uint256)',
] as const;

export const ACE_ABI = [
    'function isKYCValid(address user) external view returns (bool)',
    'function canTransact(address user, bytes32 vertical, bytes32 geoHash) external view returns (bool)',
    'function getReputationScore(address user) external view returns (uint16)',
] as const;

export const VERTICAL_NFT_ABI = [
    'function mintVertical(address to, bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint16 depth, string uri) external returns (uint256)',
    'function slugToToken(bytes32 slug) external view returns (uint256)',
    'function getVertical(uint256 tokenId) external view returns (tuple(bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint40 activatedAt, uint16 depth, bool isFractionalizable))',
    'function getVerticalBySlug(bytes32 slug) external view returns (uint256, tuple(bytes32 slug, bytes32 parentSlug, bytes32 attributesHash, uint40 activatedAt, uint16 depth, bool isFractionalizable))',
    'function ownerOf(uint256 tokenId) external view returns (address)',
    'function totalSupply() external view returns (uint256)',
    'function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256)',
    'event VerticalMinted(uint256 indexed tokenId, bytes32 indexed slug, bytes32 indexed parentSlug, address owner, uint16 depth)',
] as const;

export const USDC_ABI = [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function balanceOf(address account) external view returns (uint256)',
    'function transfer(address to, uint256 amount) external returns (bool)',
] as const;

// ============================================
// Helper to get addresses for current chain
// ============================================

export function getContractAddresses(chainId: number) {
    if (chainId === sepolia.id) {
        return CONTRACT_ADDRESSES.sepolia;
    }
    if (chainId === baseSepolia.id) {
        return CONTRACT_ADDRESSES.baseSepolia;
    }
    return CONTRACT_ADDRESSES.sepolia; // Default
}

export default wagmiConfig;
