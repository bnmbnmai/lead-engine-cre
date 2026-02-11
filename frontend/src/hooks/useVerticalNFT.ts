/**
 * useVerticalNFT — wagmi hooks for reading VerticalNFT contract state
 *
 * Hooks:
 *   useVerticalNFTOwner(slug)    — reads owner of a vertical's NFT
 *   useVerticalNFTMetadata(id)   — reads on-chain metadata struct
 *   useVerticalNFTRoyalty(id, p) — reads EIP-2981 royalty info
 */

import { useReadContract, useChainId } from 'wagmi';
import { getContractAddresses, VERTICAL_NFT_ABI } from '@/lib/wagmi';
import { keccak256, toUtf8Bytes } from 'ethers';

// ============================================
// Owner by Slug
// ============================================

export function useVerticalNFTOwner(slug: string | undefined) {
    const chainId = useChainId();
    const addresses = getContractAddresses(chainId);
    const slugHash = slug ? keccak256(toUtf8Bytes(slug)) : undefined;

    const { data: rawTokenId, ...tokenQuery } = useReadContract({
        address: addresses.verticalNFT as `0x${string}`,
        abi: VERTICAL_NFT_ABI,
        functionName: 'slugToToken',
        args: slugHash ? [slugHash] : undefined,
        query: { enabled: !!slugHash && !!addresses.verticalNFT },
    });

    const tokenId = rawTokenId as bigint | undefined;

    const { data: owner, ...ownerQuery } = useReadContract({
        address: addresses.verticalNFT as `0x${string}`,
        abi: VERTICAL_NFT_ABI,
        functionName: 'ownerOf',
        args: tokenId ? [tokenId] : undefined,
        query: { enabled: !!tokenId && tokenId > 0n },
    });

    return {
        tokenId: tokenId ? Number(tokenId) : null,
        owner: owner as string | undefined,
        isLoading: tokenQuery.isLoading || ownerQuery.isLoading,
        error: tokenQuery.error || ownerQuery.error,
    };
}

// ============================================
// On-chain Metadata
// ============================================

export function useVerticalNFTMetadata(tokenId: number | null) {
    const chainId = useChainId();
    const addresses = getContractAddresses(chainId);

    const { data, isLoading, error } = useReadContract({
        address: addresses.verticalNFT as `0x${string}`,
        abi: VERTICAL_NFT_ABI,
        functionName: 'getVertical',
        args: tokenId ? [BigInt(tokenId)] : undefined,
        query: { enabled: !!tokenId && !!addresses.verticalNFT },
    });

    const meta = data as
        | { slug: string; parentSlug: string; attributesHash: string; activatedAt: bigint; depth: number; isFractionalizable: boolean }
        | undefined;

    return {
        metadata: meta
            ? {
                slug: meta.slug,
                parentSlug: meta.parentSlug,
                attributesHash: meta.attributesHash,
                activatedAt: Number(meta.activatedAt),
                depth: meta.depth,
                isFractionalizable: meta.isFractionalizable,
            }
            : null,
        isLoading,
        error,
    };
}

// ============================================
// EIP-2981 Royalty Info
// ============================================

export function useVerticalNFTRoyalty(tokenId: number | null, salePrice: bigint = 1000000n) {
    const chainId = useChainId();
    const addresses = getContractAddresses(chainId);

    const { data, isLoading, error } = useReadContract({
        address: addresses.verticalNFT as `0x${string}`,
        abi: VERTICAL_NFT_ABI,
        functionName: 'royaltyInfo',
        args: tokenId ? [BigInt(tokenId), salePrice] : undefined,
        query: { enabled: !!tokenId && !!addresses.verticalNFT },
    });

    const result = data as [string, bigint] | undefined;

    return {
        receiver: result?.[0] ?? null,
        royaltyAmount: result ? Number(result[1]) : null,
        royaltyBps: result ? Number((result[1] * 10000n) / salePrice) : null,
        isLoading,
        error,
    };
}
