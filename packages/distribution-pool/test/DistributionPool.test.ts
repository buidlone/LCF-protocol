import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, ContractTransaction, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {InvestmentPoolMockForIntegration, DistributionPoolMock, Buidl1} from "../typechain-types";
import traveler from "ganache-time-traveler";

let accounts: SignerWithAddress[];
let admin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;
let investors: SignerWithAddress[];
let foreignActor: SignerWithAddress;

let investmentPool: InvestmentPoolMockForIntegration;
let distributionPool: DistributionPoolMock;
let buidl1Token: Buidl1;
let snapshotId: string;

let milestoneStartDate: BigNumber;
let milestoneEndDate: BigNumber;
let milestoneStartDate2: BigNumber;
let milestoneEndDate2: BigNumber;

// Percentages (in divider format)
let percentageDivider: BigNumber = BigNumber.from(0);
let percent5InIpBigNumber: BigNumber;
let percent20InIpBigNumber: BigNumber;
let percent70InIpBigNumber: BigNumber;

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

const percentToIpBigNumber = (percent: number): BigNumber => {
    return percentageDivider.mul(percent).div(100);
};

const dateToSeconds = (date: string, isBigNumber: boolean = true): BigNumber | number => {
    const convertedDate = new Date(date).getTime() / 1000;
    if (isBigNumber) {
        return BigNumber.from(convertedDate) as BigNumber;
    } else {
        return convertedDate as number;
    }
};

const getConstantVariablesFromContract = async () => {
    const distributionPoolDep = await ethers.getContractFactory("DistributionPoolMock", admin);
    distributionPool = await distributionPoolDep.deploy();
    await distributionPool.deployed();

    percentageDivider = await distributionPool.getPercentageDivider();
    await createProject();
    await defineProjectStateByteValues(investmentPool);
};

const createProject = async () => {
    const distributionPoolDep = await ethers.getContractFactory("DistributionPoolMock", admin);
    distributionPool = await distributionPoolDep.deploy();
    await distributionPool.deployed();

    const buidl1TokenDep = await ethers.getContractFactory("Buidl1", creator);
    buidl1Token = await buidl1TokenDep.deploy();
    await buidl1Token.deployed();

    milestoneStartDate = dateToSeconds("2100/09/01") as BigNumber;
    milestoneEndDate = dateToSeconds("2100/10/01") as BigNumber;
    milestoneStartDate2 = dateToSeconds("2100/10/01") as BigNumber;
    milestoneEndDate2 = dateToSeconds("2100/12/01") as BigNumber;
    percent5InIpBigNumber = percentToIpBigNumber(5);
    percent20InIpBigNumber = percentToIpBigNumber(20);
    percent70InIpBigNumber = percentToIpBigNumber(70);

    const investmentPoolDep = await ethers.getContractFactory(
        "InvestmentPoolMockForIntegration",
        admin
    );
    investmentPool = await investmentPoolDep.deploy(distributionPool.address, creator.address, [
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
    ]);
    await investmentPool.deployed();

    // Initializer
    distributionPool.initialize(
        investmentPool.address,
        buidl1Token.address,
        ethers.utils.parseEther("15000000")
    );

    await buidl1Token.connect(creator).approve(distributionPool.address, constants.MaxUint256);
};

const defineProjectStateByteValues = async (investment: InvestmentPoolMockForIntegration) => {
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

describe("Distribution Pool", async () => {
    before(async () => {
        // get accounts from hardhat
        accounts = await ethers.getSigners();
        admin = accounts[0];
        creator = accounts[2];
        investorA = accounts[3];
        investorB = accounts[4];
        foreignActor = accounts[5];
        investors = [investorA, investorB];

        await getConstantVariablesFromContract();
    });

    beforeEach(async () => {
        await createProject();
    });

    describe("1. Allocate tokens", () => {
        describe("1.1 Interactions", () => {
            it("[IP][1.1.1] Foreign actor shouldn't be able to lock tokens", async () => {
                await expect(
                    distributionPool.connect(foreignActor).lockTokens()
                ).to.be.revertedWithCustomError(
                    distributionPool,
                    "DistributionPool__ProjectTokensAlreadyLocked"
                );
            });

            it("[IP][1.1.2] Creator should be able to lock tokens", async () => {
                await expect(distributionPool.connect(creator).lockTokens()).to.emit(
                    distributionPool,
                    "LockedTokens"
                );
            });

            it("[IP][1.1.3] After locking tokens, creatorLockedTokens should be true", async () => {
                await distributionPool.connect(creator).lockTokens();
                const areTokensLocked = await distributionPool.didCreatorLockTokens();

                assert.isTrue(areTokensLocked);
            });

            it("[IP][1.1.4] By default, creatorLockedTokens should be false", async () => {
                const areTokensLocked = await distributionPool.didCreatorLockTokens();

                assert.isFalse(areTokensLocked);
            });

            describe("function -> getAllocationData", () => {
                it("[IP][1.1.1] Should return 0 if project is canceled", async () => {
                    await investmentPool.setProjectState(canceledProjectStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.2] Should return 0 if project state is before fundraiser", async () => {
                    await investmentPool.setProjectState(beforeFundraiserStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.3] Should return 0 if fundraiser is ongoing", async () => {
                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.4] Should return 0 if fundraiser failed", async () => {
                    await investmentPool.setProjectState(failedFundraiserStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.5] Should return 0 if fundraiser ended and no milestone is ongoing", async () => {
                    await investmentPool.setProjectState(
                        fundraiserEndedNoMilestonesOngoingStateValue
                    );
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.6] Should return correct amount if milestone 0 is ongoing", async () => {
                    const weightDivisor = await investmentPool.getMaximumWeightDivisor();

                    await distributionPool.connect(creator).lockTokens();
                    await investmentPool.allocateTokens(
                        0,
                        investorA.address,
                        weightDivisor.div(10),
                        weightDivisor,
                        percentageDivider
                    );

                    await investmentPool.setProjectState(milestonesOngoingBeforeLastStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    const milestoneAllocation = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        0
                    );
                    const milestoneDuration = await investmentPool.getMilestoneDuration(0);

                    console.log(milestoneAllocation);
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(
                        allocationData.allocationFlowRate.toString(),
                        milestoneAllocation.div(milestoneDuration).toString()
                    );
                });

                it("[IP][1.1.7] Should return correct amount if milestone 1 is ongoing", async () => {
                    const weightDivisor = await investmentPool.getMaximumWeightDivisor();

                    await distributionPool.connect(creator).lockTokens();
                    await investmentPool.allocateTokens(
                        0,
                        investorA.address,
                        weightDivisor.div(10),
                        weightDivisor,
                        percentageDivider
                    );

                    await investmentPool.setProjectState(lastMilestoneOngoingStateValue);
                    await investmentPool.setMilestoneId(1);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    const milestoneAllocation0 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        0
                    );
                    const milestoneAllocation1 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        1
                    );
                    const milestoneDuration1 = await investmentPool.getMilestoneDuration(1);

                    assert.equal(
                        allocationData.alreadyAllocated.toString(),
                        milestoneAllocation0.toString()
                    );
                    assert.equal(
                        allocationData.allocationFlowRate.toString(),
                        milestoneAllocation1.div(milestoneDuration1).toString()
                    );
                });

                it("[IP][1.1.8] Should return correct amount if project was terminated by voting", async () => {
                    const weightDivisor = await investmentPool.getMaximumWeightDivisor();
                    const terminationTimestamp = dateToSeconds("2100/11/01") as BigNumber;
                    const timePassed = terminationTimestamp.sub(milestoneStartDate2);

                    await distributionPool.connect(creator).lockTokens();
                    await investmentPool.allocateTokens(
                        0,
                        investorA.address,
                        weightDivisor.div(10),
                        weightDivisor,
                        percentageDivider
                    );

                    await investmentPool.setProjectState(terminatedByVotingStateValue);
                    await investmentPool.setEmergencyTerminationTimestamp(terminationTimestamp);
                    await investmentPool.setMilestoneId(1);

                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    const milestoneAllocation0 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        0
                    );
                    const milestoneAllocation1 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        1
                    );
                    const milestoneDuration1 = await investmentPool.getMilestoneDuration(1);
                    const totalAllocation = milestoneAllocation0.add(
                        milestoneAllocation1.div(milestoneDuration1).mul(timePassed)
                    );

                    assert.equal(
                        allocationData.alreadyAllocated.toString(),
                        totalAllocation.toString()
                    );
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.9] Should return correct amount if project was terminated by gelato", async () => {
                    const weightDivisor = await investmentPool.getMaximumWeightDivisor();
                    const terminationTimestamp = dateToSeconds("2100/11/01") as BigNumber;
                    const timePassed = terminationTimestamp.sub(milestoneStartDate2);

                    await distributionPool.connect(creator).lockTokens();
                    await investmentPool.allocateTokens(
                        0,
                        investorA.address,
                        weightDivisor.div(10),
                        weightDivisor,
                        percentageDivider
                    );

                    await investmentPool.setProjectState(terminatedByGelatoStateValue);
                    await investmentPool.setEmergencyTerminationTimestamp(terminationTimestamp);
                    await investmentPool.setMilestoneId(1);

                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    const milestoneAllocation0 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        0
                    );
                    const milestoneAllocation1 = await distributionPool.getAllocatedAmount(
                        investorA.address,
                        1
                    );
                    const milestoneDuration1 = await investmentPool.getMilestoneDuration(1);
                    const totalAllocation = milestoneAllocation0.add(
                        milestoneAllocation1.div(milestoneDuration1).mul(timePassed)
                    );

                    assert.equal(
                        allocationData.alreadyAllocated.toString(),
                        totalAllocation.toString()
                    );
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[IP][1.1.10] Should return correct amount if project ended successfully", async () => {
                    const weightDivisor = await investmentPool.getMaximumWeightDivisor();
                    await distributionPool.connect(creator).lockTokens();
                    await investmentPool.allocateTokens(
                        0,
                        investorA.address,
                        weightDivisor.div(10),
                        weightDivisor,
                        percentageDivider
                    );

                    await investmentPool.setProjectState(successfullyEndedStateValue);
                    await investmentPool.setMilestoneId(1);

                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    const fullAllocation = await distributionPool.getAllocatedTokens(
                        investorA.address
                    );

                    assert.equal(
                        allocationData.alreadyAllocated.toString(),
                        fullAllocation.toString()
                    );
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });
            });
        });
    });
});
