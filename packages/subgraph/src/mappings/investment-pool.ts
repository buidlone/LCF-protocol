import {Address, BigInt, store} from "@graphprotocol/graph-ts";
// import {i32} from "assemblyscript/std/assembly/index";
import {
    InvestmentPool as InvestmentPoolContract,
    Initialized as InitializedEvent,
    Invest as InvestEvent,
    Unpledge as UnpledgeEvent,
    Refund as RefundedEvent,
    Cancel as CancelEvent,
    ClaimFunds as ClaimedFundsEvent,
    TerminateStream as TerminatedStreamEvent,
    GelatoFeeTransfer as TerminatedByGelatoEvent,
} from "../../generated/templates/InvestmentPool/InvestmentPool";
import {Project} from "../../generated/schema";
import {
    getOrInitProject,
    getOrInitProjectInvestment,
    getOrInitMilestone,
    getOrInitSingleInvestment,
} from "../mappingHelpers";

export function handleInitialized(event: InitializedEvent): void {
    // INITIALIZATION
    getOrInitProject(event.address);
}

export function handleInvested(event: InvestEvent): void {
    const project = getOrInitProject(event.address);
    updateFlowrateInfo(project, event.params.caller);
    updateMilestoneInfo(project);

    // Update project investment details
    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);
    projectInvestment.investedAmount = projectInvestment.investedAmount.plus(event.params.amount);
    projectInvestment.save();

    const singleInvestment = getOrInitSingleInvestment(
        event.address,
        event.params.caller,
        BigInt.fromI32(projectInvestment.singleInvestmentsCount - 1)
    );
    singleInvestment.transactionHash = event.transaction.hash;
    singleInvestment.investedAmount = event.params.amount;
    singleInvestment.save();

    // Update total invested amount
    project.totalInvested = project.totalInvested.plus(event.params.amount);
    project.singleInvestmentsCount += 1;
    project.isSoftCapReached = project.totalInvested >= project.softCap;
    project.save();
}

export function handleUnpledged(event: UnpledgeEvent): void {
    const project = getOrInitProject(event.address);
    updateFlowrateInfo(project, event.params.caller);
    updateMilestoneInfo(project);

    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);
    const singleInvestment = getOrInitSingleInvestment(
        event.address,
        event.params.caller,
        BigInt.fromI32(projectInvestment.singleInvestmentsCount - 1)
    );

    // No matter what, delete the single investment
    store.remove("SingleInvestment", singleInvestment.id);

    if (projectInvestment.singleInvestmentsCount - 1 == 0) {
        // If investor has no more investments in this project, delete the project investment entity
        store.remove("ProjectInvestment", projectInvestment.id);
        project.investorsCount -= 1;
    } else {
        // Update investor's details
        projectInvestment.investedAmount = projectInvestment.investedAmount.minus(
            event.params.amount
        );
        projectInvestment.singleInvestmentsCount -= 1;
        projectInvestment.save();
    }

    // Update project info
    project.totalInvested = project.totalInvested.minus(event.params.amount);
    project.singleInvestmentsCount -= 1;
    project.isSoftCapReached = project.totalInvested >= project.softCap;
    project.save();
}

function updateFlowrateInfo(project: Project, investorAddress: Address): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
        Address.fromString(project.id)
    );

    const milestonesCount = project.milestonesCount;
    const tokensAllocations = new Array<BigInt>(0);
    const flowrates = new Array<BigInt>(0);

    let lastTokenAllocation = BigInt.fromI32(0);
    for (let i = 0; i < milestonesCount; i++) {
        const milestone = getOrInitMilestone(Address.fromString(project.id), BigInt.fromI32(i));
        const tokenAllocation = ipContract.getInvestorTokensAllocation(investorAddress, i);
        lastTokenAllocation = lastTokenAllocation.plus(tokenAllocation);
        tokensAllocations.push(lastTokenAllocation);
        flowrates.push(tokenAllocation.div(milestone.duration));
    }

    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(project.id),
        investorAddress
    );
    projectInvestment.investmentFlowrates = flowrates;
    projectInvestment.investmentUsed = tokensAllocations;
    projectInvestment.save();
}

function updateMilestoneInfo(project: Project): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
        Address.fromString(project.id)
    );

    // Get memoized investments list
    const memoizedInvestments: BigInt[] = ipContract.getMemoizedInvestmentsList();
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
        const milestoneId = ipContract.getCurrentMilestoneId() | 0;
        const milestoneData = ipContract.getMilestone(milestoneId);

        // Update milestone data
        const milestone = getOrInitMilestone(event.address, BigInt.fromI32(milestoneId));
        milestone.isTotalAllocationPaid = milestoneData.paid;
        milestone.isStreamOngoing = milestoneData.streamOngoing;
        milestone.paidAmount = milestoneData.paidAmount;
        milestone.save();
    }
}

export function handleRefunded(event: RefundedEvent): void {
    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);
    projectInvestment.isRefunded = true;
    projectInvestment.save();
}

export function handleClaimedFunds(event: ClaimedFundsEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    // Get project entity
    const project = getOrInitProject(event.address);

    const milestoneId = event.params.milestoneId | 0;
    const milestoneData = ipContract.getMilestone(milestoneId);

    // Update milestone data from the event data passed in
    const milestone = getOrInitMilestone(event.address, BigInt.fromI32(milestoneId));
    milestone.paidAmount = milestoneData.paidAmount;
    milestone.isSeedAllocationPaid = event.params.gotSeedFunds;
    milestone.isTotalAllocationPaid = event.params.gotStreamAmount;
    milestone.isStreamOngoing = event.params.openedStream;
    milestone.save();

    // Update current milestone id
    const currentMilestone = event.params.milestoneId | 0;
    const newCurrentMilestone = getOrInitMilestone(
        event.address,
        BigInt.fromI32(currentMilestone)
    );
    project.currentMilestone = newCurrentMilestone.id;
    project.fundsUsedByCreator = ipContract.getFundsUsed();
    project.save();
}

export function handleTerminatedStream(event: TerminatedStreamEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const milestoneId = event.params.milestoneId | 0;
    const milestoneData = ipContract.getMilestone(milestoneId);

    // Update milestone data from the event data passed in
    const milestone = getOrInitMilestone(event.address, BigInt.fromI32(milestoneId));
    milestone.paidAmount = milestoneData.paidAmount;
    milestone.isSeedAllocationPaid = milestoneData.seedAmountPaid;
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;
    milestone.save();

    const project = getOrInitProject(event.address);
    project.fundsUsedByCreator = ipContract.getFundsUsed();
    project.save();
}

export function handleTerminatedByGelato(event: TerminatedByGelatoEvent): void {
    const project = getOrInitProject(event.address);
    project.isTerminatedByGelato = true;
    project.save();
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
