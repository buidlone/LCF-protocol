import {Address, BigInt, dataSource, log, store} from "@graphprotocol/graph-ts";
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
    Milestone,
    AcceptedSuperToken,
    Investor,
    ProjectInvestment,
} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get investment pool contract
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(event.address);
    const milestonesCount = ipContract.getMilestonesCount().toI32();

    // Get context from investment pool
    const context = dataSource.context();
    const creator = context.getBytes("creator");
    const projectFactoryId = context.getBytes("investmentPoolFactoryAddress").toHexString();
    const governanceId = context.getBytes("governancePoolAddress").toHexString();
    const distributionId = context.getBytes("distributionPoolAddress").toHexString();

    // Get project entity. Shouldn't exist yet
    const projectId: string = event.address.toHexString();
    let project = Project.load(projectId);
    if (project) {
        log.critical("Project already exists: {}", [projectId]);
        return;
    }

    // Create new project entity
    project = new Project(projectId);

    // Loop through each milestone and create a new milestone entity with the data
    let milestoneIds: string[] = [];
    let projectStartTime = 0;
    let projectEndTime = 0;
    for (let milestoneId = 0; milestoneId < milestonesCount; milestoneId++) {
        // Get milestone entity
        const milestoneFullId: string = `${projectId}-${milestoneId.toString()}`;
        let milestone = Milestone.load(milestoneFullId);
        if (milestone) {
            log.critical("Milestone already exists: {}", [milestoneFullId]);
            return;
        }

        // Create new milestone entity
        milestone = new Milestone(milestoneFullId);
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
        milestoneIds.push(milestoneFullId);

        // Set project start and end time
        if (milestoneId === 0) {
            projectStartTime = milestone.startTime;
        } else if (milestoneId === milestonesCount - 1) {
            projectEndTime = milestone.endTime;
        }
    }

    // Get accepted super token entity
    const acceptedTokenAddress = ipContract.getAcceptedToken();
    const acceptedTokenId: string = acceptedTokenAddress.toHexString();
    let acceptedToken = AcceptedSuperToken.load(acceptedTokenId);
    if (!acceptedToken) {
        /**
         * @notice Create accepted super token entity if it doesn't exist
         * @notice Multiple projects can accept the same super token
         */
        const acceptedTokenContract = ERC20Contract.bind(acceptedTokenAddress);
        acceptedToken = new AcceptedSuperToken(acceptedTokenId);
        acceptedToken.name = acceptedTokenContract.name();
        acceptedToken.symbol = acceptedTokenContract.symbol();
        acceptedToken.decimals = acceptedTokenContract.decimals();
        acceptedToken.save();
    }

    // Add all project details
    project.factory = projectFactoryId;
    project.softCap = ipContract.getSoftCap();
    project.hardCap = ipContract.getHardCap();
    project.totalInvested = BigInt.fromI32(0);
    project.softCapMultiplier = ipContract.getSoftCapMultiplier().toI32();
    project.hardCapMultiplier = ipContract.getHardCapMultiplier().toI32();
    project.maximumWeightDivisor = ipContract.getMaximumWeightDivisor();
    project.governacePool = governanceId;
    project.distributionPool = distributionId;
    project.creator = creator;
    project.milestones = milestoneIds;
    project.milestonesCount = ipContract.getMilestonesCount().toI32();
    project.currentMilestone = milestoneIds[0];
    project.fundraiserStartTime = ipContract.getFundraiserStartTime().toI32();
    project.fundraiserEndTime = ipContract.getFundraiserEndTime().toI32();
    project.duration = projectEndTime - projectStartTime;
    project.acceptedToken = acceptedTokenId;
    project.percentageDivider = ipContract.getPercentageDivider();
    project.investorsCount = 0;
    project.save();
}

export function handleInvested(event: InvestEvent): void {
    // Get project entity
    const projectId: string = event.address.toHexString();
    const project = Project.load(projectId);
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    updateMilestoneInfo(project);

    const investor = getInvestor(event.params.caller);
    const projectInvestmentId = `${projectId}-${investor.id}`;
    let projectInvestment = ProjectInvestment.load(projectInvestmentId);

    if (!projectInvestment) {
        // If investor hasn't invested in this project before, create a new project investment entity
        projectInvestment = new ProjectInvestment(projectInvestmentId);
        projectInvestment.investor = investor.id;
        projectInvestment.project = projectId;
        projectInvestment.investedAmount = BigInt.fromI32(0);
        projectInvestment.allocatedProjectTokens = BigInt.fromI32(0);
        projectInvestment.votesAgainst = BigInt.fromI32(0);
        projectInvestment.claimedProjectTokens = BigInt.fromI32(0);

        // Update the number of investors
        project.investorsCount = project.investorsCount + 1;
    }

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
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(project.distributionPool)
    );

    updateMilestoneInfo(project);

    const investor = getInvestor(event.params.caller);
    const projectInvestmentId = `${projectId}-${investor.id}`;
    let projectInvestment = ProjectInvestment.load(projectInvestmentId);

    if (!projectInvestment) {
        log.critical("Project investment doesn't exist: {}", [projectInvestmentId]);
        return;
    }

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

function getInvestor(investorAddress: Address): Investor {
    const investorId = investorAddress.toHexString();
    let investor = Investor.load(investorId);
    if (!investor) {
        investor = new Investor(investorId);
        investor.save();
    }
    return investor;
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
        if (!milestone) {
            log.critical("Milestone doesn't exist: {}", [milestones[i]]);
            return;
        }

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
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    // If project was canceled before the fundraiser started, no data needs to be updated
    const canceledBefore = ipContract.isCanceledBeforeFundraiserStart();
    if (canceledBefore) return;

    // After canceling the project, milestone id stays the same
    const milestoneIdBI: BigInt = ipContract.getCurrentMilestoneId();
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) {
        log.critical("Milestone doesn't exist: {}", [milestoneFullId]);
        return;
    }

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
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) {
        log.critical("Milestone doesn't exist: {}", [milestoneFullId]);
        return;
    }

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
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    // Find the milestone entity
    const milestoneIdBI: BigInt = event.params.milestoneId;
    const milestoneFullId: string = `${projectId}-${milestoneIdBI.toString()}`;
    let milestone = Milestone.load(milestoneFullId);
    if (!milestone) {
        log.critical("Milestone doesn't exist: {}", [milestoneFullId]);
        return;
    }
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
