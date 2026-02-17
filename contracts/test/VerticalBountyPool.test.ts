import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("VerticalBountyPool", function () {
    const USDC_DECIMALS = 6;
    const depositAmount = ethers.parseUnits("100", USDC_DECIMALS); // $100
    const topUpAmount = ethers.parseUnits("50", USDC_DECIMALS);   // $50
    const releaseAmt = ethers.parseUnits("30", USDC_DECIMALS);   // $30

    // keccak256("solar")
    const solarSlug = ethers.keccak256(ethers.toUtf8Bytes("solar"));
    // keccak256("home_services.plumbing")
    const plumbingSlug = ethers.keccak256(ethers.toUtf8Bytes("home_services.plumbing"));

    async function deployFixture() {
        const [owner, buyer1, buyer2, recipient, unauthorized] = await ethers.getSigners();

        // Deploy mock USDC
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = await (MockERC20 as any).deploy("USD Coin", "USDC", 6);

        // Deploy VerticalBountyPool
        const Pool = await ethers.getContractFactory("VerticalBountyPool");
        const pool = await (Pool as any).deploy(await usdc.getAddress(), owner.address);

        // Authorize owner as caller (for releases)
        await pool.setAuthorizedCaller(owner.address, true);

        // Fund buyers with USDC
        await usdc.mint(buyer1.address, ethers.parseUnits("10000", USDC_DECIMALS));
        await usdc.mint(buyer2.address, ethers.parseUnits("10000", USDC_DECIMALS));

        // Approve pool contract
        const poolAddr = await pool.getAddress();
        await usdc.connect(buyer1).approve(poolAddr, ethers.MaxUint256);
        await usdc.connect(buyer2).approve(poolAddr, ethers.MaxUint256);

        return { pool, usdc, owner, buyer1, buyer2, recipient, unauthorized };
    }

    // ============================================
    // Deposit Tests
    // ============================================

    describe("depositBounty", function () {
        it("should create a new pool and transfer USDC", async function () {
            const { pool, usdc, buyer1 } = await loadFixture(deployFixture);

            const balBefore = await usdc.balanceOf(buyer1.address);
            const tx = await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            const receipt = await tx.wait();
            const balAfter = await usdc.balanceOf(buyer1.address);

            expect(balBefore - balAfter).to.equal(depositAmount);

            // Check pool state
            const p = await pool.pools(1);
            expect(p.buyer).to.equal(buyer1.address);
            expect(p.verticalSlugHash).to.equal(solarSlug);
            expect(p.totalDeposited).to.equal(depositAmount);
            expect(p.totalReleased).to.equal(0);
            expect(p.active).to.be.true;
        });

        it("should emit BountyDeposited event", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await expect(pool.connect(buyer1).depositBounty(solarSlug, depositAmount))
                .to.emit(pool, "BountyDeposited")
                .withArgs(1, buyer1.address, solarSlug, depositAmount, depositAmount);
        });

        it("should add pool ID to verticalPools mapping", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            const poolIds = await pool.getVerticalPoolIds(solarSlug);
            expect(poolIds.length).to.equal(1);
            expect(poolIds[0]).to.equal(1);
        });

        it("should revert on empty slug hash", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);
            await expect(
                pool.connect(buyer1).depositBounty(ethers.ZeroHash, depositAmount)
            ).to.be.revertedWith("Empty slug hash");
        });

        it("should revert on zero amount", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);
            await expect(
                pool.connect(buyer1).depositBounty(solarSlug, 0)
            ).to.be.revertedWith("Amount must be positive");
        });
    });

    // ============================================
    // Top-Up Tests
    // ============================================

    describe("topUpBounty", function () {
        it("should increase pool deposit and transfer USDC", async function () {
            const { pool, usdc, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer1).topUpBounty(1, topUpAmount);

            const p = await pool.pools(1);
            expect(p.totalDeposited).to.equal(depositAmount + topUpAmount);
        });

        it("should emit BountyDeposited with updated balance", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(pool.connect(buyer1).topUpBounty(1, topUpAmount))
                .to.emit(pool, "BountyDeposited")
                .withArgs(1, buyer1.address, solarSlug, topUpAmount, depositAmount + topUpAmount);
        });

        it("should revert if non-buyer tries to top up", async function () {
            const { pool, buyer1, buyer2 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(
                pool.connect(buyer2).topUpBounty(1, topUpAmount)
            ).to.be.revertedWith("Only pool buyer");
        });

        it("should revert on inactive pool", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            // Pool 99 doesn't exist — active defaults to false
            await expect(
                pool.connect(buyer1).topUpBounty(99, topUpAmount)
            ).to.be.revertedWith("Pool not active");
        });
    });

    // ============================================
    // Release Tests
    // ============================================

    describe("releaseBounty", function () {
        it("should transfer USDC to recipient (seller)", async function () {
            const { pool, usdc, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            const balBefore = await usdc.balanceOf(recipient.address);
            await pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-001");
            const balAfter = await usdc.balanceOf(recipient.address);

            expect(balAfter - balBefore).to.equal(releaseAmt);
        });

        it("should update totalReleased", async function () {
            const { pool, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-001");

            const p = await pool.pools(1);
            expect(p.totalReleased).to.equal(releaseAmt);
        });

        it("should emit BountyReleased event", async function () {
            const { pool, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-001"))
                .to.emit(pool, "BountyReleased")
                .withArgs(1, recipient.address, releaseAmt, "lead-001");
        });

        it("should revert if non-authorized caller", async function () {
            const { pool, buyer1, recipient, unauthorized } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(
                pool.connect(unauthorized).releaseBounty(1, recipient.address, releaseAmt, "lead-001")
            ).to.be.revertedWith("Not authorized");
        });

        it("should revert on insufficient balance", async function () {
            const { pool, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            const overAmount = ethers.parseUnits("200", USDC_DECIMALS);
            await expect(
                pool.connect(owner).releaseBounty(1, recipient.address, overAmount, "lead-001")
            ).to.be.revertedWith("Insufficient pool balance");
        });

        it("should allow multiple partial releases", async function () {
            const { pool, usdc, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-001");
            await pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-002");

            const p = await pool.pools(1);
            expect(p.totalReleased).to.equal(releaseAmt * 2n);

            const avail = await pool.availableBalance(1);
            expect(avail).to.equal(depositAmount - releaseAmt * 2n);
        });
    });

    // ============================================
    // Withdraw Tests
    // ============================================

    describe("withdrawBounty", function () {
        it("should refund unreleased balance to buyer", async function () {
            const { pool, usdc, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            const balBefore = await usdc.balanceOf(buyer1.address);
            await pool.connect(buyer1).withdrawBounty(1, depositAmount);
            const balAfter = await usdc.balanceOf(buyer1.address);

            expect(balAfter - balBefore).to.equal(depositAmount);
        });

        it("should withdraw all when amount is 0", async function () {
            const { pool, usdc, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            const balBefore = await usdc.balanceOf(buyer1.address);
            await pool.connect(buyer1).withdrawBounty(1, 0); // 0 = withdraw all
            const balAfter = await usdc.balanceOf(buyer1.address);

            expect(balAfter - balBefore).to.equal(depositAmount);
        });

        it("should deactivate pool when fully drained", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer1).withdrawBounty(1, 0);

            const p = await pool.pools(1);
            expect(p.active).to.be.false;
        });

        it("should withdraw partial amount and keep pool active", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            const partial = ethers.parseUnits("40", USDC_DECIMALS);
            await pool.connect(buyer1).withdrawBounty(1, partial);

            const p = await pool.pools(1);
            expect(p.active).to.be.true;
            expect(await pool.availableBalance(1)).to.equal(depositAmount - partial);
        });

        it("should emit BountyWithdrawn event", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(pool.connect(buyer1).withdrawBounty(1, depositAmount))
                .to.emit(pool, "BountyWithdrawn")
                .withArgs(1, buyer1.address, depositAmount);
        });

        it("should revert if non-buyer tries to withdraw", async function () {
            const { pool, buyer1, buyer2 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);

            await expect(
                pool.connect(buyer2).withdrawBounty(1, depositAmount)
            ).to.be.revertedWith("Only pool buyer");
        });

        it("should revert on overdraft", async function () {
            const { pool, buyer1, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            // Release some first
            await pool.connect(owner).releaseBounty(1, buyer1.address, releaseAmt, "lead-x");

            const remaining = depositAmount - releaseAmt;
            const overAmount = remaining + ethers.parseUnits("1", USDC_DECIMALS);
            await expect(
                pool.connect(buyer1).withdrawBounty(1, overAmount)
            ).to.be.revertedWith("Insufficient balance");
        });
    });

    // ============================================
    // Stacking (multiple pools per vertical)
    // ============================================

    describe("Stacking — multiple buyers", function () {
        it("should allow multiple pools per vertical", async function () {
            const { pool, buyer1, buyer2 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer2).depositBounty(solarSlug, topUpAmount);

            const poolIds = await pool.getVerticalPoolIds(solarSlug);
            expect(poolIds.length).to.equal(2);
        });

        it("should report correct total vertical bounty", async function () {
            const { pool, buyer1, buyer2 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer2).depositBounty(solarSlug, topUpAmount);

            const total = await pool.totalVerticalBounty(solarSlug);
            expect(total).to.equal(depositAmount + topUpAmount);
        });

        it("should track pools per vertical independently", async function () {
            const { pool, buyer1, buyer2 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer2).depositBounty(plumbingSlug, topUpAmount);

            expect(await pool.totalVerticalBounty(solarSlug)).to.equal(depositAmount);
            expect(await pool.totalVerticalBounty(plumbingSlug)).to.equal(topUpAmount);
        });
    });

    // ============================================
    // View Functions
    // ============================================

    describe("View functions", function () {
        it("availableBalance returns 0 for non-existent pool", async function () {
            const { pool } = await loadFixture(deployFixture);
            expect(await pool.availableBalance(99)).to.equal(0);
        });

        it("totalVerticalBounty returns 0 for unknown vertical", async function () {
            const { pool } = await loadFixture(deployFixture);
            const unknownSlug = ethers.keccak256(ethers.toUtf8Bytes("unknown_vertical"));
            expect(await pool.totalVerticalBounty(unknownSlug)).to.equal(0);
        });

        it("availableBalance excludes released amounts", async function () {
            const { pool, buyer1, recipient, owner } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(owner).releaseBounty(1, recipient.address, releaseAmt, "lead-1");

            expect(await pool.availableBalance(1)).to.equal(depositAmount - releaseAmt);
        });

        it("totalVerticalBounty excludes deactivated pools", async function () {
            const { pool, buyer1 } = await loadFixture(deployFixture);

            await pool.connect(buyer1).depositBounty(solarSlug, depositAmount);
            await pool.connect(buyer1).withdrawBounty(1, 0); // deactivates

            expect(await pool.totalVerticalBounty(solarSlug)).to.equal(0);
        });
    });
});
