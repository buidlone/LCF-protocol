import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Framework, WrapperSuperToken } from "@superfluid-finance/sdk-core";
import { BigNumber, ContractTransaction, providers, Contract } from "ethers";
import { ethers, web3, network } from "hardhat";
import { assert, expect } from "chai";
import {
  InvestmentPoolFactoryMock,
  InvestmentPoolMock,
  GelatoOpsMock,
} from "../typechain";
import traveler from "ganache-time-traveler";

// const { toWad } = require("@decentral.ee/web3-helpers");
// const { assert, should, expect } = require("chai");
const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

// Corresponds to each investor having N fUSDTx (fake USDT wrapped into a SuperToken, hence x suffix)
// Should be enough for all of the tests, in order to not perform funding before each
const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");

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

let investors: SignerWithAddress[];

let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investment: InvestmentPoolMock;

let snapshotId: string;

let softCap: BigNumber;
let milestoneStartDate: BigNumber;
let milestoneEndDate: BigNumber;
let campaignStartDate: BigNumber;
let campaignEndDate: BigNumber;

let creationRes: ContractTransaction;
let gelatoOpsMock: GelatoOpsMock;

const errorHandler = (err: any) => {
  if (err) throw err;
};

const getInvestmentFromTx = async (
  tx: ContractTransaction
): Promise<InvestmentPoolMock> => {
  const creationEvent = (await tx.wait(1)).events?.find(
    (e) => e.event === "Created"
  );

  assert.isDefined(creationEvent, "Didn't emit creation event");

  const poolAddress = creationEvent?.args?.pool;

  const contractFactory = await ethers.getContractFactory(
    "InvestmentPoolMock",
    dPatronAdmin
  );

  const pool = contractFactory.attach(poolAddress);

  return pool;
};

const getTimeStamp = async (
  tx: providers.TransactionResponse
): Promise<BigNumber> => {
  const timestamp = (await provider.eth.getBlock(tx.blockHash!)).timestamp;
  return BigNumber.from(timestamp);
};

describe("Investment Pool", async () => {
  before(async () => {
    // get accounts from hardhat
    accounts = await ethers.getSigners();

    admin = accounts[0];
    dPatronAdmin = accounts[1];
    creator = accounts[2];
    investorA = accounts[3];
    investorB = accounts[4];

    foreignActor = accounts[8];
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

    const totalAmount = INVESTOR_INITIAL_FUNDS.mul(investors.length);

    // Fund investors
    await fUSDT.connect(admin).mint(admin.address, totalAmount);
    await fUSDT
      .connect(admin)
      .approve(fUSDTx.address, INVESTOR_INITIAL_FUNDS.mul(investors.length));

    const upgradeOperation = fUSDTx.upgrade({
      amount: totalAmount.toString(),
    });
    const operations = [upgradeOperation];

    // Transfer upgraded tokens to investors
    for (let i = 0; i < investors.length; i++) {
      const operation = fUSDTx.transferFrom({
        sender: admin.address,
        amount: INVESTOR_INITIAL_FUNDS.toString(),
        receiver: investors[i].address,
      });
      operations.push(operation);
    }

    await sf.batchCall(operations).exec(admin);
  });

  beforeEach(async () => {
    softCap = ethers.utils.parseEther("1500");
    milestoneStartDate = BigNumber.from(
      new Date("2022/09/01").getTime() / 1000
    );
    milestoneEndDate = BigNumber.from(new Date("2022/10/01").getTime() / 1000);
    campaignStartDate = BigNumber.from(new Date("2022/07/01").getTime() / 1000);
    campaignEndDate = BigNumber.from(new Date("2022/08/01").getTime() / 1000);

    creationRes = await investmentPoolFactory
      .connect(creator)
      .createInvestmentPool(
        fUSDTx.address,
        softCap,
        campaignStartDate,
        campaignEndDate,
        0, // NON-UPGRADEABLE
        [{ startDate: milestoneStartDate, endDate: milestoneEndDate }]
      );

    investment = await getInvestmentFromTx(creationRes);
  });

  afterEach(async () => {
    // If prior investment exists, check if it has an active money stream, terminate it
    if (investment) {
      const existingFlow = await sf.cfaV1.getFlow({
        superToken: fUSDTx.address,
        sender: investment.address,
        receiver: creator.address,
        providerOrSigner: creator,
      });

      // App is actively streaming money to our creator, terminate that stream
      if (BigNumber.from(existingFlow.flowRate).gt(0)) {
        console.log("TERMINATE FLOW");
        await sf.cfaV1
          .deleteFlow({
            sender: investment.address,
            receiver: creator.address,
            superToken: fUSDTx.address,
          })
          .exec(creator);
      }
    }
  });

  describe("1. Investment creation", () => {
    describe("1.1 Public state", () => {
      it("[IP][1.1.1] Fundraiser shouldn't be ongoing on a fresh campaign if the start date is in the future", async () => {
        // NOTE: At this point we at 2022/06/01
        const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be started if the time is not right"
        );
      });

      it("[IP][1.1.2] Fundraiser shouldn't have a failed fundraiser state on creation", async () => {
        const isFailed = await investment.isFailedFundraiser();
        assert.equal(isFailed, false, "Fresh fundraiser is failed already");
      });

      it("[IP][1.1.3] Fundraiser shouldn't have reached soft cap upon creation", async () => {
        const hasRaisedSoftCap = await investment.isSoftCapReached();
        assert.equal(
          hasRaisedSoftCap,
          false,
          "Fresh fundraiser shouldn't have raised soft cap already"
        );
      });

      it("[IP][1.1.4] Fundraiser shouldn't have ender upon campaign creation", async () => {
        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
        assert.equal(
          hasFundraiserEnded,
          false,
          "Fresh campaign shouldn't have ended fundraiser already"
        );
      });
    });

    describe("1.2 Interactions", () => {
      it("[IP][1.2.1] Can create an investment", async function () {
        const creatorAddress = await investment.creator();
        const invested = await investment.totalInvestedAmount();
        const fundraiserStartAt = await investment.fundraiserStartAt();
        const fundraiserEndAt = await investment.fundraiserEndAt();
        const poolSoftCap = await investment.softCap();
        const milestoneCount = await investment.milestoneCount();
        const milestone = await investment.milestones(0);

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

      it("[IP][1.2.2] Campaign can be cancelled if it's not started yet", async () => {
        // Enforce a timestamp before campaign start
        const time = new Date("2022/06/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(investment.connect(creator).cancel()).to.emit(
          investment,
          "Cancel"
        );
      });

      it("[IP][1.2.3] Campaign can't be cancelled by anyone, except creator", async () => {
        // Enforce a timestamp before campaign start
        const time = new Date("2022/06/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(
          investment.connect(foreignActor).cancel()
        ).to.be.revertedWith("[IP]: not creator");

        await expect(investment.connect(creator).cancel()).to.emit(
          investment,
          "Cancel"
        );
      });

      it("[IP][1.2.4] Campaign can't be cancelled, if it's already started", async () => {
        // Fundraiser has already started by now
        const time = new Date("2022/07/15").getTime() / 1000;
        await investment
          .connect(dPatronAdmin)
          .setTimestamp(BigNumber.from(time));

        await expect(investment.connect(creator).cancel()).to.be.revertedWith(
          "[IP]: campaign started already"
        );
      });
    });

    // Test public campaigns states to ensure they are correct
    // (failed campaign, soft cap, etc)
  });

  describe("2. Fundraiser", () => {
    describe("2.1 Public state", () => {
      it("[IP][2.1.1] Fundraiser should be ongoing if the starting date has passed", async () => {
        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
        assert.equal(
          isFundraiserOngoing,
          true,
          "Fundraiser be started already"
        );
      });

      it("[IP][2.1.2] Campaign shouldn't have a failed state during active fundraiser", async () => {
        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedFundraiser();
        assert.equal(
          isFailed,
          false,
          "Campaign shouldn't have a failed state during the fundraiser period"
        );
      });

      it("[IP][2.1.3] Campaign shouldn't have a soft cap raised initially after the fundraiser start", async () => {
        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isSoftCapReached = await investment.isSoftCapReached();
        assert.equal(
          isSoftCapReached,
          false,
          "Campaign shouldn't have a soft cap raised initially after the fundraiser start"
        );
      });

      it("[IP][2.1.4] Fundraiser period shouldn't have ended yet", async () => {
        // NOTE: Time traveling to 2022/07/15
        const timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
        assert.equal(
          hasFundraiserEnded,
          false,
          "Fundraiser period shouldn't have ended yet"
        );
      });
    });
    describe("2.2 Interactions", () => {
      it("[IP][2.2.1] Investors should not be able to invest before the fundraiser period", async () => {
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

        await expect(
          investment.connect(investorA).invest(investedAmount)
        ).to.be.revertedWith("[IP]: not in fundraiser period");
      });

      it("[IP][2.2.2] Investors should be able to invest money", async () => {
        const investorPriorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: investorA.address,
            providerOrSigner: investorA,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        const investedFunds = await investment.investedAmount(
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

        const balanceDiff = investorPriorBalance.sub(investedAmount);
        assert.deepEqual(
          BigNumber.from(investorBalance),
          balanceDiff,
          "Investors balance is wrong after the investment"
        );
      });

      it("[IP][2.2.3] Investor should be able to do a full unpledge", async () => {
        const investorPriorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: investorA.address,
            providerOrSigner: investorA,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Request them back
        await expect(investment.connect(investorA).unpledge(investedAmount))
          .to.emit(investment, "Unpledge")
          .withArgs(investorA.address, investedAmount);

        const investorsBalance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(investorsBalance),
          investorPriorBalance,
          "Investor's balance should be == initial, after full unpledge"
        );
      });

      it("[IP][2.2.4] Investor should be able to do a partial unpledge", async () => {
        const investorPriorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: investorA.address,
            providerOrSigner: investorA,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Request half of the funds back
        await expect(
          investment.connect(investorA).unpledge(investedAmount.div(2))
        )
          .to.emit(investment, "Unpledge")
          .withArgs(investorA.address, investedAmount.div(2));

        const investorsBalance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(investorsBalance),
          investorPriorBalance.sub(investedAmount.div(2)),
          "Investor's balance should get half of invested funds back"
        );

        const investedLeft = await investment.investedAmount(investorA.address);

        assert.deepEqual(
          investedLeft,
          investedAmount.div(2),
          "Half of invested funds should stay in contract"
        );
      });

      it("[IP][2.2.5] Investor shouldn't be able to unpledge more than invested", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Request them back, but 1 wei more, should revert
        await expect(
          investment.connect(investorA).unpledge(investedAmount.add(1))
        ).to.be.revertedWith("[IP]: amount > invested");
      });

      it("[IP][2.2.6] Investors should be able to collectively raise the soft cap", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Give token approval Investor B
        await fUSDTx
          .approve({
            receiver: investment.address,
            // Max value here to test if contract attempts something out of line
            amount: UINT256_MAX.toString(),
          })
          .exec(investorB);

        // Invest money
        await expect(investment.connect(investorB).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorB.address, investedAmount);

        const softCapRaised = await investment.isSoftCapReached();

        assert.isTrue(softCapRaised);
      });

      it("[IP][2.2.7] Non-investor shouldn't be able to unpledge", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Note, the case testing unpledging more than investment is tested separately,
        // here we'll test that unpledging 0 does not change the balance
        await expect(
          investment.connect(foreignActor).unpledge(BigNumber.from(0))
        )
          .to.emit(investment, "Unpledge")
          .withArgs(foreignActor.address, BigNumber.from(0));

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

      it("[IP][2.2.8] Refund should be inactive during the fundraiser period", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // Try to refund
        await expect(investment.connect(investorA).refund()).to.be.revertedWith(
          "[IP]: is not a failed campaign"
        );
      });
    });
  });

  describe("3. Failed investment campaigns", () => {
    describe("3.1 Public state", () => {
      it("[IP][3.1.1] Campaign should have a failed campaign state for unsuccessful fundraiser", async () => {
        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedFundraiser();
        assert.equal(
          isFailed,
          true,
          "Fundraiser expired, should have failed state"
        );
      });

      it("[IP][3.1.2] Soft cap shouldn't be raised for failed fundraisers", async () => {
        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasRaisedSoftCap = await investment.isSoftCapReached();
        assert.equal(
          hasRaisedSoftCap,
          false,
          "Fundraiser expired, isSoftCapReached() should be false"
        );
      });

      it("[IP][3.1.3] Fundraiser shouldn't be ongoing for a failed campaign", async () => {
        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be ongoing, since it has failed already"
        );
      });

      it("[IP][3.1.4] Fundraiser should have ended for a failed campaign", async () => {
        // No one invests, let the fundraiser expire

        // NOTE: Time traveling to 2022/08/15
        const timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
        assert.equal(
          hasFundraiserEnded,
          true,
          "Fundraiser period should have ended, since campaign has failed already"
        );
      });
    });

    describe("3.2 Interactions", () => {
      it("[IP][3.2.1] Should be able to refund assets from a failed campaign", async () => {
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

        const investorPriorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: investorA.address,
            providerOrSigner: investorA,
          })
        );

        // Invest money
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to refund
        await expect(investment.connect(investorA).refund())
          .to.emit(investment, "Refund")
          .withArgs(investorA.address, investedAmount);

        const balance = await fUSDTx.balanceOf({
          account: investorA.address,
          providerOrSigner: investorA,
        });

        assert.deepEqual(
          BigNumber.from(balance),
          investorPriorBalance,
          "All of the funds from a failed campaign should have returned to the investor"
        );
      });

      it("[IP][3.2.2] Should not be able to get back anything if haven't invested", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to refund
        await expect(
          investment.connect(foreignActor).refund()
        ).to.be.revertedWith("[IP]: no money invested");
      });

      it("[IP][3.2.3] Unpledge shouldn't work on a failed campaign", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        // Try to unpledge
        await expect(
          investment.connect(investorA).unpledge(investedAmount)
        ).to.be.revertedWith("[IP]: not in fundraiser period");
      });
    });
  });

  describe("4. Successful fundraiser(Milestone period)", () => {
    describe("4.1 Public state", () => {
      it("[IP][4.1.1] Campaign shouldn't have a failed campaign state", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFailed = await investment.isFailedFundraiser();
        assert.equal(
          isFailed,
          false,
          "Successful fundraiser should not have a failed state"
        );
      });

      it("[IP][4.1.2] Successful campaign should have reached soft cap", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasRaisedSoftCap = await investment.isSoftCapReached();
        assert.equal(
          hasRaisedSoftCap,
          true,
          "Successful campaign should have reached a soft cap"
        );
      });

      it("[IP][4.1.3] Fundraiser shouldn't be ongoing", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
        assert.equal(
          isFundraiserOngoing,
          false,
          "Fundraiser shouldn't be ongoing for a successful campaign"
        );
      });

      it("[IP][4.1.4] Fundraiser period should have ended for a successful campaign", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
        assert.equal(
          hasFundraiserEnded,
          true,
          "Fundraiser period should have ended for a successful campaign"
        );
      });
    });

    describe("4.2 Interactions", () => {
      beforeEach(async () => {
        let snapshot = await traveler.takeSnapshot();
        snapshotId = snapshot["result"];
      });

      afterEach(async () => {
        await traveler.revertToSnapshot(snapshotId);
      });
      it("[IP][4.2.1] Investors are unable to unpledge from successful campaign", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.unpledge(investedAmount)).to.be.revertedWith(
          "[IP]: not in fundraiser period"
        );
      });

      it("[IP][4.2.2] Investors are unable to refund from successful campaign", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;

        await investment.setTimestamp(timeStamp);

        await expect(investment.refund()).to.be.revertedWith(
          "[IP]: is not a failed campaign"
        );
      });

      it("[IP][4.2.3] Creator should be able to start money streaming to their account", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);
      });

      it("[IP][4.2.4] Creator shouldn't be able to start money streaming to their account before milestone starts", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/08/15 when the fundraiser ends
        timeStamp = new Date("2022/08/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.connect(creator).claim(1)).to.be.revertedWith(
          "[IP]: milestone still locked"
        );
      });

      it("[IP][4.2.5] Double claim is prevented", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        // Try to double claim
        await expect(investment.connect(creator).claim(0)).to.be.revertedWith(
          "[IP]: already streaming for this milestone"
        );
      });

      it("[IP][4.2.6] Creates a stream of funds on claim", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        const votingPeriod = BigNumber.from(await investment.votingPeriod());

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await traveler.advanceBlockAndSetTime(timeStamp);
        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        // NOTE: even though we cannot get precise time with the traveler,
        // the investment contract itself creates flowrate, and uses the timestamp that was passed to it
        // So it's ok to make calculations using it
        // Calculate the desired flowrate, should match the one from contract
        const timeLeft = milestoneEndDate.add(votingPeriod).sub(timeStamp);
        const flowRate = investedAmount.div(timeLeft);

        const flowInfo = await sf.cfaV1.getFlow({
          superToken: fUSDTx.address,
          sender: investment.address,
          receiver: creator.address,
          providerOrSigner: creator,
        });

        assert.isDefined(flowInfo);

        assert.deepEqual(
          BigNumber.from(flowInfo.flowRate),
          flowRate,
          "Flow Rate must match the predicted one"
        );
      });

      it("[IP][4.2.7] Storage variables are updated on claim", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const milestone = await investment.milestones(0);

        assert.equal(
          milestone.streamOngoing,
          true,
          "milestone's stream should be ongoing"
        );
      });

      it("[IP][4.2.8] Only the creator should be able to call claim function", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        await expect(
          investment.connect(foreignActor).claim(0)
        ).to.be.revertedWith("[IP]: not creator");
        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);
      });

      // TODO: Test multiple milestones (distribution of funds)
    });
  });

  describe("5. Money streaming corner cases", () => {
    describe("5.1 Interactions", () => {
      beforeEach(async () => {
        let snapshot = await traveler.takeSnapshot();
        snapshotId = snapshot["result"];
      });

      afterEach(async () => {
        await traveler.revertToSnapshot(snapshotId);
      });

      it("[IP][5.1.1] Volunteer stopping of streamed funds updates records", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        timeStamp = new Date("2022/09/16").getTime() / 1000;
        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // NOTE: we are implicitly testing the SuperApp callback here
        // we want to find out, what happens if the flow is voluntarily terminated by the creator
        await sf.cfaV1
          .deleteFlow({
            superToken: fUSDTx.address,
            sender: investment.address,
            receiver: creator.address,
          })
          .exec(creator);

        const creatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        );

        const milestone = await investment.milestones(0);
        const paidAmount = milestone.paidAmount;

        assert.deepEqual(
          paidAmount,
          creatorBalance.sub(initialCreatorBalance),
          "Streamed balance and stored record should match"
        );

        assert.equal(
          milestone.paid,
          false,
          "Partial stream should not be paid yet"
        );
      });

      it("[IP][5.1.2] (Callback)Volunteer stopping during termination window instantly transfers the rest of funds", async () => {
        // NOTE: Time traveling to 2022/07/15
        let timeStamp = new Date("2022/07/15").getTime() / 1000;
        await investment.setTimestamp(timeStamp);

        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        );

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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const terminationWindow = BigNumber.from(
          await investment.terminationWindow()
        );

        const votingPeriod = await BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );

        // Let's make sure we are in the termination window
        // It is sometime at the end of a voting period
        timeStamp = milestoneEndDate
          .add(votingPeriod)
          .sub(terminationWindow.div(2))
          .toNumber();
        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // NOTE: we are implicitly testing the SuperApp callback here
        // we want to find out, what happens if the flow is voluntarily terminated by the creator
        await sf.cfaV1
          .deleteFlow({
            superToken: fUSDTx.address,
            sender: investment.address,
            receiver: creator.address,
          })
          .exec(creator);

        const creatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        );

        const milestone = await investment.milestones(0);
        const paidAmount = milestone.paidAmount;

        assert.deepEqual(
          paidAmount,
          creatorBalance.sub(initialCreatorBalance),
          "Streamed balance and stored record should match"
        );

        assert.equal(
          milestone.paid,
          true,
          "Milestone should be fully paid by now"
        );

        assert.deepEqual(
          creatorBalance.sub(initialCreatorBalance),
          investedAmount,
          "should transfer all of the funds during the termination"
        );
      });

      it("[IP][5.1.3] Should claim instantly after milestone end", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/10/15 when the milestone has ended
        timeStamp = new Date("2022/10/15").getTime() / 1000;

        // NOTE: testing with just contract timestamp is fine, cause it tests internal logic
        await investment.setTimestamp(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const creatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        );

        const milestone = await investment.milestones(0);
        const paidAmount = milestone.paidAmount;

        assert.deepEqual(
          paidAmount,
          creatorBalance.sub(initialCreatorBalance),
          "Streamed balance and stored record should match"
        );

        assert.deepEqual(
          creatorBalance.sub(initialCreatorBalance),
          investedAmount,
          "Should transfer all of the funds to the creator"
        );

        assert.equal(milestone.paid, true, "Should mark milestone as paid");
      });

      it("[IP][5.1.4] Should be able to pause the stream and resume later", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        const votingPeriod = BigNumber.from(await investment.votingPeriod());

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        // Advance in time a little
        timeStamp = new Date("2022/09/20").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // NOTE: we are implicitly testing the SuperApp callback here
        // we want to find out, what happens if the flow is voluntarily stopped by the creator
        await sf.cfaV1
          .deleteFlow({
            superToken: fUSDTx.address,
            sender: investment.address,
            receiver: creator.address,
          })
          .exec(creator);

        const streamedSoFar = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        ).sub(initialCreatorBalance);

        // Advance in time a little
        timeStamp = new Date("2022/09/25").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const flowInfo = await sf.cfaV1.getFlow({
          superToken: fUSDTx.address,
          sender: investment.address,
          receiver: creator.address,
          providerOrSigner: creator,
        });
        assert.isDefined(flowInfo);

        // Calculate the desired flowrate, should match the one from contract
        // Use the timestamp source from the flow info for precision
        const timeLeft = milestoneEndDate
          .add(votingPeriod)
          .sub(flowInfo.timestamp.getTime() / 1000);
        const flowRate = investedAmount.sub(streamedSoFar).div(timeLeft);

        assert.deepEqual(
          BigNumber.from(flowInfo.flowRate),
          flowRate,
          "Flow Rate must match the predicted one"
        );
      });

      it("[IP][5.1.5] Should be able to pause the stream, resume later, get terminated", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        const votingPeriod = BigNumber.from(await investment.votingPeriod());

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        // Advance in time a little
        timeStamp = new Date("2022/09/20").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // NOTE: we are implicitly testing the SuperApp callback here
        // we want to find out, what happens if the flow is voluntarily stopped by the creator
        await sf.cfaV1
          .deleteFlow({
            superToken: fUSDTx.address,
            sender: investment.address,
            receiver: creator.address,
          })
          .exec(creator);

        // Advance in time a little
        timeStamp = new Date("2022/09/25").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const terminationWindow = BigNumber.from(
          await investment.terminationWindow()
        );

        // Let's make sure we are in the termination window
        // It is sometime at the end of a voting period
        timeStamp = milestoneEndDate
          .add(votingPeriod)
          .sub(terminationWindow.div(2))
          .toNumber();

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.terminateMilestoneStreamFinal(0)).to.not.be
          .reverted;

        const milestone = await investment.milestones(0);

        const creatorBalance = await fUSDTx.balanceOf({
          account: creator.address,
          providerOrSigner: creator,
        });

        assert.deepEqual(
          BigNumber.from(creatorBalance).sub(initialCreatorBalance),
          investedAmount,
          "Should transfer all of the funds to the creator"
        );

        assert.deepEqual(
          milestone.paidAmount,
          investedAmount,
          "Paid amount should match the invested amount"
        );

        assert.equal(
          milestone.paid,
          true,
          "Milestone should be marked as paid by now"
        );
      });

      it("[IP][5.1.6] (Callback)Should be able to pause the stream, resume later, get terminated", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        const votingPeriod = BigNumber.from(await investment.votingPeriod());

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        // Advance in time a little
        timeStamp = new Date("2022/09/20").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // NOTE: we are implicitly testing the SuperApp callback here
        // we want to find out, what happens if the flow is voluntarily stopped by the creator
        await sf.cfaV1
          .deleteFlow({
            superToken: fUSDTx.address,
            sender: investment.address,
            receiver: creator.address,
          })
          .exec(creator);

        // Advance in time a little
        timeStamp = new Date("2022/09/25").getTime() / 1000;

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const terminationWindow = BigNumber.from(
          await investment.terminationWindow()
        );

        // Let's make sure we are in the termination window
        // It is sometime at the end of a voting period
        timeStamp = milestoneEndDate
          .add(votingPeriod)
          .sub(terminationWindow.div(2))
          .toNumber();

        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await sf.cfaV1
          .deleteFlow({
            receiver: creator.address,
            sender: investment.address,
            superToken: fUSDTx.address,
          })
          .exec(creator);

        const milestone = await investment.milestones(0);

        const creatorBalance = await fUSDTx.balanceOf({
          account: creator.address,
          providerOrSigner: creator,
        });

        assert.deepEqual(
          BigNumber.from(creatorBalance).sub(initialCreatorBalance),
          investedAmount,
          "Should transfer all of the funds to the creator"
        );

        assert.deepEqual(
          milestone.paidAmount,
          investedAmount,
          "Paid amount should match the invested amount"
        );

        assert.equal(
          milestone.paid,
          true,
          "Milestone should be marked as paid by now"
        );
      });

      // TODO: Test the ovestream case during a single milestone, probably results in internal contract undeflow, need to confirm
    });
  });

  describe("6. Money stream termination", () => {
    describe("6.1 Interactions", () => {
      beforeEach(async () => {
        let snapshot = await traveler.takeSnapshot();
        snapshotId = snapshot["result"];
      });

      afterEach(async () => {
        await traveler.revertToSnapshot(snapshotId);
      });
      it("[IP][6.1.1] Anyone can stop milestone during termination window, it instantly transfers the rest of funds", async () => {
        const initialCreatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const terminationWindow = BigNumber.from(
          await investment.terminationWindow()
        );

        const votingPeriod = await BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );

        // Let's make sure we are in the termination window
        // It is sometime at the end of a voting period
        timeStamp = milestoneEndDate
          .add(votingPeriod)
          .sub(terminationWindow.div(2))
          .toNumber();
        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(
          investment
            .connect(foreignActor) // Anyone can terminate it, no access rights needed
            .terminateMilestoneStreamFinal(0)
        ).to.not.be.reverted;

        const creatorBalance = BigNumber.from(
          await fUSDTx.balanceOf({
            account: creator.address,
            providerOrSigner: creator,
          })
        );

        const milestone = await investment.milestones(0);
        const paidAmount = milestone.paidAmount;

        assert.deepEqual(
          paidAmount,
          creatorBalance.sub(initialCreatorBalance),
          "Streamed balance and stored record should match"
        );

        assert.equal(
          milestone.paid,
          true,
          "Milestone should be fully paid by now"
        );

        assert.deepEqual(
          creatorBalance.sub(initialCreatorBalance),
          investedAmount,
          "Should transfer all of the funds during the termination"
        );
      });

      it("[IP][6.1.2] gelatoChecker should not pass if not in auto termination window", async () => {
        const { canExec } = await investment.callStatic.gelatoChecker();

        assert.equal(canExec, false);
      });

      it("[IP][6.1.3] gelatoChecker should pass if in auto termination window", async () => {
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
        await expect(investment.connect(investorA).invest(investedAmount))
          .to.emit(investment, "Invest")
          .withArgs(investorA.address, investedAmount);

        // NOTE: Time traveling to 2022/09/15 when the milestone is active
        timeStamp = new Date("2022/09/15").getTime() / 1000;

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        await expect(investment.connect(creator).claim(0))
          .to.emit(investment, "Claim")
          .withArgs(0);

        const automatedTerminationWindow = BigNumber.from(
          await investment.automatedTerminationWindow()
        );

        const votingPeriod = await BigNumber.from(
          await investmentPoolFactory.VOTING_PERIOD()
        );

        // Let's make sure we are in the automated termination window
        // It is sometime at the end of a voting period
        timeStamp = milestoneEndDate
          .add(votingPeriod)
          .sub(automatedTerminationWindow.div(2))
          .toNumber();

        // NOTE: Here we we want explicitly the chain reported time
        await investment.setTimestamp(0);
        await traveler.advanceBlockAndSetTime(timeStamp);

        // Call gelatoChecker and return value (not the transaction)
        const { canExec } = await investment.callStatic.gelatoChecker();

        assert.equal(canExec, true);
      });
    });
    // TODO: Test termination by 3P system (patricians, plebs, pirates) in case we wouldn't stop it in time, what happens then?
  });

  describe("7. Governance", () => {
    // TODO: Test milestone unlocking, once governance is in place
  });

  describe("8. Upgradeability", () => {
    // Validate that the storage slots for contract variables don't change their storage slot and offset
    // Validate that struct member order hasn't changed
    // it("8.1 Contract storage variables didn't shift during development", async () => {
    //   await investment.validateStorageLayout();
    // });
  });
});
