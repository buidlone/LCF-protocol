import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Framework, WrapperSuperToken } from "@superfluid-finance/sdk-core";
import { BigNumber } from "ethers";
import { ethers, web3 } from "hardhat";
import { assert, expect } from "chai";
import { InvestmentPoolFactoryMock, GelatoOpsMock } from "../typechain";

const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

const provider = web3;

// eslint-disable-next-line no-unused-vars
let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let dPatronAdmin: SignerWithAddress;
let creator: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let gelatoOpsMock: GelatoOpsMock;

function generateGaplessMilestones(
  startTimeStamp: BigNumber,
  duration: BigNumber,
  votingPeriod: BigNumber,
  amount: number
): { startDate: BigNumber; endDate: BigNumber }[] {
  const arr: { startDate: BigNumber; endDate: BigNumber }[] = [];
  let prevTimestamp = startTimeStamp;

  for (let i = 0; i < amount; i++) {
    const endDate = prevTimestamp.add(duration);
    arr.push({ startDate: prevTimestamp, endDate: endDate });

    prevTimestamp = endDate.add(votingPeriod);
  }

  return arr;
}

const errorHandler = (err: any) => {
  if (err) throw err;
};

describe("Investment Pool Factory", async () => {
  before(async () => {
    // get accounts from hardhat
    accounts = await ethers.getSigners();

    admin = accounts[0];
    dPatronAdmin = accounts[1];
    creator = accounts[2];

    // deploy the framework
    await deployFramework(errorHandler, {
      web3,
      from: admin.address,
    });

    // deploy a fake erc20 token
    const fUSDTAddress = await deployTestToken(errorHandler, [":", "fUSDT"], {
      web3,
      from: admin.address,
    });

    // deploy a fake erc20 wrapper super token around the fUSDT token
    const fUSDTxAddress = await deploySuperToken(errorHandler, [":", "fUSDT"], {
      web3,
      from: admin.address,
    });

    console.log("fUSDT  Address: ", fUSDTAddress);
    console.log("fUSDTx Address: ", fUSDTxAddress);

    // initialize the superfluid framework...put custom and web3 only bc we are using hardhat locally
    sf = await Framework.create({
      networkName: "custom",
      provider,
      dataMode: "WEB3_ONLY",
      resolverAddress: process.env.RESOLVER_ADDRESS, // resolver address will be set to the env by the framework deployer
      protocolReleaseVersion: "test",
    });

    // Create and deploy Gelato Ops contract mock
    const GelatoOpsMock = await ethers.getContractFactory(
      "GelatoOpsMock",
      dPatronAdmin
    );
    gelatoOpsMock = await GelatoOpsMock.deploy();
    await gelatoOpsMock.deployed();

    fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");

    const underlyingAddr = fUSDTx.underlyingToken.address;

    fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, admin);
  });

  beforeEach(async () => {
    // Create investment pool factory contract
    const investmentPoolDepFactory = await ethers.getContractFactory(
      "InvestmentPoolFactoryMock",
      dPatronAdmin
    );

    investmentPoolFactory = await investmentPoolDepFactory.deploy(
      sf.settings.config.hostAddress,
      gelatoOpsMock.address
    );

    await investmentPoolFactory.deployed();

    // Enforce a starting timestamp to avoid time based bugs
    const time = new Date("2022/06/01").getTime() / 1000;
    await investmentPoolFactory
      .connect(dPatronAdmin)
      .setTimestamp(BigNumber.from(time));
  });

  describe("1. Investment creation", () => {
    describe("1.1 Interactions", () => {
      const softCap: BigNumber = ethers.utils.parseEther("1500");

      it("[IPF][1.1.1] Can create a NO-PROXY investment", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/10/01").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        const creationRes = await investmentPoolFactory
          .connect(creator)
          .createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          );

        const creationEvent = (await creationRes.wait(1)).events?.find(
          (e) => e.event === "Created"
        );

        assert.isDefined(creationEvent, "Didn't emit creation event");

        await expect(creationRes).to.emit(gelatoOpsMock, "RegisterGelatoTask");

        const poolAddress = creationEvent?.args?.pool;

        const contractFactory = await ethers.getContractFactory(
          "InvestmentPoolMock",
          dPatronAdmin
        );

        const pool = contractFactory.attach(poolAddress);

        const creatorAddress = await pool.creator();
        const invested = await pool.totalInvestedAmount();
        const fundraiserStartAt = await pool.fundraiserStartAt();
        const fundraiserEndAt = await pool.fundraiserEndAt();
        const poolSoftCap = await pool.softCap();
        const milestoneCount = await pool.milestoneCount();
        const milestone = await pool.milestones(0);

        // Verify the campaign variables
        assert.equal(creatorAddress, creator.address, "Wrong creator address");
        assert.deepEqual(poolSoftCap, softCap, "Wrong soft cap");
        assert.deepEqual(
          invested,
          BigNumber.from(0),
          "Should not have any investments yet"
        );
        assert.deepEqual(
          BigNumber.from(fundraiserStartAt),
          campaignStartDate,
          "Wrong campaign start date"
        );
        assert.deepEqual(
          BigNumber.from(fundraiserEndAt),
          campaignEndDate,
          "Wrong campaign end date"
        );
        assert.deepEqual(
          milestoneCount,
          BigNumber.from(1),
          "Should have a single milestone"
        );
        assert.deepEqual(
          BigNumber.from(milestone.startDate),
          milestoneStartDate,
          "Wrong milestone start date"
        );
        assert.deepEqual(
          BigNumber.from(milestone.endDate),
          milestoneEndDate,
          "Wrong milestone end date"
        );
        assert.equal(
          milestone.paid,
          false,
          "Milestone should not be paid initially"
        );
        assert.equal(
          milestone.streamOngoing,
          false,
          "Stream should not be ongoing from the start"
        );
        assert.deepEqual(
          milestone.paidAmount,
          BigNumber.from(0),
          "Should have paid 0 in funds upon creation"
        );
      });
      it("[IPF][1.1.2] Reverts creation if fundraiser campaign ends before it starts", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/10/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        // Campaign ends before it starts
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.3] Reverts creation if milestone ends before it starts", async () => {
        // Milestone ends before it starts
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/10").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/9/01").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.4] Reverts creation if milestone is shorter than 30 days", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/9/10").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.5] Reverts creation if fundraiser period is longer than 90 days", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2023/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2023/9/10").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2023/08/01").getTime() / 1000
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.6] Fundraiser interval cannot be retrospective", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/9/10").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        // Move forward in time to simulate retrospective creation for fundraiser
        const time = new Date("2022/08/15").getTime() / 1000;
        await investmentPoolFactory
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.7] Milestone interval cannot be retrospective", async () => {
        // Note, it's implicitly enforced by the requirements
        // on fundraiser campaign dates, but this test is here to prevent accidental code changes
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/10/01").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        // Move forward in time to simulate retrospective creation for milestone
        const time = new Date("2022/09/15").getTime() / 1000;
        await investmentPoolFactory
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.8] Respects milestone count limit", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        // Campaign ends before it starts
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        // 30 days
        const milestoneDuration = BigNumber.from(30 * 24 * 60 * 60);
        const votingPeriod = BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );
        const maxMilestones = await investmentPoolFactory.MAX_MILESTONE_COUNT();

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            generateGaplessMilestones(
              milestoneStartDate,
              milestoneDuration,
              votingPeriod,
              maxMilestones + 1 // Intentionally provoke reverting
            )
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.9] Can create multiple milestones", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        // Campaign ends before it starts
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        // 30 days
        const milestoneDuration = BigNumber.from(30 * 24 * 60 * 60);

        const votingPeriod = BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );
        const maxMilestones = await investmentPoolFactory.MAX_MILESTONE_COUNT();

        const milestones = generateGaplessMilestones(
          milestoneStartDate,
          milestoneDuration,
          votingPeriod,
          maxMilestones // Let's create as many as it's allowed
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            milestones
          )
        ).to.not.be.reverted;
      });

      it("[IPF][1.1.10] Ensures minimal voting period and milestone spacing", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        // Campaign ends before it starts
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        // 30 days
        const milestoneDuration = BigNumber.from(30 * 24 * 60 * 60);

        const votingPeriod = BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );

        const milestones = generateGaplessMilestones(
          milestoneStartDate,
          milestoneDuration,
          votingPeriod.sub(1), // Make it one second less than minimal
          2 // will be enough
        );

        await expect(
          investmentPoolFactory.connect(creator).createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            0, // NO-PROXY
            milestones
          )
        ).to.be.reverted;
      });

      it("[IPF][1.1.11] Can create a CLONE-PROXY investment", async () => {
        const milestoneStartDate = BigNumber.from(
          new Date("2022/09/01").getTime() / 1000
        );
        const milestoneEndDate = BigNumber.from(
          new Date("2022/10/01").getTime() / 1000
        );
        const campaignStartDate = BigNumber.from(
          new Date("2022/07/01").getTime() / 1000
        );
        const campaignEndDate = BigNumber.from(
          new Date("2022/08/01").getTime() / 1000
        );

        const creationRes = await investmentPoolFactory
          .connect(creator)
          .createInvestmentPool(
            fUSDTx.address,
            softCap,
            campaignStartDate,
            campaignEndDate,
            1, // CLONE-PROXY
            [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
          );

        const creationEvent = (await creationRes.wait(1)).events?.find(
          (e) => e.event === "Created"
        );

        assert.isDefined(creationEvent, "Didn't emit creation event");

        await expect(creationRes).to.emit(gelatoOpsMock, "RegisterGelatoTask");

        const poolAddress = creationEvent?.args?.pool;

        const contractFactory = await ethers.getContractFactory(
          "InvestmentPoolMock",
          dPatronAdmin
        );

        const pool = contractFactory.attach(poolAddress);

        const creatorAddress = await pool.creator();
        const invested = await pool.totalInvestedAmount();
        const fundraiserStartAt = await pool.fundraiserStartAt();
        const fundraiserEndAt = await pool.fundraiserEndAt();
        const poolSoftCap = await pool.softCap();
        const milestoneCount = await pool.milestoneCount();
        const milestone = await pool.milestones(0);

        // Verify the campaign variables
        assert.equal(creatorAddress, creator.address, "Wrong creator address");
        assert.deepEqual(poolSoftCap, softCap, "Wrong soft cap");
        assert.deepEqual(
          invested,
          BigNumber.from(0),
          "Should not have any investments yet"
        );
        assert.deepEqual(
          BigNumber.from(fundraiserStartAt),
          campaignStartDate,
          "Wrong campaign start date"
        );
        assert.deepEqual(
          BigNumber.from(fundraiserEndAt),
          campaignEndDate,
          "Wrong campaign end date"
        );
        assert.deepEqual(
          milestoneCount,
          BigNumber.from(1),
          "Should have a single milestone"
        );
        assert.deepEqual(
          BigNumber.from(milestone.startDate),
          milestoneStartDate,
          "Wrong milestone start date"
        );
        assert.deepEqual(
          BigNumber.from(milestone.endDate),
          milestoneEndDate,
          "Wrong milestone end date"
        );
        assert.equal(
          milestone.paid,
          false,
          "Milestone should not be paid initially"
        );
        assert.equal(
          milestone.streamOngoing,
          false,
          "Stream should not be ongoing from the start"
        );
        assert.deepEqual(
          milestone.paidAmount,
          BigNumber.from(0),
          "Should have paid 0 in funds upon creation"
        );
      });
    });
  });
});
