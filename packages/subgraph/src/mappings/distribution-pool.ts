import {Address, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
    Allocated as AllocatedEvent,
    RemovedAllocation as RemovedAllocationEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {Project, Distribution, ProjectToken, ProjectInvestment} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get distribution pool contract
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

    // Get distribution entity
    const distributionId: string = event.address.toHexString();
    let distribution = Distribution.load(distributionId);
    if (distribution) {
        log.critical("Distribution already exists: {}", [distributionId]);
        return;
    }

    // Create new distribution entity
    distribution = new Distribution(distributionId);
    distribution.project = projectId;
    distribution.projectToken = projectTokenId;
    distribution.lockedTokens = dpContract.getLockedTokens();
    distribution.save();

    // Add distribution to project
    const project = Project.load(projectId);
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }
    project.distributionPool = distributionId;
    project.save();
}

export function handleAllocated(event: AllocatedEvent): void {
    updateAllocationInfo(event.address, event.params.investor);
}

export function handleRemovedAllocation(event: RemovedAllocationEvent): void {
    updateAllocationInfo(event.address, event.params.investor);
}

function updateAllocationInfo(distributionAddress: Address, investorAddress: Address): void {
    const dpContract: DistributionPoolContract =
        DistributionPoolContract.bind(distributionAddress);

    // Get distribution entity
    const distributionId: string = distributionAddress.toHexString();
    let distribution = Distribution.load(distributionId);
    if (!distribution) {
        log.critical("Distribution pool doesn't exist: {}", [distributionId]);
        return;
    }

    // Get project entity
    const projectId = distribution.project;
    const project = Project.load(projectId);
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }

    // Get project investment entity
    const projectInvestmentId = `${projectId}-${investorAddress.toHexString()}`;
    const projectInvestment = ProjectInvestment.load(projectInvestmentId);
    if (!projectInvestment) {
        log.critical("Project investment doesn't exist: {}", [projectInvestmentId]);
        return;
    }

    // Update project investment allocated tokens amount
    projectInvestment.allocatedProjectTokens = dpContract.getAllocatedTokens(investorAddress);
    projectInvestment.save();
}
