import {dataSource, Address, BigInt, ethereum, BigDecimal, Bytes} from "@graphprotocol/graph-ts";
import {
    ProjectFactory,
    Project,
    GovernancePool,
    DistributionPool,
    Milestone,
    Investor,
    ProjectInvestment,
    SingleInvestment,
    AcceptedSuperToken,
    ProjectToken,
    VotingToken,
} from "../generated/schema";
import {InvestmentPoolFactory as InvestmentPoolFactoryContract} from "../generated/InvestmentPoolFactory/InvestmentPoolFactory";
import {InvestmentPool as InvestmentPoolContract} from "../generated/templates/InvestmentPool/InvestmentPool";
import {GovernancePool as GovernancePoolContract} from "../generated/templates/GovernancePool/GovernancePool";
import {DistributionPool as DistributionPoolContract} from "../generated/templates/DistributionPool/DistributionPool";
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
    const projectId = projectAddress.toHex();
    let project = Project.load(projectId);

    if (!project) {
        const context = dataSource.context();
        const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(projectAddress);

        let milestoneIds: string[] = [];
        const milestonesCount = ipContract.getMilestonesCount().toI32();
        // Loop through each milestone and create a new milestone entity with the data
        for (let milestoneId = 0; milestoneId < milestonesCount; milestoneId++) {
            const milestone = getOrInitMilestone(projectAddress, BigInt.fromI32(milestoneId));
            milestoneIds.push(milestone.id);
        }

        const acceptedSuperToken = getOrInitAcceptedSuperToken(ipContract.getAcceptedToken());
        const projectStartTime: BigInt = getOrInitMilestone(
            projectAddress,
            BigInt.fromI32(0)
        ).startTime;
        const projectEndTime: BigInt = getOrInitMilestone(
            projectAddress,
            BigInt.fromI32(milestonesCount - 1)
        ).endTime;

        // Add all project details
        project = new Project(projectId);
        project.factory = context.getString("investmentPoolFactoryAddress");
        project.softCap = ipContract.getSoftCap();
        project.hardCap = ipContract.getHardCap();
        project.isSoftCapReached = false;
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
        project.isCanceledBeforeFundraiserStart = false;
        project.emergencyTerminationTime = BigInt.fromI32(0);
        project.isEmergencyTerminated = false;
        project.isCanceledDuringMilestones = false;
        project.isTerminatedByGelato = false;
        project.singleInvestmentsCount = 0;
        project.investmentCancelationPercentageFee = ipContract
            .getInvestmentWithdrawPercentageFee()
            .toBigDecimal();
        project.fundsUsedByCreator = BigInt.fromI32(0);
        project.save();
    }

    return project;
}

export function getOrInitGovernancePool(governancePoolAddress: Address): GovernancePool {
    const governancePoolId = governancePoolAddress.toHex();
    let governancePool = GovernancePool.load(governancePoolId);

    if (!governancePool) {
        const context = dataSource.context();
        const gpContract: GovernancePoolContract =
            GovernancePoolContract.bind(governancePoolAddress);

        const votingToken = getOrInitVotingToken(context.getString("votingTokenId"));
        // Create new governancePool entity
        governancePool = new GovernancePool(governancePoolId);
        governancePool.project = context.getString("investmentPoolAddress");
        governancePool.votingToken = votingToken.id;
        governancePool.totalVotesAgainst = BigInt.fromI32(0);
        governancePool.totalPercentageAgainst = BigDecimal.fromString("0");
        governancePool.votesPercentageThreshold = BigDecimal.fromString(
            gpContract.getVotesPercentageThreshold().toString()
        );
        governancePool.votesWithdrawalPercentageFee = gpContract
            .getVotesWithdrawPercentageFee()
            .toBigDecimal();
        governancePool.save();
    }

    return governancePool;
}

export function getOrInitDistributionPool(distributionPoolAddress: Address): DistributionPool {
    const distributionPoolId = distributionPoolAddress.toHex();
    let distributionPool = DistributionPool.load(distributionPoolId);
    if (!distributionPool) {
        const context = dataSource.context();
        const dpContract: DistributionPoolContract =
            DistributionPoolContract.bind(distributionPoolAddress);

        const projectToken = getOrInitProjectToken(dpContract.getToken());

        // Create new distributionPool entity
        distributionPool = new DistributionPool(distributionPoolId);
        distributionPool.project = context.getString("investmentPoolAddress");
        distributionPool.projectToken = projectToken.id;
        distributionPool.lockedTokensForRewards = dpContract.getLockedTokens();
        distributionPool.totalAllocatedTokens = BigInt.fromI32(0);
        distributionPool.didCreatorLockTokens = false;
        distributionPool.save();
    }

    return distributionPool;
}
export function getOrInitMilestone(projectAddress: Address, milestoneId: BigInt): Milestone {
    const projectId = projectAddress.toHex();
    const milestoneFullId: string = `${projectId}-${milestoneId.toString()}`;
    let milestone = Milestone.load(milestoneFullId);

    if (!milestone) {
        const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
            Address.fromString(projectId)
        );
        const milestoneData = ipContract.getMilestone(milestoneId);

        // Create new milestone entity
        milestone = new Milestone(milestoneFullId);
        milestone.project = projectId;
        // number type cannot be assigned to i32 type so we need to convert it
        milestone.milestoneId = milestoneId.toI32();
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
        const zerosList = new Array<BigInt>(project.milestonesCount).fill(BigInt.fromI32(0));
        // If investor hasn't invested in this project before, create a new project investment entity
        projectInvestment = new ProjectInvestment(projectInvestmentId);
        projectInvestment.investor = investor.id;
        projectInvestment.project = projectAddress.toHex();
        projectInvestment.investedAmount = BigInt.fromI32(0);
        projectInvestment.allocatedProjectTokens = BigInt.fromI32(0);
        projectInvestment.votesAgainst = BigInt.fromI32(0);
        projectInvestment.claimedProjectTokens = BigInt.fromI32(0);
        projectInvestment.unusedActiveVotes = new Array<BigInt>(project.milestonesCount).fill(
            BigInt.fromI32(0)
        );
        projectInvestment.singleInvestmentsCount = 0;
        projectInvestment.isRefunded = false;
        projectInvestment.investmentFlowrates = zerosList;
        projectInvestment.investmentUsed = zerosList;
        projectInvestment.projectTokenFlowrates = zerosList;
        projectInvestment.projectTokensDistributed = zerosList;
        projectInvestment.save();

        // Update the number of investors
        project.investorsCount += 1;
        project.save();
    }

    return projectInvestment;
}

export function getOrInitSingleInvestment(
    projectAddress: Address,
    investorAddress: Address,
    investmentId: BigInt
): SingleInvestment {
    const projectInvestment = getOrInitProjectInvestment(projectAddress, investorAddress);
    const singleInvestmentId = `${projectAddress.toHex()}-${investorAddress.toHex()}-${investmentId.toString()}`;
    let singleInvestment = SingleInvestment.load(singleInvestmentId);

    if (!singleInvestment) {
        const ipContract = InvestmentPoolContract.bind(projectAddress);
        const milestone = getOrInitMilestone(projectAddress, ipContract.getCurrentMilestoneId());

        singleInvestment = new SingleInvestment(singleInvestmentId);
        singleInvestment.investor = investorAddress.toHex();
        singleInvestment.investmentId = investmentId.toI32();
        singleInvestment.projectInvestment = projectInvestment.id;
        singleInvestment.milestone = milestone.id;
        singleInvestment.transactionHash = Bytes.fromI32(0);
        singleInvestment.investedAmount = BigInt.fromI32(0);

        // Update the number of single investments
        projectInvestment.singleInvestmentsCount += 1;
        projectInvestment.save();
    }

    return singleInvestment;
}

export function getOrInitAcceptedSuperToken(acceptedTokenAddress: Address): AcceptedSuperToken {
    // Get accepted super token entity
    const acceptedTokenId = acceptedTokenAddress.toHex();
    let acceptedToken = AcceptedSuperToken.load(acceptedTokenId);

    if (!acceptedToken) {
        const acceptedTokenContract = ERC20Contract.bind(acceptedTokenAddress);

        /** @notice Multiple projects can accept the same super token*/
        acceptedToken = new AcceptedSuperToken(acceptedTokenId);
        acceptedToken.name = acceptedTokenContract.name();
        acceptedToken.symbol = acceptedTokenContract.symbol();
        acceptedToken.decimals = acceptedTokenContract.decimals();
        acceptedToken.save();
    }

    return acceptedToken;
}

export function getOrInitProjectToken(projectTokenAddress: Address): ProjectToken {
    const projectTokenId: string = projectTokenAddress.toHex();
    let projectToken = ProjectToken.load(projectTokenId);

    if (!projectToken) {
        const projectTokenContract = ERC20Contract.bind(projectTokenAddress);

        /** @notice Multiple projects can use the same project token for rewards */
        projectToken = new ProjectToken(projectTokenId);
        projectToken.name = projectTokenContract.name();
        projectToken.symbol = projectTokenContract.symbol();
        projectToken.decimals = projectTokenContract.decimals();
        projectToken.save();
    }
    return projectToken;
}

export function getOrInitVotingToken(votingTokenId: string): VotingToken {
    let votingToken = VotingToken.load(votingTokenId);

    if (!votingToken) {
        const context = dataSource.context();
        const investmentPoolAddress = context.getString("investmentPoolAddress");
        const governancePoolAddress = context.getString("governancePoolAddress");
        const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(
            Address.fromString(investmentPoolAddress)
        );
        const gpContract: GovernancePoolContract = GovernancePoolContract.bind(
            Address.fromString(governancePoolAddress)
        );

        // Create project token entity
        votingToken = new VotingToken(votingTokenId);
        votingToken.governancePool = governancePoolAddress;
        votingToken.address = gpContract.getVotingTokenAddress();
        votingToken.currentSupply = BigInt.fromI32(0);
        votingToken.supplyCap = ipContract.getVotingTokensSupplyCap();
        votingToken.save();
    }

    return votingToken;
}
