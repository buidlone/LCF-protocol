// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {IDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";
import {IInitializableInvestmentPool, IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {AbstractInvestmentPool, AbstractEmptyInvestmentPool} from "@buidlone/investment-pool/contracts/abstracts/AInvestmentPool.sol";

contract InvestmentPoolMockForIntegration is AbstractInvestmentPool, AbstractEmptyInvestmentPool {
    IGovernancePool public governancePool;
    uint16 internal currentMilestone = 0;
    uint24 internal investmentPoolStateValue;

    constructor(IGovernancePool _governancePool) {
        governancePool = _governancePool;
    }

    function mintVotingTokens(uint16 _milestoneId, address _investor, uint256 _amount) public {
        governancePool.mintVotingTokens(_milestoneId, _investor, _amount);
    }

    function burnVotes(uint16 _milestoneId, address _investor) public {
        governancePool.burnVotes(_milestoneId, _investor);
    }

    function getCurrentMilestoneId()
        external
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (uint16)
    {
        return currentMilestone;
    }

    function increaseMilestone() external {
        currentMilestone += 1;
    }

    function setMilestoneId(uint16 _id) external {
        currentMilestone = _id;
    }

    function setProjectState(uint24 _state) public {
        investmentPoolStateValue = _state;
    }

    function getProjectStateValue()
        public
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (uint24 stateNumber)
    {
        return investmentPoolStateValue;
    }

    function getGovernancePool()
        public
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (address)
    {
        return address(governancePool);
    }

    function isStateAnyMilestoneOngoing()
        external
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (bool)
    {
        if (investmentPoolStateValue & ANY_MILESTONE_ONGOING_STATE_VALUE == 0) {
            return false;
        } else {
            return true;
        }
    }
}
