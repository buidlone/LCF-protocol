import {BigInt} from "@graphprotocol/graph-ts";
import {TransferSingle as TransferSingleEvent} from "../../generated/templates/VotingToken/VotingToken";
import {VotingToken} from "../../generated/schema";

enum TokenAction {
    Mint,
    Burn,
}

export function handleTransfer(event: TransferSingleEvent): void {
    const fromAddress = event.params.from;
    const toAddress = event.params.to;
    const tokenId = event.params.id;
    const amount = event.params.value;

    if (fromAddress.toHexString() == "0x0000000000000000000000000000000000000000") {
        // Mint
        updateCurrentSupply(tokenId.toString(), amount, TokenAction.Mint);
    }

    if (toAddress.toHexString() == "0x0000000000000000000000000000000000000000") {
        // Burn
        updateCurrentSupply(tokenId.toString(), amount, TokenAction.Burn);
    }
}

function updateCurrentSupply(tokenId: string, amount: BigInt, action: TokenAction): void {
    let votingToken = VotingToken.load(tokenId);
    if (!votingToken) throw new Error("Voting token doesn't exist: " + tokenId);

    switch (action) {
        case TokenAction.Mint:
            votingToken.currentSupply = votingToken.currentSupply.plus(amount);
            break;

        case TokenAction.Burn:
            votingToken.currentSupply = votingToken.currentSupply.minus(amount);
            break;
    }

    votingToken.save();
}
