import {BigInt, dataSource, Address} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
    Allocated as AllocatedEvent,
    RemovedAllocation as RemovedAllocationEvent,
    Claimed as ClaimedEvent,
    LockedTokens as LockedTokensEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {
    Project,
    DistributionPool,
    ProjectToken,
    ProjectInvestment,
    GovernancePool,
} from "../../generated/schema";
import {
    getOrInitDistributionPool,
    getOrInitProjectToken,
    getOrInitProjectInvestment,
    getOrInitProject,
    getOrInitMilestone,
} from "../mappingHelpers";

export function handleInitialized(event: InitializedEvent): void {
    // INITIALIZATION
    const distributionPool = getOrInitDistributionPool(event.address);
    getOrInitProjectToken(Address.fromString(distributionPool.projectToken));
}

export function handleAllocated(event: AllocatedEvent): void {
    const distributionPool = getOrInitDistributionPool(event.address);
    updateFlowrateInfo(distributionPool, event.params.investor);
    updateAllocationInfo(distributionPool);
}

export function handleRemovedAllocation(event: RemovedAllocationEvent): void {
    const distributionPool = getOrInitDistributionPool(event.address);
    updateFlowrateInfo(distributionPool, event.params.investor);
    updateAllocationInfo(distributionPool);
}

function updateFlowrateInfo(distributionPool: DistributionPool, investorAddress: Address): void {
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(distributionPool.id)
    );
    const project = getOrInitProject(Address.fromString(distributionPool.project));
    const milestonesCount = project.milestonesCount;
    const tokensAllocations = new Array<BigInt>(0);
    const flowrates = new Array<BigInt>(0);

    let lastTokenAllocation = BigInt.fromI32(0);
    for (let i = 0; i < milestonesCount; i++) {
        const milestone = getOrInitMilestone(Address.fromString(project.id), BigInt.fromI32(i));
        const tokenAllocation = dpContract.getAllocatedAmount(investorAddress, BigInt.fromI32(i));

        lastTokenAllocation = lastTokenAllocation.plus(tokenAllocation);
        tokensAllocations.push(lastTokenAllocation);
        flowrates.push(tokenAllocation.div(milestone.duration));
    }

    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(project.id),
        investorAddress
    );
    projectInvestment.projectTokenFlowrates = flowrates;
    projectInvestment.projectTokensDistributed = tokensAllocations;
    projectInvestment.save();
}

function updateAllocationInfo(distributionPool: DistributionPool): void {
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(
        Address.fromString(distributionPool.id)
    );
    distributionPool.totalAllocatedTokens = dpContract.getTotalAllocatedTokens();
    distributionPool.save();
}

export function handleClaimed(event: ClaimedEvent): void {
    const distributionPool = getOrInitDistributionPool(event.address);

    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(distributionPool.project),
        event.params.investor
    );
    projectInvestment.claimedProjectTokens = projectInvestment.claimedProjectTokens.plus(
        event.params.tokensAmount
    );
    projectInvestment.save();
}

export function handleLockedTokens(event: LockedTokensEvent): void {
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(event.address);

    const distributionPool = getOrInitDistributionPool(event.address);
    distributionPool.didCreatorLockTokens = dpContract.didCreatorLockTokens();
    distributionPool.save();
}
