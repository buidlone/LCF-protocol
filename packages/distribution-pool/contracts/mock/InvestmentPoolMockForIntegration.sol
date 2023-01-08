// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {IDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";
import {IInitializableInvestmentPool, IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {AbstractInvestmentPool, AbstractEmptyInvestmentPool} from "@buidlone/investment-pool/contracts/abstracts/AInvestmentPool.sol";

contract InvestmentPoolMockForIntegration is AbstractInvestmentPool, AbstractEmptyInvestmentPool {
    IDistributionPool public distributionPool;
    uint48 internal emergencyTerminationTimestamp;
    address internal creator;
    uint16 internal currentMilestone = 0;
    uint24 internal investmentPoolStateValue;

    mapping(uint16 => IInvestmentPool.Milestone) internal milestones;

    constructor(
        IDistributionPool _distributionPool,
        address _creator,
        IInvestmentPool.MilestoneInterval[] memory _milestones
    ) {
        distributionPool = _distributionPool;
        creator = _creator;

        MilestoneInterval memory interval;
        for (uint16 i = 0; i < _milestones.length; ++i) {
            interval = _milestones[i];
            milestones[i] = Milestone({
                startDate: interval.startDate,
                endDate: interval.endDate,
                paid: false,
                seedAmountPaid: false,
                streamOngoing: false,
                paidAmount: 0,
                intervalSeedPortion: interval.intervalSeedPortion,
                intervalStreamingPortion: interval.intervalStreamingPortion
            });
        }
    }

    function allocateTokens(
        uint16 _milestoneId,
        address _investor,
        uint256 _investmentWeight,
        uint256 _weightDivisor,
        uint256 _allocationCoefficient
    ) external {
        distributionPool.allocateTokens(
            _milestoneId,
            _investor,
            _investmentWeight,
            _weightDivisor,
            _allocationCoefficient
        );
    }

    function getCreator()
        external
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (address)
    {
        return creator;
    }

    function getInvestmentWeight(
        uint256 _amount
    ) external pure override(IInvestmentPool, AbstractEmptyInvestmentPool) returns (uint256) {
        return _amount * 10;
    }

    function getMaximumWeightDivisor()
        external
        pure
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (uint256)
    {
        return 100000 ether;
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

    function getMilestoneDuration(
        uint16 _milestoneId
    ) public view override(IInvestmentPool, AbstractEmptyInvestmentPool) returns (uint256) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return milestone.endDate - milestone.startDate;
    }

    function getMilestone(
        uint16 _milestoneId
    )
        public
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (Milestone memory)
    {
        return milestones[_milestoneId];
    }

    function isStateAnyMilestoneOngoing()
        external
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (bool)
    {
        if (investmentPoolStateValue & getAnyMilestoneOngoingStateValue() == 0) {
            return false;
        } else {
            return true;
        }
    }

    function getEmergencyTerminationTimestamp()
        external
        view
        override(IInvestmentPool, AbstractEmptyInvestmentPool)
        returns (uint48)
    {
        return emergencyTerminationTimestamp;
    }

    function setEmergencyTerminationTimestamp(uint48 _timestamp) external {
        emergencyTerminationTimestamp = _timestamp;
    }
}
