import {DataSourceContext} from "@graphprotocol/graph-ts";
import {
    Created as CreatedEvent,
    InvestmentPoolFactory as InvestmentPoolFactoryContract,
} from "../../generated/InvestmentPoolFactory/InvestmentPoolFactory";
import {InvestmentPool as InvestmentPoolContract} from "../../generated/templates/InvestmentPool/InvestmentPool";
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
    const projectFactory = getOrInitProjectFactory(event.address);

    // Get details from event params
    const investmentPoolAddress = event.params.ipContract;
    const governancePoolAddress = event.params.gpContract;
    const distributionPoolAddress = event.params.dpContract;
    const creator = event.params.creator;

    // Get details from contracts
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(investmentPoolAddress);
    const votesSupplyCap = ipContract.getVotingTokensSupplyCap();
    const gpContract: GovernancePoolContract = GovernancePoolContract.bind(governancePoolAddress);
    const votingTokenAddress = gpContract.getVotingTokenAddress();
    const votingTokenId = gpContract.getInvestmentPoolId().toString();

    // Create data source context
    let context = new DataSourceContext();
    context.setString("investmentPoolFactoryAddress", event.address.toHex());
    context.setString("investmentPoolAddress", investmentPoolAddress.toHex());
    context.setString("governancePoolAddress", governancePoolAddress.toHex());
    context.setString("distributionPoolAddress", distributionPoolAddress.toHex());
    context.setString("creator", creator.toHex());
    context.setString("votingTokenAddress", votingTokenAddress.toHex());
    context.setString("votingTokenId", votingTokenId);
    context.setBigInt("votesSupplyCap", votesSupplyCap);

    // Start indexing project contracts
    InvestmentPool.createWithContext(investmentPoolAddress, context);
    GovernancePool.createWithContext(governancePoolAddress, context);
    DistributionPool.createWithContext(distributionPoolAddress, context);
    VotingToken.create(votingTokenAddress);
}
