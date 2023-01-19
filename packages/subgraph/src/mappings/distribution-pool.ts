import {Address, BigInt} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {Distribution, ProjectToken} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get distribution pool contract
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(event.address);

    // Get distribution entity
    const distributionId: string = event.address.toHexString();
    let distribution = Distribution.load(distributionId);
    if (distribution) return;

    // Create new distribution entity
    distribution = new Distribution(distributionId);

    // Get project token entity
    const projectTokenAddress = dpContract.getToken();
    const projectTokenId: string = projectTokenAddress.toHexString();
    let projectToken = ProjectToken.load(projectTokenId);
    if (projectToken) return;

    // Create project token entity
    const projectTokenContract = ERC20Contract.bind(projectTokenAddress);
    projectToken = new ProjectToken(projectTokenId);
    projectToken.name = projectTokenContract.name();
    projectToken.symbol = projectTokenContract.symbol();
    projectToken.decimals = projectTokenContract.decimals();
    projectToken.save();
}
