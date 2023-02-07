import {BigInt, BigDecimal, Address} from "@graphprotocol/graph-ts";
import {TransferSingle as TransferSingleEvent} from "../../generated/templates/VotingToken/VotingToken";
import {GovernancePool, VotingToken} from "../../generated/schema";
import {getOrInitGovernancePool, getOrInitVotingToken} from "../mappingHelpers";

enum TokenAction {
    Mint,
    Burn,
}

export function handleTransfer(event: TransferSingleEvent): void {
    const fromAddress = event.params.from;
    const toAddress = event.params.to;
    const tokenId = event.params.id;
    const amount = event.params.value;

    if (fromAddress.toHex() == Address.zero().toHex()) {
        // Mint
        updateCurrentSupply(tokenId.toString(), amount, TokenAction.Mint);
    }

    if (toAddress.toHex() == Address.zero().toHex()) {
        // Burn
        updateCurrentSupply(tokenId.toString(), amount, TokenAction.Burn);
    }
}

function updateCurrentSupply(tokenId: string, amount: BigInt, action: TokenAction): void {
    const votingToken = getOrInitVotingToken(tokenId);
    const governancePool = getOrInitGovernancePool(Address.fromString(votingToken.governancePool));

    switch (action) {
        case TokenAction.Mint:
            votingToken.currentSupply = votingToken.currentSupply.plus(amount);
            break;

        case TokenAction.Burn:
            votingToken.currentSupply = votingToken.currentSupply.minus(amount);
            break;
    }

    // Update total percentage against
    // Formula: totalVotesAgainst * 100 / currentSupply
    governancePool.totalPercentageAgainst = governancePool.totalVotesAgainst
        .toBigDecimal()
        .times(BigDecimal.fromString("100"))
        .div(votingToken.currentSupply.toBigDecimal());
    governancePool.save();

    votingToken.save();
}
