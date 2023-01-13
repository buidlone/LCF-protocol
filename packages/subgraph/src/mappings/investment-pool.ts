import {Address, BigInt, log} from "@graphprotocol/graph-ts";
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
import {Project, Milestone} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);
    const milestonesCount = ipContract.getMilestonesCount().toI32();
    let milestoneIds: string[] = [];

    const projectId: string = event.address.toHexString();
    let project = Project.load(projectId);
    if (project) return;

    project = new Project(projectId);
    project.creator = ipContract.getCreator();
    project.percentageDivider = ipContract.getPercentageDivider();

    for (let milestoneId = 0; milestoneId < milestonesCount; milestoneId++) {
        const id: string = `${projectId}-${milestoneId.toString()}`;
        let milestone = Milestone.load(id);
        if (milestone) return;

        milestone = new Milestone(id);
        milestone.project = projectId;
        milestone.milestoneId = milestoneId;

        const milestoneIdBI: BigInt = BigInt.fromI32(milestoneId);
        const milestoneData = ipContract.getMilestone(milestoneIdBI);
        milestone.startTime = milestoneData.startDate.toI32();
        milestone.endTime = milestoneData.endDate.toI32();
        milestone.duration = milestone.endTime - milestone.startTime;
        milestone.seedPercentagePortion = milestoneData.intervalSeedPortion;
        milestone.streamPercentagePortion = milestoneData.intervalStreamingPortion;

        milestone.seedFundsAllocation = BigInt.fromI32(0);
        milestone.streamFundsAllocation = BigInt.fromI32(0);
        milestone.isSeedAllocationPaid = false;
        milestone.isTotalAllocationPaid = false;
        milestone.isStreamOngoing = false;
        milestone.paidAmount = BigInt.fromI32(0);

        milestone.save();

        milestoneIds.push(id);
    }

    project.milestones = milestoneIds;
    project.save();
}

export function handleInvested(event: InvestEvent): void {
    updateSeedAndStreamAllocations(event.address);
}

export function handleUnpledged(event: UnpledgeEvent): void {
    updateSeedAndStreamAllocations(event.address);
}

function updateSeedAndStreamAllocations(contractAddress: Address): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(contractAddress);

    const projectId: string = contractAddress.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    const memoizedInvestments: BigInt[] = ipContract.getMilestonesInvestmentsListForFormula();
    const milestones: string[] = project.milestones;

    for (let i = 0; i < milestones.length; i++) {
        let milestone = Milestone.load(milestones[i]);
        if (!milestone) return;

        const milestoneIdBI: BigInt = BigInt.fromI32(milestone.milestoneId);
        const memMilestoneInvestment: BigInt = findInvestment(memoizedInvestments, milestoneIdBI);

        milestone.seedFundsAllocation = memMilestoneInvestment
            .times(milestone.seedPercentagePortion)
            .div(project.percentageDivider);
        milestone.streamFundsAllocation = memMilestoneInvestment
            .times(milestone.streamPercentagePortion)
            .div(project.percentageDivider);

        milestone.save();
    }
}

export function handleCanceled(event: CancelEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    const canceledBefore = ipContract.isCanceledBeforeFundraiserStart();
    if (canceledBefore) return;

    // After canceling the project, milestone id stays the same
    const milestoneIdBI: BigInt = ipContract.getCurrentMilestoneId();
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    const milestoneData = ipContract.getMilestone(milestoneIdBI);
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;
    milestone.paidAmount = milestoneData.paidAmount;

    milestone.save();
}

export function handleRefunded(event: RefundedEvent): void {
    // Does not change milestone information
}

export function handleClaimedFunds(event: ClaimedFundsEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    const milestoneIdBI: BigInt = event.params.milestoneId;
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    const isSeedAllocationPaid = event.params.gotSeedFunds;
    const isTotalAllocationPaid = event.params.gotStreamAmount;
    const isStreamOngoing = event.params.openedStream;
    milestone.isSeedAllocationPaid = isSeedAllocationPaid;
    milestone.isTotalAllocationPaid = isTotalAllocationPaid;
    milestone.isStreamOngoing = isStreamOngoing;

    const paidAmount = ipContract.getMilestone(milestoneIdBI).paidAmount;
    milestone.paidAmount = paidAmount;

    milestone.save();
}

export function handleTerminatedStream(event: TerminatedStreamEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    const milestoneIdBI: BigInt = event.params.milestoneId;
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    const milestoneData = ipContract.getMilestone(milestoneIdBI);
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;
    milestone.paidAmount = milestoneData.paidAmount;

    milestone.save();
}

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
