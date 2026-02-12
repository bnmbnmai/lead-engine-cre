import { ethers } from "hardhat";

async function main() {
    const signers = await ethers.getSigners();
    const count = Math.min(signers.length, 8);
    console.log(`\nDerived ${signers.length} wallets from mnemonic (showing first ${count}):\n`);
    for (let i = 0; i < count; i++) {
        const bal = ethers.formatEther(await ethers.provider.getBalance(signers[i].address));
        console.log(`[${i}] ${signers[i].address}  ${bal} ETH`);
    }
}

main().catch(console.error);
