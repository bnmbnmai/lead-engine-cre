import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { PersonalEscrowVault, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PersonalEscrowVault", function () {
    let vault: PersonalEscrowVault;
    let usdc: MockERC20;
    let owner: SignerWithAddress;
    let platform: SignerWithAddress;
    let buyer1: SignerWithAddress;
    let buyer2: SignerWithAddress;
    let seller: SignerWithAddress;
    let backend: SignerWithAddress;

    const CONVENIENCE_FEE = 1_000_000n; // $1 USDC
    const DEPOSIT_AMOUNT = 100_000_000n; // $100 USDC
    const BID_AMOUNT = 25_000_000n; // $25 USDC

    beforeEach(async function () {
        [owner, platform, buyer1, buyer2, seller, backend] = await ethers.getSigners();

        // Deploy mock USDC
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
        await usdc.waitForDeployment();

        // Deploy vault
        const Vault = await ethers.getContractFactory("PersonalEscrowVault");
        vault = await Vault.deploy(
            await usdc.getAddress(),
            platform.address,
            owner.address
        );
        await vault.waitForDeployment();

        // Enable demo mode so lockForBid/settleBid bypass the hardcoded
        // Base Sepolia Chainlink feed address (doesn't exist on Hardhat local network).
        await vault.setDemoMode(true);

        // Authorize backend
        await vault.setAuthorizedCaller(backend.address, true);

        // Mint USDC to buyers and approve vault
        const vaultAddr = await vault.getAddress();
        await usdc.mint(buyer1.address, DEPOSIT_AMOUNT * 10n);
        await usdc.mint(buyer2.address, DEPOSIT_AMOUNT * 10n);
        await usdc.connect(buyer1).approve(vaultAddr, ethers.MaxUint256);
        await usdc.connect(buyer2).approve(vaultAddr, ethers.MaxUint256);
    });

    // ============================================
    // Deposit
    // ============================================

    describe("deposit", function () {
        it("should accept USDC deposit and update balance", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);

            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await vault.totalDeposited()).to.equal(DEPOSIT_AMOUNT);
        });

        it("should emit Deposited event", async function () {
            await expect(vault.connect(buyer1).deposit(DEPOSIT_AMOUNT))
                .to.emit(vault, "Deposited")
                .withArgs(buyer1.address, DEPOSIT_AMOUNT, DEPOSIT_AMOUNT);
        });

        it("should revert on zero amount", async function () {
            await expect(vault.connect(buyer1).deposit(0))
                .to.be.revertedWith("Zero amount");
        });

        it("should accumulate multiple deposits", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);

            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT * 2n);
        });
    });

    // ============================================
    // Withdraw
    // ============================================

    describe("withdraw", function () {
        beforeEach(async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
        });

        it("should withdraw specified amount", async function () {
            const withdrawAmt = 50_000_000n; // $50
            await vault.connect(buyer1).withdraw(withdrawAmt);

            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT - withdrawAmt);
        });

        it("should withdraw all when amount is 0", async function () {
            await vault.connect(buyer1).withdraw(0);

            expect(await vault.balanceOf(buyer1.address)).to.equal(0);
        });

        it("should revert on insufficient balance", async function () {
            await expect(vault.connect(buyer1).withdraw(DEPOSIT_AMOUNT + 1n))
                .to.be.revertedWith("Insufficient balance");
        });

        it("should emit Withdrawn event", async function () {
            await expect(vault.connect(buyer1).withdraw(DEPOSIT_AMOUNT))
                .to.emit(vault, "Withdrawn")
                .withArgs(buyer1.address, DEPOSIT_AMOUNT, 0);
        });

        it("should NOT allow withdrawing locked funds (active bid)", async function () {
            // Lock $25 + $1 fee = $26 from $100 deposit
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Available = $100 - $26 = $74
            const available = await vault.balanceOf(buyer1.address);
            expect(available).to.equal(DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE);

            // Trying to withdraw full $100 should fail
            await expect(vault.connect(buyer1).withdraw(DEPOSIT_AMOUNT))
                .to.be.revertedWith("Insufficient balance");
        });

        it("should allow withdrawing unlocked portion while bids are active", async function () {
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Available = $100 - $26 = $74 — withdraw $50 should succeed
            const withdrawAmt = 50_000_000n;
            await vault.connect(buyer1).withdraw(withdrawAmt);

            // Remaining unlocked = $74 - $50 = $24
            expect(await vault.balanceOf(buyer1.address)).to.equal(
                DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE - withdrawAmt
            );
            // Locked balance unchanged
            expect(await vault.lockedBalances(buyer1.address)).to.equal(
                BID_AMOUNT + CONVENIENCE_FEE
            );
        });

        it("should withdraw-all only withdrawing unlocked portion", async function () {
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // withdraw(0) = withdraw all available (unlocked)
            const available = DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE;
            await expect(vault.connect(buyer1).withdraw(0))
                .to.emit(vault, "Withdrawn")
                .withArgs(buyer1.address, available, 0);

            // Balance = 0, locked still intact
            expect(await vault.balanceOf(buyer1.address)).to.equal(0);
            expect(await vault.lockedBalances(buyer1.address)).to.equal(
                BID_AMOUNT + CONVENIENCE_FEE
            );
        });

        it("should keep PoR solvent after withdraw with active lock", async function () {
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);
            const available = DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE;
            await vault.connect(buyer1).withdraw(available);

            await vault.verifyReserves();
            expect(await vault.lastPorSolvent()).to.be.true;
        });
    });

    // ============================================
    // Bid Lock
    // ============================================

    describe("lockForBid", function () {
        beforeEach(async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
        });

        it("should lock bidAmount + fee from user balance", async function () {
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            const expectedBalance = DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE;
            expect(await vault.balanceOf(buyer1.address)).to.equal(expectedBalance);
            expect(await vault.lockedBalances(buyer1.address)).to.equal(BID_AMOUNT + CONVENIENCE_FEE);
        });

        it("should create a bid lock record", async function () {
            const tx = await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);
            const receipt = await tx.wait();

            // lockId should be 1
            const lock = await vault.bidLocks(1);
            expect(lock.user).to.equal(buyer1.address);
            expect(lock.amount).to.equal(BID_AMOUNT);
            expect(lock.fee).to.equal(CONVENIENCE_FEE);
            expect(lock.settled).to.be.false;
        });

        it("should revert if insufficient balance for bid + fee", async function () {
            // Try to bid more than balance
            await expect(
                vault.connect(backend).lockForBid(buyer1.address, DEPOSIT_AMOUNT)
            ).to.be.revertedWith("Insufficient vault balance");
        });

        it("should reject non-authorized callers", async function () {
            await expect(
                vault.connect(buyer1).lockForBid(buyer1.address, BID_AMOUNT)
            ).to.be.revertedWith("Vault: not authorized");
        });

        it("should emit BidLocked event", async function () {
            await expect(vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT))
                .to.emit(vault, "BidLocked")
                .withArgs(1, buyer1.address, BID_AMOUNT, CONVENIENCE_FEE);
        });

        it("should report canBid correctly", async function () {
            expect(await vault.canBid(buyer1.address, BID_AMOUNT)).to.be.true;
            expect(await vault.canBid(buyer1.address, DEPOSIT_AMOUNT)).to.be.false; // amount + fee > balance
        });
    });

    // ============================================
    // Settle Bid (Winner)
    // ============================================

    describe("settleBid", function () {
        let lockId: bigint;

        beforeEach(async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            const tx = await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);
            const receipt = await tx.wait();
            lockId = 1n;
        });

        it("should transfer 95% of bid to seller, 5% + fee to platform", async function () {
            const sellerBefore = await usdc.balanceOf(seller.address);
            const platformBefore = await usdc.balanceOf(platform.address);

            await vault.connect(backend).settleBid(lockId, seller.address);

            // 5% of $25 = $1.25
            const platformCut = BID_AMOUNT * 500n / 10000n; // 1_250_000
            const sellerAmount = BID_AMOUNT - platformCut;  // 23_750_000

            expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + sellerAmount);
            expect(await usdc.balanceOf(platform.address)).to.equal(platformBefore + platformCut + CONVENIENCE_FEE);
        });

        it("should mark lock as settled", async function () {
            await vault.connect(backend).settleBid(lockId, seller.address);
            const lock = await vault.bidLocks(lockId);
            expect(lock.settled).to.be.true;
        });

        it("should reduce locked balance", async function () {
            await vault.connect(backend).settleBid(lockId, seller.address);
            expect(await vault.lockedBalances(buyer1.address)).to.equal(0);
        });

        it("should revert on double-settle", async function () {
            await vault.connect(backend).settleBid(lockId, seller.address);
            await expect(
                vault.connect(backend).settleBid(lockId, seller.address)
            ).to.be.revertedWith("Already settled");
        });

        it("should emit BidSettled event with platform cut", async function () {
            const platformCut = BID_AMOUNT * 500n / 10000n;
            const sellerAmount = BID_AMOUNT - platformCut;

            await expect(vault.connect(backend).settleBid(lockId, seller.address))
                .to.emit(vault, "BidSettled")
                .withArgs(lockId, buyer1.address, seller.address, sellerAmount, platformCut, CONVENIENCE_FEE);
        });
    });

    // ============================================
    // Refund Bid (Loser)
    // ============================================

    describe("refundBid", function () {
        let lockId: bigint;

        beforeEach(async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);
            lockId = 1n;
        });

        it("should return locked funds to user balance", async function () {
            await vault.connect(backend).refundBid(lockId);

            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await vault.lockedBalances(buyer1.address)).to.equal(0);
        });

        it("should emit BidRefunded event", async function () {
            await expect(vault.connect(backend).refundBid(lockId))
                .to.emit(vault, "BidRefunded")
                .withArgs(lockId, buyer1.address, BID_AMOUNT + CONVENIENCE_FEE);
        });

        it("should revert on double-refund", async function () {
            await vault.connect(backend).refundBid(lockId);
            await expect(
                vault.connect(backend).refundBid(lockId)
            ).to.be.revertedWith("Already settled");
        });
    });

    // ============================================
    // Proof of Reserves
    // ============================================

    describe("verifyReserves", function () {
        it("should report solvent when deposits balance", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);

            await expect(vault.verifyReserves())
                .to.emit(vault, "ReservesVerified");

            expect(await vault.lastPorSolvent()).to.be.true;
        });

        it("should set lastPorCheck timestamp", async function () {
            await vault.verifyReserves();
            expect(await vault.lastPorCheck()).to.be.gt(0);
        });
    });

    // ============================================
    // Chainlink Automation
    // ============================================

    describe("Automation (checkUpkeep / performUpkeep)", function () {
        it("should report upkeep needed after POR_INTERVAL", async function () {
            // Initially no upkeep (lastPorCheck = 0, so it IS needed)
            const [needed] = await vault.checkUpkeep("0x");
            expect(needed).to.be.true;
        });

        it("should not need upkeep right after PoR check", async function () {
            await vault.verifyReserves();

            const [needed] = await vault.checkUpkeep("0x");
            expect(needed).to.be.false;
        });

        it("should need upkeep after 24 hours", async function () {
            await vault.verifyReserves();

            // Advance 24 hours
            await time.increase(24 * 60 * 60);

            const [needed] = await vault.checkUpkeep("0x");
            expect(needed).to.be.true;
        });

        it("should detect expired locks", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.verifyReserves(); // Reset PoR timer
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Advance 7 days
            await time.increase(7 * 24 * 60 * 60);

            const [needed, data] = await vault.checkUpkeep("0x");
            expect(needed).to.be.true;
        });

        it("should auto-refund expired locks via performUpkeep", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.verifyReserves(); // Reset PoR timer
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Not enough time = no refund
            const balBefore = await vault.balanceOf(buyer1.address);

            // Advance 7 days
            await time.increase(7 * 24 * 60 * 60);

            // Perform upkeep (action 2 = expired refunds)
            await vault.performUpkeep(ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [2]));

            // Balance should be restored
            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await vault.activeLockCount()).to.equal(0);
        });
    });

    // ============================================
    // Pausable
    // ============================================

    describe("Pausable", function () {
        it("should prevent deposits when paused", async function () {
            await vault.pause();
            await expect(vault.connect(buyer1).deposit(DEPOSIT_AMOUNT))
                .to.be.revertedWithCustomError(vault, "EnforcedPause");
        });

        it("should resume after unpause", async function () {
            await vault.pause();
            await vault.unpause();
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
        });
    });

    // ============================================
    // Admin
    // ============================================

    describe("Admin", function () {
        it("should only allow owner to set authorized callers", async function () {
            await expect(
                vault.connect(buyer1).setAuthorizedCaller(buyer1.address, true)
            ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
        });

        it("should update platform wallet", async function () {
            await vault.setPlatformWallet(buyer2.address);
            expect(await vault.platformWallet()).to.equal(buyer2.address);
        });
    });

    // ============================================
    // E2E Flow
    // ============================================

    describe("E2E: Full auction lifecycle", function () {
        it("fund → bid → win → seller paid + fee collected", async function () {
            // 1. Buyer deposits
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);

            // 2. Backend locks funds for bid
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // 3. Buyer1 wins — settle
            const sellerBefore = await usdc.balanceOf(seller.address);
            await vault.connect(backend).settleBid(1, seller.address);

            // 4. Verify final state
            const expectedRemaining = DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE;
            expect(await vault.balanceOf(buyer1.address)).to.equal(expectedRemaining);

            // Seller gets 95% of bid
            const sellerAmount = BID_AMOUNT - (BID_AMOUNT * 500n / 10000n);
            expect(await usdc.balanceOf(seller.address)).to.equal(sellerBefore + sellerAmount);
        });

        it("fund → bid → lose → fully refunded", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Buyer loses — refund
            await vault.connect(backend).refundBid(1);

            // Balance fully restored
            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
            expect(await vault.lockedBalances(buyer1.address)).to.equal(0);
        });

        it("fund → bid → expire → auto-refunded by Automation", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.verifyReserves();
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Advance 7 days
            await time.increase(7 * 24 * 60 * 60);

            // Automation triggers refund
            const [needed, data] = await vault.checkUpkeep("0x");
            expect(needed).to.be.true;

            await vault.performUpkeep(data);

            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT);
        });
    });

    // ============================================
    // Audit-Critical: PoR after Settlement
    // ============================================

    describe("PoR after settlement", function () {
        it("should remain solvent after settleBid (totalObligations decremented)", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);

            // Settle — USDC leaves the contract
            await vault.connect(backend).settleBid(1, seller.address);

            // PoR must still pass: actual >= totalObligations
            await vault.verifyReserves();
            expect(await vault.lastPorSolvent()).to.be.true;

            // Verify totalObligations was decremented (bid + fee left the system)
            const remaining = DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE;
            expect(await vault.totalObligations()).to.equal(remaining);

            // totalDeposited is now info-only, stays at original deposit
            expect(await vault.totalDeposited()).to.equal(DEPOSIT_AMOUNT);
        });

        it("should remain solvent after withdraw", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            const half = DEPOSIT_AMOUNT / 2n;
            await vault.connect(buyer1).withdraw(half);

            await vault.verifyReserves();
            expect(await vault.lastPorSolvent()).to.be.true;
        });
    });

    // ============================================
    // Audit: Edge Cases
    // ============================================

    describe("Edge cases", function () {
        it("should handle concurrent locks from two buyers", async function () {
            await vault.connect(buyer1).deposit(DEPOSIT_AMOUNT);
            await vault.connect(buyer2).deposit(DEPOSIT_AMOUNT);

            // Lock for both buyers
            await vault.connect(backend).lockForBid(buyer1.address, BID_AMOUNT);
            await vault.connect(backend).lockForBid(buyer2.address, BID_AMOUNT);

            expect(await vault.activeLockCount()).to.equal(2);

            // Settle buyer1, refund buyer2
            await vault.connect(backend).settleBid(1, seller.address);
            await vault.connect(backend).refundBid(2);

            expect(await vault.activeLockCount()).to.equal(0);
            expect(await vault.balanceOf(buyer1.address)).to.equal(DEPOSIT_AMOUNT - BID_AMOUNT - CONVENIENCE_FEE);
            expect(await vault.balanceOf(buyer2.address)).to.equal(DEPOSIT_AMOUNT); // fully refunded
        });

        it("should reject lockForBid with zero bid amount (only fee)", async function () {
            await vault.connect(buyer1).deposit(CONVENIENCE_FEE); // only enough for fee
            // 0 bid + $1 fee = $1 total, but bidAmount = 0 is valid if balance >= fee
            await vault.connect(backend).lockForBid(buyer1.address, 0);
            const lock = await vault.bidLocks(1);
            expect(lock.amount).to.equal(0);
            expect(lock.fee).to.equal(CONVENIENCE_FEE);
        });

        it("should reject settle for non-existent lock", async function () {
            await expect(
                vault.connect(backend).settleBid(999, seller.address)
            ).to.be.revertedWith("Invalid lock");
        });

        it("should reject refund for non-existent lock", async function () {
            await expect(
                vault.connect(backend).refundBid(999)
            ).to.be.revertedWith("Invalid lock");
        });
    });
});

