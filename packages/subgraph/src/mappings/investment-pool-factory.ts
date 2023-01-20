import {Address, BigInt, DataSourceContext, log} from "@graphprotocol/graph-ts";
import {
    InvestmentPoolFactory as InvestmentPoolFactoryContract,
    Created as CreatedEvent,
} from "../../generated/InvestmentPoolFactory/InvestmentPoolFactory";
import {InvestmentPool as InvestmentPoolContract} from "../../generated/templates/InvestmentPool/InvestmentPool";
import {GovernancePool as GovernancePoolContract} from "../../generated/templates/GovernancePool/GovernancePool";
import {DistributionPool as DistributionPoolContract} from "../../generated/templates/DistributionPool/DistributionPool";
import {
    DistributionPool,
    GovernancePool,
    InvestmentPool,
    VotingToken,
} from "../../generated/templates";
import {ProjectFactory} from "../../generated/schema";

export function handleCreated(event: CreatedEvent): void {
    // Get details from event params
    const investmentPoolAddress = event.params.ipContract;
    const governancePoolAddress = event.params.gpContract;
    const distributionPoolAddress = event.params.dpContract;
    const creator = event.params.creator;

    // Get project factory entity
    const projectFactoryId: string = event.address.toHexString();
    let projectFactory = ProjectFactory.load(projectFactoryId);

    if (!projectFactory) {
        // Create new project factory entity
        projectFactory = new ProjectFactory(projectFactoryId);
        projectFactory.save();
    }

    // Get details from contracts
    const ipContract: InvestmentPoolContract = InvestmentPoolContract.bind(investmentPoolAddress);
    const votesSupplyCap = ipContract.getVotingTokensSupplyCap();
    const gpContract: GovernancePoolContract = GovernancePoolContract.bind(governancePoolAddress);
    const votingTokenAddress = gpContract.getVotingTokenAddress();
    const votingTokenId = gpContract.getInvestmentPoolId().toString();

    // Create data source context
    let context = new DataSourceContext();
    context.setBytes("investmentPoolFactoryAddress", event.address);
    context.setBytes("investmentPoolAddress", investmentPoolAddress);
    context.setBytes("governancePoolAddress", governancePoolAddress);
    context.setBytes("distributionPoolAddress", distributionPoolAddress);
    context.setBytes("creator", creator);
    context.setBytes("votingTokenAddress", votingTokenAddress);
    context.setString("votingTokenId", votingTokenId);
    context.setBigInt("votesSupplyCap", votesSupplyCap);

    // Start indexing project contracts
    InvestmentPool.createWithContext(investmentPoolAddress, context);
    GovernancePool.createWithContext(governancePoolAddress, context);
    DistributionPool.createWithContext(distributionPoolAddress, context);
    VotingToken.create(votingTokenAddress);
}
