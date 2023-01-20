import {Address, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {
    GovernancePool as GovernancePoolContract,
    Initialized as InitializedEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {Project, Governance, VotingToken} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get context from investment pool
    const context = dataSource.context();
    const votesSupplyCap = context.getBigInt("votesSupplyCap");
    const projectId = context.getBytes("investmentPoolAddress").toHexString();
    const votingTokenId = context.getString("votingTokenId");
    const votingTokenAddress = context.getBytes("votingTokenAddress");

    // Get governance entity
    const governanceId: string = event.address.toHexString();
    let governance = Governance.load(governanceId);
    if (governance) {
        log.error("Governance already exists: {}", [governanceId]);
        return;
    }

    // Get voting token entity
    let votingToken = VotingToken.load(votingTokenId);
    if (votingToken) {
        log.error("Voting token already exists: {}", [votingTokenId]);
        return;
    }

    // Create project token entity
    votingToken = new VotingToken(votingTokenId);
    votingToken.address = votingTokenAddress;
    votingToken.currentSupply = BigInt.fromI32(0);
    votingToken.supplyCap = votesSupplyCap;
    votingToken.save();

    // Create new governance entity
    governance = new Governance(governanceId);
    governance.project = projectId;
    governance.votingToken = votingTokenId;
    governance.save();

    // Add governance to project
    const project = Project.load(projectId);
    if (!project) {
        log.error("Project doesn't exist: {}", [projectId]);
        return;
    }
    project.governacePool = governanceId;
    project.save();
}
