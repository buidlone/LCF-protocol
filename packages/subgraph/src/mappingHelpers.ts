import {dataSource, Address, BigInt, ethereum} from "@graphprotocol/graph-ts";
import {
    ProjectFactory,
    Project,
    Milestone,
    AcceptedSuperToken,
    ProjectInvestment,
    Investor,
    GovernancePool,
    DistributionPool,
} from "../generated/schema";
import {InvestmentPoolFactory as InvestmentPoolFactoryContract} from "../generated/InvestmentPoolFactory/InvestmentPoolFactory";
import {InvestmentPool as InvestmentPoolContract} from "../generated/templates/InvestmentPool/InvestmentPool";
import {ERC20 as ERC20Contract} from "../generated/templates/ERC20/ERC20";

export function getOrInitProjectFactory(projectFactoryAddress: Address): ProjectFactory {
    // Get project factory entity
    const projectFactoryId: string = projectFactoryAddress.toHex();
    let projectFactory = ProjectFactory.load(projectFactoryId);

    if (!projectFactory) {
        const ipFactoryContract: InvestmentPoolFactoryContract =
            InvestmentPoolFactoryContract.bind(projectFactoryAddress);

        // Create new project factory entity
        projectFactory = new ProjectFactory(projectFactoryId);
        projectFactory.maxMilesonesCount = ipFactoryContract.getMaxMilestoneCount().toI32();
        projectFactory.terminationWindow = ipFactoryContract.getTerminationWindow();
        projectFactory.minMilestoneDuration = ipFactoryContract.getMilestoneMinDuration();
        projectFactory.maxMilestoneDuration = ipFactoryContract.getMilestoneMaxDuration();
        projectFactory.minFundraiserDuration = ipFactoryContract.getFundraiserMinDuration();
        projectFactory.maxFundraiserDuration = ipFactoryContract.getFundraiserMaxDuration();
        projectFactory.save();
    }

    return projectFactory;
}

export function getOrInitProject(projectAddress: Address): Project {
    // Get project entity. Shouldn't exist yet
    const projectId: string = projectAddress.toHex();
    let project = Project.load(projectId);

    if (!project) {
        const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(projectAddress);
        project = new Project(projectId);

        let milestoneIds: string[] = [];
        const milestonesCount = ipContract.getMilestonesCount().toI32();

        // Loop through each milestone and create a new milestone entity with the data
        for (let milestoneId = 0; milestoneId < milestonesCount; milestoneId++) {
            const milestone = getOrInitMilestone(projectAddress, milestoneId);
            milestoneIds.push(milestone.id);
        }

        let projectStartTime: BigInt = getOrInitMilestone(projectAddress, 0).startTime;
        let projectEndTime: BigInt = getOrInitMilestone(
            projectAddress,
            milestonesCount - 1
        ).endTime;

        const context = dataSource.context();
        const acceptedSuperToken = getOrInitAcceptedSuperToken(
            Address.fromString(project.acceptedToken)
        );

        // Add all project details
        project.factory = context.getString("investmentPoolFactoryAddress");
        project.softCap = ipContract.getSoftCap();
        project.hardCap = ipContract.getHardCap();
        project.totalInvested = BigInt.fromI32(0);
        project.softCapMultiplier = ipContract.getSoftCapMultiplier().toI32();
        project.hardCapMultiplier = ipContract.getHardCapMultiplier().toI32();
        project.maximumWeightDivisor = ipContract.getMaximumWeightDivisor();
        project.governancePool = context.getString("governancePoolAddress");
        project.distributionPool = context.getString("distributionPoolAddress");
        project.creator = Address.fromString(context.getString("creator"));
        project.milestones = milestoneIds;
        project.milestonesCount = ipContract.getMilestonesCount().toI32();
        project.currentMilestone = milestoneIds[0];
        project.fundraiserStartTime = ipContract.getFundraiserStartTime();
        project.fundraiserEndTime = ipContract.getFundraiserEndTime();
        project.duration = projectEndTime.minus(projectStartTime);
        project.acceptedToken = acceptedSuperToken.id;
        project.percentageDivider = ipContract.getPercentageDivider();
        project.investorsCount = 0;
        project.save();
    }

    return project;
}

export function getOrInitGovernancePool(): GovernancePool {
    return governancePool;
}

export function getOrInitDistributionPool(): DistributionPool {
    return distributionPool;
}

export function getOrInitMilestone(projectAddress: Address, milestoneId: number): Milestone {
    const projectId = projectAddress.toHex();
    const milestoneFullId: string = `${projectId}-${milestoneId.toString()}`;
    let milestone = Milestone.load(milestoneFullId);

    if (!milestone) {
        const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
            Address.fromString(projectId)
        );

        // Create new milestone entity
        milestone = new Milestone(milestoneFullId);
        const milestoneIdBI: BigInt = BigInt.fromI32(milestoneId);
        const milestoneData = ipContract.getMilestone(milestoneIdBI);

        milestone.project = projectId;
        milestone.milestoneId = milestoneId;
        milestone.startTime = milestoneData.startDate;
        milestone.endTime = milestoneData.endDate;
        milestone.duration = milestone.endTime.minus(milestone.startTime);
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
    }

    return milestone;
}

export function getOrInitInvestor(investorAddress: Address): Investor {
    const investorId = investorAddress.toHex();
    let investor = Investor.load(investorId);

    if (!investor) {
        investor = new Investor(investorId);
        investor.save();
    }

    return investor;
}

export function getOrInitProjectInvestment(
    projectAddress: Address,
    investorAddress: Address
): ProjectInvestment {
    const investor = getOrInitInvestor(investorAddress);
    const project = getOrInitProject(projectAddress);
    const projectInvestmentId = `${projectAddress.toHex()}-${investor.id}`;
    let projectInvestment = ProjectInvestment.load(projectInvestmentId);

    if (!projectInvestment) {
        // If investor hasn't invested in this project before, create a new project investment entity
        projectInvestment = new ProjectInvestment(projectInvestmentId);
        projectInvestment.investor = investor.id;
        projectInvestment.project = projectAddress.toHex();
        projectInvestment.investedAmount = BigInt.fromI32(0);
        projectInvestment.allocatedProjectTokens = BigInt.fromI32(0);
        projectInvestment.votesAgainst = BigInt.fromI32(0);
        projectInvestment.claimedProjectTokens = BigInt.fromI32(0);
        projectInvestment.save();

        // Update the number of investors
        project.investorsCount = project.investorsCount + 1;
        project.save();
    }

    return projectInvestment;
}

export function getOrInitAcceptedSuperToken(acceptedTokenAddress: Address): AcceptedSuperToken {
    // Get accepted super token entity
    const acceptedTokenId: string = acceptedTokenAddress.toHex();
    let acceptedToken = AcceptedSuperToken.load(acceptedTokenId);

    if (!acceptedToken) {
        const acceptedTokenContract = ERC20Contract.bind(acceptedTokenAddress);

        /**
         * @notice Create accepted super token entity if it doesn't exist
         * @notice Multiple projects can accept the same super token
         */
        acceptedToken = new AcceptedSuperToken(acceptedTokenId);
        acceptedToken.name = acceptedTokenContract.name();
        acceptedToken.symbol = acceptedTokenContract.symbol();
        acceptedToken.decimals = acceptedTokenContract.decimals();
        acceptedToken.save();
    }

    return acceptedToken;
}
