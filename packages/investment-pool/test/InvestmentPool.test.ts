import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Framework, WrapperSuperToken } from "@superfluid-finance/sdk-core";
import { BigNumber } from "ethers";
import { ethers, web3 } from "hardhat";
import { assert, expect } from "chai";
import { InvestmentMock } from "../typechain";
// import traveler from "ganache-time-traveler";

// const { toWad } = require("@decentral.ee/web3-helpers");
// const { assert, should, expect } = require("chai");
const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

// Corresponds to each investor having N fUSDTx (fake USDT wrapped into a SuperToken, hence x suffix)
const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("5000");

const UINT256_MAX = BigNumber.from(2).pow(256).sub(1);

const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let dPatronAdmin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;

let activeAccounts: SignerWithAddress[];
let investors: SignerWithAddress[];

let foreignActor: SignerWithAddress;
let tokenDump: SignerWithAddress;

let sf: Framework;
let investment: InvestmentMock;

const errorHandler = (err: any) => {
  if (err) throw err;
};

before(async function () {
  // get accounts from hardhat
  accounts = await ethers.getSigners();

  admin = accounts[0];
  dPatronAdmin = accounts[1];
  creator = accounts[2];
  investorA = accounts[3];
  investorB = accounts[4];

  foreignActor = accounts[8];
  tokenDump = accounts[9];

  activeAccounts = [creator, investorA, investorB];
  investors = [investorA, investorB];

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

  console.log("fUSDT Address:  ", fUSDTAddress);
  console.log("fUSDTx Address: ", fUSDTxAddress);

  // initialize the superfluid framework...put custom and web3 only bc we are using hardhat locally
  sf = await Framework.create({
    networkName: "custom",
    provider,
    dataMode: "WEB3_ONLY",
    resolverAddress: process.env.RESOLVER_ADDRESS, // resolver address will be set to the env by the framework deployer
    protocolReleaseVersion: "test",
  });

  fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");

  const underlyingAddr = fUSDTx.underlyingToken.address;

  fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, admin);
});

describe("Investment", async () => {
  beforeEach(async () => {
    // If prior investment exists, check if it has an active money stream, terminate it
    if (investment) {
      const existingFlow = await sf.cfaV1.getFlow({
        superToken: fUSDTx.address,
        sender: investment.address,
        receiver: creator.address,
        providerOrSigner: creator,
      });

      // App is actively streaming money to our creator, terminate that stream
      if (!BigNumber.from(existingFlow.flowRate).isZero()) {
        await sf.cfaV1
          .deleteFlow({
            sender: investment.address,
            receiver: creator.address,
            superToken: fUSDTx.address,
          })
          .exec(creator);
      }
    }

    // Transfer all of the money from active accounts to a token dump to make sure we have a clean state
    // TODO: Refactor this into a batch call for faster cleanup between test runs, now it takes too much time
    for (let i = 0; i < activeAccounts.length; i++) {
      const account = activeAccounts[i];

      const balance = await fUSDTx.balanceOf({
        account: account.address,
        providerOrSigner: account,
      });
      const balanceBn = BigNumber.from(balance);
      if (!balanceBn.isZero()) {
        // Transfer leftover tokens to the TokenDump account
        await fUSDTx
          .transfer({
            receiver: tokenDump.address,
            amount: balance,
          })
          .exec(account);
      }
    }

    // Recreate investment contract
    const investmentPoolDepFactory = await ethers.getContractFactory(
      "InvestmentMock",
      dPatronAdmin
    );

    investment = await investmentPoolDepFactory.deploy(
      sf.settings.config.hostAddress,
      fUSDTx.address,
      ""
    );

    // Fund investors
    // TODO: Refactor into a batch call for speed
    for (let i = 0; i < investors.length; i++) {
      const investor = investors[i];
      await fUSDT
        .connect(investor)
        .mint(investor.address, INVESTOR_INITIAL_FUNDS);

      await fUSDT
        .connect(investor)
        .approve(fUSDTx.address, INVESTOR_INITIAL_FUNDS);

      const fUSDtxUpgradeOperation = fUSDTx.upgrade({
        amount: INVESTOR_INITIAL_FUNDS.toString(),
      });

      await fUSDtxUpgradeOperation.exec(investor);
    }
    // Enforce a starting timestamp to avoid time based bugs
    const time = new Date("2022/06/01").getTime() / 1000;
    await investment.connect(dPatronAdmin).setTimestamp(BigNumber.from(time));
  });

  describe("1. Investment creation", () => {
    describe("1.1 Public state", () => {
      it("1.1.1 Fundraiser shouldn't be ongoing on a fresh campaign if the start date is in the future", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: At this point we at 2022/06/01
        const isFundraiserOngoing = await investment.isFundraiserOngoingNow(1);
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be started if the time is not right"
        );
      });

      it("1.1.2 Campaign shouldn't have a failed campaign state on creation", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        const isFailed = await investment.isFailedCampaign(1);
        assert.equal(isFailed, false, "Fresh campaign is failed already");
      });

      it("1.1.3 Campaign shouldn't have reached soft cap upon creation", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        const hasRaisedSoftCap = await investment.isSoftCapReached(1);
        assert.equal(
          hasRaisedSoftCap,
          false,
          "Fresh campaign shouldn't have raised soft cap already"
        );
      });

      it("1.1.4 Fundraiser shouldn't have ender upon campaign creation", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd(1);
        assert.equal(
          hasFundraiserEnded,
          false,
          "Fresh campaign shouldn't have ended fundraiser already"
        );
      });
    });

    describe("1.2 Interactions", () => {
      it("1.2.1 Can create an investment", async function () {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        const campaign = await investment.campaigns(1);
        // Verify the campaign variables
        assert.equal(
          campaign.creator,
          creator.address,
          "Wrong creator address"
        );
        assert.deepEqual(campaign.softCap, softCap, "Wrong soft cap");
        assert.deepEqual(
          campaign.invested,
          BigNumber.from(0),
          "Should not have any investments yet"
        );
        assert.deepEqual(
          campaign.milestoneStartDate,
          milestoneStartDate,
          "Wrong milestone start date"
        );
        assert.deepEqual(
          campaign.milestoneEndDate,
          milestoneEndDate,
          "Wrong milestone end date"
        );
        assert.deepEqual(
          BigNumber.from(campaign.startAt),
          campaignStartDate,
          "Wrong campaign start date"
        );
        assert.deepEqual(
          BigNumber.from(campaign.endAt),
          campaignEndDate,
          "Wrong campaign end date"
        );
        assert.equal(
          campaign.claimed,
          false,
          "Freshly created campaign shouldn't be claimed"
        );
      });
      it("1.2.2 Reverts creation if fundraiser campaign ends before it starts", async () => {
        const softCap = ethers.utils.parseEther("1500");
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
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.3 Reverts creation if milestone ends before it starts", async () => {
        const softCap = ethers.utils.parseEther("1500");
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
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.4 Reverts creation if milestone is shorter than 30 days", async () => {
        const softCap = ethers.utils.parseEther("1500");
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
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.5 Reverts creation if fundraiser period is longer than 90 days", async () => {
        const softCap = ethers.utils.parseEther("1500");
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
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.6 Fundraiser interval cannot be retrospective", async () => {
        const softCap = ethers.utils.parseEther("1500");
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
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.7 Milestone interval cannot be retrospective", async () => {
        // Note, it's implicitly enforced by the requirements
        // on fundraiser campaign dates, but this test is here to prevent accidental code changes
        const softCap = ethers.utils.parseEther("1500");
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
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(
          investment
            .connect(creator)
            .launch(
              softCap,
              milestoneStartDate,
              milestoneEndDate,
              campaignStartDate,
              campaignEndDate
            )
        ).to.be.reverted;
      });

      it("1.2.8 Campaign can be cancelled if it's not started yet", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // Enforce a timestamp before campaign start
        const time = new Date("2022/06/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(investment.connect(creator).cancel(1)).to.not.be.reverted;
      });

      it("1.2.9 Campaign can't be cancelled by anyone, except creator", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // Enforce a timestamp before campaign start
        const time = new Date("2022/06/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(investment.connect(foreignActor).cancel(1)).to.be.reverted;
      });

      it("1.2.10 Campaign can't be cancelled, if it's already started", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // Fundraiser has already started by now
        const time = new Date("2022/07/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(investment.connect(foreignActor).cancel(1)).to.be.reverted;
      });
    });

    // Test public campaigns states to ensure they are correct
    // (failed campaign, soft cap, etc)
  });

  describe("2. Fundraiser", () => {
    describe("2.1 Public state", () => {
      it("2.1.1 Fundraiser should be ongoing if the starting date has passed", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow(1);
        assert.equal(
          isFundraiserOngoing,
          true,
          "Fundraiser be started already"
        );
      });

      it("2.1.2 Campaign shouldn't have a failed state during active fundraiser", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedCampaign(1);
        assert.equal(
          isFailed,
          false,
          "Campaign shouldn't have a failed state during the fundraiser period"
        );
      });

      it("2.1.3 Campaign shouldn't have a soft cap raised initially after the fundraiser start", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isSoftCapReached = await investment.isSoftCapReached(1);
        assert.equal(
          isSoftCapReached,
          false,
          "Campaign shouldn't have a soft cap raised initially after the fundraiser start"
        );
      });

      it("2.1.4 Fundraiser period shouldn't have ended yet", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd(1);
        assert.equal(
          hasFundraiserEnded,
          false,
          "Fundraiser period shouldn't have ended yet"
        );
      });
    });
    describe("2.2 Interactions", () => {
      it("2.2.1 Investors should not be able to invest before the fundraiser period", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/06/15
        const timeStamp = new Date("2022/06/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .be.reverted;
      });

      it("2.2.2 Investors should be able to invest money", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        const investedFunds = await investment.investedAmount(
          1,
          investorA.address
        );

        assert.deepEqual(
          investedFunds,
          investedAmount,
          "Invested amount is wrong"
        );

        const investorBalance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        const balanceDiff = INVESTOR_INITIAL_FUNDS.sub(investedAmount);
        assert.deepEqual(
          BigNumber.from(investorBalance),
          balanceDiff,
          "Investors balance is wrong after the investment"
        );
      });

      it("2.2.3 Investor should be able to do a full unpledge", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Request them back
        await expect(investment.connect(investorA).unpledge(1, investedAmount))
          .to.not.be.reverted;

        const investorsBalance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(investorsBalance),
          INVESTOR_INITIAL_FUNDS,
          "Investor's balance should be == initial, after full unpledge"
        );
      });

      it("2.2.4 Investor should be able to do a partial unpledge", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Request half of the funds back
        await expect(
          investment.connect(investorA).unpledge(1, investedAmount.div(2))
        ).to.not.be.reverted;

        const investorsBalance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(investorsBalance),
          INVESTOR_INITIAL_FUNDS.sub(investedAmount.div(2)),
          "Investor's balance should get half of invested funds back"
        );

        const investedLeft = await investment.investedAmount(
          1,
          investorA.address
        );

        assert.deepEqual(
          investedLeft,
          investedAmount.div(2),
          "Half of invested funds should stay in contract"
        );
      });

      it("2.2.5 Investor shouldn't be able to unpledge more than invested", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Request them back, but 1 wei more, should revert
        await expect(
          investment.connect(investorA).unpledge(1, investedAmount.add(1))
        ).to.be.reverted;
      });

      it("2.2.6 Investors should be able to collectively raise the soft cap", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("750");
        // Give token approval Investor A
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Give token approval Investor B
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorB);

        // Invest money
        await expect(investment.connect(investorB).invest(1, investedAmount)).to
          .not.be.reverted;

        const softCapRaised = await investment.isSoftCapReached(1);

        assert.isTrue(softCapRaised);
      });

      it("2.2.7 Non-investor shouldn't be able to unpledge", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Note, the case testing unpledging more than investment is tested separately,
        // here we'll test that unpledging 0 does not change the balance
        await investment.connect(foreignActor).unpledge(1, BigNumber.from(0));

        const balance = await fUSDTx.balanceOf({
          account: foreignActor.address,
          providerOrSigner: foreignActor,
        });

        assert.deepEqual(
          BigNumber.from(balance),
          BigNumber.from(0),
          "Balance was altered by unpledging 0. Foreign actor got funds"
        );
      });

      it("2.2.8 Refund should be inactive during the fundraiser period", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // Try to refund
        await expect(investment.connect(investorA).refund(1)).to.be.reverted;
      });
    });
  });

  describe("3. Failed investment campaigns", () => {
    describe("3.1 Public state", () => {
      it("3.1.1 Campaign should have a failed campaign state for unsuccessful fundraiser", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedCampaign(1);
        assert.equal(
          isFailed,
          true,
          "Fundraiser expired, should have failed state"
        );
      });

      it("3.1.2 Soft cap shouldn't be raised for failed fundraisers", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasRaisedSoftCap = await investment.isSoftCapReached(1);
        assert.equal(
          hasRaisedSoftCap,
          false,
          "Fundraiser expired, isSoftCapReached() should be false"
        );
      });

      it("3.1.3 Fundraiser shouldn't be ongoing for a failed campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow(1);
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be ongoing, since it has failed already"
        );
      });

      it("3.1.4 Fundraiser should have ended for a failed campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd(1);
        assert.equal(
          hasFundraiserEnded,
          true,
          "Fundraiser period should have ended, since campaign has failed already"
        );
      });
    });

    describe("3.2 Interactions", () => {
      it("3.2.1 Should be able to refund assets from a failed campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to refund
        await expect(investment.connect(investorA).refund(1)).to.not.be
          .reverted;

        const balance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(balance),
          INVESTOR_INITIAL_FUNDS,
          "All of the funds from a failed campaign should have returned to the investor"
        );
      });

      it("3.2.2 Should not get anything back if haven't invested", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to refund
        await expect(investment.connect(foreignActor).refund(1)).to.not.be
          .reverted;

        const balance = await fUSDTx.balanceOf({
          account: foreignActor.address,
          providerOrSigner: foreignActor,
        });

        assert.deepEqual(
          BigNumber.from(balance),
          BigNumber.from(0),
          "Foreign actor should not get any funds"
        );
      });

      it("3.2.3 Unpledge shouldn't work on a failed campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const investedAmount: BigNumber = ethers.utils.parseEther("10");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to unpledge
        await expect(investment.connect(investorA).unpledge(1, investedAmount))
          .to.be.reverted;
      });
    });
  });

  describe("4. Successful fundraiser(Milestone period)", () => {
    describe("4.1 Public state", () => {
      it("4.1.1 Campaign shouldn't have a failed campaign state", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedCampaign(1);
        assert.equal(
          isFailed,
          false,
          "Successful campaign should not have a failed state"
        );
      });

      it("4.1.2 Successful campaign should have reached soft cap", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasRaisedSoftCap = await investment.isSoftCapReached(1);
        assert.equal(
          hasRaisedSoftCap,
          true,
          "Successful campaign should have reached a soft cap"
        );
      });

      it("4.1.3 Fundraiser shouldn't be ongoing", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow(1);
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be ongoing for a successful campaign"
        );
      });

      it("4.1.4 Fundraiser period should have ended for a successful campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd(1);
        assert.equal(
          hasFundraiserEnded,
          true,
          "Fundraiser period should have ended for a successful campaign"
        );
      });
    });

    describe("4.2 Interactions", () => {
      it("4.2.1 Investors are unable to unpledge from successful campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.unpledge(1, investedAmount)).to.be.reverted;
      });

      it("4.2.1 Investors are unable to refund from successful campaign", async () => {
        const softCap = ethers.utils.parseEther("1500");
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

        await investment
          .connect(creator)
          .launch(
            softCap,
            milestoneStartDate,
            milestoneEndDate,
            campaignStartDate,
            campaignEndDate
          );

        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Invest more than soft cap here to make sure the campaign is a success
        const investedAmount: BigNumber = ethers.utils.parseEther("2000");
        // Give token approval
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorA);

        // Invest money
        await expect(investment.connect(investorA).invest(1, investedAmount)).to
          .not.be.reverted;

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.refund(1)).to.be.reverted;
      });
      // TODO: Test the ability of campaign creator to start money streaming
      // TODO: Test flowrates
    });
  });

  describe("5. Money streaming corner cases", () => {
    // Test the volunteer termination of streaming by campaign creator
  });

  describe("6. Money stream termination", () => {
    // Test money streaming termination using checker(for example for Gelato)
    // Test money streaming termination with a small window near the end of streaming (to avoid going over budget)
    // Test termination by 3P system (patricians, plebs, pirates) in case we wouldn't stop it in time, what happens then?
  });

  describe("7. Upgradeability", () => {
    // Validate that the storage slots for contract variables don't change their storage slot and offset
    // Validate that struct member order hasn't changed

    it("7.1 Contract storage variables didn't shift during development", async () => {
      await investment.validateStorageLayout();
    });
  });
});
