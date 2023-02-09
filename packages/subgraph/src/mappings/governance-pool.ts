import {Address, BigDecimal, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {
    GovernancePool as GovernancePoolContract,
    Initialized as InitializedEvent,
    MintVotingTokens as MintedVotingTokensEvent,
    VoteAgainstProject as VoteAgainstEvent,
    RetractVotes as RetractVotesEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {Project, GovernancePool, VotingToken, ProjectInvestment} from "../../generated/schema";
import {
    getOrInitSingleInvestment,
    getOrInitGovernancePool,
    getOrInitProjectInvestment,
    getOrInitProject,
    getOrInitVotingToken,
} from "../mappingHelpers";

enum VotingAction {
    VoteAgainst,
    RetractVotes,
}

export function handleInitialized(event: InitializedEvent): void {
    // INTIALIZATION
    getOrInitGovernancePool(event.address);

    const context = dataSource.context();
    const votingTokenId = context.getString("votingTokenId");
    getOrInitVotingToken(votingTokenId);
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
    const governancePool = getOrInitGovernancePool(governancePoolAddress);
    const votingToken = getOrInitVotingToken(governancePool.votingToken);
    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(governancePool.project),
        investorAddress
    );

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
    governancePool.totalPercentageAgainst = governancePool.totalVotesAgainst
        .toBigDecimal()
        .times(BigDecimal.fromString("100"))
        .div(votingToken.currentSupply.toBigDecimal());
    governancePool.save();

    projectInvestment.save();
}
