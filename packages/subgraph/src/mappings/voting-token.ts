import {BigInt, BigDecimal, Address} from "@graphprotocol/graph-ts";
import {TransferSingle as TransferSingleEvent} from "../../generated/templates/VotingToken/VotingToken";
import {
    getOrInitGovernancePool,
    getOrInitProject,
    getOrInitProjectInvestment,
    getOrInitVotingToken,
} from "../mappingHelpers";

enum SupplyAction {
    Mint,
    Burn,
}

enum TransferAction {
    Send,
    Receive,
}

export function handleTransfer(event: TransferSingleEvent): void {
    const fromAddress = event.params.from;
    const toAddress = event.params.to;
    const tokenId = event.params.id;
    const amount = event.params.value;

    if (fromAddress.toHex() == Address.zero().toHex()) {
        // Mint
        updateCurrentSupply(tokenId, amount, SupplyAction.Mint);
    } else if (fromAddress.toHex() != event.address.toHex()) {
        updateIndividualBalance(tokenId, fromAddress, amount, TransferAction.Send);
    }

    if (toAddress.toHex() == Address.zero().toHex()) {
        // Burn
        updateCurrentSupply(tokenId, amount, SupplyAction.Burn);
    } else if (toAddress.toHex() != event.address.toHex()) {
        updateIndividualBalance(tokenId, toAddress, amount, TransferAction.Receive);
    }
}

function updateIndividualBalance(
    tokenId: BigInt,
    investor: Address,
    amount: BigInt,
    action: TransferAction
): void {
    const ipAddress = Address.fromString(tokenId.toHex());
    const projectInvestment = getOrInitProjectInvestment(ipAddress, investor);

    switch (action) {
        case TransferAction.Send:
            projectInvestment.currentVotesBalance =
                projectInvestment.currentVotesBalance.minus(amount);
            break;

        case TransferAction.Receive:
            projectInvestment.currentVotesBalance =
                projectInvestment.currentVotesBalance.plus(amount);
            break;
    }
    projectInvestment.save();
}

function updateCurrentSupply(tokenId: BigInt, amount: BigInt, action: SupplyAction): void {
    const votingToken = getOrInitVotingToken(tokenId.toString());
    const governancePool = getOrInitGovernancePool(Address.fromString(votingToken.governancePool));

    switch (action) {
        case SupplyAction.Mint:
            votingToken.currentSupply = votingToken.currentSupply.plus(amount);
            break;

        case SupplyAction.Burn:
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
