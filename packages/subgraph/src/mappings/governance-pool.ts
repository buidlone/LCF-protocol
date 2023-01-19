import {Address, BigInt, dataSource} from "@graphprotocol/graph-ts";
import {
    GovernancePool as GovernancePoolContract,
    Initialized as InitializedEvent,
} from "../../generated/templates/GovernancePool/GovernancePool";
import {Governance, VotingToken} from "../../generated/schema";

export function handleInitialized(event: InitializedEvent): void {
    // Get governance pool contract
    const gpContract: GovernancePoolContract = GovernancePoolContract.bind(event.address);

    // Get governance entity
    const governanceId: string = event.address.toHexString();
    let governance = Governance.load(governanceId);
    if (governance) return;

    // Create new governance entity
    governance = new Governance(governanceId);

    // Get context from investment pool
    const context = dataSource.context();
    const supplyCap = context.getBigInt("supplyCap");

    // Get voting token entity
    const votingTokenId: string = gpContract.getInvestmentPoolId().toString();
    let votingToken = VotingToken.load(votingTokenId);
    if (votingToken) return;

    // Create project token entity
    const votingTokenAddress = gpContract.getVotingTokenAddress();
    votingToken = new VotingToken(votingTokenId);
    votingToken.address = votingTokenAddress;
    votingToken.currentSupply = BigInt.fromI32(0);
    votingToken.supplyCap = supplyCap;
    votingToken.save();
}
