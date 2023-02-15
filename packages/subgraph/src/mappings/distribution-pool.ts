import {BigInt, Address} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
    Allocated as AllocatedEvent,
    RemovedAllocation as RemovedAllocationEvent,
    Claimed as ClaimedEvent,
    LockedTokens as LockedTokensEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {DistributionPool} from "../../generated/schema";
import {
    getOrInitDistributionPool,
    getOrInitProjectToken,
    getOrInitProjectInvestment,
    getOrInitProject,
    getOrInitMilestone,
    getOrInitSingleInvestment,
} from "../mappingHelpers";

enum AllocationAction {
    Allocate,
    RemoveAllocation,
}

export function handleInitialized(event: InitializedEvent): void {
    // INITIALIZATION
    const distributionPool = getOrInitDistributionPool(event.address);
    getOrInitProjectToken(Address.fromString(distributionPool.projectToken));
}

export function handleAllocated(event: AllocatedEvent): void {
    const distributionPool = getOrInitDistributionPool(event.address);
    updateFlowrateInfo(distributionPool, event.params.investor);
    updateAllocationInfo(
        distributionPool,
        event.params.investor,
        event.params.amount,
        AllocationAction.Allocate
    );

    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(distributionPool.project),
        event.params.investor
    );
    const singleInvestment = getOrInitSingleInvestment(
        Address.fromString(distributionPool.project),
        event.params.investor,
        BigInt.fromI32(projectInvestment.singleInvestmentsCount - 1)
    );

    singleInvestment.allocatedProjectTokens = event.params.amount;
    singleInvestment.save();
}

export function handleRemovedAllocation(event: RemovedAllocationEvent): void {
    const distributionPool = getOrInitDistributionPool(event.address);
    updateFlowrateInfo(distributionPool, event.params.investor);
    updateAllocationInfo(
        distributionPool,
        event.params.investor,
        event.params.amount,
        AllocationAction.RemoveAllocation
    );
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
        const tokenAllocation = dpContract.getAllocatedAmount(investorAddress, i);

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

function updateAllocationInfo(
    distributionPool: DistributionPool,
    investorAddress: Address,
    amount: BigInt,
    action: AllocationAction
): void {
    const project = getOrInitProject(Address.fromString(distributionPool.project));
    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(project.id),
        investorAddress
    );

    switch (action) {
        case AllocationAction.Allocate:
            distributionPool.totalAllocatedTokens =
                distributionPool.totalAllocatedTokens.plus(amount);
            projectInvestment.allocatedProjectTokens =
                projectInvestment.allocatedProjectTokens.plus(amount);
            break;

        case AllocationAction.RemoveAllocation:
            distributionPool.totalAllocatedTokens =
                distributionPool.totalAllocatedTokens.minus(amount);
            projectInvestment.allocatedProjectTokens =
                projectInvestment.allocatedProjectTokens.minus(amount);
            break;
    }

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
