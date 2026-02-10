const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");

    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name, "chainId:", Number(network.chainId));

    if (balance === 0n) {
        console.log("ERROR: No Sepolia ETH. Get some from https://faucets.chain.link");
    }
}

main().catch(console.error);
