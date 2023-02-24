import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {Framework, WrapperSuperToken} from "@superfluid-finance/sdk-core";
import {BigNumber, BigNumberish, ContractTransaction, constants} from "ethers";
import {ethers, web3} from "hardhat";
import {assert, expect} from "chai";
import {InvestmentPoolMockForIntegration, DistributionPoolMock, Buidl1} from "../typechain-types";
import traveler from "ganache-time-traveler";

let accounts: SignerWithAddress[];
let buidl1Admin: SignerWithAddress;
let creator: SignerWithAddress;
let investorA: SignerWithAddress;
let investorB: SignerWithAddress;
let investors: SignerWithAddress[];
let foreignActor: SignerWithAddress;

let investmentPool: InvestmentPoolMockForIntegration;
let distributionPool: DistributionPoolMock;
let buidl1Token: Buidl1;
let snapshotId: string;

let milestone0StartDate: number;
let milestone0EndDate: number;
let milestone1StartDate: number;
let milestone1EndDate: number;

// Percentages (in divider format)
let percentageDivider: number = 0;
let formated5Percent: number;
let formated20Percent: number;
let formated70Percent: number;
let weightDivisor: BigNumber;
let lockedTokens: BigNumber = ethers.utils.parseEther("15000000");
let milestonesPortionsLeft: number[] = [];

// Project state values
let canceledProjectStateValue: number;
let beforeFundraiserStateValue: number;
let fundraiserOngoingStateValue: number;
let failedFundraiserStateValue: number;
let fundraiserEndedNoMilestonesOngoingStateValue: number;
let milestonesOngoingBeforeLastStateValue: number;
let lastMilestoneOngoingStateValue: number;
let terminatedByVotingStateValue: number;
let terminatedByGelatoStateValue: number;
let successfullyEndedStateValue: number;
let unknownStateValue: number;

const formatPercentage = (percent: number): number => {
    return (percentageDivider * percent) / 100;
};

const dateToSeconds = (date: string): number => {
    return new Date(date).getTime() / 1000;
};

const getConstantVariablesFromContract = async () => {
    await createProject();

    percentageDivider = await distributionPool.getPercentageDivider();
    weightDivisor = await investmentPool.getMaximumWeightDivisor();
    await defineStateValues(investmentPool);
};

const createProject = async () => {
    const distributionPoolDep = await ethers.getContractFactory(
        "DistributionPoolMock",
        buidl1Admin
    );
    distributionPool = await distributionPoolDep.deploy();
    await distributionPool.deployed();

    const buidl1TokenDep = await ethers.getContractFactory("Buidl1", creator);
    buidl1Token = await buidl1TokenDep.deploy();
    await buidl1Token.deployed();

    milestone0StartDate = dateToSeconds("2100/09/01");
    milestone0EndDate = dateToSeconds("2100/10/01");
    milestone1StartDate = dateToSeconds("2100/10/01");
    milestone1EndDate = dateToSeconds("2100/12/01");
    formated5Percent = formatPercentage(5);
    formated20Percent = formatPercentage(20);
    formated70Percent = formatPercentage(70);
    milestonesPortionsLeft = [percentageDivider, formated20Percent + formated5Percent, 0];

    const investmentPoolDep = await ethers.getContractFactory(
        "InvestmentPoolMockForIntegration",
        buidl1Admin
    );
    investmentPool = await investmentPoolDep.deploy(distributionPool.address, creator.address, [
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
    ]);
    await investmentPool.deployed();

    // Initializer
    distributionPool.initialize(investmentPool.address, buidl1Token.address, lockedTokens);

    await buidl1Token.connect(creator).approve(distributionPool.address, constants.MaxUint256);
};

const defineStateValues = async (investment: InvestmentPoolMockForIntegration) => {
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
        accounts = await ethers.getSigners();
        buidl1Admin = accounts[0];
        creator = accounts[1];
        investorA = accounts[2];
        investorB = accounts[3];
        foreignActor = accounts[4];
        investors = [investorA, investorB];

        await getConstantVariablesFromContract();
    });

    beforeEach(async () => {
        await createProject();
    });

    describe("Functions", () => {
        describe("1. lockTokens() function", () => {
            describe("1.1 Interactions", () => {
                it("[DP][1.1.1] Foreign actor shouldn't be able to lock tokens", async () => {
                    await expect(
                        distributionPool.connect(foreignActor).lockTokens()
                    ).to.be.revertedWithCustomError(
                        distributionPool,
                        "DistributionPool__NotProjectCreator"
                    );
                });

                it("[DP][1.1.2] Creator should be able to lock tokens", async () => {
                    await expect(distributionPool.connect(creator).lockTokens()).to.emit(
                        distributionPool,
                        "LockedTokens"
                    );
                });

                it("[DP][1.1.3] After locking tokens, creatorLockedTokens should be true", async () => {
                    await distributionPool.connect(creator).lockTokens();
                    const areTokensLocked = await distributionPool.didCreatorLockTokens();

                    assert.isTrue(areTokensLocked);
                });

                it("[DP][1.1.4] By default, creatorLockedTokens should be false", async () => {
                    const areTokensLocked = await distributionPool.didCreatorLockTokens();

                    assert.isFalse(areTokensLocked);
                });

                it("[DP][1.1.5] Creator shouldn't be able to lock tokens twice", async () => {
                    await distributionPool.connect(creator).lockTokens();
                    await expect(
                        distributionPool.connect(creator).lockTokens()
                    ).to.be.revertedWithCustomError(
                        distributionPool,
                        "DistributionPool__ProjectTokensAlreadyLocked"
                    );
                });

                it("[DP][1.1.6] Distribution pool balance for project token should increase by locked tokens amount", async () => {
                    const initialBalance = await buidl1Token.balanceOf(distributionPool.address);
                    await distributionPool.connect(creator).lockTokens();
                    const finalBalance = await buidl1Token.balanceOf(distributionPool.address);

                    assert.equal(
                        finalBalance.toString(),
                        initialBalance.add(lockedTokens).toString()
                    );
                });
            });
        });

        describe("2. getAllocationData() function", () => {
            describe("1.1 Interactions", () => {
                it("[DP][2.1.1] Should return 0 if project is canceled", async () => {
                    await investmentPool.setProjectState(canceledProjectStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[DP][2.1.2] Should return 0 if project state is before fundraiser", async () => {
                    await investmentPool.setProjectState(beforeFundraiserStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[DP][2.1.3] Should return 0 if fundraiser is ongoing", async () => {
                    await investmentPool.setProjectState(fundraiserOngoingStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[DP][2.1.4] Should return 0 if fundraiser failed", async () => {
                    await investmentPool.setProjectState(failedFundraiserStateValue);
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[DP][2.1.5] Should return 0 if fundraiser ended and no milestone is ongoing", async () => {
                    await investmentPool.setProjectState(
                        fundraiserEndedNoMilestonesOngoingStateValue
                    );
                    const allocationData = await distributionPool.getAllocationData(
                        investorA.address
                    );
                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(allocationData.allocationFlowRate.toString(), "0");
                });

                it("[DP][2.1.6] Should return correct amount if milestone 0 is ongoing", async () => {
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

                    assert.equal(allocationData.alreadyAllocated.toString(), "0");
                    assert.equal(
                        allocationData.allocationFlowRate.toString(),
                        milestoneAllocation.div(milestoneDuration).toString()
                    );
                });

                it("[DP][2.1.7] Should return correct amount if milestone 1 is ongoing", async () => {
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

                it("[DP][2.1.8] Should return correct amount if project was terminated by voting", async () => {
                    const terminationTimestamp = dateToSeconds("2100/11/01");
                    const timePassed = terminationTimestamp - milestone1StartDate;

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

                it("[DP][2.1.9] Should return correct amount if project was terminated by gelato", async () => {
                    const terminationTimestamp = dateToSeconds("2100/11/01");
                    const timePassed = terminationTimestamp - milestone1StartDate;

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

                it("[DP][2.1.10] Should return correct amount if project ended successfully", async () => {
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
        describe("3. allocateTokens() function", () => {
            describe("3.1 Public state", () => {
                it("[DP][3.1.1] Should push milestone to milestonesWithAllocation if no allocation was made for that milestone", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    const milestonesWithAllocation =
                        await distributionPool.getMilestonesWithAllocation(investorA.address);
                    assert.equal(milestonesWithAllocation.length, 1);
                    assert.equal(milestonesWithAllocation[0], 1);
                });

                it("[DP][3.1.2] Shouldn't push milestone to milestonesWithAllocation if allocation was made for that milestone", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    const milestonesWithAllocation =
                        await distributionPool.getMilestonesWithAllocation(investorA.address);
                    assert.equal(milestonesWithAllocation.length, 1);
                    assert.equal(milestonesWithAllocation[0], 1);
                });

                it("[DP][3.1.3] Should update memMilestoneAllocation with new allocation (1st allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    const memoizedMilestoneAllocation =
                        await distributionPool.getMemoizedMilestoneAllocation(
                            investorA.address,
                            1
                        );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    const newMemMilestoneAllocation =
                        await distributionPool.getMemMilestoneAllocation(investorA.address, 1);
                    const tokenAllocation = investmentWeight.mul(lockedTokens).div(weightDivisor);
                    const scaledAllocation = tokenAllocation
                        .mul(percentageDivider)
                        .div(allocationCoefficient);

                    assert.equal(
                        newMemMilestoneAllocation.toString(),
                        memoizedMilestoneAllocation.add(scaledAllocation).toString()
                    );
                });

                it("[DP][3.1.4] Should update memMilestoneAllocation with new allocation (2nd allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    const memoizedMilestoneAllocation =
                        await distributionPool.getMemoizedMilestoneAllocation(
                            investorA.address,
                            1
                        );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight.mul(2),
                        weightDivisor,
                        allocationCoefficient
                    );

                    const newMemMilestoneAllocation =
                        await distributionPool.getMemMilestoneAllocation(investorA.address, 1);
                    const tokenAllocation = investmentWeight
                        .mul(3)
                        .mul(lockedTokens)
                        .div(weightDivisor);
                    const scaledAllocation = tokenAllocation
                        .mul(percentageDivider)
                        .div(allocationCoefficient);

                    assert.equal(
                        newMemMilestoneAllocation.toString(),
                        memoizedMilestoneAllocation.add(scaledAllocation).toString()
                    );
                });

                it("[DP][3.1.5] Should update allocatedTokens for investor (2nd allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    const tokenAllocation = investmentWeight.mul(lockedTokens).div(weightDivisor);
                    const allocatedTokensInContract = await distributionPool.getAllocatedTokens(
                        investorA.address
                    );

                    assert.equal(allocatedTokensInContract.toString(), tokenAllocation.toString());
                });

                it("[DP][3.1.6] Should update allocatedTokens for investor (1st allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight.mul(2),
                        weightDivisor,
                        allocationCoefficient
                    );

                    const tokenAllocation = investmentWeight
                        .mul(3)
                        .mul(lockedTokens)
                        .div(weightDivisor);
                    const allocatedTokensInContract = await distributionPool.getAllocatedTokens(
                        investorA.address
                    );

                    assert.equal(allocatedTokensInContract.toString(), tokenAllocation.toString());
                });

                it("[DP][3.1.7] Should update totalAllocatedTokens (1st allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    const tokenAllocation = investmentWeight.mul(lockedTokens).div(weightDivisor);
                    const allocatedTokensInContract =
                        await distributionPool.getTotalAllocatedTokens();

                    assert.equal(allocatedTokensInContract.toString(), tokenAllocation.toString());
                });

                it("[DP][3.1.8] Should update totalAllocatedTokens (2nd allocation)", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        allocationCoefficient
                    );

                    investmentPool.allocateTokens(
                        1,
                        investorA.address,
                        investmentWeight.mul(2),
                        weightDivisor,
                        allocationCoefficient
                    );

                    const tokenAllocation = investmentWeight
                        .mul(3)
                        .mul(lockedTokens)
                        .div(weightDivisor);
                    const allocatedTokensInContract =
                        await distributionPool.getTotalAllocatedTokens();

                    assert.equal(allocatedTokensInContract.toString(), tokenAllocation.toString());
                });
            });
            describe("3.2 Interactions", () => {
                it("[DP][3.2.1] Investor shouldn't be able to allocate tokens", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    await expect(
                        distributionPool.allocateTokens(
                            0,
                            investorA.address,
                            investmentWeight,
                            weightDivisor,
                            allocationCoefficient
                        )
                    ).to.be.revertedWithCustomError(
                        distributionPool,
                        "DistributionPool__NotInvestmentPool"
                    );
                });

                it("[DP][3.2.2] Investment pool should be able to allocate tokens and emit event", async () => {
                    const investmentWeight = weightDivisor.div(10);
                    const allocationCoefficient = percentageDivider / 4;
                    await expect(
                        investmentPool.allocateTokens(
                            0,
                            investorA.address,
                            investmentWeight,
                            weightDivisor,
                            allocationCoefficient
                        )
                    )
                        .to.emit(distributionPool, "Allocated")
                        .withArgs(investorA.address, lockedTokens.div(10), 0);
                });
            });
        });
        describe("4. removeTokensAllocation() function", () => {
            describe("4.1 Public state", () => {});
            describe("4.2 Interactions", () => {
                it("[DP][4.2.1] Investor shouldn't be able to remove tokens allocation", async () => {
                    await expect(
                        distributionPool.removeTokensAllocation(0, investorA.address)
                    ).to.be.revertedWithCustomError(
                        distributionPool,
                        "DistributionPool__NotInvestmentPool"
                    );
                });

                it("[DP][4.2.2] Investment pool should be able to allocate tokens and emit event", async () => {
                    const milestoneId = 1;
                    const investmentWeight = weightDivisor.div(10);
                    investmentPool.allocateTokens(
                        milestoneId,
                        investorA.address,
                        investmentWeight,
                        weightDivisor,
                        milestonesPortionsLeft[milestoneId]
                    );

                    const tokenAllocation = await distributionPool.getInvestmentAllocation(
                        investorA.address,
                        milestoneId
                    );
                    await expect(
                        investmentPool.removeTokensAllocation(milestoneId, investorA.address)
                    )
                        .to.emit(distributionPool, "RemovedAllocation")
                        .withArgs(investorA.address, tokenAllocation, milestoneId);
                });
            });
        });
    });
});
