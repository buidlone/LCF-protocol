import {Address, BigDecimal, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {
    GovernancePool as GovernancePoolContract,
    Initialized as InitializedEvent,
    VoteAgainstProject as VoteAgainstEvent,
    RetractVotes as RetractVotesEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {Project, GovernancePool, VotingToken, ProjectInvestment} from "../../generated/schema";

enum VotingAction {
    VoteAgainst,
    RetractVotes,
}

export function handleInitialized(event: InitializedEvent): void {
    const gpContract: GovernancePoolContract = GovernancePoolContract.bind(event.address);

    // Get context from investment pool
    const context = dataSource.context();
    const votesSupplyCap = context.getBigInt("votesSupplyCap");
    const projectId = context.getString("investmentPoolAddress");
    const votingTokenId = context.getString("votingTokenId");
    const votingTokenAddress = context.getString("votingTokenAddress");

    // Get governancePool entity
    const governancePoolId: string = event.address.toHexString();
    let governancePool = GovernancePool.load(governancePoolId);
    if (governancePool) throw new Error("GovernancePool already exists: " + governancePoolId);

    // Get voting token entity
    let votingToken = VotingToken.load(votingTokenId);
    if (votingToken) throw new Error("Voting token already exists: " + votingTokenId);

    // Create project token entity
    votingToken = new VotingToken(votingTokenId);
    votingToken.governancePool = governancePoolId;
    votingToken.address = Address.fromString(votingTokenAddress);
    votingToken.currentSupply = BigInt.fromI32(0);
    votingToken.supplyCap = votesSupplyCap;
    votingToken.save();

    // Create new governancePool entity
    governancePool = new GovernancePool(governancePoolId);
    governancePool.project = projectId;
    governancePool.votingToken = votingTokenId;
    governancePool.totalVotesAgainst = BigInt.fromI32(0);
    governancePool.totalPercentageAgainst = BigDecimal.fromString("0");
    governancePool.votesPercentageThreshold = BigDecimal.fromString(
        gpContract.getVotesPercentageThreshold().toString()
    );
    governancePool.withdrawalPercentageFee = BigDecimal.fromString(
        gpContract.getVotesWithdrawPercentageFee().toString()
    );
    governancePool.save();

    // Add governancePool to project
    const project = Project.load(projectId);
    if (!project) throw new Error("Project doesn't exist: " + projectId);

    project.governancePool = governancePoolId;
    project.save();
}

export function handleVotedAgainst(event: VoteAgainstEvent): void {
    updateVotesInfo(
        event.address,
        event.params.investor,
        event.params.amount,
        VotingAction.VoteAgainst
    );
}

export function handleRetractedVotes(event: RetractVotesEvent): void {
    updateVotesInfo(
        event.address,
        event.params.investor,
        event.params.amount,
        VotingAction.RetractVotes
    );
}

function updateVotesInfo(
    governancePoolAddress: Address,
    investorAddress: Address,
    amount: BigInt,
    action: VotingAction
): void {
    // Get governancePool pool entity
    const governancePoolId: string = governancePoolAddress.toHexString();
    let governancePool = GovernancePool.load(governancePoolId);
    if (!governancePool)
        throw new Error("GovernancePool pool doesn't exists: " + governancePoolId);

    // Get voting token entity
    const votingTokenId = governancePool.votingToken;
    let votingToken = VotingToken.load(votingTokenId);
    if (!votingToken) throw new Error("Voting token doesn't exists: " + votingTokenId);

    const projectInvestmentId = `${governancePool.project}-${investorAddress.toHexString()}`;
    const projectInvestment = ProjectInvestment.load(projectInvestmentId);
    if (!projectInvestment)
        throw new Error("Project investment doesn't exists: " + projectInvestmentId);

    // Update details
    switch (action) {
        case VotingAction.VoteAgainst:
            governancePool.totalVotesAgainst = governancePool.totalVotesAgainst.plus(amount);
            projectInvestment.votesAgainst = projectInvestment.votesAgainst.plus(amount);
            break;

        case VotingAction.RetractVotes:
            governancePool.totalVotesAgainst = governancePool.totalVotesAgainst.minus(amount);
            projectInvestment.votesAgainst = projectInvestment.votesAgainst.minus(amount);
            break;
    }

    // Update total percentage against
    // Formula: totalVotesAgainst * 100 / currentSupply
    governancePool.totalPercentageAgainst = BigDecimal.fromString(
        governancePool.totalVotesAgainst.toString()
    )
        .times(BigDecimal.fromString("100"))
        .div(BigDecimal.fromString(votingToken.currentSupply.toString()));
    governancePool.save();
}
