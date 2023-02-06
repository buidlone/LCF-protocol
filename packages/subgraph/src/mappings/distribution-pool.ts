import {BigInt, dataSource, Address} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
    Allocated as AllocatedEvent,
    RemovedAllocation as RemovedAllocationEvent,
    Claimed as ClaimedEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {Project, DistributionPool, ProjectToken, ProjectInvestment} from "../../generated/schema";
import {
    getOrInitDistributionPool,
    getOrInitProjectToken,
    getOrInitProjectInvestment,
} from "../mappingHelpers";

export function handleInitialized(event: InitializedEvent): void {
    // INITIALIZATION
    const distributionPool = getOrInitDistributionPool(event.address);
    getOrInitProjectToken(Address.fromString(distributionPool.projectToken));
}

export function handleAllocated(event: AllocatedEvent): void {
    updateAllocationInfo(event.address);
}

export function handleRemovedAllocation(event: RemovedAllocationEvent): void {
    updateAllocationInfo(event.address);
}

function updateAllocationInfo(distributionPoolAddress: Address): void {
    const dpContract: DistributionPoolContract =
        DistributionPoolContract.bind(distributionPoolAddress);

    const distributionPool = getOrInitDistributionPool(distributionPoolAddress);
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
