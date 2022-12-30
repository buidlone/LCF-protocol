import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants, BigNumberish} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {
    InvestmentPoolFactoryMock,
    InvestmentPoolMock,
    GovernancePoolMockForIntegration,
    DistributionPoolMockForIntegration,
    GelatoOpsMock,
    VotingTokenMock,
    Buidl1,
} from "../typechain-types";
import traveler from "ganache-time-traveler";

const fTokenAbi = require("./abis/fTokenAbi");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");

// Corresponds to each investor having N fUSDTx (fake USDT wrapped into a SuperToken, hence x suffix)
// Should be enough for all of the tests, in order to not perform funding before each
const INVESTOR_INITIAL_FUNDS = ethers.utils.parseEther("50000000000");
const provider = web3;

let fUSDT: InstanceType<typeof fTokenAbi>;
let fUSDTx: WrapperSuperToken;

let accounts: SignerWithAddress[];
let superfluidAdmin: SignerWithAddress;
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;
let investors: SignerWithAddress[];
let foreignActor: SignerWithAddress;

let sf: Framework;
let investmentPoolFactory: InvestmentPoolFactoryMock;
let investmentPool: InvestmentPoolMock;
let governancePool: GovernancePoolMockForIntegration;
let distributionPool: DistributionPoolMockForIntegration;
let gelatoOpsMock: GelatoOpsMock;
let votingToken: VotingTokenMock;

let snapshotId: string;

let softCap: BigNumber;
let hardCap: BigNumber;
let milestone0StartDate: number;
let milestone0EndDate: number;
let milestone1StartDate: number;
let milestone1EndDate: number;
let fundraiserStartDate: number;
let fundraiserEndDate: number;
let tokenRewards: BigNumber;

let gelatoFeeAllocation: BigNumber;
let investmentWithdrawFee: BigNumber;
let ethAddress: string;

// Percentages (in divider format)
let percentageDivider: BigNumber = BigNumber.from(0);
let formated5Percent: BigNumber;
let formated20Percent: BigNumber;
let formated70Percent: BigNumber;

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

// Multipliers
let softCapMultiplier: BigNumber;
let hardCapMultiplier: BigNumber;

const formatPercentage = (percent: BigNumberish): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const errorHandler = (err: any) => {
    if (err) throw err;
};

const dateToSeconds = (date: string): number => {
    return new Date(date).getTime() / 1000;
};

const timeTravelToDate = async (date: number) => {
    await traveler.advanceBlockAndSetTime(date);
};

const timeTravelByIncreasingSeconds = async (seconds: number) => {
    await traveler.advanceTimeAndBlock(seconds);
};

const investMoney = async (
    token: WrapperSuperToken,
    investmentPool: InvestmentPoolMock,
    investorObj: SignerWithAddress,
    investedMoney: BigNumber
) => {
    // Give token approval
    await token
        .approve({
            receiver: investmentPool.address,
            amount: investedMoney.toString(),
        })
        .exec(investorObj);

    // Invest money
    await investmentPool.connect(investorObj).invest(investedMoney, false);
};

const deployLogicContracts = async (): Promise<
    [InvestmentPoolMock, GovernancePoolMockForIntegration, DistributionPoolMockForIntegration]
> => {
    // Create investment pool implementation contract
    const investmentPoolDep = await ethers.getContractFactory("InvestmentPoolMock", buidl1Admin);
    const investmentPoolLogic = await investmentPoolDep.deploy();
    await investmentPoolLogic.deployed();

    // Create governance pool implementation contract
    const governancePoolFactory = await ethers.getContractFactory(
        "GovernancePoolMockForIntegration",
        buidl1Admin
    );
    const governancePoolLogic = await governancePoolFactory.deploy();
    await governancePoolLogic.deployed();

    const distributionPoolLogicDep = await ethers.getContractFactory(
        "DistributionPoolMockForIntegration",
        buidl1Admin
    );
    const distributionPoolLogic = await distributionPoolLogicDep.deploy();
    await distributionPoolLogic.deployed();

    return [investmentPoolLogic, governancePoolLogic, distributionPoolLogic];
};

const deployBuidl1Token = async (): Promise<Buidl1> => {
    const buidl1TokenDep = await ethers.getContractFactory("Buidl1", buidl1Admin);
    const buidl1Token = await buidl1TokenDep.deploy();
    await buidl1Token.deployed();

    return buidl1Token;
};

const deployInvestmentPoolFactory = async () => {
    const [investmentPoolLogic, governancePoolLogic, distributionPoolLogic] =
        await deployLogicContracts();

    // Create and deploy Gelato Ops contract mock
    const GelatoOpsMock = await ethers.getContractFactory("GelatoOpsMock", buidl1Admin);
    gelatoOpsMock = await GelatoOpsMock.deploy();
    await gelatoOpsMock.deployed();

    // Create voting token
    const votingTokenDep = await ethers.getContractFactory("VotingTokenMock", buidl1Admin);
    votingToken = await votingTokenDep.deploy();
    await votingToken.deployed();

    const investmentPoolDepFactory = await ethers.getContractFactory(
        "InvestmentPoolFactoryMock",
        buidl1Admin
    );
    investmentPoolFactory = await investmentPoolDepFactory.deploy(
        sf.settings.config.hostAddress,
        gelatoOpsMock.address,
        investmentPoolLogic.address,
        governancePoolLogic.address,
        distributionPoolLogic.address,
        votingToken.address
    );
    await investmentPoolFactory.deployed();

    // Enforce a starting timestamp to avoid time based bugs
    const time = dateToSeconds("2100/06/01");
    await investmentPoolFactory.setTimestamp(time);
};

const getConstantVariablesFromContract = async () => {
    const [investmentPoolLogic, ,] = await deployLogicContracts();

    percentageDivider = await investmentPoolFactory.getPercentageDivider();
    formated5Percent = formatPercentage(5);
    formated20Percent = formatPercentage(20);
    formated70Percent = formatPercentage(70);

    gelatoFeeAllocation = await investmentPoolFactory.getGelatoFeeAllocationForProject();
    ethAddress = await investmentPoolLogic.getEthAddress();
    investmentWithdrawFee = await investmentPoolFactory.getInvestmentWithdrawPercentageFee();
    softCapMultiplier = await investmentPoolFactory.getSoftCapMultiplier();
    hardCapMultiplier = await investmentPoolFactory.getHardCapMultiplier();

    await defineProjectStateByteValues(investmentPoolLogic);
};

const defineProjectStateByteValues = async (ip: InvestmentPoolMock) => {
    canceledProjectStateValue = await ip.getCanceledProjectStateValue();
    beforeFundraiserStateValue = await ip.getBeforeFundraiserStateValue();
    fundraiserOngoingStateValue = await ip.getFundraiserOngoingStateValue();
    failedFundraiserStateValue = await ip.getFailedFundraiserStateValue();
    fundraiserEndedNoMilestonesOngoingStateValue =
        await ip.getFundraiserEndedNoMilestonesOngoingStateValue();
    milestonesOngoingBeforeLastStateValue = await ip.getMilestonesOngoingBeforeLastStateValue();
    lastMilestoneOngoingStateValue = await ip.getLastMilestoneOngoingStateValue();
    terminatedByVotingStateValue = await ip.getTerminatedByVotingStateValue();
    terminatedByGelatoStateValue = await ip.getTerminatedByGelatoStateValue();
    successfullyEndedStateValue = await ip.getSuccessfullyEndedStateValue();
};

const getContractsFromTx = async (
    tx: ContractTransaction
): Promise<
    [InvestmentPoolMock, GovernancePoolMockForIntegration, DistributionPoolMockForIntegration]
> => {
    const creationEvent = (await tx.wait(1)).events?.find((e) => e.event === "Created");
    assert.isDefined(creationEvent, "Didn't emit creation event");

    const ipAddress = creationEvent?.args?.ipContract;
    const ipContractFactory = await ethers.getContractFactory("InvestmentPoolMock", buidl1Admin);
    const ipContract = ipContractFactory.attach(ipAddress);

    const gpAddress = creationEvent?.args?.gpContract;
    const gpContractFactory = await ethers.getContractFactory(
        "GovernancePoolMockForIntegration",
        buidl1Admin
    );
    const gpContract = gpContractFactory.attach(gpAddress);

    const dpAddress = creationEvent?.args?.dpContract;
    const dpContractFactory = await ethers.getContractFactory(
        "DistributionPoolMockForIntegration",
        buidl1Admin
    );
    const dpContract = dpContractFactory.attach(dpAddress);
    return [ipContract, gpContract, dpContract];
};

const createInvestmentWithTwoMilestones = async (feeAmount: BigNumber = gelatoFeeAllocation) => {
    hardCap = ethers.utils.parseEther("15000");
    softCap = ethers.utils.parseEther("1500");
    fundraiserStartDate = dateToSeconds("2100/07/01");
    fundraiserEndDate = dateToSeconds("2100/08/01");
    milestone0StartDate = dateToSeconds("2100/09/01");
    milestone0EndDate = dateToSeconds("2100/10/01");
    milestone1StartDate = dateToSeconds("2100/10/01");
    milestone1EndDate = dateToSeconds("2100/12/01");
    tokenRewards = ethers.utils.parseEther("15000000");

    const buidl1Token = await deployBuidl1Token();

    const creationRes: ContractTransaction = await investmentPoolFactory
        .connect(creator)
        .createProjectPools(
            {
                softCap: softCap,
                hardCap: hardCap,
                fundraiserStartAt: fundraiserStartDate,
                fundraiserEndAt: fundraiserEndDate,
                acceptedToken: fUSDTx.address,
                projectToken: buidl1Token.address,
                tokenRewards: tokenRewards,
            },
            0, // CLONE-PROXY
            [
                {
                    startDate: milestone0StartDate,
                    endDate: milestone0EndDate,
                    intervalSeedPortion: formated5Percent,
                    intervalStreamingPortion: formated70Percent,
                },
                {
                    startDate: milestone1StartDate,
                    endDate: milestone1EndDate,
                    intervalSeedPortion: formated5Percent,
                    intervalStreamingPortion: formated20Percent,
                },
            ],
            {value: feeAmount}
        );

    [investmentPool, governancePool, distributionPool] = await getContractsFromTx(creationRes);
};

const deploySuperfluidToken = async () => {
    // deploy the framework
    await deployFramework(errorHandler, {
        web3,
        from: superfluidAdmin.address,
    });

    // deploy a fake erc20 token
    await deployTestToken(errorHandler, [":", "fUSDT"], {
        web3,
        from: superfluidAdmin.address,
    });

    // deploy a fake erc20 wrapper super token around the fUSDT token
    await deploySuperToken(errorHandler, [":", "fUSDT"], {
        web3,
        from: superfluidAdmin.address,
    });

    sf = await Framework.create({
        resolverAddress: process.env.RESOLVER_ADDRESS,
        chainId: 31337,
        provider,
        protocolReleaseVersion: "test",
    });

    fUSDTx = await sf.loadWrapperSuperToken("fUSDTx");
    fUSDT = new ethers.Contract(fUSDTx.underlyingToken.address, fTokenAbi, superfluidAdmin);
};

const transferSuperTokens = async () => {
    const totalAmount = INVESTOR_INITIAL_FUNDS.mul(investors.length);

    // Fund investors
    await fUSDT.connect(superfluidAdmin).mint(superfluidAdmin.address, totalAmount);
    await fUSDT.connect(superfluidAdmin).approve(fUSDTx.address, totalAmount);

    const upgradeOperation = fUSDTx.upgrade({
        amount: totalAmount.toString(),
    });
    const operations = [upgradeOperation];

    // Transfer upgraded tokens to investors
    for (let i = 0; i < investors.length; i++) {
        const operation = fUSDTx.transferFrom({
            sender: superfluidAdmin.address,
            amount: INVESTOR_INITIAL_FUNDS.toString(),
            receiver: investors[i].address,
        });
        operations.push(operation);
    }

    await sf.batchCall(operations).exec(superfluidAdmin);
};

const tokenBalanceOf = async (token: WrapperSuperToken, account: string): Promise<BigNumber> => {
    return BigNumber.from(
        await token.balanceOf({
            account: account,
            providerOrSigner: buidl1Admin,
        })
    );
};

const getSuperTokensFlow = async (token: WrapperSuperToken, sender: string, receiver: string) => {
    const flow = await sf.cfaV1.getFlow({
        superToken: token.address,
        sender: sender,
        receiver: receiver,
        providerOrSigner: buidl1Admin,
    });

    return flow;
};

describe("Investment Pool", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();
        superfluidAdmin = accounts[0];
        buidl1Admin = accounts[1];
        creator = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        foreignActor = accounts[5];
        investors = [investorA, investorB];

        await deploySuperfluidToken();
        await transferSuperTokens();

        await deployInvestmentPoolFactory();
        await getConstantVariablesFromContract();
    });

    beforeEach(async () => {
        await createInvestmentWithTwoMilestones();
        let snapshot = await traveler.takeSnapshot();
        snapshotId = snapshot["result"];
    });

    afterEach(async () => {
        await traveler.revertToSnapshot(snapshotId);

        // If prior investment exists, check if it has an active money stream, terminate it
        if (investmentPool) {
            const existingFlow = await getSuperTokensFlow(
                fUSDTx,
                investmentPool.address,
                creator.address
            );

            // App is actively streaming money to our creator, terminate that stream
            if (BigNumber.from(existingFlow.flowRate).gt(0)) {
                console.log("TERMINATE FLOW");
                await sf.cfaV1
                    .deleteFlow({
                        sender: investmentPool.address,
                        receiver: creator.address,
                        superToken: fUSDTx.address,
                    })
                    .exec(creator);
            }
        }
    });

    describe("Functions", () => {
        describe("1. initialize() function", () => {
            describe("1.1 Public state", () => {
                it("[IP][1.1.1] Should assign accepted token correctly", async () => {
                    const acceptedToken = await investmentPool.getAcceptedToken();
                    assert.equal(acceptedToken, fUSDTx.address);
                });

                it("[IP][1.1.2] Should assign creator correctly", async () => {
                    const contractCreator = await investmentPool.getCreator();
                    assert.equal(contractCreator, creator.address);
                });

                it("[IP][1.1.3] Should assign soft cap correctly", async () => {
                    const contractSoftCap = await investmentPool.getSoftCap();
                    assert.equal(contractSoftCap.toString(), softCap.toString());
                });

                it("[IP][1.1.4] Should assign hard cap correctly", async () => {
                    const contractHardCap = await investmentPool.getHardCap();
                    assert.equal(contractHardCap.toString(), hardCap.toString());
                });

                it("[IP][1.1.5] Should assign fundraiser start time correctly", async () => {
                    const contractFundraiserStart = await investmentPool.getFundraiserStartTime();
                    assert.equal(contractFundraiserStart, fundraiserStartDate);
                });

                it("[IP][1.1.6] Should assign fundraiser end time correctly", async () => {
                    const contractFundraiserEnd = await investmentPool.getFundraiserEndTime();
                    assert.equal(contractFundraiserEnd, fundraiserEndDate);
                });

                it("[IP][1.1.7] Should assign termination window correctly", async () => {
                    const contractTermination = await investmentPool.getTerminationWindow();
                    const realTermination = await investmentPoolFactory.getTerminationWindow();

                    assert.equal(contractTermination, realTermination);
                });

                it("[IP][1.1.8] Should assign automated termination window correctly", async () => {
                    const contractTermination =
                        await investmentPool.getAutomatedTerminationWindow();
                    const realTermination =
                        await investmentPoolFactory.getAutomatedTerminationWindow();

                    assert.equal(contractTermination, realTermination);
                });

                it("[IP][1.1.9] Should assign soft cap multiplier correctly", async () => {
                    const contractMultiplier = await investmentPool.getSoftCapMultiplier();
                    assert.equal(contractMultiplier.toString(), softCapMultiplier.toString());
                });

                it("[IP][1.1.10] Should assign investment withdraw fee correctly", async () => {
                    const withdrawFee = await investmentPool.getInvestmentWithdrawPercentageFee();
                    assert.equal(withdrawFee.toString(), investmentWithdrawFee.toString());
                });

                it("[IP][1.1.11] Should assign milestones count correctly", async () => {
                    const contractCount = await investmentPool.getMilestonesCount();
                    assert.equal(contractCount.toString(), "2");
                });

                it("[IP][1.1.12] Should assign current milestone to zero", async () => {
                    const contractCurrentMilestone = await investmentPool.getCurrentMilestoneId();
                    assert.equal(contractCurrentMilestone.toString(), "0");
                });

                it("[IP][1.1.13] Should assign governance pool correctly", async () => {
                    const gp = await investmentPool.getGovernancePool();
                    assert.equal(gp, governancePool.address);
                });

                it("[IP][1.1.14] Should assign distribution pool correctly", async () => {
                    const dp = await investmentPool.getDistributionPool();
                    assert.equal(dp, distributionPool.address);
                });

                it("[IP][1.1.15] Should assign gelato ops correctly", async () => {
                    const contractGelatoOps = await investmentPool.getGelatoOps();
                    assert.equal(contractGelatoOps, gelatoOpsMock.address);
                });

                it("[IP][1.1.16] Should assign gelato correctly", async () => {
                    const gelatoAddress = await investmentPool.getGelato();
                    assert.equal(gelatoOpsMock.address, gelatoAddress);
                });

                it("[IP][1.1.17] Fundraiser shouldn't be terminated with emergency on a new project", async () => {
                    const isEmergencyTerminated = await investmentPool.isEmergencyTerminated();
                    assert.isFalse(isEmergencyTerminated);
                });

                it("[IP][1.1.18] Fundraiser shouldn't be ongoing on a new project", async () => {
                    // NOTE: At this point we are at 2100/06/01
                    const isFundraiserOngoing = await investmentPool.isFundraiserOngoingNow();
                    assert.isFalse(isFundraiserOngoing);
                });

                it("[IP][1.1.19] Fundraiser shouldn't have reached soft cap upon creation", async () => {
                    const hasRaisedSoftCap = await investmentPool.isSoftCapReached();
                    assert.isFalse(hasRaisedSoftCap);
                });

                it("[IP][1.1.20] Fundraiser shouldn't have ended upon campaign creation", async () => {
                    const hasFundraiserEnded = await investmentPool.didFundraiserPeriodEnd();
                    assert.isFalse(hasFundraiserEnded);
                });

                it("[IP][1.1.21] Fundraiser shouldn't have a failed fundraiser state on creation", async () => {
                    const isFailed = await investmentPool.isFailedFundraiser();
                    assert.isFalse(isFailed);
                });

                it("[IP][1.1.22] Fundraiser shouldn't have any investments yet", async () => {
                    const invested = await investmentPool.getTotalInvestedAmount();
                    assert.equal(invested.toString(), "0");
                });

                it("[IP][1.1.23] Milestones should have a correct start date", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.equal(milestone0.startDate, milestone0StartDate);
                    assert.equal(milestone1.startDate, milestone1StartDate);
                });

                it("[IP][1.1.24] Milestones should have a correct end date", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.equal(milestone0.endDate, milestone0EndDate);
                    assert.equal(milestone1.endDate, milestone1EndDate);
                });

                it("[IP][1.1.25] Milestones shouldn't be paid initially", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.isFalse(milestone0.paid);
                    assert.isFalse(milestone1.paid);
                });

                it("[IP][1.1.26] Milestone seed amounts shouldn't be paid initially", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.isFalse(milestone0.seedAmountPaid);
                    assert.isFalse(milestone1.seedAmountPaid);
                });

                it("[IP][1.1.27] Milestone streams shouldn't be ongoing from the start", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.isFalse(milestone0.streamOngoing);
                    assert.isFalse(milestone1.streamOngoing);
                });

                it("[IP][1.1.28] Should have paid 0 in funds upon creation", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.equal(milestone0.paidAmount.toString(), "0");
                    assert.equal(milestone1.paidAmount.toString(), "0");
                });

                it("[IP][1.1.29] Milestones should have a correct seed portions", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.equal(
                        milestone0.intervalSeedPortion.toString(),
                        formated5Percent.toString()
                    );
                    assert.equal(
                        milestone1.intervalSeedPortion.toString(),
                        formated5Percent.toString()
                    );
                });

                it("[IP][1.1.30] Milestones should have a correct stream portions", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    assert.equal(
                        milestone0.intervalStreamingPortion.toString(),
                        formated70Percent.toString()
                    );
                    assert.equal(
                        milestone1.intervalStreamingPortion.toString(),
                        formated20Percent.toString()
                    );
                });

                it("[IP][1.1.31] Should assign milestones portions correctly", async () => {
                    const milestone0Portion = await investmentPool.getMemMilestonePortions(0);
                    const milestone1Portion = await investmentPool.getMemMilestonePortions(1);
                    const lastItem = await investmentPool.getMemMilestonePortions(2);
                    assert.equal(milestone0Portion.toString(), percentageDivider.toString());
                    assert.equal(milestone1Portion.toString(), formatPercentage(25).toString());
                    assert.equal(lastItem.toString(), "0");
                });

                it("[IP][1.1.32] Should assign total streaming duration correctly", async () => {
                    const totalStreamingDuration =
                        await investmentPool.getTotalStreamingDuration();
                    const realDuration =
                        milestone0EndDate -
                        milestone0StartDate +
                        (milestone1EndDate - milestone1StartDate);
                    assert.equal(totalStreamingDuration.toString(), realDuration.toString());
                });

                it("[IP][1.1.33] Should get correct milestone durations", async () => {
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    const milestone0Duration = await investmentPool.getMilestoneDuration(0);
                    const milestone0ExpectedDuration = milestone0.endDate - milestone0.startDate;
                    const milestone1Duration = await investmentPool.getMilestoneDuration(1);
                    const milestone1ExpectedDuration = milestone1.endDate - milestone1.startDate;
                    assert.equal(milestone0Duration.toNumber(), milestone0ExpectedDuration);
                    assert.equal(milestone1Duration.toNumber(), milestone1ExpectedDuration);
                });

                it("[IP][1.1.34] Fundraiser shouldn't have started yet", async () => {
                    const fundraiserNotStarted = await investmentPool.isFundraiserNotStarted();
                    assert.isTrue(fundraiserNotStarted);
                });

                it("[IP][1.1.35] Milestones shouldn't be ongoing yet", async () => {
                    const milestonesOngoing = await investmentPool.isAnyMilestoneOngoing();
                    assert.isFalse(milestonesOngoing);
                });

                it("[IP][1.1.36] Project shouldn't have ended yet", async () => {
                    const ended = await investmentPool.didProjectEnd();
                    assert.isFalse(ended);
                });

                it("[IP][1.1.37] Project state should be - before fundraiser", async () => {
                    const state = await investmentPool.getProjectStateByteValue();
                    assert.equal(state.toString(), beforeFundraiserStateValue.toString());
                });
            });
        });

        describe("2. cancelBeforeFundraiserStart() function", () => {
            describe("2.1 Interactions", () => {
                it("[IP][2.1.1] Fundraiser can be canceled if it's not started yet", async () => {
                    // Timestamp before fundraiser start
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(
                        investmentPool.connect(creator).cancelBeforeFundraiserStart()
                    ).to.emit(investmentPool, "Cancel");

                    assert.notEqual(await investmentPool.getEmergencyTerminationTimestamp(), 0);
                });

                it("[IP][2.1.2] Before the fundraiser, it should return the correct state", async () => {
                    // Timestamp before fundraiser start
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), beforeFundraiserStateValue.toString());
                });

                it("[IP][2.1.3] After canceling the fundraiser, project state should change", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), canceledProjectStateValue.toString());
                });

                it("[IP][2.1.4] Fundraiser can't be canceled by anyone, except creator", async () => {
                    // Timestamp before fundraiser start
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(
                        investmentPool.connect(foreignActor).cancelBeforeFundraiserStart()
                    ).to.be.revertedWithCustomError(investmentPool, "InvestmentPool__NotCreator");
                });

                it("[IP][2.1.5] Fundraiser can't be canceled, if it's already started", async () => {
                    // Fundraiser has already started by now
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(investmentPool.connect(creator).cancelBeforeFundraiserStart())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][2.1.6] Fundraiser can't be canceled, if it's already been canceled", async () => {
                    // Timestamp before fundraiser start
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(creator).cancelBeforeFundraiserStart())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][2.1.7] If fundraiser is canceled, state functions should return correct answers", async () => {
                    // Timestamp before fundraiser start
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    assert.isTrue(await investmentPool.isCanceledBeforeFundraiserStart());
                    assert.isTrue(await investmentPool.isFundraiserNotStarted());
                    assert.isTrue(await investmentPool.isEmergencyTerminated());
                    assert.isFalse(await investmentPool.isFailedFundraiser());
                    assert.isFalse(await investmentPool.isFundraiserOngoingNow());
                    assert.isFalse(await investmentPool.isFundraiserEndedButNoMilestoneIsActive());
                    assert.isFalse(await investmentPool.isAnyMilestoneOngoing());
                    assert.isFalse(await investmentPool.isLastMilestoneOngoing());
                    assert.isFalse(await investmentPool.isCanceledDuringMilestones());
                    assert.isFalse(await investmentPool.didProjectEnd());
                    assert.notEqual(
                        await investmentPool.getGelatoTask(),
                        ethers.utils.formatBytes32String("")
                    );
                });
            });
        });

        describe("3. invest() function", () => {
            describe("3.1 Public state", () => {
                it("[IP][3.1.1] In fundraising period investors investment should update memMilestoneInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const memMilestoneInvestments =
                        await investmentPool.getMemMilestoneInvestments(0);
                    assert.equal(investedAmount.toString(), memMilestoneInvestments.toString());
                });

                it("[IP][3.1.2] In fundraising period investors investment should update investedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const contractInvestedAmount = await investmentPool.getInvestedAmount(
                        investorA.address,
                        0
                    );
                    assert.equal(investedAmount.toString(), contractInvestedAmount.toString());
                });

                it("[IP][3.1.3] In fundraising period investors investment should update totalInvestedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const totalInvestedAmount = await investmentPool.getTotalInvestedAmount();
                    assert.equal(investedAmount.toString(), totalInvestedAmount.toString());
                });

                it("[IP][3.1.4] In fundraising period investors investment should update investors and contract balance", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("100");
                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const investorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);

                    const investorBalanceDiff = investorPriorBalance.sub(investedAmount);
                    const contractTotalBalance = contractPriorBalance.add(investedAmount);
                    assert.equal(investorBalance.toString(), investorBalanceDiff.toString());
                    assert.equal(contractBalance.toString(), contractTotalBalance.toString());
                });

                it("[IP][3.1.5] In fundraising period investors investment should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("100");
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await fUSDTx
                        .approve({
                            receiver: investmentPool.address,
                            amount: investedAmount.toString(),
                        })
                        .exec(investorA);

                    await expect(investmentPool.connect(investorA).invest(investedAmount, false))
                        .to.emit(investmentPool, "Invest")
                        .withArgs(investorA.address, investedAmount);
                });

                it("[IP][3.1.6] In milestone 0 period investors investment should update memMilestoneInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    const memMilestoneInvestments =
                        await investmentPool.getMemMilestoneInvestments(1);
                    const memMilestonePortions = await investmentPool.getMemMilestonePortions(1);
                    const expectedMemInvestment = investedAmount.add(
                        investedAmount2.mul(percentageDivider).div(memMilestonePortions)
                    );

                    assert.equal(
                        memMilestoneInvestments.toString(),
                        expectedMemInvestment.toString()
                    );
                });

                it("[IP][3.1.7] In milestone 0 period investors investment should update investedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    const amount = await investmentPool.getInvestedAmount(investorB.address, 1);
                    assert.equal(investedAmount2.toString(), amount.toString());
                });

                it("[IP][3.1.8] In milestone 0 period investors investment should update totalInvestedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    const amount = await investmentPool.getTotalInvestedAmount();
                    assert.equal(
                        investedAmount.add(investedAmount2).toString(),
                        amount.toString()
                    );
                });

                it("[IP][3.1.9] In milestone 0 period investors investment should update investors and contract balance", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    const investorBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);

                    const investorBalanceDiff = investorPriorBalance.sub(investedAmount2);
                    const contractTotalBalance = contractPriorBalance.add(investedAmount2);
                    assert.equal(investorBalance.toString(), investorBalanceDiff.toString());
                    assert.equal(contractBalance.toString(), contractTotalBalance.toString());
                });

                it("[IP][3.1.10] In milestone 0 period investors investment should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));

                    await fUSDTx
                        .approve({
                            receiver: investmentPool.address,
                            amount: investedAmount2.toString(),
                        })
                        .exec(investorB);

                    await expect(investmentPool.connect(investorB).invest(investedAmount2, false))
                        .to.emit(investmentPool, "Invest")
                        .withArgs(investorB.address, investedAmount2);
                });

                it("[IP][3.1.11] In milestone 0 period, project should have milestones ongoing state", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        projectState.toString(),
                        milestonesOngoingBeforeLastStateValue.toString()
                    );
                });

                it("[IP][3.1.12] In milestone 1 period, project should have last milestone ongoing state", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        projectState.toString(),
                        lastMilestoneOngoingStateValue.toString()
                    );
                });
                it("[IP][3.1.13] Should push milestone id to the milestonesWithInvestment list if no investments were made during milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const milestoneIds = await investmentPool.getMilestonesWithInvestment(
                        investorA.address
                    );
                    assert.deepEqual(milestoneIds, [BigNumber.from(0), BigNumber.from(1)]);
                });

                it("[IP][3.1.14] Shouldn't push milestone id to the milestonesWithInvestment list if investment was already made previously", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const milestoneIds = await investmentPool.getMilestonesWithInvestment(
                        investorA.address
                    );
                    assert.deepEqual(milestoneIds, [BigNumber.from(0)]);
                });

                it("[IP][3.1.15] In fundraiser period should update memInvestorInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const memInvestment = await investmentPool.getMemInvestorInvestments(
                        investorA.address,
                        0
                    );
                    assert.equal(memInvestment.toString(), investedAmount.mul(2).toString());
                });

                it("[IP][3.1.16] In milestone 0 period should update memInvestorInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const memInvestment = await investmentPool.getMemInvestorInvestments(
                        investorA.address,
                        1
                    );
                    const portionLeft = await investmentPool.getMilestonesPortionLeft(1);
                    assert.equal(
                        memInvestment.toString(),
                        investedAmount
                            .add(investedAmount.mul(percentageDivider).div(portionLeft))
                            .toString()
                    );
                });
            });

            describe("3.2 Interactions", () => {
                it("[IP][3.2.1] Shouldn't be able to invest zero amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("0");
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(
                        investmentPool.connect(investorA).invest(investedAmount, false)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__ZeroAmountProvided"
                    );
                });

                it("[IP][3.2.2] Investor shouldn't be able to invest if fundraiser has already been canceled", async () => {
                    const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(investorA).invest(amountToInvest, false))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][3.2.3] Investor shouldn't be able to invest if fundraiser hasn't been started", async () => {
                    const amountToInvest: BigNumber = ethers.utils.parseEther("1");
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(investmentPool.connect(investorA).invest(amountToInvest, false))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][3.2.4] Investor shouldn't be able to invest if fundraiser has failed", async () => {
                    const amountToInvest: BigNumber = ethers.utils.parseEther("1");

                    // No investments were made, which means fundraiser failed
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investmentPool.connect(investorA).invest(amountToInvest, false))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(failedFundraiserStateValue);
                });

                it("[IP][3.2.5] Investor shouldn't be able to invest during gap between fundraiser end and 0 milestone start", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investMoney(fUSDTx, investmentPool, investorB, investedAmount))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][3.2.6] Shouldn't be able to invest in last milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await expect(investMoney(fUSDTx, investmentPool, investorB, investedAmount))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(lastMilestoneOngoingStateValue);
                });

                it("[IP][3.2.7] Shouldn't be able to invest if project was terminated by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(investMoney(fUSDTx, investmentPool, investorB, investedAmount))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(terminatedByVotingStateValue);
                });

                it("[IP][3.2.8] Investor shouldn't be able to invest after project has ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));

                    await expect(investMoney(fUSDTx, investmentPool, investorB, investedAmount))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(successfullyEndedStateValue);
                });

                it("[IP][3.2.9] Investor shouldn't be able to invest more than a hard cap if stric mode is enabled", async () => {
                    const investedAmount: BigNumber = hardCap.add(1);
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(
                        investmentPool.connect(investorA).invest(investedAmount, true)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__CannotInvestAboveHardCap"
                    );
                });

                it("[IP][3.2.10] Investor shouldn't be able to invest more than a hard cap if hard cap is reached", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1");
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, hardCap);

                    await expect(
                        investmentPool.connect(investorB).invest(investedAmount, false)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__CannotInvestAboveHardCap"
                    );
                });

                it("[IP][3.2.11] Investor shouldn't be able to invest more than a hard cap if hard cap is reached and stric mode is enabled", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1");
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, hardCap);

                    await expect(
                        investmentPool.connect(investorA).invest(investedAmount, true)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__CannotInvestAboveHardCap"
                    );
                });

                it("[IP][3.2.12] Should allow a smaller investment to go through than a total amount", async () => {
                    const investedAmount: BigNumber = hardCap.add(10);
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    // Give token approval
                    await fUSDTx
                        .approve({
                            receiver: investmentPool.address,
                            amount: investedAmount.toString(),
                        })
                        .exec(investorA);

                    await expect(investmentPool.connect(investorA).invest(investedAmount, false))
                        .to.emit(investmentPool, "Invest")
                        .withArgs(investorA.address, hardCap);
                });

                it("[IP][3.2.13] Investors should be able to collectively raise the soft cap", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("750");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);

                    const softCapRaised = await investmentPool.isSoftCapReached();
                    assert.isTrue(softCapRaised);
                });
            });
        });

        describe("4. unpledge() function", () => {
            describe("4.1 Public state", () => {
                it("[IP][4.1.1] In fundraising period unpledge should update totalInvestedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount.mul(2));
                    await investmentPool.connect(investorA).unpledge();

                    const currentTotalInvestedAmount =
                        await investmentPool.getTotalInvestedAmount();
                    assert.equal(
                        currentTotalInvestedAmount.toString(),
                        investedAmount.mul(2).toString()
                    );
                });

                it("[IP][4.1.2] In fundraising period unpledge should update investedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const currentInvestedAmount = await investmentPool.getInvestedAmount(
                        investorA.address,
                        0
                    );
                    assert.equal(currentInvestedAmount.toString(), "0");
                });

                it("[IP][4.1.3] In fundraising period unpledge should update memMilestoneInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const memMilestoneInvestments =
                        await investmentPool.getMemMilestoneInvestments(0);
                    assert.equal(memMilestoneInvestments.toString(), investedAmount.toString());
                });

                it("[IP][4.1.4] In fundraising period unpledge should update investors and contract balance", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const investorsBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);
                    const feeAmount: BigNumber = investedAmount
                        .mul(investmentWithdrawFee)
                        .div(100);

                    assert.equal(
                        investorsBalance.toString(),
                        investorPriorBalance.sub(feeAmount).toString()
                    );
                    assert.equal(
                        contractBalance.toString(),
                        contractPriorBalance.add(feeAmount).toString()
                    );
                });

                it("[IP][4.1.5] In fundraising period unpledge should emit event with investor and amount args", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.emit(investmentPool, "Unpledge")
                        .withArgs(investorA.address, investedAmount);
                });

                it("[IP][4.1.6] In milestone 0 period unpledge should update memMilestoneInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const priorMemMilestoneInvestments =
                        await investmentPool.getMemMilestoneInvestments(0);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);
                    await investmentPool.connect(investorB).unpledge();

                    const memMilestoneInvestments =
                        await investmentPool.getMemMilestoneInvestments(1);
                    assert.equal(
                        memMilestoneInvestments.toString(),
                        priorMemMilestoneInvestments.toString()
                    );
                });

                it("[IP][4.1.7] In milestone 0 period unpledge should update investedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);
                    await investmentPool.connect(investorB).unpledge();

                    const amount = await investmentPool.getInvestedAmount(investorB.address, 1);
                    assert.equal(amount.toString(), "0");
                });

                it("[IP][4.1.8] In milestone 0 period unpledge should update totalInvestedAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);
                    await investmentPool.connect(investorB).unpledge();

                    const amount = await investmentPool.getTotalInvestedAmount();
                    assert.equal(amount.toString(), investedAmount.toString());
                });

                it("[IP][4.1.9] In milestone 0 period unpledge should update investors and contract balance", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);
                    await investmentPool.connect(investorB).unpledge();

                    const investorsBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);
                    const feeAmount: BigNumber = investedAmount2
                        .mul(investmentWithdrawFee)
                        .div(100);

                    assert.equal(
                        investorsBalance.toString(),
                        investorPriorBalance.sub(feeAmount).toString()
                    );
                    assert.equal(
                        contractBalance.toString(),
                        contractPriorBalance.add(feeAmount).toString()
                    );
                });

                it("[IP][4.1.10] In milestone 0 period unpledge should emit event with investor and amount args", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    await expect(investmentPool.connect(investorB).unpledge())
                        .to.emit(investmentPool, "Unpledge")
                        .withArgs(investorB.address, investedAmount2);
                });

                it("[IP][4.1.11] In fundraiser period should remove milestone id from the milestonesWithInvestment", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const milestoneIds = await investmentPool.getMilestonesWithInvestment(
                        investorA.address
                    );
                    assert.deepEqual(milestoneIds, []);
                });

                it("[IP][4.1.12] In milestone 0 period should remove milestone id from the milestonesWithInvestment", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const milestoneIds = await investmentPool.getMilestonesWithInvestment(
                        investorA.address
                    );
                    assert.deepEqual(milestoneIds, [BigNumber.from(0)]);
                });

                it("[IP][4.1.13] Should remove investment from memInvestorInvestments", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investmentPool.connect(investorA).unpledge();

                    const memInvestment = await investmentPool.getMemInvestorInvestments(
                        investorA.address,
                        1
                    );
                    assert.equal(memInvestment.toString(), "0");
                });
            });

            describe("4.2 Interactions", () => {
                it("[IP][4.2.1] Investor shouldn't be able to unpledge if no investments were made", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(
                        investmentPool.connect(investorA).unpledge()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoMoneyInvested"
                    );
                });

                it("[IP][4.2.2] Shouldn't be able to unpledge if project was canceled", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][4.2.3] Shouldn't be able to unpledge if fundraiser hasn't started", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][4.2.4] Shouldn't be able to unpledge from failed fundraiser", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(failedFundraiserStateValue);
                });

                it("[IP][4.2.5] Shouldn't be able to unpledge if fundraiser has ended (in gap between fundraiser and 0 milestone)", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][4.2.6] Shouldn't be able to unpledge in last milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(lastMilestoneOngoingStateValue);
                });

                it("[IP][4.2.7] Shouldn't be able to unpledge if project was terminated by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(terminatedByVotingStateValue);
                });

                it("[IP][4.2.8] Shouldn't be able to unpledge after project ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(successfullyEndedStateValue);
                });

                it("[IP][4.2.10] Investor should be able to do a full unpledge", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await expect(investmentPool.connect(investorA).unpledge())
                        .to.emit(investmentPool, "Unpledge")
                        .withArgs(investorA.address, investedAmount);

                    const investorsBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);
                    const feeAmount: BigNumber = investedAmount
                        .mul(investmentWithdrawFee)
                        .div(100);

                    assert.equal(
                        investorsBalance.toString(),
                        investorPriorBalance.sub(feeAmount).toString()
                    );
                    assert.equal(
                        contractBalance.toString(),
                        contractPriorBalance.add(feeAmount).toString()
                    );
                });

                it("[IP][4.2.12] Non-investor shouldn't be able to unpledge", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await expect(
                        investmentPool.connect(foreignActor).unpledge()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoMoneyInvested"
                    );
                });

                it("[IP][4.2.13] Shouldn't be able to unpledge if next milestone has started", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(
                        investmentPool.connect(investorA).unpledge()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoMoneyInvested"
                    );
                });
            });
        });

        describe("5. refund() function", () => {
            describe("5.1 Public state", () => {
                it("[IP][5.1.1] If failed fundraiser, refund should assign investedAmount to 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await investmentPool.connect(investorA).refund();

                    const leftInvestedAmount = await investmentPool.getInvestedAmount(
                        investorA.address,
                        0
                    );
                    assert.equal(leftInvestedAmount.toString(), "0");
                });

                it("[IP][5.1.2] If failed fundraiser, refund should transfer back the tokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");
                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await investmentPool.connect(investorA).refund();

                    const investorBalance = await tokenBalanceOf(fUSDTx, investorA.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);
                    assert.equal(investorBalance.toString(), investorPriorBalance.toString());
                    assert.equal(contractBalance.toString(), contractPriorBalance.toString());
                });

                it("[IP][5.1.3] If failed fundraiser, refund should emit Refund event with investor and investment amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(investmentPool.connect(investorA).refund())
                        .to.emit(investmentPool, "Refund")
                        .withArgs(investorA.address, investedAmount);
                });

                it("[IP][5.1.4] If terminated by voting, refund should assign investedAmount to 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(investorA).refund();

                    const leftInvestedAmount = await investmentPool.getInvestedAmount(
                        investorA.address,
                        0
                    );
                    assert.equal(leftInvestedAmount.toString(), "0");
                });

                it("[IP][5.1.5] If terminated by voting, refund should transfer money back", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmount2: BigNumber = ethers.utils.parseEther("100");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount2);

                    const investorPriorBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(investorB).refund();

                    const investorBalance = await tokenBalanceOf(fUSDTx, investorB.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);

                    assert.equal(
                        investorPriorBalance.add(investedAmount2).toString(),
                        investorBalance.toString()
                    );
                    assert.equal(
                        contractPriorBalance.sub(investedAmount2).toString(),
                        contractBalance.toString()
                    );
                });

                it("[IP][5.1.6] If terminated by voting, refund should emit event with investor and amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(investmentPool.connect(investorB).refund())
                        .to.emit(investmentPool, "Refund")
                        .withArgs(investorB.address, investedAmount);
                });

                it("[IP][5.1.7] If terminated by gelato, refund should emit event with investor and amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);

                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    await expect(investmentPool.connect(investorB).refund())
                        .to.emit(investmentPool, "Refund")
                        .withArgs(investorB.address, investedAmount);
                });
            });

            describe("5.2 Interactions", () => {
                it("[IP][5.2.1] Refund should be inactive if fundraiser was canceled", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][5.2.2] Refund should be inactive before fundraiser", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][5.2.3] Refund should be inactive during fundraiser", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][5.2.4] Refund should be inactive if fundraiser was successful (gap between fundraiser and 0 milestone)", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][5.2.5] Refund should be inactive if not last milestone is active", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(milestonesOngoingBeforeLastStateValue);
                });

                it("[IP][5.2.6] Refund should be inactive if last milestone is active", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await expect(investmentPool.connect(investorA).refund())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(lastMilestoneOngoingStateValue);
                });

                it("[IP][5.2.7] If failed fundraiser, refund should revert where zero investments were made", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(
                        investmentPool.connect(investorA).refund()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoMoneyInvested"
                    );
                });

                it("[IP][5.2.8] If failed fundraiser, investor shouldn't be able to get back anything if haven't invested", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("10");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(
                        investmentPool.connect(foreignActor).refund()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoMoneyInvested"
                    );
                });

                it("[IP][5.2.9] If terminated by voting and no money was invested, refund should revert", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(
                        investmentPool.connect(investorB).refund()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
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

        describe("6. getInvestorTokensAllocation() function", () => {
            describe("6.1 Interactions", () => {
                it("[IP][6.1.1] Should correctly calculate investor's single investment allocation", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("750");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);

                    const investmentAllocation0 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const investmentAllocation1 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        1
                    );

                    assert.equal(
                        investmentAllocation0.toString(),
                        investedAmount.mul(formatPercentage(75)).div(percentageDivider).toString()
                    );
                    assert.equal(
                        investmentAllocation1.toString(),
                        investedAmount.mul(formatPercentage(25)).div(percentageDivider).toString()
                    );
                });

                it("[IP][6.1.2] Should correctly calculate investor's multiple investments allocation", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("750");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);
                    await investMoney(fUSDTx, investmentPool, investorB, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const investmentAllocation0 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const investmentAllocation1 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        1
                    );

                    assert.equal(
                        investmentAllocation0.toString(),
                        investedAmount.mul(formatPercentage(75)).div(percentageDivider).toString()
                    );
                    assert.equal(
                        investmentAllocation1.toString(),
                        investedAmount
                            .mul(formatPercentage(25))
                            .div(percentageDivider)
                            .add(investedAmount)
                            .toString()
                    );
                });
            });
        });

        describe("7. getUsedInvestmentsData() function", () => {
            describe("7.1 Interactions", () => {
                it("[IP][7.1.1] On canceled project state, should return 0", async () => {
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), canceledProjectStateValue.toString());
                });

                it("[IP][7.1.2] If before fundraiser state, should return 0", async () => {
                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), beforeFundraiserStateValue.toString());
                });

                it("[IP][7.1.3] If fundraiser is ongoing, should return 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), fundraiserOngoingStateValue.toString());
                });

                it("[IP][7.1.4] If fundraiser failed, should return 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), failedFundraiserStateValue.toString());
                });

                it("[IP][7.1.5] If fundraiser ended successfully, should return 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(
                        projectState.toString(),
                        fundraiserEndedNoMilestonesOngoingStateValue.toString()
                    );
                });

                it("[IP][7.1.6] If milestone 0 is ongoing, should return only the flow rate", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const investmentAllocation = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const duration = await investmentPool.getMilestoneDuration(0);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedInvestment.alreadyAllocated.toString(), "0");
                    assert.equal(
                        usedInvestment.allocationFlowRate.toString(),
                        investmentAllocation.div(duration).toString()
                    );
                    assert.equal(
                        projectState.toString(),
                        milestonesOngoingBeforeLastStateValue.toString()
                    );
                });

                it("[IP][7.1.7] If milestone 1 is ongoing, should return already allocated and flow rate numbers", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await investmentPool.setCurrentMilestone(1);

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const investmentAllocation0 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const investmentAllocation1 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        1
                    );
                    const duration1 = await investmentPool.getMilestoneDuration(1);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        usedInvestment.alreadyAllocated.toString(),
                        investmentAllocation0.toString()
                    );
                    assert.equal(
                        usedInvestment.allocationFlowRate.toString(),
                        investmentAllocation1.div(duration1).toString()
                    );
                    assert.equal(
                        projectState.toString(),
                        lastMilestoneOngoingStateValue.toString()
                    );
                });

                it("[IP][7.1.8] If terminated by voting, should return only already allocated amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await investmentPool.setCurrentMilestone(1);
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();
                    const investmentAllocation0 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const investmentAllocation1 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        1
                    );
                    const duration1 = await investmentPool.getMilestoneDuration(1);

                    const timePassed = dateToSeconds("2100/10/15") - milestone1StartDate;
                    const allocationUntilTermination = investmentAllocation1
                        .div(duration1)
                        .mul(timePassed);
                    const totalAllocated = investmentAllocation0.add(allocationUntilTermination);

                    assert.equal(
                        usedInvestment.alreadyAllocated.toString(),
                        totalAllocated.toString()
                    );
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), terminatedByVotingStateValue.toString());
                });

                it("[IP][7.1.9] If terminated by gelato, should return only already allocated amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    const autoTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone1EndDate - autoTerminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(1);

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const emergencyTimestamp =
                        await investmentPool.getEmergencyTerminationTimestamp();
                    const investmentAllocation0 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        0
                    );
                    const investmentAllocation1 = await investmentPool.getInvestorTokensAllocation(
                        investorA.address,
                        1
                    );
                    const duration1 = await investmentPool.getMilestoneDuration(1);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    const timePassed = emergencyTimestamp - milestone1StartDate;
                    const allocationUntilTermination = investmentAllocation1
                        .div(duration1)
                        .mul(timePassed);
                    const totalAllocated = investmentAllocation0.add(allocationUntilTermination);

                    assert.equal(
                        usedInvestment.alreadyAllocated.toString(),
                        totalAllocated.toString()
                    );
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), terminatedByGelatoStateValue.toString());
                });

                it("[IP][7.1.10] If successfully finished project, should return all investment amount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/12/15"));
                    await investmentPool.setCurrentMilestone(1);

                    const usedInvestment = await investmentPool.getUsedInvestmentsData(
                        investorA.address
                    );
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        usedInvestment.alreadyAllocated.toString(),
                        investedAmount.toString()
                    );
                    assert.equal(usedInvestment.allocationFlowRate.toString(), "0");
                    assert.equal(projectState.toString(), successfullyEndedStateValue.toString());
                });
            });
        });

        describe("8. getVotingTokensAmountToMint() function", () => {
            describe("8.1 Interactions", () => {
                it("[IP][8.1.1] Should correctly calculate amount to mint during private funding with amount < soft cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("800");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("400");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmountA);

                    const tokensToMint: BigNumber =
                        await investmentPool.getVotingTokensAmountToMint(investedAmountB);

                    assert.equal(
                        tokensToMint.toString(),
                        investedAmountB.mul(softCapMultiplier).toString()
                    );
                });

                it("[IP][8.1.2] Should correctly calculate amount to mint during private funding with amount < hard cap AND amount > soft cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("1000");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmountA);

                    const tokensToMint: BigNumber =
                        await investmentPool.getVotingTokensAmountToMint(investedAmountB);
                    const tokensInPrivateFunding = softCap
                        .sub(investedAmountA)
                        .mul(softCapMultiplier);
                    const tokensInPublicFunding = investedAmountB
                        .sub(softCap.sub(investedAmountA))
                        .mul(hardCapMultiplier);

                    assert.equal(
                        tokensToMint.toString(),
                        tokensInPrivateFunding.add(tokensInPublicFunding).toString()
                    );
                });

                it("[IP][8.1.3] Should correctly calculate amount to mint during ppublic funding with amount < hard cap", async () => {
                    const investedAmountA: BigNumber = ethers.utils.parseEther("2000");
                    const investedAmountB: BigNumber = ethers.utils.parseEther("400");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmountA);

                    const tokensToMint: BigNumber =
                        await investmentPool.getVotingTokensAmountToMint(investedAmountB);
                    const tokensInPublicFunding = investedAmountB.mul(hardCapMultiplier);

                    assert.equal(tokensToMint.toString(), tokensInPublicFunding.toString());
                });
            });
        });

        describe("9. startFirstFundsStream() function", () => {
            describe("9.1 Public state", () => {
                it("[IP][9.1.1] If project was terminated by voting and seed amount for given milestone wasn't paid, it should update seedAmountPaid", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isTrue(milestone.seedAmountPaid);
                });

                it("[IP][9.1.2] If project was terminated by voting and seed amount for given milestone wasn't paid, it should update paidAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    const seedAmount = await investmentPool.getMilestoneSeedAmount(0);
                    assert.equal(milestone.paidAmount.toString(), seedAmount.toString());
                });

                it("[IP][9.1.3] If project was terminated by voting and seed amount for given milestone wasn't paid, it should transfer seedtokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const creatorPriorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);

                    const milestone = await investmentPool.getMilestone(0);
                    assert.equal(
                        creatorPriorBalance.add(milestone.paidAmount).toString(),
                        creatorBalance.toString()
                    );
                    assert.equal(
                        contractPriorBalance.sub(milestone.paidAmount).toString(),
                        contractBalance.toString()
                    );
                });

                it("[IP][9.1.4] If project was terminated by voting and seed amount for given milestone wasn't paid, it should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(0, true, false, false);
                });

                it("[IP][9.1.5] If seed amount for given milestone wasn't paid, it should update seedAmountPaid", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isTrue(milestone.seedAmountPaid);
                });

                it("[IP][9.1.6] If seed amount for given milestone wasn't paid, it should update paidAmount", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    const seedAmount = await investmentPool.getMilestoneSeedAmount(0);
                    assert.equal(milestone.paidAmount.toString(), seedAmount.toString());
                });

                it("[IP][9.1.7] If seed amount for given milestone wasn't paid, it should transfer seed tokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const creatorPriorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelByIncreasingSeconds(60);

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);
                    const milestone = await investmentPool.getMilestone(0);

                    // Stream was opened, so we can't get the specific balance, we just check if seed amount was transfered
                    assert.isTrue(
                        creatorPriorBalance.add(milestone.paidAmount).lt(creatorBalance)
                    );
                    assert.isTrue(
                        contractPriorBalance.sub(milestone.paidAmount).gt(contractBalance)
                    );
                });

                it("[IP][9.1.8] If seed amount for given milestone wasn't paid, it should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(0, true, false, false);
                });

                it("[IP][9.1.9] If termination window is entered, it should update paid value to true", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(milestone0EndDate - 120);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isTrue(milestone.paid);
                });

                it("[IP][9.1.10] If termination window is entered, it should update paidAmount value", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const creatorPriorBalance = await tokenBalanceOf(fUSDTx, creator.address);

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(milestone0EndDate - 120);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const milestone = await investmentPool.getMilestone(0);
                    const milestoneAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);

                    assert.equal(milestone.paidAmount.toString(), milestoneAllocation.toString());
                    assert.equal(
                        creatorBalance.sub(milestone.paidAmount).toString(),
                        creatorPriorBalance.toString()
                    );
                });

                it("[IP][9.1.11] If termination window is entered, it should transfer stream tokens instantly", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const creatorPriorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractPriorBalance = await tokenBalanceOf(
                        fUSDTx,
                        investmentPool.address
                    );

                    await investmentPool.setTimestamp(milestone0EndDate - 120);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const contractBalance = await tokenBalanceOf(fUSDTx, investmentPool.address);

                    const milestoneAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);
                    assert.equal(
                        creatorPriorBalance.add(milestoneAllocation).toString(),
                        creatorBalance.toString()
                    );
                    assert.equal(
                        contractPriorBalance.sub(milestoneAllocation).toString(),
                        contractBalance.toString()
                    );
                });

                it("[IP][9.1.12] If termination window is entered, it should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(milestone0EndDate - 120);
                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(0, false, true, false);
                });

                it("[IP][9.1.13] Should update streamOngoing variable state", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isTrue(milestone.streamOngoing);
                });

                it("[IP][9.1.14] On creator funds claim, it should emit event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(0, false, false, true);
                });
            });

            describe("9.2 Interactions", () => {
                it("[IP][9.2.1] Non-creator shouldn't be able to claim tokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(
                        investmentPool.connect(foreignActor).startFirstFundsStream()
                    ).to.be.revertedWithCustomError(investmentPool, "InvestmentPool__NotCreator");
                });

                it("[IP][9.2.2] Creator shouldn't be able to claim tokens if project was canceled", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][9.2.3] Creator shouldn't be able to claim tokens before fundraiser start", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][9.2.4] Creator shouldn't be able to claim tokens during fundraiser", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][9.2.5] Creator shouldn't be able to claim tokens if fundraiser failed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(failedFundraiserStateValue);
                });

                it("[IP][9.2.6] Creator shouldn't be able to claim tokens in gap between fundraiser and 0 milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][9.2.7] Creator shouldn't be able to claim tokens after project ends", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(successfullyEndedStateValue);
                });

                it("[IP][9.2.8] Creator shouldn't be able to claim funds and open stream before milestone starts", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(
                        investmentPool.connect(creator).claim(1)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__MilestoneStillLocked"
                    );
                });

                it("[IP][9.2.9] Creator shouldn't be able to claim funds and open stream if stream is ongoing already", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await expect(investmentPool.connect(creator).startFirstFundsStream())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__AlreadyStreamingForMilestone"
                        )
                        .withArgs(0);
                });

                it("[IP][9.2.10] If project was terminated by voting, but seed amount was already paid, it should revert", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await expect(
                        investmentPool.connect(creator).startFirstFundsStream()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoSeedAmountDedicated"
                    );
                });

                it("[IP][9.2.11] If project was terminated by voting, but termination didn't happen in given milestone, it should revert", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);
                    await investmentPool.increaseMilestone();

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await expect(
                        investmentPool.connect(creator).claim(1)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoSeedAmountDedicated"
                    );
                });

                it("[IP][9.2.12] Should claim all the funds instantly if in milestone's termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await investmentPool.setTimestamp(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);

                    const milestone = await investmentPool.getMilestone(0);
                    const milestoneAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);
                    assert.equal(milestone.paidAmount.toString(), milestoneAllocation.toString());
                    assert.equal(
                        creatorBalance.sub(milestone.paidAmount).toString(),
                        initialCreatorBalance.toString()
                    );
                });

                it("[IP][9.2.13] Superfluid creates a stream of funds on startFirstFundsStream", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));

                    await investmentPool.connect(creator).startFirstFundsStream();

                    // NOTE: even though we cannot get precise time with the traveler,
                    // the investmentPool contract itself creates flowrate, and uses the timestamp that was passed to it
                    // So it's ok to make calculations using it
                    // Calculate the desired flowrate, should match the one from contract
                    const flowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );

                    const timeLeft = milestone0EndDate - flowInfo.timestamp.getTime() / 1000;
                    const seedAmount = (await investmentPool.getMilestone(0)).paidAmount;
                    const tokenAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);
                    const flowRate = tokenAllocation.sub(seedAmount).div(timeLeft);

                    assert.isDefined(flowInfo);
                    assert.equal(flowInfo.flowRate, flowRate.toString());
                });

                it("[IP][9.2.14] Shouldn't be able to start first funds stream after 0 milestone has ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/02"));
                    await expect(
                        investmentPool.connect(creator).startFirstFundsStream()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NotInFirstMilestonePeriod"
                    );
                });

                it("[IP][9.2.15] Shouldn't be able to claim any tokens if full amount is already paid", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await expect(
                        investmentPool.connect(creator).claim(0)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__AlreadyPaidForMilestone"
                    );
                });
            });
        });

        describe("10. gelatoChecker() function", () => {
            describe("10.1 Interactions", () => {
                it("[IP][10.1.1] gelatoChecker shouldn't pass if gelatoTask is not assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await investmentPool.deleteGelatoTask();
                    const encodedFunction =
                        await investmentPool.encodeGelatoTerminationWithSelector(0);

                    const {canExec, execPayload} = await investmentPool.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                    assert.equal(execPayload, encodedFunction);
                });

                it("[IP][10.1.2] gelatoChecker shouldn't pass if not in auto termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const {canExec} = await investmentPool.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                });

                it("[IP][10.1.3] gelatoChecker shouldn't pass if stream is not opened", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    const {canExec} = await investmentPool.callStatic.gelatoChecker();
                    assert.isFalse(canExec);
                });

                it("[IP][10.1.4] gelatoChecker should pass if in auto termination window, stream is opened and gelatoTask variable is assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));

                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);

                    const {canExec} = await investmentPool.callStatic.gelatoChecker();
                    assert.isTrue(canExec);
                });
            });
        });

        describe("11. receive() function", () => {
            describe("11.1 Interactions", () => {
                it("[IP][11.1.1] Should be able to receive eth", async () => {
                    const ethAmount = ethers.utils.parseEther("1");

                    const initialBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    await buidl1Admin.sendTransaction({
                        to: investmentPool.address,
                        value: ethAmount,
                    });

                    const currentBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    assert.equal(
                        currentBalance.toString(),
                        initialBalance.add(ethAmount).toString()
                    );
                });
            });
        });

        describe("12. cancelDuringMilestones() function", () => {
            describe("12.1 Public state", () => {
                it("[IP][12.1.1] Should update emergencyTerminationTimestamp", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));

                    await expect(
                        governancePool.cancelDuringMilestones(investmentPool.address)
                    ).to.emit(investmentPool, "Cancel");

                    const emergencyTerminationTimestamp =
                        await investmentPool.getEmergencyTerminationTimestamp();
                    assert.notEqual(emergencyTerminationTimestamp, 0);
                });

                it("[IP][12.1.2] Should delete flow if it exists", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/20"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const flowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );

                    // If timestamp is 0, it means there is no flow
                    assert.equal(flowInfo.timestamp.getTime() / 1000, 0);
                });

                it("[IP][12.1.3] Should set streamOngoing to false", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/20"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isFalse(milestone.streamOngoing);
                });

                it("[IP][12.1.4] Should update paidAmount with streamed money", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();
                    const priorMilestone = await investmentPool.getMilestone(0);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/30"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const milestone = await investmentPool.getMilestone(0);
                    assert.isTrue(priorMilestone.paidAmount.lt(milestone.paidAmount));
                });

                it("[IP][12.1.5] If terminated by voting, it should update project state", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), terminatedByVotingStateValue.toString());
                });
            });

            describe("12.2 Interactions", () => {
                it("[IP][12.2.1] Project can't be canceled if fundraiser was already canceled", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][12.2.2] Project can't be canceled if fundraiser hasn't started", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][12.2.3] Project can't be canceled if fundraiser is active", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][12.2.4] Project can't be canceled if fundraiser has failed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(failedFundraiserStateValue);
                });

                it("[IP][12.2.5] Project can't be canceled if fundraiser ended successfully, but 0 milestone hasn't started yet", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][12.2.6] Project can't be canceled if project was already canceled by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(terminatedByVotingStateValue);
                });

                it("[IP][12.2.7] Project can't be canceled if project milestones have ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));

                    await expect(governancePool.cancelDuringMilestones(investmentPool.address))
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(successfullyEndedStateValue);
                });

                it("[IP][12.2.8] Project can't be canceled if caller isn't a governance pool", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    await expect(
                        investmentPool.connect(foreignActor).cancelDuringMilestones()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NotGovernancePool"
                    );
                });
            });
        });

        describe("13. milestoneJumpOrFinalProjectTermination() function", () => {
            describe("13.1 Public state", () => {
                it("[IP][13.1.1] Should terminate old milestone stream", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));

                    await investmentPool.connect(creator).startFirstFundsStream();

                    const priorFlowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.emit(investmentPool, "TerminateStream")
                        .withArgs(0);

                    const flowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );

                    // If timestamp is the same, it means the old stream was not terminated
                    assert.notEqual(
                        priorFlowInfo.timestamp.getTime() / 1000,
                        flowInfo.timestamp.getTime() / 1000
                    );
                });

                it("[IP][13.1.2] Should increase current milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    const currentMilestone = await investmentPool.getCurrentMilestoneId();
                    assert.equal(currentMilestone.toString(), "1");
                });

                it("[IP][13.1.3] Should claim another milestone seed funds and open stream", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(1, true, false, false)
                        .to.emit(investmentPool, "ClaimFunds")
                        .withArgs(1, false, false, true);
                });

                it("[IP][13.1.4] If last milestone, shouldn't increase current milestone and claim funds, but only terminate stream", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    ).to.emit(gelatoOpsMock, "CancelGelatoTask");

                    const currentMilestone = await investmentPool.getCurrentMilestoneId();
                    const flowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );

                    assert.equal(currentMilestone.toString(), "1");
                    assert.equal(flowInfo.timestamp.getTime() / 1000, 0);
                });

                it("[IP][13.1.5] If project has ended successfully, the project state should be updated", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(projectState.toString(), successfullyEndedStateValue.toString());
                });
            });

            describe("13.2 Interactions", () => {
                it("[IP][13.2.1] Non-creator should be able to do a milestone jump", async () => {
                    await expect(
                        investmentPool
                            .connect(foreignActor)
                            .milestoneJumpOrFinalProjectTermination()
                    ).to.be.revertedWithCustomError(investmentPool, "InvestmentPool__NotCreator");
                });

                it("[IP][13.2.2] Shouldn't be able to do a milestone jump if fundraiser was canceled", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(canceledProjectStateValue);
                });

                it("[IP][13.2.3] Shouldn't be able to do a milestone jump if fundraiser hasn't started", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][13.2.4] Shouldn't be able to do a milestone jump if fundraiser is active", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][13.2.5] Shouldn't be able to do a milestone jump if fundraiser has failed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(failedFundraiserStateValue);
                });

                it("[IP][13.2.6] Shouldn't be able to do a milestone jump if fundraiser ended successfully, but 0 milestone hasn't started yet", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][13.2.7] Shouldn't be able to do a milestone jump if project was already canceled by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(terminatedByVotingStateValue);
                });

                it("[IP][13.2.8] Shouldn't be able to do a milestone jump if project milestones have ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    )
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(successfullyEndedStateValue);
                });

                it("[IP][13.2.9] Shouldn't be able to do a milestone jump if not in termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__MilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][13.2.10] Shouldn't be able to do a milestone jump if stream is not ongoing", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await expect(
                        investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__MilestoneStreamTerminationUnavailable"
                    );
                });
            });
        });

        describe("14. withdrawRemainingEth() function", () => {
            describe("14.1 Public state", () => {
                it("[IP][14.1.1] Creator should be able to get the transfered eth", async () => {
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    const priorContractBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    const priorCreatorBalance = await ethers.provider.getBalance(creator.address);

                    const tx = await investmentPool.connect(creator).withdrawRemainingEth();
                    const receipt = await tx.wait();
                    const txFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);

                    const contractBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    const creatorBalance = await ethers.provider.getBalance(creator.address);

                    assert.equal(
                        priorContractBalance.sub(gelatoFeeAllocation).toString(),
                        contractBalance.toString()
                    );
                    assert.equal(contractBalance.toString(), "0");
                    assert.equal(
                        priorCreatorBalance.add(gelatoFeeAllocation).sub(txFee).toString(),
                        creatorBalance.toString()
                    );
                });
            });

            describe("14.2 Interactions", () => {
                it("[IP][14.2.1] Creator should be able to withdraw eth if fundraiser has already been canceled", async () => {
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();

                    await expect(investmentPool.connect(creator).withdrawRemainingEth()).not.to.be
                        .reverted;
                });

                it("[IP][14.2.2] Creator should be able to withdraw eth if fundraiser has failed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    await expect(investmentPool.connect(creator).withdrawRemainingEth()).not.to.be
                        .reverted;
                });

                it("[IP][14.2.3] Creator should be able to withdraw eth if project was terminated by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    await expect(investmentPool.connect(creator).withdrawRemainingEth()).not.to.be
                        .reverted;
                });

                it("[IP][14.2.4] Creator should be able to withdraw eth after project has ended", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/15"));
                    await expect(investmentPool.connect(creator).withdrawRemainingEth()).not.to.be
                        .reverted;
                });

                it("[IP][14.2.5] Creator shouldn't be able to withdraw eth if fundraiser hasn't been started", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/06/15"));

                    await expect(investmentPool.connect(creator).withdrawRemainingEth())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(beforeFundraiserStateValue);
                });

                it("[IP][14.2.6] Creator shouldn't be able to withdraw eth if fundraiser is active", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    await expect(investmentPool.connect(creator).withdrawRemainingEth())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserOngoingStateValue);
                });

                it("[IP][14.2.7] Creator shouldn't be able to withdraw eth during gap between fundraiser end and 0 milestone start", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    await expect(investmentPool.connect(creator).withdrawRemainingEth())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(fundraiserEndedNoMilestonesOngoingStateValue);
                });

                it("[IP][14.2.8] Creator shouldn't be able to withdraw eth during not last milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/09/15"));
                    await expect(investmentPool.connect(creator).withdrawRemainingEth())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(milestonesOngoingBeforeLastStateValue);
                });

                it("[IP][14.2.9] Creator shouldn't be able to withdraw eth during last milestone", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/10/15"));
                    await expect(investmentPool.connect(creator).withdrawRemainingEth())
                        .to.be.revertedWithCustomError(
                            investmentPool,
                            "InvestmentPool__CurrentStateIsNotAllowed"
                        )
                        .withArgs(lastMilestoneOngoingStateValue);
                });

                it("[IP][14.2.10] Creator shouldn't be able to withdraw eth if 0 amount is left", async () => {
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();
                    await investmentPool.connect(creator).withdrawRemainingEth();

                    await expect(
                        investmentPool.connect(creator).withdrawRemainingEth()
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__NoEthLeftToWithdraw"
                    );
                });

                it("[IP][14.2.11] Creator should be able to withdraw eth if project was terminated by gelato", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    await expect(investmentPool.connect(creator).withdrawRemainingEth()).not.to.be
                        .reverted;
                });
            });
        });

        describe("15. gelatoTerminateMilestoneStreamFinal() function", () => {
            describe("15.1 Interactions", () => {
                it("[IP][15.1.1] Non gelato address should be able to call gelato stream termination", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);

                    await expect(
                        investmentPool.connect(foreignActor).gelatoTerminateMilestoneStreamFinal(0)
                    ).not.to.be.reverted;
                });
                it("[IP][15.1.2] Gelato shouldn't be able to terminate stream if gelatoTask is not assigned", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));

                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.deleteGelatoTask();

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][15.1.3] Should not pass if not in auto termination window", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][15.1.4] Should not pass if stream is not opened", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__GelatoMilestoneStreamTerminationUnavailable"
                    );
                });

                it("[IP][15.1.5] Investment pool should emit transfer event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    const feeDetails = await gelatoOpsMock.getFeeDetails();

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0))
                        .to.emit(investmentPool, "GelatoFeeTransfer")
                        .withArgs(feeDetails[0], feeDetails[1]);
                });

                it("[IP][15.1.6] Investment pool should transfer fee to Gelato", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    const investmentPoolPriorBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    const gelatoPriorBalance = await ethers.provider.getBalance(
                        gelatoOpsMock.address
                    );

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const investmentPoolBalance = await ethers.provider.getBalance(
                        investmentPool.address
                    );
                    const gelatoBalance = await ethers.provider.getBalance(gelatoOpsMock.address);
                    const feeDetails = await gelatoOpsMock.getFeeDetails();

                    assert.equal(
                        investmentPoolPriorBalance.sub(feeDetails[0]).toString(),
                        investmentPoolBalance.toString()
                    );
                    assert.equal(
                        gelatoPriorBalance.add(feeDetails[0]).toString(),
                        gelatoBalance.toString()
                    );
                });

                it("[IP][15.1.7] Investment pool shouldn't be able to transfer fee to Gelato if not enough tokens", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    await investmentPool.transferGelatoFee(gelatoFeeAllocation, ethAddress);

                    await expect(
                        gelatoOpsMock.gelatoTerminateMilestoneStream(0)
                    ).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__EthTransferFailed"
                    );
                });

                it("[IP][15.1.8] Should emit cancel event", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0)).to.emit(
                        investmentPool,
                        "Cancel"
                    );
                });

                it("[IP][15.1.9] Should cancel gelatoTask", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);

                    await expect(gelatoOpsMock.gelatoTerminateMilestoneStream(0)).to.emit(
                        gelatoOpsMock,
                        "CancelGelatoTask"
                    );
                });

                it("[IP][15.1.10] If gelato terminates stream, project state should be updated", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), terminatedByGelatoStateValue.toString());
                });

                it("[IP][15.1.11] Should set the gelatoTask variable to empty bytes32 value", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const automatedTerminationWindow =
                        await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - automatedTerminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const gelatoTask = await investmentPool.getGelatoTask();
                    assert.equal(gelatoTask, ethers.utils.formatBytes32String(""));
                });
            });
        });

        describe("16. getMilestonesInvestmentsListForFormula() function", () => {
            describe("16.1 Interactions", () => {
                it("[IP][16.1.1] Should return empty list if no investments were made", async () => {
                    const investmentsList =
                        await investmentPool.getMilestonesInvestmentsListForFormula();
                    assert.equal(investmentsList[0].toString(), "0");
                    assert.equal(investmentsList[1].toString(), "0");
                });

                it("[IP][16.1.2] Should return correct values for later usage", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const investmentsList =
                        await investmentPool.getMilestonesInvestmentsListForFormula();
                    assert.equal(investmentsList[0].toString(), investedAmount.toString());
                    assert.equal(investmentsList[1].toString(), "0");
                });
            });
        });

        describe("17. getVotingTokensSupplyCap() function", () => {
            describe("17.1 Interactions", () => {
                it("[IP][17.1.1] Should return empty list if no investments were made", async () => {
                    const onlyHardCapAmount = hardCap.sub(softCap);
                    const softCapTokenAllocation = softCap.mul(softCapMultiplier);
                    const hardCapTokenAllocation = onlyHardCapAmount.mul(hardCapMultiplier);
                    const expectedSupplyCap = softCapTokenAllocation.add(hardCapTokenAllocation);

                    const votingTokensSupplyCap = await investmentPool.getVotingTokensSupplyCap();
                    assert.equal(votingTokensSupplyCap.toString(), expectedSupplyCap.toString());
                });
            });
        });

        describe("18. getFundsUsed() function", () => {
            describe("18.1 Interactions", () => {
                it("[IP][18.1.1] Should return 0 if project is canceled", async () => {
                    await investmentPool.connect(creator).cancelBeforeFundraiserStart();
                    const usedFunds = await investmentPool.getFundsUsed();
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), "0");
                    assert.equal(projectState.toString(), canceledProjectStateValue.toString());
                });

                it("[IP][18.1.2] Should return 0 if state is before fundraiser", async () => {
                    const usedFunds = await investmentPool.getFundsUsed();
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), "0");
                    assert.equal(projectState.toString(), beforeFundraiserStateValue.toString());
                });

                it("[IP][18.1.3] Should return 0 if fundraiser is ongoing", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const usedFunds = await investmentPool.getFundsUsed();
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), "0");
                    assert.equal(projectState.toString(), fundraiserOngoingStateValue.toString());
                });

                it("[IP][18.1.4] Should return 0 if fundraiser failed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const usedFunds = await investmentPool.getFundsUsed();
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), "0");
                    assert.equal(projectState.toString(), failedFundraiserStateValue.toString());
                });

                it("[IP][18.1.5] Should return 0 if fundraiser ended and waiting for milestone start", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const usedFunds = await investmentPool.getFundsUsed();
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), "0");
                    assert.equal(
                        projectState.toString(),
                        fundraiserEndedNoMilestonesOngoingStateValue.toString()
                    );
                });

                it("[IP][18.1.6] Should return seed amount if milestone 0 is ongoing", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const usedFunds = await investmentPool.getFundsUsed();
                    const milestone0 = await investmentPool.getMilestone(0);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        usedFunds.toString(),
                        investedAmount
                            .mul(milestone0.intervalSeedPortion)
                            .div(percentageDivider)
                            .toString()
                    );
                    assert.equal(
                        projectState.toString(),
                        milestonesOngoingBeforeLastStateValue.toString()
                    );
                });

                it("[IP][18.1.7] Should return correct amount if milestone 1 is ongoing", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    // Do milestone jump from milestone id 0 to 1
                    let terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/10/15"));

                    const usedFunds = await investmentPool.getFundsUsed();
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        usedFunds.toString(),
                        investedAmount
                            .mul(
                                milestone1.intervalSeedPortion
                                    .add(milestone0.intervalStreamingPortion)
                                    .add(milestone0.intervalSeedPortion)
                            )
                            .div(percentageDivider)
                            .toString()
                    );
                    assert.equal(
                        projectState.toString(),
                        lastMilestoneOngoingStateValue.toString()
                    );
                });

                it("[IP][18.1.8] Should return correct amount if project was terminated by voting", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelToDate(dateToSeconds("2100/09/25"));
                    await governancePool.cancelDuringMilestones(investmentPool.address);

                    const usedFunds = await investmentPool.getFundsUsed();
                    const milestone0 = await investmentPool.getMilestone(0);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), milestone0.paidAmount.toString());
                    assert.equal(projectState.toString(), terminatedByVotingStateValue.toString());
                });

                it("[IP][18.1.9] Should return correct amount if project was terminated by gelato", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getAutomatedTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await gelatoOpsMock.gelatoTerminateMilestoneStream(0);

                    const usedFunds = await investmentPool.getFundsUsed();
                    const milestone0 = await investmentPool.getMilestone(0);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(usedFunds.toString(), milestone0.paidAmount.toString());
                    assert.equal(projectState.toString(), terminatedByGelatoStateValue.toString());
                });

                it("[IP][18.1.10] Should return correct amount if project was terminated by gelato", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("1500");

                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(milestone1EndDate - terminationWindow / 2);
                    await investmentPool.connect(creator).milestoneJumpOrFinalProjectTermination();

                    await timeTravelToDate(dateToSeconds("2100/12/05"));
                    const usedFunds = await investmentPool.getFundsUsed();
                    const milestone0 = await investmentPool.getMilestone(0);
                    const milestone1 = await investmentPool.getMilestone(1);
                    const projectState = await investmentPool.getProjectStateByteValue();

                    assert.equal(
                        usedFunds.toString(),
                        milestone0.paidAmount.add(milestone1.paidAmount).toString()
                    );
                    assert.equal(usedFunds.toString(), investedAmount.toString());
                    assert.equal(projectState.toString(), successfullyEndedStateValue.toString());
                });
            });
        });

        describe("19. startGelatoTask() function", () => {
            describe("19.1 Interactions", () => {
                it("[IP][19.1.1] gelatoTask should be assigned", async () => {
                    const gelatoTask = await investmentPool.getGelatoTask();
                    const zeroInBytes32 = ethers.utils.formatBytes32String("");
                    assert.notEqual(gelatoTask, zeroInBytes32);
                });

                it("[IP][19.1.2] gelatoTaskCreated should be assigned to true", async () => {
                    const gelatoTaskCreated = await investmentPool.getGelatoTaskCreated();
                    assert.isTrue(gelatoTaskCreated);
                });

                it("[IP][19.1.3] gelatoTaskCreated should be assigned to true", async () => {
                    const gelatoTaskCreated = await investmentPool.getGelatoTaskCreated();
                    assert.isTrue(gelatoTaskCreated);
                });

                it("[IP][19.1.4] Shouldn't be able to start gelato task if it was already created", async () => {
                    await expect(investmentPool.startGelatoTask()).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__GelatoTaskAlreadyStarted"
                    );
                });

                it("[IP][19.1.5] Shouldn't be able to start gelato task if gelato task is already assigned", async () => {
                    await investmentPool.setGelatoTaskCreated(false);
                    await expect(investmentPool.startGelatoTask()).to.be.revertedWithCustomError(
                        investmentPool,
                        "InvestmentPool__GelatoTaskAlreadyStarted"
                    );
                });
            });
        });

        describe("20. ifNeededUpdateMemInvestmentValue() function", () => {
            describe("20.1 Interactions", () => {
                it("[IP][20.1.1] Should update memMilestoneInvestments if memoized amount is not 0 and milestone id is not 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.ifNeededUpdateMemInvestmentValue(1);
                    const initialMemInvestment = await investmentPool.getMemMilestoneInvestments(
                        1
                    );
                    await investmentPool.ifNeededUpdateMemInvestmentValue(1);
                    const memInvestment = await investmentPool.getMemMilestoneInvestments(1);

                    assert.equal(memInvestment.toString(), initialMemInvestment.toString());
                });

                it("[IP][20.1.2] Should not update memMilestoneInvestments if milestone id is 0", async () => {
                    const initialMemInvestment = await investmentPool.getMemMilestoneInvestments(
                        0
                    );
                    await investmentPool.ifNeededUpdateMemInvestmentValue(0);
                    const memInvestment = await investmentPool.getMemMilestoneInvestments(0);

                    assert.equal(initialMemInvestment.toString(), memInvestment.toString());
                    assert.equal(memInvestment.toString(), "0");
                });

                it("[IP][20.1.3] Should not update memMilestoneInvestments if memoized amount is not 0", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    const initialMemInvestment = await investmentPool.getMemMilestoneInvestments(
                        1
                    );
                    await investmentPool.ifNeededUpdateMemInvestmentValue(1);
                    const memInvestment0 = await investmentPool.getMemMilestoneInvestments(0);
                    const memInvestment1 = await investmentPool.getMemMilestoneInvestments(1);

                    assert.equal(
                        memInvestment1.toString(),
                        initialMemInvestment.add(memInvestment0).toString()
                    );
                });
            });
        });
    });

    describe("Additional tests", () => {
        describe("1001. Fundraiser started. Contract should have correct values", () => {
            describe("1001.1 Public state", () => {
                it("[IP][1001.1.1] Fundraiser should be ongoing if the starting date has passed", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const isFundraiserOngoing = await investmentPool.isFundraiserOngoingNow();
                    assert.isTrue(isFundraiserOngoing);
                });

                it("[IP][1001.1.2] Fundraiser shouldn't have a soft cap raised initially after the fundraiser start", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const isSoftCapReached = await investmentPool.isSoftCapReached();
                    assert.isFalse(isSoftCapReached);
                });

                it("[IP][1001.1.3] Fundraiser period shouldn't have ended yet", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const hasFundraiserEnded = await investmentPool.didFundraiserPeriodEnd();
                    assert.isFalse(hasFundraiserEnded);
                });

                it("[IP][1001.1.4] Fundraiser shouldn't have a failed state during active fundraiser", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const isFailed = await investmentPool.isFailedFundraiser();
                    assert.isFalse(isFailed);
                });

                it("[IP][6.1.5] During the fundraiser, it should return the correct state", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), fundraiserOngoingStateValue.toString());
                });
            });
        });

        describe("1002. Fundraiser failed. Contract should have correct values", () => {
            describe("1002.1 Public state", () => {
                it("[IP][1002.1.1] Campaign should have a failed campaign state for unsuccessful fundraiser", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const isFailed = await investmentPool.isFailedFundraiser();
                    assert.isTrue(isFailed);
                });

                it("[IP][1002.1.2] Soft cap shouldn't be raised for failed fundraisers", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const hasRaisedSoftCap = await investmentPool.isSoftCapReached();
                    assert.isFalse(hasRaisedSoftCap);
                });

                it("[IP][1002.1.3] Fundraiser shouldn't be ongoing for a failed campaign", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const isFundraiserOngoing = await investmentPool.isFundraiserOngoingNow();
                    assert.isFalse(isFundraiserOngoing);
                });

                it("[IP][1002.1.4] Fundraiser should have ended for a failed campaign", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const hasFundraiserEnded = await investmentPool.didFundraiserPeriodEnd();
                    assert.isTrue(hasFundraiserEnded);
                });

                it("[IP][1002.1.5] If fundraiser failed, it should return the correct state", async () => {
                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));

                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(projectState.toString(), failedFundraiserStateValue.toString());
                });
            });
        });

        describe("1003. Fundraiser ended successfully. Contract should have correct values", () => {
            describe("1003.1 Interactions", () => {
                it("[IP][1003.1.1] Campaign shouldn't have a failed campaign state", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const isFailed = await investmentPool.isFailedFundraiser();
                    assert.isFalse(isFailed);
                });

                it("[IP][1003.1.2] Successful campaign should have reached soft cap", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const hasRaisedSoftCap = await investmentPool.isSoftCapReached();
                    assert.isTrue(hasRaisedSoftCap);
                });

                it("[IP][1003.1.3] Fundraiser shouldn't be ongoing", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const isFundraiserOngoing = await investmentPool.isFundraiserOngoingNow();
                    assert.isFalse(isFundraiserOngoing);
                });

                it("[IP][1003.1.4] Fundraiser period should have ended for a successful campaign", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const hasFundraiserEnded = await investmentPool.didFundraiserPeriodEnd();
                    assert.isTrue(hasFundraiserEnded);
                });

                it("[IP][1003.1.5] If fundraiser ended successfully, project state should change", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");

                    await investmentPool.setTimestamp(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await investmentPool.setTimestamp(dateToSeconds("2100/08/15"));
                    const projectState = await investmentPool.getProjectStateByteValue();
                    assert.equal(
                        projectState.toString(),
                        fundraiserEndedNoMilestonesOngoingStateValue.toString()
                    );
                });
            });
        });

        describe("1004. Corner cases for stopping/resuming streams", () => {
            describe("1004.1 Interactions", () => {
                it("[IP][1004.1.1] Volunteer stopping of streamed funds updates records", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));

                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelToDate(dateToSeconds("2100/09/16"));

                    // NOTE: we are implicitly testing the SuperApp callback here
                    // we want to find out, what happens if the flow is voluntarily terminated by the creator
                    await sf.cfaV1
                        .deleteFlow({
                            superToken: fUSDTx.address,
                            sender: investmentPool.address,
                            receiver: creator.address,
                        })
                        .exec(creator);

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const milestone = await investmentPool.getMilestone(0);
                    const paidAmount = milestone.paidAmount;

                    assert.equal(
                        paidAmount.toString(),
                        creatorBalance.sub(initialCreatorBalance).toString()
                    );
                    assert.isFalse(milestone.paid);
                });

                it("[IP][1004.1.2] (Callback) Volunteer stopping during termination window instantly transfers the rest of funds", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));

                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    // NOTE: we are implicitly testing the SuperApp callback here
                    // we want to find out, what happens if the flow is voluntarily terminated by the creator
                    await sf.cfaV1
                        .deleteFlow({
                            superToken: fUSDTx.address,
                            sender: investmentPool.address,
                            receiver: creator.address,
                        })
                        .exec(creator);

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const milestone = await investmentPool.getMilestone(0);
                    const paidAmount = milestone.paidAmount;
                    const tokenAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);

                    assert.equal(
                        paidAmount.toString(),
                        creatorBalance.sub(initialCreatorBalance).toString(),
                        "Streamed balance and stored record should match"
                    );
                    assert.equal(
                        creatorBalance.sub(initialCreatorBalance).toString(),
                        tokenAllocation.toString(),
                        "Should transfer all of the funds during the termination"
                    );
                    assert.isTrue(milestone.paid, "Milestone should be fully paid by now");
                });

                it("[IP][1004.1.3] Should be able to pause the stream and resume later", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    await investmentPool.setTimestamp(0);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelToDate(dateToSeconds("2100/09/20"));

                    // NOTE: we are implicitly testing the SuperApp callback here
                    // we want to find out, what happens if the flow is voluntarily stopped by the creator
                    await sf.cfaV1
                        .deleteFlow({
                            superToken: fUSDTx.address,
                            sender: investmentPool.address,
                            receiver: creator.address,
                        })
                        .exec(creator);

                    const streamedSoFar = (await tokenBalanceOf(fUSDTx, creator.address)).sub(
                        initialCreatorBalance
                    );

                    await timeTravelToDate(dateToSeconds("2100/09/25"));
                    await investmentPool.connect(creator).startFirstFundsStream();
                    const flowInfo = await getSuperTokensFlow(
                        fUSDTx,
                        investmentPool.address,
                        creator.address
                    );
                    assert.isDefined(flowInfo);

                    // Calculate the desired flowrate, should match the one from contract
                    // Use the timestamp source from the flow info for precision
                    const timeLeft = milestone0EndDate - flowInfo.timestamp.getTime() / 1000;
                    const tokenAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);
                    const flowRate = tokenAllocation.sub(streamedSoFar).div(timeLeft);

                    assert.equal(flowInfo.flowRate, flowRate.toString());
                });

                it("[IP][1004.1.4] Should be able to pause the stream, resume later, get terminated", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelToDate(dateToSeconds("2100/09/20"));

                    // NOTE: we are implicitly testing the SuperApp callback here
                    // we want to find out, what happens if the flow is voluntarily stopped by the creator
                    await sf.cfaV1
                        .deleteFlow({
                            superToken: fUSDTx.address,
                            sender: investmentPool.address,
                            receiver: creator.address,
                        })
                        .exec(creator);

                    await timeTravelToDate(dateToSeconds("2100/09/25"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);

                    await expect(investmentPool.terminateMilestoneStreamFinal(0))
                        .to.emit(investmentPool, "TerminateStream")
                        .withArgs(0);

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const milestone = await investmentPool.getMilestone(0);
                    const tokenAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);

                    assert.equal(
                        creatorBalance.sub(initialCreatorBalance).toString(),
                        tokenAllocation.toString(),
                        "Should transfer all of the funds to the creator"
                    );
                    assert.equal(
                        milestone.paidAmount.toString(),
                        tokenAllocation.toString(),
                        "Paid amount should match the invested amount"
                    );
                    assert.isTrue(milestone.paid, "Milestone should be marked as paid by now");
                });

                it("[IP][1004.1.5] (Callback) Should be able to pause the stream, resume later, get terminated", async () => {
                    const investedAmount: BigNumber = ethers.utils.parseEther("2000");
                    await investmentPool.setTimestamp(0);

                    const initialCreatorBalance = await tokenBalanceOf(fUSDTx, creator.address);

                    await timeTravelToDate(dateToSeconds("2100/07/15"));
                    await investMoney(fUSDTx, investmentPool, investorA, investedAmount);

                    await timeTravelToDate(dateToSeconds("2100/09/15"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    await timeTravelToDate(dateToSeconds("2100/09/20"));

                    // NOTE: we are implicitly testing the SuperApp callback here
                    // we want to find out, what happens if the flow is voluntarily stopped by the creator
                    await sf.cfaV1
                        .deleteFlow({
                            superToken: fUSDTx.address,
                            sender: investmentPool.address,
                            receiver: creator.address,
                        })
                        .exec(creator);

                    await timeTravelToDate(dateToSeconds("2100/09/25"));
                    await investmentPool.connect(creator).startFirstFundsStream();

                    const terminationWindow = await investmentPool.getTerminationWindow();
                    await timeTravelToDate(milestone0EndDate - terminationWindow / 2);
                    await sf.cfaV1
                        .deleteFlow({
                            receiver: creator.address,
                            sender: investmentPool.address,
                            superToken: fUSDTx.address,
                        })
                        .exec(creator);

                    const creatorBalance = await tokenBalanceOf(fUSDTx, creator.address);
                    const milestone = await investmentPool.getMilestone(0);
                    const tokenAllocation =
                        await investmentPool.callStatic.getTotalMilestoneTokenAllocation(0);

                    assert.equal(
                        creatorBalance.sub(initialCreatorBalance).toString(),
                        tokenAllocation.toString(),
                        "Should transfer all of the funds to the creator"
                    );
                    assert.equal(
                        milestone.paidAmount.toString(),
                        tokenAllocation.toString(),
                        "Paid amount should match the invested amount"
                    );
                    assert.isTrue(milestone.paid, "Milestone should be marked as paid by now");
                });
            });
            // TODO: Test the ovestream case during a single milestone, probably results in internal contract undeflow, need to confirm
        });
    });

    describe("Upgradeability", () => {
        // Validate that the storage slots for contract variables don't change their storage slot and offset
        // Validate that struct member order hasn't changed
        // it("Contract storage variables didn't shift during development", async () => {
        //   await investmentPool.validateStorageLayout();
        // });
    });
});
