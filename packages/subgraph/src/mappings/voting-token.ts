import {Address, BigInt, DataSourceContext, log} from "@graphprotocol/graph-ts";
import {TransferSingle as TransferSingleEvent} from "../../generated/templates/VotingToken/VotingToken";
import {VotingToken} from "../../generated/schema";

export function handleTransfer(event: TransferSingleEvent): void {
    const fromAddress = event.params.from;
    const toAddress = event.params.to;
    const tokenId = event.params.id;
    const amount = event.params.value;

    if (fromAddress.toHexString() == "0x0000000000000000000000000000000000000000") {
        // Mint
        updateCurrentSupply(tokenId.toString(), amount, "mint");
    }

    if (toAddress.toHexString() == "0x0000000000000000000000000000000000000000") {
        // Burn
        updateCurrentSupply(tokenId.toString(), amount, "burn");
    }
}

function updateCurrentSupply(tokenId: string, amount: BigInt, action: string): void {
    let votingToken = VotingToken.load(tokenId);
    if (!votingToken) {
        log.error("Voting token doesn't exist: {}", [tokenId]);
        return;
    }

    if (action === "mint") {
        votingToken.currentSupply = votingToken.currentSupply.plus(amount);
    } else if (action === "burn") {
        votingToken.currentSupply = votingToken.currentSupply.minus(amount);
    }

    votingToken.save();
}
