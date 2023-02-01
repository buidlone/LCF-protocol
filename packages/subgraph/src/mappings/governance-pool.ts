import {Address, BigInt, dataSource, log} from "@graphprotocol/graph-ts";
import {
    GovernancePool as GovernancePoolContract,
    Initialized as InitializedEvent,
    VoteAgainstProject as VoteAgainstEvent,
    RetractVotes as RetractVotesEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {Project, Governance, VotingToken, ProjectInvestment} from "../../generated/schema";

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
        log.critical("Governance already exists: {}", [governanceId]);
        return;
    }

    // Get voting token entity
    let votingToken = VotingToken.load(votingTokenId);
    if (votingToken) {
        log.critical("Voting token already exists: {}", [votingTokenId]);
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
    governance.totalVotesAgainst = BigInt.fromI32(0);
    governance.save();

    // Add governance to project
    const project = Project.load(projectId);
    if (!project) {
        log.critical("Project doesn't exist: {}", [projectId]);
        return;
    }
    project.governacePool = governanceId;
    project.save();
}

export function handleVotedAgainst(event: VoteAgainstEvent): void {
    updateVotesInfo(event.address, event.params.investor, event.params.amount, "vote_against");
}

export function handleRetractedVotes(event: RetractVotesEvent): void {
    updateVotesInfo(event.address, event.params.investor, event.params.amount, "retract_votes");
}

function updateVotesInfo(
    governanceAddress: Address,
    investorAddress: Address,
    amount: BigInt,
    action: string
): void {
    // Get governance pool entity
    const governanceId: string = governanceAddress.toHexString();
    let governance = Governance.load(governanceId);
    if (!governance) {
        log.critical("Governance pool doesn't exists: {}", [governanceId]);
        return;
    }

    const projectInvestmentId = `${governance.project}-${investorAddress.toHexString()}`;
    const projectInvestment = ProjectInvestment.load(projectInvestmentId);
    if (!projectInvestment) {
        log.critical("Project investment doesn't exists: {}", [projectInvestmentId]);
        return;
    }

    // Update details
    if (action === "vote_against") {
        governance.totalVotesAgainst = governance.totalVotesAgainst.plus(amount);
        projectInvestment.votesAgainst = projectInvestment.votesAgainst.plus(amount);
    } else {
        governance.totalVotesAgainst = governance.totalVotesAgainst.minus(amount);
        projectInvestment.votesAgainst = projectInvestment.votesAgainst.minus(amount);
    }
    governance.save();
}
