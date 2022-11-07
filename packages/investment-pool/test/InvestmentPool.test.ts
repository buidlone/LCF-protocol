import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GelatoOpsMock,
    GovernancePoolMockForIntegration,
} from "../typechain-types";
import traveler from "ganache-time-traveler";

const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

// Corresponds to each investor having N fUSDTx (fake USDT wrapped into a SuperToken, hence x suffix)
// Should be enough for all of the tests, in order to not perform funding before each
const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");

const UINT256_MAX = constants.MaxUint256;

const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;

let investors: SignerWithAddress[];

let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investment: InvestmentPoolMock;
let governancePoolMock: GovernancePoolMockForIntegration;

let snapshotId: string;

let softCap: BigNumber;
let hardCap: BigNumber;
let milestoneStartDate: BigNumber;
let milestoneEndDate: BigNumber;
let milestoneStartDate2: BigNumber;
let milestoneEndDate2: BigNumber;
let campaignStartDate: BigNumber;
let campaignEndDate: BigNumber;

let creationRes: ContractTransaction;
let gelatoOpsMock: GelatoOpsMock;

let gelatoFeeAllocation: BigNumber;
let investmentWithdrawFee: BigNumber;
let ethAddress: string;

// Percentages (in divider format)
let percentageDivider: BigNumber = BigNumber.from(0);
let percent5InIpBigNumber: BigNumber;
let percent20InIpBigNumber: BigNumber;
let percent25InIpBigNumber: BigNumber;
let percent70InIpBigNumber: BigNumber;
let percent95InIpBigNumber: BigNumber;

// Project state values
let canceledProjectStateValue: BigNumber;
let beforeFundraiserStateValue: BigNumber;
let fundraiserOngoingStateValue: BigNumber;
let failedFundraiserStateValue: BigNumber;
let fundraiserEndedNoMilestonesOngoingStateValue: BigNumber;
let milestonesOngoingBeforeLastStateValue: BigNumber;
let lastMilestoneOngoingStateValue: BigNumber;
let terminatedByVotingStateValue: BigNumber;
let terminatedByGelatoStateValue: BigNumber;
let successfullyEndedStateValue: BigNumber;
let unknownStateValue: BigNumber;

// Multipliers
let privateFundingMultiplier: BigNumber;
let publicFundingMultiplier: BigNumber;

const percentToIpBigNumber = (percent: number): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const getInvestmentFromTx = async (tx: ContractTransaction): Promise<InvestmentPoolMock> => {
    const creationEvent = (await tx.wait(1)).events?.find((e) => e.event === "Created");

    assert.isDefined(creationEvent, "Didn't emit creation event");

    const poolAddress = creationEvent?.args?.pool;

    const contractFactory = await ethers.getContractFactory("InvestmentPoolMock", buidl1Admin);

    const pool = contractFactory.attach(poolAddress);

    return pool;
};

const dateToSeconds = (date: string, isBigNumber: boolean = true): BigNumber | number => {
    const convertedDate = new Date(date).getTime() / 1000;
    if (isBigNumber) {
        return BigNumber.from(convertedDate);
    } else {
        return convertedDate;
    }
};

const definePercentageDivider = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    percentageDivider = await investmentPoolFactory.getPercentageDivider();
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent20InIpBigNumber = percentToIpBigNumber(20);
    percent25InIpBigNumber = percentToIpBigNumber(25);
    percent70InIpBigNumber = percentToIpBigNumber(70);
    percent95InIpBigNumber = percentToIpBigNumber(95);
};

const defineProjectStateByteValues = async (investment: InvestmentPoolMock) => {
    canceledProjectStateValue = await investment.getCanceledProjectStateValue();
    beforeFundraiserStateValue = await investment.getBeforeFundraiserStateValue();
    fundraiserOngoingStateValue = await investment.getFundraiserOngoingStateValue();
    failedFundraiserStateValue = await investment.getFailedFundraiserStateValue();
    fundraiserEndedNoMilestonesOngoingStateValue =
        await investment.getFundraiserEndedNoMilestonesOngoingStateValue();
    milestonesOngoingBeforeLastStateValue =
        await investment.getMilestonesOngoingBeforeLastStateValue();
    lastMilestoneOngoingStateValue = await investment.getLastMilestoneOngoingStateValue();
    terminatedByVotingStateValue = await investment.getTerminatedByVotingStateValue();
    terminatedByGelatoStateValue = await investment.getTerminatedByGelatoStateValue();
    successfullyEndedStateValue = await investment.getSuccessfullyEndedStateValue();
    unknownStateValue = await investment.getUnknownStateValue();
};

const defineGelatoFeeAllocation = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    gelatoFeeAllocation = await investmentPoolFactory.getGelatoFeeAllocationForProject();
};

const defineInvestmentWithdrawFee = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    investmentWithdrawFee = await investmentPoolFactory.getInvestmentWithdrawPercentageFee();
};

const defineEthAddress = async (investmentPool: InvestmentPoolMock) => {
    ethAddress = await investmentPool.getEthAddress();
};

const defineMultipliers = async (investmentPoolFactory: InvestmentPoolFactoryMock) => {
    privateFundingMultiplier = await investmentPoolFactory.getPrivateFundingMultiplier();
    publicFundingMultiplier = await investmentPoolFactory.getPublicFundingMultiplier();
};

const deployGovernancePoolMock = async () => {
    const governancePoolFactory = await ethers.getContractFactory(
        "GovernancePoolMockForIntegration",
        buidl1Admin
    );
    governancePoolMock = await governancePoolFactory.deploy();
    await governancePoolMock.deployed();
};

const createInvestmentWithTwoMilestones = async (feeAmount: BigNumber = gelatoFeeAllocation) => {
    hardCap = ethers.utils.parseEther("15000");
    softCap = ethers.utils.parseEther("1500");
    milestoneStartDate = dateToSeconds("2100/09/01") as BigNumber;
    milestoneEndDate = dateToSeconds("2100/10/01") as BigNumber;
    milestoneStartDate2 = dateToSeconds("2100/10/01") as BigNumber;
    milestoneEndDate2 = dateToSeconds("2100/12/01") as BigNumber;
    campaignStartDate = dateToSeconds("2100/07/01") as BigNumber;
    campaignEndDate = dateToSeconds("2100/08/01") as BigNumber;

    creationRes = await investmentPoolFactory.connect(creator).createInvestmentPool(
        fUSDTx.address,
        softCap,
        hardCap,
        campaignStartDate,
        campaignEndDate,
        0, // CLONE-PROXY
        [
            {
                startDate: milestoneStartDate,
                endDate: milestoneEndDate,
                intervalSeedPortion: percent5InIpBigNumber,
                intervalStreamingPortion: percent70InIpBigNumber,
            },
            {
                startDate: milestoneStartDate2,
                endDate: milestoneEndDate2,
                intervalSeedPortion: percent5InIpBigNumber,
                intervalStreamingPortion: percent20InIpBigNumber,
            },
        ],
        {value: feeAmount}
    );

    investment = await getInvestmentFromTx(creationRes);
};

const investMoney = async (
    fUSDTxToken: WrapperSuperToken,
    investmentPool: InvestmentPoolMock,
    investorObj: SignerWithAddress,
    investedMoney: BigNumber
) => {
    // Give token approval
    await fUSDTxToken
        .approve({
            receiver: investmentPool.address,
            amount: UINT256_MAX.toString(),
        })
        .exec(investorObj);

    // Invest money
    await investmentPool.connect(investorObj).invest(investedMoney, false);
};

const timeTravelToDate = async (date: number | BigNumber) => {
    if (date instanceof BigNumber) {
        date = date.toNumber();
    }
    await traveler.advanceBlockAndSetTime(date);
};

const timeTravelByIncreasingSeconds = async (seconds: number | BigNumber) => {
    if (seconds instanceof BigNumber) {
        seconds = seconds.toNumber();
    }
    await traveler.advanceTimeAndBlock(seconds);
};

describe("Investment Pool", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();

        admin = accounts[0];
        buidl1Admin = accounts[1];
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

        sf = await Framework.create({
            resolverAddress: process.env.RESOLVER_ADDRESS,
            chainId: 31337,
            provider,
            protocolReleaseVersion: "test",
        });

        // Create and deploy Gelato Ops contract mock
        const GelatoOpsMock = await ethers.getContractFactory("GelatoOpsMock", buidl1Admin);
        gelatoOpsMock = await GelatoOpsMock.deploy();
        await gelatoOpsMock.deployed();

        fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");

        const underlyingAddr = fUSDTx.underlyingToken.address;

        fUSDT = new ethers.Contract(underlyingAddr, fTokenAbi, admin);

        // Create investment pool implementation contract
        const investmentPoolDep = await ethers.getContractFactory(
            "InvestmentPoolMock",
            buidl1Admin
        );

        const investmentPool = await investmentPoolDep.deploy();
        await investmentPool.deployed();

        // Create investment pool factory contract
        const investmentPoolDepFactory = await ethers.getContractFactory(
            "InvestmentPoolFactoryMock",
            buidl1Admin
        );

        investmentPoolFactory = await investmentPoolDepFactory.deploy(
            sf.settings.config.hostAddress,
            gelatoOpsMock.address,
            investmentPool.address
        );
        await investmentPoolFactory.deployed();

        // Assign governance pool
        await deployGovernancePoolMock();
        await investmentPoolFactory
            .connect(buidl1Admin)
            .setGovernancePool(governancePoolMock.address);

        // Get percentage divider and byte values from contract constant variables
        await definePercentageDivider(investmentPoolFactory);
        await defineGelatoFeeAllocation(investmentPoolFactory);
        await defineProjectStateByteValues(investmentPool);
        await defineEthAddress(investmentPool);
        await defineInvestmentWithdrawFee(investmentPoolFactory);
        await defineMultipliers(investmentPoolFactory);

        // Enforce a starting timestamp to avoid time based bugs
        const time = dateToSeconds("2100/06/01");
        await investmentPoolFactory.setTimestamp(time);

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
        await createInvestmentWithTwoMilestones();
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

    describe("1. Investment pool creation", () => {
        describe("1.1 Public state", () => {
            it("[IP][1.1.1] Should assign accepted token correctly", async () => {
                const acceptedToken = await investment.getAcceptedToken();
                assert.equal(fUSDTx.address, acceptedToken, "Token addresses are not the same");
            });

            it("[IP][1.1.2] Should assign creator correctly", async () => {
                const contractCreator = await investment.getCreator();
                assert.equal(creator.address, contractCreator);
            });

            it("[IP][1.1.3] Should assign gelato ops correctly", async () => {
                const contractGelatoOps = await investment.getGelatoOps();
                assert.equal(gelatoOpsMock.address, contractGelatoOps);
            });

            it("[IP][1.1.4] Should assign soft cap correctly", async () => {
                const contractSoftCap = await investment.getSoftCap();
                assert.deepEqual(softCap, contractSoftCap);
            });

            it("[IP][1.1.5] Should assign hard cap correctly", async () => {
                const contractHardCap = await investment.getHardCap();
                assert.deepEqual(hardCap, contractHardCap);
            });

            it("[IP][1.1.6] Should assign fundraiser start time correctly", async () => {
                const contractFundraiserStart = BigNumber.from(
                    await investment.getFundraiserStartTime()
                );
                assert.deepEqual(campaignStartDate, contractFundraiserStart);
            });

            it("[IP][1.1.7] Should assign fundraiser end time correctly", async () => {
                const contractFundraiserEnd = BigNumber.from(
                    await investment.getFundraiserEndTime()
                );
                assert.deepEqual(campaignEndDate, contractFundraiserEnd);
            });

            it("[IP][1.1.8] Should assign termination window correctly", async () => {
                const contractTermination = await investment.getTerminationWindow();
                const realTermination = await investmentPoolFactory.getTerminationWindow();

                assert.deepEqual(realTermination, contractTermination);
            });

            it("[IP][1.1.9] Should assign automated termination window correctly", async () => {
                const contractTermination = await investment.getAutomatedTerminationWindow();
                const realTermination =
                    await investmentPoolFactory.getAutomatedTerminationWindow();

                assert.equal(realTermination, contractTermination);
            });

            it("[IP][1.1.10] Should assign milestones count correctly", async () => {
                const contractCount = await investment.getMilestonesCount();
                const realCount = BigNumber.from(2);
                assert.deepEqual(contractCount, realCount);
            });

            it("[IP][1.1.11] Should assign current milestone to zero", async () => {
                const contractCurrentMilestone = await investment.getCurrentMilestoneId();
                const realMilestone = BigNumber.from(0);
                assert.deepEqual(contractCurrentMilestone, realMilestone);
            });

            it("[IP][1.1.12] Fundraiser shouldn't be terminated with emergency on a fresh campaign", async () => {
                const isEmergencyTerminated = await investment.isEmergencyTerminated();
                assert.isFalse(isEmergencyTerminated);
            });

            it("[IP][1.1.13] Fundraiser shouldn't be ongoing on a fresh campaign if the start date is in the future", async () => {
                // NOTE: At this point we at 2100/06/01
                const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
                assert.isFalse(isFundraiserOngoing);
            });

            it("[IP][1.1.14] Fundraiser shouldn't have reached soft cap upon creation", async () => {
                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.isFalse(hasRaisedSoftCap);
            });

            it("[IP][1.1.15] Fundraiser shouldn't have ended upon campaign creation", async () => {
                const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
                assert.isFalse(hasFundraiserEnded);
            });

            it("[IP][1.1.16] Fundraiser shouldn't have a failed fundraiser state on creation", async () => {
                const isFailed = await investment.isFailedFundraiser();
                assert.isFalse(isFailed);
            });

            it("[IP][1.1.17] Fundraiser shouldn't have any investments yet", async () => {
                const invested = await investment.getTotalInvestedAmount();
                assert.deepEqual(invested, BigNumber.from(0));
            });

            it("[IP][1.1.18] Milestones should have a correct start date", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.deepEqual(BigNumber.from(milestone1.startDate), milestoneStartDate);
                assert.deepEqual(BigNumber.from(milestone2.startDate), milestoneStartDate2);
            });

            it("[IP][1.1.19] Milestones should have a correct end date", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.deepEqual(BigNumber.from(milestone1.endDate), milestoneEndDate);
                assert.deepEqual(BigNumber.from(milestone2.endDate), milestoneEndDate2);
            });

            it("[IP][1.1.20] Milestones should not be paid initially", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.isFalse(milestone1.paid);
                assert.isFalse(milestone2.paid);
            });

            it("[IP][1.1.21] Milestones' seed amounts should not be paid initially", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.isFalse(milestone1.seedAmountPaid);
                assert.isFalse(milestone2.seedAmountPaid);
            });

            it("[IP][1.1.22] Milestones' streams should not be ongoing from the start", async () => {
                const milestones1 = await investment.getMilestone(0);
                const milestones2 = await investment.getMilestone(1);
                assert.isFalse(milestones1.streamOngoing);
                assert.isFalse(milestones2.streamOngoing);
            });

            it("[IP][1.1.23] Should have paid 0 in funds upon creation", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.deepEqual(milestone1.paidAmount, BigNumber.from(0));
                assert.deepEqual(milestone2.paidAmount, BigNumber.from(0));
            });

            it("[IP][1.1.24] Milestones should have a correct seed portions", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.deepEqual(milestone1.intervalSeedPortion, percent5InIpBigNumber);
                assert.deepEqual(milestone2.intervalSeedPortion, percent5InIpBigNumber);
            });

            it("[IP][1.1.25] Milestones should have a correct stream portions", async () => {
                const milestone1 = await investment.getMilestone(0);
                const milestone2 = await investment.getMilestone(1);
                assert.deepEqual(milestone1.intervalStreamingPortion, percent70InIpBigNumber);
                assert.deepEqual(milestone2.intervalStreamingPortion, percent20InIpBigNumber);
            });

            it("[IP][1.1.26] Should assign milestones portions correctly", async () => {
                const milestone1 = await investment.getMemMilestonePortions(0);
                const milestone2 = await investment.getMemMilestonePortions(1);
                const lastItem = await investment.getMemMilestonePortions(2);
                assert.deepEqual(milestone1, percentageDivider);
                assert.deepEqual(milestone2, percent25InIpBigNumber);
                assert.deepEqual(lastItem, BigNumber.from(0));
            });

            it("[IP][1.1.27] Should assign total streaming duration correctly", async () => {
                const totalStreamingDuration = await investment.getTotalStreamingDuration();
                const realDuration =
                    milestoneEndDate.toNumber() -
                    milestoneStartDate.toNumber() +
                    (milestoneEndDate2.toNumber() - milestoneStartDate2.toNumber());
                assert.deepEqual(totalStreamingDuration, realDuration);
            });

            it("[IP][1.1.28] Should be able to receive eth", async () => {
                const ethAmountToReceive = ethers.utils.parseEther("1");

                const priorContractBalance = await ethers.provider.getBalance(investment.address);
                await buidl1Admin.sendTransaction({
                    to: investment.address,
                    value: ethAmountToReceive,
                });
                const contractBalance = await ethers.provider.getBalance(investment.address);

                assert.deepEqual(priorContractBalance.add(ethAmountToReceive), contractBalance);
            });

            it("[IP][1.1.29] Should assign investment withdraw fee correctly", async () => {
                assert.equal(investmentWithdrawFee.toString(), "1");
            });
        });
    });

    describe("2. Fundraiser cancelation", () => {
        describe("2.1 Interactions", () => {
            it("[IP][2.1.1] Fundraiser can be cancelled if it's not started yet", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await expect(investment.connect(creator).cancelBeforeFundraiserStart()).to.emit(
                    investment,
                    "Cancel"
                );

                assert.notEqual(await investment.getEmergencyTerminationTimestamp(), 0);
            });

            it("[IP][2.1.2] Before the fundraiser, it should return the correct state", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(projectState.toString(), beforeFundraiserStateValue.toString());
            });

            it("[IP][2.1.3] After canceling the fundraiser, project state should change", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await investment.connect(creator).cancelBeforeFundraiserStart();

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(projectState.toString(), canceledProjectStateValue.toString());
            });

            it("[IP][2.1.4] Fundraiser can't be cancelled by anyone, except creator", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await expect(
                    investment.connect(foreignActor).cancelBeforeFundraiserStart()
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__NotCreator");
            });

            it("[IP][2.1.5] Fundraiser can't be cancelled, if it's already started", async () => {
                // Fundraiser has already started by now
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);

                await expect(investment.connect(creator).cancelBeforeFundraiserStart())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][2.1.6] Fundraiser can't be cancelled, if it's already been canceled", async () => {
                // Enforce a timestamp before campaign start
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(creator).cancelBeforeFundraiserStart())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });
        });
    });

    describe("3. Invest process", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("3.1 Public state", () => {
            it("[IP][3.1.1] In fundraising period investors investment should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const memMilestoneInvestments = await investment.getMemMilestoneInvestments(0);

                assert.deepEqual(investedAmount, memMilestoneInvestments);
            });

            it("[IP][3.1.2] In fundraising period investors investment should update investedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const contractInvestedAmount = await investment.getInvestedAmount(
                    investorA.address,
                    0
                );

                assert.deepEqual(investedAmount, contractInvestedAmount);
            });

            it("[IP][3.1.3] In fundraising period investors investment should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const totalInvestedAmount = await investment.getTotalInvestedAmount();

                assert.deepEqual(investedAmount, totalInvestedAmount);
            });

            it("[IP][3.1.4] In fundraising period investors investment should update investors and contract balance", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("100");
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const investorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const investorBalanceDiff = investorPriorBalance.sub(investedAmount);
                const contractTotalBalance = contractPriorBalance.add(investedAmount);
                assert.deepEqual(investorBalance, investorBalanceDiff);
                assert.deepEqual(contractBalance, contractTotalBalance);
            });

            it("[IP][3.1.5] In fundraising period investors investment should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(investment.connect(investorA).invest(investedAmount, false))
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, investedAmount);
            });

            it("[IP][3.1.6] In milestone 0 period investors investment should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                const memMilestoneInvestments = await investment.getMemMilestoneInvestments(1);
                const memMilestonePortions = await investment.getMemMilestonePortions(1);
                const expectedMemInvestment = investedAmount.add(
                    investedAmount2.mul(percentageDivider).div(memMilestonePortions)
                );

                assert.deepEqual(memMilestoneInvestments, expectedMemInvestment);
            });

            it("[IP][3.1.7] In milestone 0 period investors investment should update investedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                const amount = await investment.getInvestedAmount(investorB.address, 1);
                assert.deepEqual(investedAmount2, amount);
            });

            it("[IP][3.1.8] In milestone 0 period investors investment should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                const amount = await investment.getTotalInvestedAmount();
                assert.deepEqual(investedAmount.add(investedAmount2), amount);
            });

            it("[IP][3.1.9] In milestone 0 period investors investment should update investors and contract balance", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                const investorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const investorBalanceDiff = investorPriorBalance.sub(investedAmount2);
                const contractTotalBalance = contractPriorBalance.add(investedAmount2);
                assert.deepEqual(investorBalance, investorBalanceDiff);
                assert.deepEqual(contractBalance, contractTotalBalance);
            });

            it("[IP][3.1.10] In milestone 0 period investors investment should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);

                // Invest money
                await expect(investment.connect(investorB).invest(investedAmount2, false))
                    .to.emit(investment, "Invest")
                    .withArgs(investorB.address, investedAmount2);
            });

            it("[IP][3.1.11] In milestone 0 period, project should have milestones ongoing state", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                const projectState = await investment.getProjectStateByteValue();

                assert.equal(
                    projectState.toString(),
                    milestonesOngoingBeforeLastStateValue.toString()
                );
            });

            it("[IP][3.1.12] In milestone 1 period, project should have last milestone ongoing state", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                const projectState = await investment.getProjectStateByteValue();

                assert.equal(projectState.toString(), lastMilestoneOngoingStateValue.toString());
            });
        });

        describe("3.2 Interactions", () => {
            it("[IP][3.2.1] Shouldn't be able to invest zero amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("0");

                // NOTE: Time traveling to 2100/07/15,
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(investorA).invest(investedAmount, false)
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__ZeroAmountProvided");
            });

            it("[IP][3.2.2] Investor shouldn't be able to invest if fundraiser has already been canceled", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");

                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(investorA).invest(amountToInvest, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][3.2.3] Investor shouldn't be able to invest if fundraiser hasn't been started", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await expect(investment.connect(investorA).invest(amountToInvest, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][3.2.4] Investor shouldn't be able to invest if fundraiser has failed", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                // No investments were made, which means fundraiser failed

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).invest(amountToInvest, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(failedFundraiserStateValue);
            });

            it("[IP][3.2.5] Investor shouldn't be able to invest during gap between fundraiser end and 0 milestone start", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);

                await expect(investment.connect(investorB).invest(investedAmount, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][3.2.6] Shouldn't be able to invest in last milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/15
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);

                // Invest money
                await expect(investment.connect(investorB).invest(investedAmount, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(lastMilestoneOngoingStateValue);
            });

            it("[IP][3.2.7] Shouldn't be able to invest if project was terminated by voting", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);

                // Invest money
                await expect(investment.connect(investorB).invest(investedAmount, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(terminatedByVotingStateValue);
            });

            it("[IP][3.2.8] Investor shouldn't be able to invest after project has ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorB);

                await expect(investment.connect(investorB).invest(investedAmount, false))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(successfullyEndedStateValue);
            });

            it("[IP][3.2.9] Investor shouldn't be able to invest more than a hard cap if stric mode is enabled", async () => {
                const amountToInvest: BigNumber = hardCap.add(1);
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);

                await expect(
                    investment.connect(investorA).invest(amountToInvest, true)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.10] Investor shouldn't be able to invest more than a hard cap if hard cap is reached", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);

                await investMoney(fUSDTx, investment, investorA, hardCap);

                await expect(
                    investment.connect(investorB).invest(amountToInvest, false)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.11] Investor shouldn't be able to invest more than a hard cap if hard cap is reached and stric mode is enabled", async () => {
                const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);
                await investMoney(fUSDTx, investment, investorA, hardCap);

                await expect(
                    investment.connect(investorB).invest(amountToInvest, true)
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__CannotInvestAboveHardCap"
                );
            });

            it("[IP][3.2.12] Should allow a smaller investment to go through than a total amount", async () => {
                const amountToInvest: BigNumber = hardCap.add(10);
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);

                // Give token approval
                await fUSDTx
                    .approve({
                        receiver: investment.address,
                        amount: UINT256_MAX.toString(),
                    })
                    .exec(investorA);

                // Invest money
                await expect(investment.connect(investorA).invest(amountToInvest, false))
                    .to.emit(investment, "Invest")
                    .withArgs(investorA.address, hardCap);
            });

            it("[IP][3.2.13] Investors should be able to collectively raise the soft cap", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("750");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                // Investor A invests
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Investor B invests
                await investMoney(fUSDTx, investment, investorB, investedAmount);

                const softCapRaised = await investment.isSoftCapReached();
                assert.isTrue(softCapRaised);
            });

            describe("function -> _getVotingTokensAmountToMint()", () => {
                it("[IP][3.2.17] Should correctly calculate amount to mint during private funding with amount < soft cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("800");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("400");

                    // NOTE: Time traveling to 2100/07/15
                    const timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);

                    // Investor A invests
                    await investMoney(fUSDTx, investment, investorA, investedAmountA);

                    const tokensToMint: BigNumber = await investment.getVotingTokensAmountToMint(
                        investedAmountB
                    );

                    assert.equal(
                        tokensToMint.toString(),
                        investedAmountB.mul(privateFundingMultiplier).toString()
                    );
                });

                it("[IP][3.2.18] Should correctly calculate amount to mint during private funding with amount < hard cap AND amount > soft cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("1000");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("1500");

                    // NOTE: Time traveling to 2100/07/15
                    const timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);

                    // Investor A invests
                    await investMoney(fUSDTx, investment, investorA, investedAmountA);

                    const tokensToMint: BigNumber = await investment.getVotingTokensAmountToMint(
                        investedAmountB
                    );

                    const tokensInPrivateFunding = softCap
                        .sub(investedAmountA)
                        .mul(privateFundingMultiplier);
                    const tokensInPublicFunding = investedAmountB
                        .sub(softCap.sub(investedAmountA))
                        .mul(publicFundingMultiplier);

                    assert.equal(
                        tokensToMint.toString(),

                        tokensInPrivateFunding.add(tokensInPublicFunding).toString()
                    );
                });

                it("[IP][3.2.19] Should correctly calculate amount to mint during ppublic funding with amount < hard cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("400");

                    // NOTE: Time traveling to 2100/07/15
                    const timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);

                    // Investor A invests
                    await investMoney(fUSDTx, investment, investorA, investedAmountA);

                    const tokensToMint: BigNumber = await investment.getVotingTokensAmountToMint(
                        investedAmountB
                    );

                    const tokensInPublicFunding = investedAmountB.mul(publicFundingMultiplier);

                    assert.equal(tokensToMint.toString(), tokensInPublicFunding.toString());
                });
            });
        });
    });

    describe("4. Unpledge process", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("4.1 Public state", () => {
            it("[IP][4.1.1] In fundraising period unpledge should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await investment.connect(investorA).unpledge(investedAmount.div(2));

                const currentTotalInvestedAmount = await investment.getTotalInvestedAmount();
                assert.deepEqual(currentTotalInvestedAmount, investedAmount.div(2));
            });

            it("[IP][4.1.2] In fundraising period unpledge should update investedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await investment.connect(investorA).unpledge(investedAmount.div(2));

                const currentInvestedAmount = await investment.getInvestedAmount(
                    investorA.address,
                    0
                );

                assert.deepEqual(currentInvestedAmount, investedAmount.div(2));
            });

            it("[IP][4.1.3] In fundraising period unpledge should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await investment.connect(investorA).unpledge(investedAmount.div(2));

                const memMilestoneInvestments = await investment.getMemMilestoneInvestments(0);

                assert.deepEqual(memMilestoneInvestments, investedAmount.div(2));
            });

            it("[IP][4.1.4] In fundraising period unpledge should update investors and contract balance", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                const unpledgeAmount: BigNumber = ethers.utils.parseEther("1");

                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await investment.connect(investorA).unpledge(unpledgeAmount);

                const investorsBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const feeAmount: BigNumber = unpledgeAmount
                    .mul(investmentWithdrawFee)
                    .div(BigNumber.from(100));

                assert.deepEqual(
                    investorsBalance,
                    investorPriorBalance.sub(investedAmount).add(unpledgeAmount).sub(feeAmount)
                );
                assert.deepEqual(
                    contractBalance,
                    contractPriorBalance.add(investedAmount).sub(unpledgeAmount).add(feeAmount)
                );
            });

            it("[IP][4.1.5] In fundraising period unpledge should emit event with investor and amount args", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await expect(investment.connect(investorA).unpledge(investedAmount.sub(100)))
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorA.address, investedAmount.sub(100));
            });

            it("[IP][4.1.6] In milestone 0 period unpledge should update memMilestoneInvestments", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                await investment.connect(investorB).unpledge(investedAmount2.div(2));

                const memMilestoneInvestments = await investment.getMemMilestoneInvestments(1);
                const memMilestonePortions = await investment.getMemMilestonePortions(1);
                const expectedMemInvestment = investedAmount
                    .add(investedAmount2.mul(percentageDivider).div(memMilestonePortions))
                    .sub(investedAmount2.div(2).mul(percentageDivider).div(memMilestonePortions));
                assert.deepEqual(memMilestoneInvestments, expectedMemInvestment);
            });

            it("[IP][4.1.7] In milestone 0 period unpledge should update investedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                await investment.connect(investorB).unpledge(investedAmount2.div(2));

                const amount = await investment.getInvestedAmount(investorB.address, 1);
                assert.deepEqual(amount, investedAmount2.div(2));
            });

            it("[IP][4.1.8] In milestone 0 period unpledge should update totalInvestedAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                await investment.connect(investorB).unpledge(investedAmount2.div(2));

                const amount = await investment.getTotalInvestedAmount();
                assert.deepEqual(amount, investedAmount.add(investedAmount2.div(2)));
            });

            it("[IP][4.1.9] In milestone 0 period unpledge should update investors and contract balance", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");
                const unpledgeAmount: BigNumber = ethers.utils.parseEther("1");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                await investment.connect(investorB).unpledge(unpledgeAmount);

                const investorsBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const feeAmount: BigNumber = unpledgeAmount
                    .mul(investmentWithdrawFee)
                    .div(BigNumber.from(100));

                assert.deepEqual(
                    investorsBalance,
                    investorPriorBalance.sub(investedAmount2).add(unpledgeAmount).sub(feeAmount)
                );
                assert.deepEqual(
                    contractBalance,
                    contractPriorBalance.add(investedAmount2).sub(unpledgeAmount).add(feeAmount)
                );
            });

            it("[IP][4.1.10] In milestone 0 period unpledge should emit event with investor and amount args", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15, when fundraiser already started
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 1st milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                await expect(investment.connect(investorB).unpledge(investedAmount2.sub(100)))
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorB.address, investedAmount2.sub(100));
            });
        });

        describe("4.2 Interactions", () => {
            it("[IP][4.2.1] Investor shouldn't be able to unpledge zero amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await expect(
                    investment.connect(investorA).unpledge(0)
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__ZeroAmountProvided");
            });

            it("[IP][4.2.2] Shouldn't be able to unpledge if project was canceled", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][4.2.3] Shouldn't be able to unpledge if fundraiser hasn't started", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][4.2.4] Shouldn't be able to unpledge from failed fundraiser", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/08/15
                let timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(failedFundraiserStateValue);
            });

            it("[IP][4.2.5] Shouldn't be able to unpledge if fundraiser has ended (in gap between fundraiser and 0 milestone)", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15, when the fundraiser ended
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][4.2.6] Shouldn't be able to unpledge in last milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/15
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(lastMilestoneOngoingStateValue);
            });

            it("[IP][4.2.7] Shouldn't be able to unpledge if project was terminated by voting", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(terminatedByVotingStateValue);
            });

            it("[IP][4.2.8] Shouldn't be able to unpledge after project ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(successfullyEndedStateValue);
            });

            it("[IP][4.2.9] Investor shouldn't be able to unpledge more than invested", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Request them back, but 1 wei more, should revert
                await expect(investment.connect(investorA).unpledge(investedAmount.add(1)))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__AmountIsGreaterThanInvested"
                    )
                    .withArgs(investedAmount.add(1), investedAmount);
            });

            it("[IP][4.2.10] Investor should be able to do a full unpledge", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Request all of tokens back
                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorA.address, investedAmount);

                const investorsBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const feeAmount: BigNumber = investedAmount
                    .mul(investmentWithdrawFee)
                    .div(BigNumber.from(100));

                assert.deepEqual(investorsBalance, investorPriorBalance.sub(feeAmount));
                assert.deepEqual(contractBalance, contractPriorBalance.add(feeAmount));
            });

            it("[IP][4.2.11] Investor should be able to do a partial unpledge", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Request half of the funds back
                await expect(investment.connect(investorA).unpledge(investedAmount.div(2)))
                    .to.emit(investment, "Unpledge")
                    .withArgs(investorA.address, investedAmount.div(2));

                const investorsBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorA.address,
                        providerOrSigner: investorA,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const feeAmount: BigNumber = investedAmount
                    .div(2)
                    .mul(investmentWithdrawFee)
                    .div(BigNumber.from(100));

                assert.deepEqual(
                    investorsBalance,
                    investorPriorBalance.sub(investedAmount.div(2)).sub(feeAmount)
                );
                assert.deepEqual(
                    contractBalance,
                    contractPriorBalance.add(investedAmount.div(2)).add(feeAmount)
                );
            });

            it("[IP][4.2.12] Non-investor shouldn't be able to unpledge", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await expect(investment.connect(foreignActor).unpledge(1))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__AmountIsGreaterThanInvested"
                    )
                    .withArgs(1, 0);
            });

            it("[IP][4.2.13] Shouldn't be able to unpledge if next milestone has started", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).unpledge(investedAmount))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__AmountIsGreaterThanInvested"
                    )
                    .withArgs(investedAmount, 0);
            });
        });
    });

    describe("5. Refund process", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("5.1 Public state", () => {
            it("[IP][5.1.1] If failed fundraiser, refund should assign investedAmount to 0", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await investment.connect(investorA).refund();

                const leftInvestedAmount = await investment.getInvestedAmount(
                    investorA.address,
                    0
                );
                assert.deepEqual(leftInvestedAmount, BigNumber.from(0));
            });

            it("[IP][5.1.2] If failed fundraiser, refund should transfer back the tokens", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");
                const investorPriorBalance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });
                const contractPriorBalance = await fUSDTx.balanceOf({
                    account: investment.address,
                    providerOrSigner: buidl1Admin,
                });

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                // Refund
                await investment.connect(investorA).refund();

                const investorBalance = await fUSDTx.balanceOf({
                    account: investorA.address,
                    providerOrSigner: investorA,
                });
                const contractBalance = await fUSDTx.balanceOf({
                    account: investment.address,
                    providerOrSigner: buidl1Admin,
                });
                assert.deepEqual(investorBalance, investorPriorBalance);
                assert.deepEqual(contractBalance, contractPriorBalance);
            });

            it("[IP][5.1.3] If failed fundraiser, refund should emit Refund event with investor and investment amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                // Refund
                await expect(investment.connect(investorA).refund())
                    .to.emit(investment, "Refund")
                    .withArgs(investorA.address, investedAmount);
            });

            it("[IP][5.1.4] If terminated by voting, refund should assign investedAmount to 0", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.connect(investorA).refund();

                const leftInvestedAmount = await investment.getInvestedAmount(
                    investorA.address,
                    0
                );
                assert.deepEqual(leftInvestedAmount, BigNumber.from(0));
            });

            it("[IP][5.1.5] If terminated by voting, refund should transfer money back", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount2);

                const investorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                await governancePoolMock.cancelDuringMilestones(investment.address);
                await investment.connect(investorB).refund();

                const investorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investorB.address,
                        providerOrSigner: investorB,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                assert.deepEqual(investorPriorBalance.add(investedAmount2), investorBalance);
                assert.deepEqual(contractPriorBalance.sub(investedAmount2), contractBalance);
            });

            it("[IP][5.1.6] If terminated by voting, refund should emit event with investor and amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount);

                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(investorB).refund())
                    .to.emit(investment, "Refund")
                    .withArgs(investorB.address, investedAmount);
            });

            it("[IP][5.1.7] If terminated by gelato, refund should emit event with investor and amount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorB, investedAmount);

                await investment.connect(creator).startFirstFundsStream();

                const automatedTerminationWindow =
                    await investment.getAutomatedTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                await expect(investment.connect(investorB).refund())
                    .to.emit(investment, "Refund")
                    .withArgs(investorB.address, investedAmount);
            });
        });

        describe("5.2 Interactions", () => {
            it("[IP][5.2.1] Refund should be inactive if fundraiser was canceled", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][5.2.2] Refund should be inactive before fundraiser", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][5.2.3] Refund should be inactive during fundraiser", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][5.2.4] Refund should be inactive if fundraiser was successful (gap between fundraiser and 0 milestone)", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][5.2.5] Refund should be inactive if not last milestone is active", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(milestonesOngoingBeforeLastStateValue);
            });

            it("[IP][5.2.6] Refund should be inactive if last milestone is active", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(investorA).refund())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(lastMilestoneOngoingStateValue);
            });

            it("[IP][5.2.7] If failed fundraiser, refund should revert where zero investments were made", async () => {
                // NOTE: Time traveling to 2100/08/15, when the fundraiser ends
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                // Try to refund
                await expect(investment.connect(investorA).refund()).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NoMoneyInvested"
                );
            });

            it("[IP][5.2.8] If failed fundraiser, investor shouldn't be able to get back anything if haven't invested", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("10");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                // Try to refund
                await expect(
                    investment.connect(foreignActor).refund()
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__NoMoneyInvested");
            });

            it("[IP][5.2.9] If terminated by voting and no money was invested, refund should revert", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(investorB).refund()).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NoMoneyInvested"
                );
            });

            it("[IP][5.2.10] If invested in 0 milestone, stream was opened, invested in 1 milestone, terminated by voting, should transfer left amount", async () => {
                // If invested in 0 milestone, stream was opened, invested in 1 milestone, terminated by voting, should transfer left amount
            });

            it("[IP][5.2.11] If invested in 0 milestone, stream was opened, invested in 1 milestone, creator closed stream, next stream was opened, terminated by voting, should transfer left amount", async () => {
                // If invested in 0 milestone, stream was opened, invested in 1 milestone, creator closed stream, next stream was opened, terminated by voting, should transfer left amount
            });

            it("[IP][5.2.12] If invested in 0 milestone, stream was opened, terminated by voting, should transfer left amount", async () => {
                // If invested in 0 milestone, stream was opened, terminated by voting, should transfer left amount
            });

            it("[IP][5.2.13] If invested in 0 milestone, stream was opened, creator closed stream, next stream was opened, terminated by voting, should transfer left amount", async () => {
                // If invested in 0 milestone, stream was opened, creator closed stream, next stream was opened, terminated by voting, should transfer left amount
            });

            it("[IP][5.2.14] If stream was opened, invested in 1 milestone, terminated by voting, should transfer left amount", async () => {
                // If stream was opened, invested in 1 milestone, terminated by voting, should transfer left amount
            });

            it("[IP][5.2.15] If stream was opened, invested in 1 milestone, creator closed stream, next stream was opened, terminated by voting, should transfer left amount", async () => {
                // If stream was opened, invested in 1 milestone, creator closed stream, next stream was opened, terminated by voting, should transfer left amount
            });
        });
    });

    describe("6. Fundraiser start", () => {
        describe("6.1 Public state", () => {
            it("[IP][6.1.1] Fundraiser should be ongoing if the starting date has passed", async () => {
                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
                assert.isTrue(isFundraiserOngoing);
            });

            it("[IP][6.1.2] Fundraiser shouldn't have a soft cap raised initially after the fundraiser start", async () => {
                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                const isSoftCapReached = await investment.isSoftCapReached();
                assert.isFalse(isSoftCapReached);
            });

            it("[IP][6.1.3] Fundraiser period shouldn't have ended yet", async () => {
                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
                assert.isFalse(hasFundraiserEnded);
            });

            it("[IP][6.1.4] Fundraiser shouldn't have a failed state during active fundraiser", async () => {
                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.isFalse(isFailed);
            });

            it("[IP][6.1.5] During the fundraiser, it should return the correct state", async () => {
                // NOTE: Time traveling to 2100/07/15
                const timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(projectState.toString(), fundraiserOngoingStateValue.toString());
            });
        });
    });

    describe("7. Failed fundraiser", () => {
        describe("7.1 Public state", () => {
            it("[IP][7.1.1] Campaign should have a failed campaign state for unsuccessful fundraiser", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.isTrue(isFailed);
            });

            it("[IP][7.1.2] Soft cap shouldn't be raised for failed fundraisers", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.isFalse(hasRaisedSoftCap);
            });

            it("[IP][7.1.3] Fundraiser shouldn't be ongoing for a failed campaign", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
                assert.isFalse(isFundraiserOngoing);
            });

            it("[IP][7.1.4] Fundraiser should have ended for a failed campaign", async () => {
                // No one invests, let the fundraiser expire

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
                assert.isTrue(hasFundraiserEnded);
            });

            it("[IP][7.1.5] If fundraiser failed, it should return the correct state", async () => {
                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(projectState.toString(), failedFundraiserStateValue.toString());
            });
        });
    });

    describe("8. Successful fundraiser", () => {
        describe("8.1 Interactions", () => {
            it("[IP][8.1.1] Campaign shouldn't have a failed campaign state", async () => {
                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15, when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const isFailed = await investment.isFailedFundraiser();
                assert.isFalse(isFailed);
            });

            it("[IP][8.1.2] Successful campaign should have reached soft cap", async () => {
                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const hasRaisedSoftCap = await investment.isSoftCapReached();
                assert.isTrue(hasRaisedSoftCap);
            });

            it("[IP][8.1.3] Fundraiser shouldn't be ongoing", async () => {
                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const isFundraiserOngoing = await investment.isFundraiserOngoingNow();
                assert.isFalse(isFundraiserOngoing);
            });

            it("[IP][8.1.4] Fundraiser period should have ended for a successful campaign", async () => {
                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const hasFundraiserEnded = await investment.didFundraiserPeriodEnd();
                assert.isTrue(hasFundraiserEnded);
            });

            it("[IP][8.1.5] If fundraiser ended successfully, project state should change", async () => {
                // Invest more than soft cap here to make sure the campaign is a success
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15 when the fundraiser ends
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(
                    projectState.toString(),
                    fundraiserEndedNoMilestonesOngoingStateValue.toString()
                );
            });
        });
    });

    describe("9. Creator tokens claim", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("9.1 Public state", () => {
            it("[IP][9.1.1] If project was terminated by voting and seed amount for given milestone wasn't paid, it should update seedAmountPaid", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                assert.isTrue(milestone.seedAmountPaid);
            });

            it("[IP][9.1.2] If project was terminated by voting and seed amount for given milestone wasn't paid, it should update paidAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                const seedAmount = await investment.getMilestoneSeedAmount(0);
                assert.deepEqual(milestone.paidAmount, seedAmount);
            });

            it("[IP][9.1.3] If project was terminated by voting and seed amount for given milestone wasn't paid, it should transfer seedtokens", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const creatorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.connect(creator).startFirstFundsStream();

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );
                const milestone = await investment.getMilestone(0);
                assert.deepEqual(creatorPriorBalance.add(milestone.paidAmount), creatorBalance);
                assert.deepEqual(contractPriorBalance.sub(milestone.paidAmount), contractBalance);
            });

            it("[IP][9.1.4] If project was terminated by voting and seed amount for given milestone wasn't paid, it should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(0, true, false, false);
            });

            it("[IP][9.1.5] If seed amount for given milestone wasn't paid, it should update seedAmountPaid", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                assert.isTrue(milestone.seedAmountPaid);
            });

            it("[IP][9.1.6] If seed amount for given milestone wasn't paid, it should update paidAmount", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                const seedAmount = await investment.getMilestoneSeedAmount(0);
                assert.deepEqual(milestone.paidAmount, seedAmount);
            });

            it("[IP][9.1.7] If seed amount for given milestone wasn't paid, it should transfer seed tokens", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const creatorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                // timeStamp = dateToSeconds("2100/09/16");
                await timeTravelByIncreasingSeconds(60);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );
                const milestone = await investment.getMilestone(0);

                // Stream was opened, so we can't get the specific balance, we just check if seed amount was transfered
                assert.isTrue(creatorPriorBalance.add(milestone.paidAmount).lt(creatorBalance));
                assert.isTrue(contractPriorBalance.sub(milestone.paidAmount).gt(contractBalance));
            });

            it("[IP][9.1.8] If seed amount for given milestone wasn't paid, it should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(0, true, false, false);
            });

            it("[IP][9.1.9] If termination window is entered, it should update paid value to true", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/01 - 2 minute
                timeStamp = dateToSeconds("2100/10/01", false) as number;
                await investment.setTimestamp(timeStamp - 120);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                assert.isTrue(milestone.paid);
            });

            it("[IP][9.1.10] If termination window is entered, it should update paidAmount value", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const creatorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/01 - 2 minute
                timeStamp = dateToSeconds("2100/10/01", false) as number;
                await investment.setTimestamp(timeStamp - 120);

                await investment.connect(creator).startFirstFundsStream();

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.getMilestone(0);
                const milestoneAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);
                assert.deepEqual(milestone.paidAmount, milestoneAllocation);
                assert.deepEqual(creatorBalance.sub(milestone.paidAmount), creatorPriorBalance);
            });

            it("[IP][9.1.11] If termination window is entered, it should transfer stream tokens instantly", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                const creatorPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractPriorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                // NOTE: Time traveling to 2100/10/01 - 2 minute
                timeStamp = dateToSeconds("2100/10/01", false) as number;
                await investment.setTimestamp(timeStamp - 120);

                await investment.connect(creator).startFirstFundsStream();

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const contractBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: investment.address,
                        providerOrSigner: buidl1Admin,
                    })
                );

                const milestoneAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);
                assert.deepEqual(creatorPriorBalance.add(milestoneAllocation), creatorBalance);
                assert.deepEqual(contractPriorBalance.sub(milestoneAllocation), contractBalance);
            });

            it("[IP][9.1.12] If termination window is entered, it should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/01 - 2 minute
                timeStamp = dateToSeconds("2100/10/01", false) as number;
                await investment.setTimestamp(timeStamp - 120);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(0, false, true, false);
            });

            it("[IP][9.1.13] Should update streamOngoing variable state", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const milestone = await investment.getMilestone(0);
                assert.isTrue(milestone.streamOngoing);
            });

            it("[IP][9.1.14] On creator funds claim, it should emit event", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(0, false, false, true);
            });
        });

        describe("9.2 Interactions", () => {
            it("[IP][9.2.1] Non-creator shouldn't be able to claim tokens", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(foreignActor).startFirstFundsStream()
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__NotCreator");
            });

            it("[IP][9.2.2] Creator shouldn't be able to claim tokens if project was canceled", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][9.2.3] Creator shouldn't be able to claim tokens before fundraiser start", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][9.2.4] Creator shouldn't be able to claim tokens during fundraiser", async () => {
                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][9.2.5] Creator shouldn't be able to claim tokens if fundraiser failed", async () => {
                // NOTE: Time traveling to 2100/08/15
                let timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(failedFundraiserStateValue);
            });

            it("[IP][9.2.6] Creator shouldn't be able to claim tokens in gap between fundraiser and 0 milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][9.2.7] Creator shouldn't be able to claim tokens after project ends", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(successfullyEndedStateValue);
            });

            it("[IP][9.2.8] Creator shouldn't be able to claim funds and open stream before milestone starts", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 0 milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(1)).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__MilestoneStillLocked"
                );
            });

            it("[IP][9.2.9] Creator shouldn't be able to claim funds and open stream if stream is ongoing already", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15, when 0 milestone already started
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                await expect(investment.connect(creator).startFirstFundsStream())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__AlreadyStreamingForMilestone"
                    )
                    .withArgs(0);
            });

            it("[IP][9.2.10] If project was terminated by voting, but seed amount was already paid, it should revert", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.connect(creator).startFirstFundsStream();

                await expect(
                    investment.connect(creator).startFirstFundsStream()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NoSeedAmountDedicated"
                );
            });

            it("[IP][9.2.11] If project was terminated by voting, but termination didn't happen in given milestone, it should revert", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await investment.increaseMilestone();
                // NOTE: Time traveling to 2100/10/15
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).claim(1)).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NoSeedAmountDedicated"
                );
            });

            it("[IP][9.2.12] Should claim all the funds instantly if in milestone's termination window", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to the end of milestone 0
                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await investment.setTimestamp(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.getMilestone(0);
                const milestoneAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);
                assert.deepEqual(milestone.paidAmount, milestoneAllocation);
                assert.deepEqual(creatorBalance.sub(milestone.paidAmount), initialCreatorBalance);
            });

            it("[IP][9.2.13] Superfluid creates a stream of funds on startFirstFundsStream", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                /**
                 * NOTE: even though we cannot get precise time with the traveler,
                 * the investment contract itself creates flowrate, and uses the timestamp that was passed to it
                 * So it's ok to make calculations using it
                 * Calculate the desired flowrate, should match the one from contract
                 */

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                const timeLeft = milestoneEndDate.sub(
                    BigNumber.from(flowInfo.timestamp.getTime() / 1000)
                );
                const seedAmount = (await investment.getMilestone(0)).paidAmount;
                const tokenAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);
                const flowRate = tokenAllocation.sub(seedAmount).div(timeLeft);

                assert.isDefined(flowInfo);
                assert.deepEqual(BigNumber.from(flowInfo.flowRate), flowRate);
            });

            it("[IP][9.2.14] Shouldn't be able to start first funds stream after 0 milestone has ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to the start of milestone 1
                timeStamp = dateToSeconds("2100/10/02");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(creator).startFirstFundsStream()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NotInFirstMilestonePeriod"
                );
            });

            it("[IP][9.2.15] Shouldn't be able to claim any tokens if full amount is already paid", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                await expect(investment.connect(creator).claim(0)).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__AlreadyPaidForMilestone"
                );
            });

            describe("function -> ifNeededUpdateMemInvestmentValue", () => {
                it("[IP][9.2.15] Should update memMilestoneInvestments if memoized amount is not 0 and milestone id is not 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    await investment.ifNeededUpdateMemInvestmentValue(1);

                    const initialMemInvestment = await investment.getMemMilestoneInvestments(1);
                    await investment.ifNeededUpdateMemInvestmentValue(1);
                    const memInvestment = await investment.getMemMilestoneInvestments(1);

                    assert.equal(memInvestment.toString(), initialMemInvestment.toString());
                });

                it("[IP][9.2.16] Should not update memMilestoneInvestments if milestone id is 0", async () => {
                    const initialMemInvestment = await investment.getMemMilestoneInvestments(0);
                    await investment.ifNeededUpdateMemInvestmentValue(0);
                    const memInvestment = await investment.getMemMilestoneInvestments(0);

                    assert.equal(initialMemInvestment.toString(), memInvestment.toString());
                    assert.equal(memInvestment.toString(), "0");
                });

                it("[IP][9.2.17] Should not update memMilestoneInvestments if memoized amount is not 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    const initialMemInvestment = await investment.getMemMilestoneInvestments(1);
                    await investment.ifNeededUpdateMemInvestmentValue(1);
                    const memInvestment = await investment.getMemMilestoneInvestments(1);

                    assert.equal(
                        memInvestment.toString(),
                        initialMemInvestment
                            .add(await investment.getMemMilestoneInvestments(0))
                            .toString()
                    );
                });
            });
        });
    });

    describe("10. Money streaming corner cases", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("10.1 Interactions", () => {
            it("[IP][10.1.1] Volunteer stopping of streamed funds updates records", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                timeStamp = dateToSeconds("2100/09/16");
                await timeTravelToDate(timeStamp);

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

                const milestone = await investment.getMilestone(0);
                const paidAmount = milestone.paidAmount;
                assert.deepEqual(paidAmount, creatorBalance.sub(initialCreatorBalance));
                assert.isFalse(milestone.paid);
            });

            it("[IP][10.1.2] (Callback) Volunteer stopping during termination window instantly transfers the rest of funds", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const terminationWindow = BigNumber.from(await investment.getTerminationWindow());
                timeStamp = milestoneEndDate.sub(terminationWindow.div(2)).toNumber();
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

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

                const milestone = await investment.getMilestone(0);
                const paidAmount = milestone.paidAmount;
                const tokenAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);

                assert.deepEqual(
                    paidAmount,
                    creatorBalance.sub(initialCreatorBalance),
                    "Streamed balance and stored record should match"
                );
                assert.equal(milestone.paid, true, "Milestone should be fully paid by now");
                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    tokenAllocation,
                    "Should transfer all of the funds during the termination"
                );
            });

            it("[IP][10.1.3] Should be able to pause the stream and resume later", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                // Advance in time a little
                timeStamp = dateToSeconds("2100/09/20");
                await timeTravelToDate(timeStamp);

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
                timeStamp = dateToSeconds("2100/09/25");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });
                assert.isDefined(flowInfo);

                // Calculate the desired flowrate, should match the one from contract
                // Use the timestamp source from the flow info for precision
                const timeLeft = milestoneEndDate.sub(
                    BigNumber.from(flowInfo.timestamp.getTime() / 1000)
                );
                const tokenAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);
                const flowRate = tokenAllocation.sub(streamedSoFar).div(timeLeft);

                assert.deepEqual(BigNumber.from(flowInfo.flowRate), flowRate);
            });

            it("[IP][10.1.4] Should be able to pause the stream, resume later, get terminated", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                // Advance in time a little
                timeStamp = dateToSeconds("2100/09/20");
                await timeTravelToDate(timeStamp);

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
                timeStamp = dateToSeconds("2100/09/25");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();
                const terminationWindow = BigNumber.from(await investment.getTerminationWindow());

                // Let's make sure we are in the termination window
                timeStamp = milestoneEndDate.sub(terminationWindow.div(2)).toNumber();
                await timeTravelToDate(timeStamp);

                await expect(investment.terminateMilestoneStreamFinal(0))
                    .to.emit(investment, "TerminateStream")
                    .withArgs(0);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                const milestone = await investment.getMilestone(0);
                const tokenAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);

                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    tokenAllocation,
                    "Should transfer all of the funds to the creator"
                );
                assert.deepEqual(
                    milestone.paidAmount,
                    tokenAllocation,
                    "Paid amount should match the invested amount"
                );
                assert.equal(milestone.paid, true, "Milestone should be marked as paid by now");
            });

            it("[IP][10.1.5] (Callback) Should be able to pause the stream, resume later, get terminated", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                const initialCreatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                // Advance in time a little
                timeStamp = dateToSeconds("2100/09/20");
                await timeTravelToDate(timeStamp);

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
                timeStamp = dateToSeconds("2100/09/25");
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                // Let's make sure we are in the termination window
                const terminationWindow = BigNumber.from(await investment.getTerminationWindow());
                timeStamp = milestoneEndDate.sub(terminationWindow.div(2)).toNumber();
                await timeTravelToDate(timeStamp);

                await sf.cfaV1
                    .deleteFlow({
                        receiver: creator.address,
                        sender: investment.address,
                        superToken: fUSDTx.address,
                    })
                    .exec(creator);

                const creatorBalance = BigNumber.from(
                    await fUSDTx.balanceOf({
                        account: creator.address,
                        providerOrSigner: creator,
                    })
                );
                const milestone = await investment.getMilestone(0);
                const tokenAllocation =
                    await investment.callStatic.getTotalMilestoneTokenAllocation(0);

                assert.deepEqual(
                    creatorBalance.sub(initialCreatorBalance),
                    tokenAllocation,
                    "Should transfer all of the funds to the creator"
                );
                assert.deepEqual(
                    milestone.paidAmount,
                    tokenAllocation,
                    "Paid amount should match the invested amount"
                );
                assert.isTrue(milestone.paid, "Milestone should be marked as paid by now");
            });
        });
        // TODO: Test the ovestream case during a single milestone, probably results in internal contract undeflow, need to confirm
    });

    describe("11. Gelato automated stream termination", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("11.1 Interactions", () => {
            describe("function -> startGelatoTask", () => {
                it("[IP][11.1.1] gelatoTask should be assigned", async () => {
                    const gelatoTask = await investment.getGelatoTask();
                    const zeroInBytes32 = ethers.utils.formatBytes32String("");
                    assert.notEqual(gelatoTask, zeroInBytes32);
                });
            });

            describe("function -> gelatoChecker", () => {
                it("[IP][11.1.2] gelatoChecker should not pass if gelatoTask is not assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investment.getTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    // Remove gelato task
                    await investment.deleteGelatoTask();
                    // Get encode bytes value
                    const encodedFunction = await investment.encodeGelatoTerminationWithSelector(
                        0
                    );

                    // Call gelatoChecker and return value (not the transaction)
                    const {canExec, execPayload} = await investment.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                    assert.equal(execPayload, encodedFunction);
                });

                it("[IP][11.1.3] gelatoChecker should not pass if not in auto termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const {canExec} = await investment.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                });

                it("[IP][11.1.4] gelatoChecker should not pass if stream is not opened", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    const terminationWindow = await investment.getTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    const {canExec} = await investment.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                });

                it("[IP][11.1.5] gelatoChecker should pass if in auto termination window, stream is opened and gelatoTask variable is assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    // Call gelatoChecker and return value (not the transaction)
                    const {canExec} = await investment.callStatic.gelatoChecker();
                    assert.isTrue(canExec);
                });
            });

            describe("function -> gelatoTerminateMilestoneStreamFinal", () => {
                it("[IP][11.1.6] Non gelato address should not be able to call gelato stream termination", async () => {
                    await expect(
                        investment.connect(foreignActor).gelatoTerminateMilestoneStreamFinal(0)
                    ).to.be.revertedWithCustomError(investment, "InvestmentPool__NotGelatoOps");
                });
                it("[IP][11.1.7] Gelato should not be able to terminate stream if gelatoTask is not assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investment.getTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    // Remove gelato task
                    await investment.deleteGelatoTask();
                    // Get encode bytes value

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][11.1.8] gelatoChecker should not pass if not in auto termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][11.1.9] gelatoChecker should not pass if stream is not opened", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    const terminationWindow = await investment.getTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][11.1.10] Investment pool should emit transfer event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    const feeDetails = await gelatoOpsMock.getFeeDetails();

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0))
                        .to.emit(investment, "GelatoFeeTransfer")
                        .withArgs(feeDetails.fee, feeDetails.feeToken);
                });

                it("[IP][11.1.11] Investment pool should transfer fee to Gelato", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    // Send Ether to Investment Pool for gelato task

                    const investmentPoolPriorBalance = await ethers.provider.getBalance(
                        investment.address
                    );
                    const gelatoPriorBalance = await ethers.provider.getBalance(
                        gelatoOpsMock.address
                    );

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const investmentPoolBalance = await ethers.provider.getBalance(
                        investment.address
                    );
                    const gelatoBalance = await ethers.provider.getBalance(gelatoOpsMock.address);
                    const feeDetails = await gelatoOpsMock.getFeeDetails();

                    assert.deepEqual(
                        investmentPoolPriorBalance.sub(feeDetails.fee),
                        investmentPoolBalance
                    );
                    assert.deepEqual(gelatoPriorBalance.add(feeDetails.fee), gelatoBalance);
                });

                it("[IP][11.1.12] Investment pool shouldn't be able to transfer fee to Gelato if not enough tokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    // Transfer all the tokens, to make sure termination fails
                    await investment.transferGelatoFee(gelatoFeeAllocation, ethAddress);

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__GelatoEthTransferFailed"
                    );
                });

                it("[IP][11.1.13] Should emit cancel event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0)).to.emit(
                        investment,
                        "Cancel"
                    );
                });

                it("[IP][11.1.14] Should cancel gelatoTask", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0)).to.emit(
                        gelatoOpsMock,
                        "CancelGelatoTask"
                    );
                });

                it("[IP][11.1.15] If gelato terminates stream, project state should be updated", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    // NOTE: Time traveling to 2100/09/15 when the milestone is active
                    timeStamp = dateToSeconds("2100/09/15");
                    // NOTE: Here we we want explicitly the chain reported time
                    await investment.setTimestamp(0);
                    await timeTravelToDate(timeStamp);

                    await investment.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investment.getAutomatedTerminationWindow();
                    timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                    // NOTE: Here we we want explicitly the chain reported time
                    await timeTravelToDate(timeStamp);

                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const projectState = await investment.getProjectStateByteValue();
                    assert.equal(projectState.toString(), terminatedByGelatoStateValue.toString());
                });
            });
        });

        // TODO: Test termination by 3P system (patricians, plebs, pirates) in case we wouldn't stop it in time, what happens then?
    });

    describe("12. Project cancelation during active milestones", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("12.1 Public state", () => {
            it("[IP][12.1.1] Should update emergencyTerminationTimestamp", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    governancePoolMock.cancelDuringMilestones(investment.address)
                ).to.emit(investment, "Cancel");

                const emergencyTerminationTimestamp =
                    await investment.getEmergencyTerminationTimestamp();
                assert.notEqual(emergencyTerminationTimestamp, 0);
            });

            it("[IP][12.1.2] Should delete flow if it exists", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // NOTE: Time traveling to 2100/09/20
                timeStamp = dateToSeconds("2100/09/20");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                // If timestamp is 0, it means there is no flow
                assert.equal(flowInfo.timestamp.getTime() / 1000, 0);
            });

            it("[IP][12.1.3] Should set streamOngoing to false", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // NOTE: Time traveling to 2100/09/20
                timeStamp = dateToSeconds("2100/09/20");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                const milestone = await investment.getMilestone(0);

                assert.isFalse(milestone.streamOngoing);
            });

            it("[IP][12.1.4] Should update paidAmount with streamed money", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const priorMilestone = await investment.getMilestone(0);

                // NOTE: Time traveling to 2100/09/30
                timeStamp = dateToSeconds("2100/09/30");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                const milestone = await investment.getMilestone(0);

                assert.isTrue(priorMilestone.paidAmount.lt(milestone.paidAmount));
            });

            it("[IP][12.1.5] If terminated by voting, it should update project state", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);

                // Terminate by voting from governance pool
                await governancePoolMock.cancelDuringMilestones(investment.address);

                const projectState = await investment.getProjectStateByteValue();
                assert.equal(projectState.toString(), terminatedByVotingStateValue.toString());
            });
        });

        describe("12.2 Interactions", () => {
            it("[IP][12.2.1] Project can't be canceled if fundraiser was already canceled", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][12.2.2] Project can't be canceled if fundraiser hasn't started", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][12.2.3] Project can't be canceled if fundraiser is active", async () => {
                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][12.2.4] Project can't be canceled if fundraiser has failed", async () => {
                // No investments were made, which means fundraiser failed

                // NOTE: Time traveling to 2100/08/15
                let timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(failedFundraiserStateValue);
            });

            it("[IP][12.2.5] Project can't be canceled if fundraiser ended successfully, but 0 milestone hasn't started yet", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][12.2.6] Project can't be canceled if project was already canceled by voting", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(terminatedByVotingStateValue);
            });

            it("[IP][12.2.7] Project can't be canceled if project milestones have ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                await expect(governancePoolMock.cancelDuringMilestones(investment.address))
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(successfullyEndedStateValue);
            });

            it("[IP][12.2.8] Project can't be canceled if caller isn't a governance pool", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await investment.setTimestamp(timeStamp);

                await expect(
                    investment.connect(foreignActor).cancelDuringMilestones()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__NotGovernancePoolOrGelato"
                );
            });
        });
    });

    describe("13. Milestone jump with final termination", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("13.1 Public state", () => {
            it("[IP][13.1.1] Should terminate old milestone stream", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const priorFlowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.emit(investment, "TerminateStream")
                    .withArgs(0);

                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                // If timestamp is the same, it means the old stream was not terminated
                assert.notEqual(
                    priorFlowInfo.timestamp.getTime() / 1000,
                    flowInfo.timestamp.getTime() / 1000
                );
            });

            it("[IP][13.1.2] Should increase current milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                const currentMilestone = await investment.getCurrentMilestoneId();
                assert.deepEqual(currentMilestone, BigNumber.from(1));
            });

            it("[IP][13.1.3] Should claim another milestone seed funds and open stream", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(1, true, false, false)
                    .to.emit(investment, "ClaimFunds")
                    .withArgs(1, false, false, true);
            });

            it("[IP][13.1.4] If last milestone, shouldn't increase current milestone and claim funds, but only terminate stream", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await expect(
                    investment.connect(creator).milestoneJumpOrFinalProjectTermination()
                ).to.emit(gelatoOpsMock, "CancelGelatoTask");

                const currentMilestone = await investment.getCurrentMilestoneId();
                const flowInfo = await sf.cfaV1.getFlow({
                    superToken: fUSDTx.address,
                    sender: investment.address,
                    receiver: creator.address,
                    providerOrSigner: creator,
                });

                assert.deepEqual(currentMilestone, BigNumber.from(1));
                assert.equal(flowInfo.timestamp.getTime() / 1000, 0);
            });

            it("[IP][13.1.5] If project has ended successfully, the project state should be updated", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                const terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                const projectState = await investment.getProjectStateByteValue();

                assert.equal(projectState.toString(), successfullyEndedStateValue.toString());
            });
        });

        describe("13.2 Interactions", () => {
            it("[IP][13.2.1] Non-creator should be able to do a milestone jump", async () => {
                await expect(
                    investment.connect(foreignActor).milestoneJumpOrFinalProjectTermination()
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__NotCreator");
            });

            it("[IP][13.2.2] Shouldn't be able to do a milestone jump if fundraiser was canceled", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(canceledProjectStateValue);
            });

            it("[IP][13.2.3] Shouldn't be able to do a milestone jump if fundraiser hasn't started", async () => {
                // NOTE: Time traveling to 2100/06/15
                let timeStamp = dateToSeconds("2100/06/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][13.2.4] Shouldn't be able to do a milestone jump if fundraiser is active", async () => {
                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][13.2.5] Shouldn't be able to do a milestone jump if fundraiser has failed", async () => {
                // No investments were made, which means fundraiser failed

                // NOTE: Time traveling to 2100/08/15
                let timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(failedFundraiserStateValue);
            });

            it("[IP][13.2.6] Shouldn't be able to do a milestone jump if fundraiser ended successfully, but 0 milestone hasn't started yet", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][13.2.7] Shouldn't be able to do a milestone jump if project was already canceled by voting", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(terminatedByVotingStateValue);
            });

            it("[IP][13.2.8] Shouldn't be able to do a milestone jump if project milestones have ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(creator).milestoneJumpOrFinalProjectTermination())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(successfullyEndedStateValue);
            });

            it("[IP][13.2.9] Shouldn't be able to do a milestone jump if not in termination window", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                await expect(
                    investment.connect(creator).milestoneJumpOrFinalProjectTermination()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__MilestoneStreamTerminationUnavailable"
                );
            });

            it("[IP][13.2.10] Shouldn't be able to do a milestone jump if stream is not ongoing", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);

                await expect(
                    investment.connect(creator).milestoneJumpOrFinalProjectTermination()
                ).to.be.revertedWithCustomError(
                    investment,
                    "InvestmentPool__MilestoneStreamTerminationUnavailable"
                );
            });
        });
    });

    describe("14. Remaining ETH witdraw", () => {
        beforeEach(async () => {
            let snapshot = await traveler.takeSnapshot();
            snapshotId = snapshot["result"];
        });

        afterEach(async () => {
            await traveler.revertToSnapshot(snapshotId);
        });

        describe("14.1 Public state", () => {
            it("[IP][14.1.1] Creator should be able to get the transfered eth", async () => {
                await investment.connect(creator).cancelBeforeFundraiserStart();

                const priorContractBalance = await ethers.provider.getBalance(investment.address);
                const priorCreatorBalance = await ethers.provider.getBalance(creator.address);

                const tx = await investment.connect(creator).withdrawRemainingEth();
                const receipt = await tx.wait();
                const txFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);

                const contractBalance = await ethers.provider.getBalance(investment.address);
                const creatorBalance = await ethers.provider.getBalance(creator.address);

                assert.deepEqual(priorContractBalance.sub(gelatoFeeAllocation), contractBalance);
                assert.deepEqual(BigNumber.from(0), contractBalance);
                assert.equal(
                    priorCreatorBalance.add(gelatoFeeAllocation).sub(txFee).toString(),
                    creatorBalance.toString()
                );
            });
        });

        describe("14.2 Interactions", () => {
            it("[IP][14.2.1] Creator should be able to withdraw eth if fundraiser has already been canceled", async () => {
                await investment.connect(creator).cancelBeforeFundraiserStart();

                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be
                    .reverted;
            });

            it("[IP][14.2.2] Creator should be able to withdraw eth if fundraiser has failed", async () => {
                // No investments were made, which means fundraiser failed

                // NOTE: Time traveling to 2100/08/15
                const timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be
                    .reverted;
            });

            it("[IP][14.2.3] Creator should be able to withdraw eth if project was terminated by voting", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await governancePoolMock.cancelDuringMilestones(investment.address);

                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be
                    .reverted;
            });

            it("[IP][14.2.4] Creator should be able to withdraw eth after project has ended", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // Invest on fundraiser time
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // Start first milestone (id = 0)
                timeStamp = dateToSeconds("2100/09/15");
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).startFirstFundsStream();

                // Do milestone jump from milestone id 0 to 1
                let terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // Terminate milestone id 1
                terminationWindow = await investment.getTerminationWindow();
                timeStamp = milestoneEndDate2.toNumber() - terminationWindow / 2;
                await timeTravelToDate(timeStamp);
                await investment.connect(creator).milestoneJumpOrFinalProjectTermination();

                // NOTE: Time traveling to 2100/12/15
                timeStamp = dateToSeconds("2100/12/15");
                await timeTravelToDate(timeStamp);

                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be
                    .reverted;
            });

            it("[IP][14.2.5] Creator shouldn't be able to withdraw eth if fundraiser hasn't been started", async () => {
                const time = dateToSeconds("2100/06/15");
                await investment.setTimestamp(time);

                await expect(investment.connect(creator).withdrawRemainingEth())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(beforeFundraiserStateValue);
            });

            it("[IP][14.2.6] Creator shouldn't be able to withdraw eth if fundraiser is active", async () => {
                const time = dateToSeconds("2100/07/15");
                await investment.setTimestamp(time);

                await expect(investment.connect(creator).withdrawRemainingEth())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserOngoingStateValue);
            });

            it("[IP][14.2.7] Creator shouldn't be able to withdraw eth during gap between fundraiser end and 0 milestone start", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/08/15
                timeStamp = dateToSeconds("2100/08/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be;
                await expect(investment.connect(creator).withdrawRemainingEth())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
            });

            it("[IP][14.2.8] Creator shouldn't be able to withdraw eth during not last milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/15
                timeStamp = dateToSeconds("2100/09/15");
                await investment.setTimestamp(timeStamp);
                await expect(investment.connect(creator).withdrawRemainingEth())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(milestonesOngoingBeforeLastStateValue);
            });

            it("[IP][14.2.9] Creator shouldn't be able to withdraw eth during last milestone", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/10/15
                timeStamp = dateToSeconds("2100/10/15");
                await investment.setTimestamp(timeStamp);

                await expect(investment.connect(creator).withdrawRemainingEth())
                    .to.be.revertedWithCustomError(
                        investment,
                        "InvestmentPool__CurrentStateIsNotAllowed"
                    )
                    .withArgs(lastMilestoneOngoingStateValue);
            });

            it("[IP][14.2.10] Creator shouldn't be able to withdraw eth if 0 amount is left", async () => {
                await investment.connect(creator).cancelBeforeFundraiserStart();
                await investment.connect(creator).withdrawRemainingEth();

                await expect(
                    investment.connect(creator).withdrawRemainingEth()
                ).to.be.revertedWithCustomError(investment, "InvestmentPool__NoEthLeftToWithdraw");
            });

            it("[IP][14.2.11] Creator should be able to withdraw eth if project was terminated by gelato", async () => {
                const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                // NOTE: Time traveling to 2100/07/15
                let timeStamp = dateToSeconds("2100/07/15");
                await investment.setTimestamp(timeStamp);
                await investMoney(fUSDTx, investment, investorA, investedAmount);

                // NOTE: Time traveling to 2100/09/15 when the milestone is active
                timeStamp = dateToSeconds("2100/09/15");
                // NOTE: Here we we want explicitly the chain reported time
                await investment.setTimestamp(0);
                await timeTravelToDate(timeStamp);

                await investment.connect(creator).startFirstFundsStream();

                const automatedTerminationWindow =
                    await investment.getAutomatedTerminationWindow();
                timeStamp = milestoneEndDate.toNumber() - automatedTerminationWindow / 2;
                // NOTE: Here we we want explicitly the chain reported time
                await timeTravelToDate(timeStamp);

                await gelatoOpsMock.gelatoTerminateMilestoneStream(0);
                await expect(investment.connect(creator).withdrawRemainingEth()).not.to.be
                    .reverted;
            });
        });
    });

    describe("15. Functionality used only by frontend", () => {
        describe("15.1 Interactions", () => {
            describe("function -> getMilestonesInvestmentsListForFormula", () => {
                it("[IP][15.1.1] Should return empty list if no investments were made", async () => {
                    const investmentsList =
                        await investment.getMilestonesInvestmentsListForFormula();
                    assert.equal(investmentsList[0].toString(), "0");
                    assert.equal(investmentsList[1].toString(), "0");
                });

                it("[IP][15.1.2] Should return correct values for later usage", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    // NOTE: Time traveling to 2100/07/15
                    let timeStamp = dateToSeconds("2100/07/15");
                    await investment.setTimestamp(timeStamp);
                    await investMoney(fUSDTx, investment, investorA, investedAmount);

                    const investmentsList =
                        await investment.getMilestonesInvestmentsListForFormula();

                    assert.equal(investmentsList[0].toString(), investedAmount.toString());
                    assert.equal(investmentsList[1].toString(), "0");
                });
            });
        });
    });

    describe("Upgradeability", () => {
        // Validate that the storage slots for contract variables don't change their storage slot and offset
        // Validate that struct member order hasn't changed
        // it("Contract storage variables didn't shift during development", async () => {
        //   await investment.validateStorageLayout();
        // });
    });
});
