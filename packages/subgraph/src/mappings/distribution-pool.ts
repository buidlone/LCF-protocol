import {Address, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {
    DistributionPool as DistributionPoolContract,
    Initialized as InitializedEvent,
} from "../../generated/templates/DistributionPool/DistributionPool";
import {ERC20 as ERC20Contract} from "../../generated/templates/ERC20/ERC20";
import {Project, Distribution, ProjectToken} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get distribution pool contract
    const dpContract: DistributionPoolContract = DistributionPoolContract.bind(event.address);

    // Get context from investment pool
    const context = dataSource.context();
    const projectId = context.getBytes("investmentPoolAddress").toHexString();

    // Get distribution entity
    const distributionId: string = event.address.toHexString();
    let distribution = Distribution.load(distributionId);
    if (distribution) {
        log.error("Distribution already exists: {}", [distributionId]);
        return;
    }

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

    // Create new distribution entity
    distribution = new Distribution(distributionId);
    distribution.project = projectId;
    distribution.projectToken = projectTokenId;
    distribution.save();

    // Add distribution to project
    const project = Project.load(projectId);
    if (!project) {
        log.error("Project doesn't exist: {}", [projectId]);
        return;
    }
    project.distributionPool = distributionId;
    project.save();
}
