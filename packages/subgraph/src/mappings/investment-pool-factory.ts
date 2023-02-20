import {DataSourceContext} from "@graphprotocol/graph-ts";
import {Created as CreatedEvent} from "../../generated/InvestmentPoolFactory/InvestmentPoolFactory";
import {GovernancePool as GovernancePoolContract} from "../../generated/templates/GovernancePool/GovernancePool";
import {
    DistributionPool,
    GovernancePool,
    InvestmentPool,
    VotingToken,
} from "../../generated/templates";
import {ProjectFactory} from "../../generated/schema";
import {getOrInitProjectFactory} from "../mappingHelpers";

export function handleCreated(event: CreatedEvent): void {
    // Get details from event params
    const investmentPoolAddress = event.params.ipContract;
    const governancePoolAddress = event.params.gpContract;
    const distributionPoolAddress = event.params.dpContract;
    const creator = event.params.creator;

    // Get details from contracts
    const gpContract: GovernancePoolContract = GovernancePoolContract.bind(governancePoolAddress);
    const votingTokenAddress = gpContract.getVotingTokenAddress();
    /** @notice investment id is used in ERC1155 voting token as project id */
    const votingTokenId = gpContract.getInvestmentPoolId();

    // Check if project factory was already created.
    // If not, create it and create voting token.
    if (ProjectFactory.load(event.address.toHex()) === null) {
        // INITIALIZATION
        getOrInitProjectFactory(event.address);
        VotingToken.create(votingTokenAddress);
    }

    // Create data source context
    let context = new DataSourceContext();
    context.setString("investmentPoolFactoryAddress", event.address.toHex());
    context.setString("investmentPoolAddress", investmentPoolAddress.toHex());
    context.setString("governancePoolAddress", governancePoolAddress.toHex());
    context.setString("distributionPoolAddress", distributionPoolAddress.toHex());
    context.setString("votingTokenId", votingTokenId.toString());
    context.setString("creator", creator.toHex());

    // Start indexing project contracts
    InvestmentPool.createWithContext(investmentPoolAddress, context);
    GovernancePool.createWithContext(governancePoolAddress, context);
    DistributionPool.createWithContext(distributionPoolAddress, context);
}
