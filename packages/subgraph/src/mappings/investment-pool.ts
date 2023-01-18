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
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {
    Project,
    Governance,
    Distribution,
    Milestone,
    AcceptedSuperToken,
    ProjectToken,
    VotingToken,
} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get investment pool contract
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);
    const milestonesCount = ipContract.getMilestonesCount().toI32();
    let milestoneIds: string[] = [];

    // Get project entity
    const projectId: string = event.address.toHexString();
    let project = Project.load(projectId);
    if (project) return;

    // Create new project entity
    project = new Project(projectId);
    project.creator = ipContract.getCreator();
    project.percentageDivider = ipContract.getPercentageDivider();

    // Loop through each milestone and create a new milestone entity with the data
    for (let milestoneId = 0; milestoneId < milestonesCount; milestoneId++) {
        // Get project entity
        const id: string = `${projectId}-${milestoneId.toString()}`;
        let milestone = Milestone.load(id);
        if (milestone) return;

        // Create new milestone entity
        milestone = new Milestone(id);
        milestone.project = projectId;
        milestone.milestoneId = milestoneId;

        // Assign milestone data from IP smart contract
        const milestoneIdBI: BigInt = BigInt.fromI32(milestoneId);
        const milestoneData = ipContract.getMilestone(milestoneIdBI);
        milestone.startTime = milestoneData.startDate.toI32();
        milestone.endTime = milestoneData.endDate.toI32();
        milestone.duration = milestone.endTime - milestone.startTime;
        milestone.seedPercentagePortion = milestoneData.intervalSeedPortion;
        milestone.streamPercentagePortion = milestoneData.intervalStreamingPortion;

        // Set default values
        milestone.seedFundsAllocation = BigInt.fromI32(0);
        milestone.streamFundsAllocation = BigInt.fromI32(0);
        milestone.isSeedAllocationPaid = false;
        milestone.isTotalAllocationPaid = false;
        milestone.isStreamOngoing = false;
        milestone.paidAmount = BigInt.fromI32(0);

        milestone.save();

        milestoneIds.push(id);
    }

    // Add all milestones to project entity
    project.milestones = milestoneIds;
    project.save();

    // Get accepted super token entity
    const acceptedTokenAddress = ipContract.getAcceptedToken();
    const acceptedTokenId: string = acceptedTokenAddress.toHexString();
    let acceptedToken = AcceptedSuperToken.load(acceptedTokenId);
    if (acceptedToken) return;

    // Create accepted super token entity
    const acceptedTokenContract = ERC20Contract.bind(acceptedTokenAddress);
    acceptedToken = new AcceptedSuperToken(acceptedTokenId);
    acceptedToken.name = acceptedTokenContract.name();
    acceptedToken.symbol = acceptedTokenContract.symbol();
    acceptedToken.decimals = acceptedTokenContract.decimals();
    acceptedToken.save();

    // Get new governance entity
    // TODO add governance entity
}

export function handleInvested(event: InvestEvent): void {
    updateSeedAndStreamAllocations(event.address);
}

export function handleUnpledged(event: UnpledgeEvent): void {
    updateSeedAndStreamAllocations(event.address);
}

function updateSeedAndStreamAllocations(contractAddress: Address): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(contractAddress);

    // Get project entity
    const projectId: string = contractAddress.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    const memoizedInvestments: BigInt[] = ipContract.getMilestonesInvestmentsListForFormula();
    const milestones: string[] = project.milestones;

    // Loop through each milestone and update the seed and stream allocations
    for (let i = 0; i < milestones.length; i++) {
        let milestone = Milestone.load(milestones[i]);
        if (!milestone) return;

        const milestoneIdBI: BigInt = BigInt.fromI32(milestone.milestoneId);
        // Find the memoized investment
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

    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    // If project was canceled before the fundraiser started, no data needs to be updated
    const canceledBefore = ipContract.isCanceledBeforeFundraiserStart();
    if (canceledBefore) return;

    // After canceling the project, milestone id stays the same
    const milestoneIdBI: BigInt = ipContract.getCurrentMilestoneId();
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    // Update milestone data
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

    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    // Update milestone data from the event data passed in
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

    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) return;

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    let milestone = Milestone.load(`${projectId}-${milestoneIdBI.toString()}`);
    if (!milestone) return;

    // Update milestone data from the smart contract
    const milestoneData = ipContract.getMilestone(milestoneIdBI);
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;
    milestone.paidAmount = milestoneData.paidAmount;

    milestone.save();
}

/**
 * Find the memoized investment for the milestone.
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
