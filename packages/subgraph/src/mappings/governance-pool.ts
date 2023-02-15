import {Address, BigDecimal, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {
    Initialized as InitializedEvent,
    VoteAgainstProject as VoteAgainstEvent,
    RetractVotes as RetractVotesEvent,
    MintVotingTokens as MintedVotingTokensEvent,
    BurnVotes as BurnedVotesEvent,
    TransferVotes as TransferedVotesEvent,
    LockVotingTokens as LockedVotingTokensEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {InvestmentPool as InvestmentPoolContract} from "../../generated/templates/InvestmentPool/InvestmentPool";
import {
    getOrInitGovernancePool,
    getOrInitProject,
    getOrInitProjectInvestment,
    getOrInitSingleInvestment,
    getOrInitVotingToken,
} from "../mappingHelpers";

enum VotingAction {
    VoteAgainst,
    RetractVotes,
}

enum TokenAction {
    Receive,
    Send,
}

export function handleInitialized(event: InitializedEvent): void {
    // INTIALIZATION
    getOrInitGovernancePool(event.address);

    const context = dataSource.context();
    const votingTokenId = context.getString("votingTokenId");
    getOrInitVotingToken(votingTokenId);
}

export function handleVotedAgainst(event: VoteAgainstEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.investor,
        milestoneId,
        event.params.amount,
        TokenAction.Send
    );

    updateVotesInfo(
        event.address,
        event.params.investor,
        event.params.amount,
        VotingAction.VoteAgainst
    );
}

export function handleRetractedVotes(event: RetractVotesEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.investor,
        milestoneId,
        event.params.amount,
        TokenAction.Receive
    );

    updateVotesInfo(
        event.address,
        event.params.investor,
        event.params.amount,
        VotingAction.RetractVotes
    );
}

export function handleMintedVotingTokens(event: MintedVotingTokensEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.investor,
        milestoneId,
        event.params.amount,
        TokenAction.Receive
    );

    const governancePool = getOrInitGovernancePool(event.address);
    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(governancePool.project),
        event.params.investor
    );
    const singleInvestment = getOrInitSingleInvestment(
        Address.fromString(governancePool.project),
        event.params.investor,
        BigInt.fromI32(projectInvestment.singleInvestmentsCount)
    );

    singleInvestment.votingTokensMinted = event.params.amount;
    singleInvestment.save();
}

export function handleBurnedVotes(event: BurnedVotesEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.investor,
        milestoneId,
        event.params.amount,
        TokenAction.Send
    );
}

export function handleTransferedVotes(event: TransferedVotesEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.sender,
        milestoneId,
        event.params.amount,
        TokenAction.Send
    );
    updateIndividualBalance(
        event.address,
        event.params.recipient,
        milestoneId,
        event.params.amount,
        TokenAction.Receive
    );
}

export function handleLockedVotingTokens(event: LockedVotingTokensEvent): void {
    const milestoneId = event.params.milestoneId;

    updateIndividualBalance(
        event.address,
        event.params.investor,
        milestoneId,
        event.params.amount,
        TokenAction.Send
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

function updateIndividualBalance(
    governancePoolAddress: Address,
    investorAddress: Address,
    milestoneId: number,
    amount: BigInt,
    action: TokenAction
): void {
    const governancePool = getOrInitGovernancePool(governancePoolAddress);
    const projectInvestment = getOrInitProjectInvestment(
        Address.fromString(governancePool.project),
        investorAddress
    );

    const milestonesCount = projectInvestment.unusedActiveVotes.length;
    let newList = new Array<BigInt>(milestonesCount);
    for (let i = 0; i < milestonesCount; i++) {
        if (i >= milestoneId) {
            switch (action) {
                case TokenAction.Receive:
                    newList[i] = projectInvestment.unusedActiveVotes[i].plus(amount);
                    break;

                case TokenAction.Send:
                    newList[i] = projectInvestment.unusedActiveVotes[i].minus(amount);
                    break;
            }
        } else {
            newList[i] = projectInvestment.unusedActiveVotes[i];
        }
    }

    projectInvestment.unusedActiveVotes = newList;
    projectInvestment.save();
}
