import {dataSource} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
    Allocated as AllocatedEvent,
    RemovedAllocation as RemovedAllocationEvent,
    Claimed as ClaimedEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {Project, DistributionPool, ProjectToken, ProjectInvestment} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get distributionPool pool contract
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(event.address);

    // Get context from investment pool
    const context = dataSource.context();
    const projectId = context.getBytes("investmentPoolAddress").toHexString();

    // Get project token entity
    const projectTokenAddress = dpContract.getToken();
    const projectTokenId: string = projectTokenAddress.toHexString();
    let projectToken = ProjectToken.load(projectTokenId);
    if (!projectToken) {
        /**
         * @notice Create project token entity if it doesn't exist
         * @notice Multiple projects can use the same token
         * @notice There might be a case where creator uses the same token for multiple projects
         */
        const projectTokenContract = ERC20Contract.bind(projectTokenAddress);
        projectToken = new ProjectToken(projectTokenId);
        projectToken.name = projectTokenContract.name();
        projectToken.symbol = projectTokenContract.symbol();
        projectToken.decimals = projectTokenContract.decimals();
        projectToken.save();
    }

    // Get distributionPool entity
    const distributionPoolId: string = event.address.toHexString();
    let distributionPool = DistributionPool.load(distributionPoolId);
    if (distributionPool)
        throw new Error("DistributionPool already exists: " + distributionPoolId);

    // Create new distributionPool entity
    distributionPool = new DistributionPool(distributionPoolId);
    distributionPool.project = projectId;
    distributionPool.projectToken = projectTokenId;
    distributionPool.lockedTokensForRewards = dpContract.getLockedTokens();
    distributionPool.save();

    // Add distributionPool to project
    const project = Project.load(projectId);
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    project.distributionPool = distributionPoolId;
    project.save();
}

export function handleAllocated(event: AllocatedEvent): void {
    // Currently allocation is updated in investment pool when investment is performed
}

export function handleRemovedAllocation(event: RemovedAllocationEvent): void {
    // Currently allocation is updated in investment pool when investment is unpledged
}

export function handleClaimed(event: ClaimedEvent): void {
    // Get distributionPool entity
    const distributionPoolId: string = event.address.toHexString();
    let distributionPool = DistributionPool.load(distributionPoolId);
    if (!distributionPool)
        throw new Error("DistributionPool doesn't exists: " + distributionPoolId);

    const projectInvestmentId = `${
        distributionPool.project
    }-${event.params.investor.toHexString()}`;
    let projectInvestment = ProjectInvestment.load(projectInvestmentId);
    if (!projectInvestment)
        throw new Error("Project investment doesn't exists: " + projectInvestmentId);

    projectInvestment.claimedProjectTokens = projectInvestment.claimedProjectTokens.plus(
        event.params.tokensAmount
    );
    projectInvestment.save();
}
