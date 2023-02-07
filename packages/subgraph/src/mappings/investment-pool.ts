import {Address, BigInt, dataSource, store} from "@graphprotocol/graph-ts";
import {
    InvestmentPool as InvestmentPoolContract,
    Initialized as InitializedEvent,
    Invest as InvestEvent,
    Unpledge as UnpledgeEvent,
    Refund as RefundedEvent,
    Cancel as CancelEvent,
    ClaimFunds as ClaimedFundsEvent,
    TerminateStream as TerminatedStreamEvent,
} from "../../generated/InvestmentPool/InvestmentPool";
import {DistributionPool as DistributionPoolContract} from "../../generated/templates/InvestmentPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {
    Project,
    DistributionPool,
    Milestone,
    AcceptedSuperToken,
    Investor,
    ProjectInvestment,
} from "../../generated/schema";
import {
    getOrInitProject,
    getOrInitAcceptedSuperToken,
    getOrInitInvestor,
    getOrInitProjectInvestment,
    getOrInitMilestone,
} from "../mappingHelpers";

export function handleInitialized(event: InitializedEvent): void {
    // INITIALIZATION
    getOrInitProject(event.address);
}

export function handleInvested(event: InvestEvent): void {
    const project = getOrInitProject(event.address);
    updateMilestoneInfo(project);

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    // Update project investment details
    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);
    projectInvestment.allocatedProjectTokens = dpContract.getAllocatedTokens(event.params.caller);
    projectInvestment.investedAmount = projectInvestment.investedAmount.plus(event.params.amount);
    projectInvestment.singleInvestmentsCount += 1;
    projectInvestment.save();

    // Update total invested amount
    project.totalInvested = project.totalInvested.plus(event.params.amount);
    project.isSoftCapReached = project.totalInvested >= project.softCap;
    project.save();
}

export function handleUnpledged(event: UnpledgeEvent): void {
    const project = getOrInitProject(event.address);
    updateMilestoneInfo(project);

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);

    if (projectInvestment.singleInvestmentsCount - 1 == 0) {
        // If investor has no more investments in this project, delete the project investment entity
        store.remove("ProjectInvestment", projectInvestment.id);
        project.investorsCount -= 1;
    } else {
        // Update investor's details
        projectInvestment.allocatedProjectTokens = dpContract.getAllocatedTokens(
            event.params.caller
        );
        projectInvestment.investedAmount = projectInvestment.investedAmount.minus(
            event.params.amount
        );
        projectInvestment.singleInvestmentsCount -= 1;
        projectInvestment.save();
    }

    // Update project info
    project.totalInvested = project.totalInvested.minus(event.params.amount);
    project.isSoftCapReached = project.totalInvested >= project.softCap;
    project.save();
}

function updateMilestoneInfo(project: Project): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
        Address.fromString(project.id)
    );

    // Get memoized investments list
    const memoizedInvestments: BigInt[] = ipContract.getMilestonesInvestmentsListForFormula();
    const milestones: string[] = project.milestones;
    const percentageDivider = project.percentageDivider;

    // Loop through each milestone and update the seed and stream allocations
    for (let i = 0; i < milestones.length; i++) {
        const milestone = getOrInitMilestone(Address.fromString(project.id), BigInt.fromI32(i));

        // Find the memoized investment
        const memMilestoneInvestment: BigInt = findInvestment(
            memoizedInvestments,
            BigInt.fromI32(i)
        );

        milestone.seedFundsAllocation = memMilestoneInvestment
            .times(milestone.seedPercentagePortion)
            .div(percentageDivider);
        milestone.streamFundsAllocation = memMilestoneInvestment
            .times(milestone.streamPercentagePortion)
            .div(percentageDivider);

        milestone.save();
    }
}

export function handleCanceled(event: CancelEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const project = getOrInitProject(event.address);
    project.isCanceledBeforeFundraiserStart = ipContract.isCanceledBeforeFundraiserStart();
    project.isCanceledDuringMilestones = ipContract.isCanceledDuringMilestones();
    project.emergencyTerminationTime = ipContract.getEmergencyTerminationTimestamp();
    project.isEmergencyTerminated = ipContract.isEmergencyTerminated();
    project.save();

    // If project was canceled before the fundraiser started, no data needs to be updated
    if (!project.isCanceledBeforeFundraiserStart) {
        // After canceling the project, milestone id stays the same
        const milestoneIdBI: BigInt = ipContract.getCurrentMilestoneId();
        const milestoneData = ipContract.getMilestone(milestoneIdBI);

        // Update milestone data
        const milestone = getOrInitMilestone(event.address, milestoneIdBI);
        milestone.isTotalAllocationPaid = milestoneData.paid;
        milestone.isStreamOngoing = milestoneData.streamOngoing;
        milestone.paidAmount = milestoneData.paidAmount;
        milestone.save();
    }
}

export function handleRefunded(event: RefundedEvent): void {
    // Currently not needed as no data changes after refunding
}

export function handleClaimedFunds(event: ClaimedFundsEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    // Get project entity
    const project = getOrInitProject(event.address);

    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneData = ipContract.getMilestone(milestoneIdBI);

    // Update milestone data from the event data passed in
    const milestone = getOrInitMilestone(event.address, milestoneIdBI);
    milestone.paidAmount = milestoneData.paidAmount;
    milestone.isSeedAllocationPaid = event.params.gotSeedFunds;
    milestone.isTotalAllocationPaid = event.params.gotStreamAmount;
    milestone.isStreamOngoing = event.params.openedStream;
    milestone.save();

    // Update current milestone id
    const currentMilestone = ipContract.getCurrentMilestoneId();
    const newCurrentMilestone = getOrInitMilestone(event.address, currentMilestone);
    project.currentMilestone = newCurrentMilestone.id;
    project.save();
}

export function handleTerminatedStream(event: TerminatedStreamEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneData = ipContract.getMilestone(milestoneIdBI);

    // Update milestone data from the event data passed in
    const milestone = getOrInitMilestone(event.address, milestoneIdBI);
    milestone.paidAmount = milestoneData.paidAmount;
    milestone.isSeedAllocationPaid = milestoneData.seedAmountPaid;
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;

    milestone.save();
}

/**
 * @notice Find the memoized investment for the milestone.
 * If the milestone has no investment, find the last investment before the milestone.
 * If there is no investment before the milestone, return 0.
 * @param investmentsList memoized investments list
 * @param idBI milestone id
 * @returns memoized investment
 * Example: list = [100, 0, 0], id = 1;
 * This will return 100, because there is no memoized investment for milestone 1, but there is for milestone 0.
 */
function findInvestment(investmentsList: BigInt[], idBI: BigInt): BigInt {
    const id = idBI.toI32();
    const investment = investmentsList[id];

    if (investment.notEqual(BigInt.fromI32(0))) {
        return investment;
    } else {
        for (let i = id - 1; i >= 0; i--) {
            if (investmentsList[i].notEqual(BigInt.fromI32(0))) {
                return investmentsList[i];
            }
        }
    }

    return BigInt.fromI32(0);
}
