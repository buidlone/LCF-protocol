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
} from "../mappingHelpers";

export function handleInitialized(event: InitializedEvent): void {
    // Initialize project entity
    const project = getOrInitProject(event.address);
}

export function handleInvested(event: InvestEvent): void {
    const project = getOrInitProject(event.address);

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    updateMilestoneInfo(project);

    const projectInvestment = getOrInitProjectInvestment(event.address, event.params.caller);

    // Update investor invested amount
    projectInvestment.allocatedProjectTokens = dpContract.getAllocatedTokens(event.params.caller);
    projectInvestment.investedAmount = projectInvestment.investedAmount.plus(event.params.amount);
    projectInvestment.save();

    // Update total invested amount
    project.totalInvested = project.totalInvested.plus(event.params.amount);
    project.save();
}

export function handleUnpledged(event: UnpledgeEvent): void {
    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    updateMilestoneInfo(project);

    const investor = getOrInitInvestor(event.params.caller);
    const projectInvestmentId = `${projectId}-${investor.id}`;
    let projectInvestment = ProjectInvestment.load(projectInvestmentId);

    if (!projectInvestment)
        throw new Error("Project investment doesn't exist: " + projectInvestmentId);

    if (projectInvestment.investedAmount.minus(event.params.amount).equals(BigInt.fromI32(0))) {
        // If investor has no more investments in this project, delete the project investment entity
        store.remove("ProjectInvestment", projectInvestmentId);
        project.investorsCount = project.investorsCount - 1;
    } else {
        // Update investor's details
        projectInvestment.allocatedProjectTokens = dpContract.getAllocatedTokens(
            event.params.caller
        );
        projectInvestment.investedAmount = projectInvestment.investedAmount.minus(
            event.params.amount
        );
        projectInvestment.save();
    }

    // Update project info
    project.totalInvested = project.totalInvested.minus(event.params.amount);
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
        let milestone = Milestone.load(milestones[i]);
        if (!milestone) throw new Error("Milestone doesn't exist: " + milestones[i]);

        const milestoneIdBI: BigInt = BigInt.fromI32(milestone.milestoneId);
        // Find the memoized investment
        const memMilestoneInvestment: BigInt = findInvestment(memoizedInvestments, milestoneIdBI);

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

    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    // If project was canceled before the fundraiser started, no data needs to be updated
    const canceledBefore = ipContract.isCanceledBeforeFundraiserStart();
    if (canceledBefore) return;

    // After canceling the project, milestone id stays the same
    const milestoneIdBI: BigInt = ipContract.getCurrentMilestoneId();
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) throw new Error("Milestone doesn't exist: " + milestoneFullId);

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
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) throw new Error("Milestone doesn't exist: " + milestoneFullId);

    // Update milestone data from the event data passed in
    const paidAmount = ipContract.getMilestone(milestoneIdBI).paidAmount;
    milestone.paidAmount = paidAmount;
    milestone.isSeedAllocationPaid = event.params.gotSeedFunds;
    milestone.isTotalAllocationPaid = event.params.gotStreamAmount;
    milestone.isStreamOngoing = event.params.openedStream;
    milestone.save();

    // Update current milestone id
    const currentMilestone = ipContract.getCurrentMilestoneId().toString();
    const newMilestoneId: string = `${projectId}-${currentMilestone}`;
    project.currentMilestone = newMilestoneId;
    project.save();
}

export function handleTerminatedStream(event: TerminatedStreamEvent): void {
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);

    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) throw new Error("Milestone doesn't exist: " + milestoneFullId);

    // Update milestone data from the smart contract
    const milestoneData = ipContract.getMilestone(milestoneIdBI);
    milestone.isTotalAllocationPaid = milestoneData.paid;
    milestone.isStreamOngoing = milestoneData.streamOngoing;
    milestone.paidAmount = milestoneData.paidAmount;

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
