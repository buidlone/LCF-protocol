// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "./IGovernancePool.sol";
import {IDistributionPool} from "./IDistributionPool.sol";

interface IInvestmentPool is ISuperApp {
    struct ProjectInfo {
        ISuperToken acceptedToken;
        address creator;
        uint96 softCap;
        uint96 hardCap;
        uint48 fundraiserStartAt;
        uint48 fundraiserEndAt;
        uint48 terminationWindow;
        uint48 automatedTerminationWindow;
    }

    struct VotingTokensMultipliers {
        uint256 softCapMultiplier;
        uint256 hardCapMultiplier;
    }

    struct MilestoneInterval {
        // Starting date of the milestone
        uint48 startDate;
        // End date of the milestone period
        uint48 endDate;
        // Describes the portion of the total funds(all milestones),
        // assigned as a seed portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalSeedPortion;
        // Describes the portion of the total funds(all milestones),
        // assigned as a streaming portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalStreamingPortion;
    }

    struct Milestone {
        uint48 startDate;
        uint48 endDate;
        bool paid;
        bool seedAmountPaid;
        bool streamOngoing;
        uint256 paidAmount;
        // Describes the portion of the total funds(all milestones),
        // assigned as a seed portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalSeedPortion;
        // Describes the portion of the total funds(all milestones),
        // assigned as a streaming portion for this milestone
        // 100% == 10 ** 6
        uint256 intervalStreamingPortion;
        // TODO: More fields here for internal state tracking
    }

    function invest(uint256 _amount, bool _strict) external;

    function unpledge() external;

    function refund() external;

    function cancelBeforeFundraiserStart() external;

    function cancelDuringMilestones() external;

    function startFirstFundsStream() external;

    function advanceToNextMilestone() external;

    function withdrawEther() external;

    function getCurrentMilestoneId() external view returns (uint256);

    function isEmergencyTerminated() external view returns (bool);

    function isCanceledBeforeFundraiserStart() external view returns (bool);

    function isCanceledDuringMilestones() external view returns (bool);

    function isSoftCapReached() external view returns (bool);

    function isTimeAfterFundraiser() external view returns (bool);

    function isTimeBeforeFundraiser() external view returns (bool);

    function isTimeWithinFundraiser() external view returns (bool);

    function isTimeBetweenFundraiserAndMilestones() external view returns (bool);

    function isTimeWithinMilestone(uint _id) external view returns (bool);

    function isTimeWithinAnyMilestone() external view returns (bool);

    function isTimeWithinLastMilestone() external view returns (bool);

    function isFailedFundraiser() external view returns (bool);

    function isProjectCompleted() external view returns (bool);

    function getProjectStateValue() external view returns (uint256 stateNumber);

    function canTerminateMilestoneStream(uint256 _milestoneId) external view returns (bool);

    function canGelatoTerminateMilestoneStream(uint256 _milestoneId) external view returns (bool);

    function getMilestoneSeedAmount(uint256 _milestoneId) external view returns (uint256);

    function getMilestoneTotalAllocation(uint _milestoneId) external returns (uint256);

    function getInvestorTokensAllocation(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256);

    function getFundsUsed() external view returns (uint256);

    function getUsedInvestmentsData(address _investor) external view returns (uint256, uint256);

    function isStateAnyMilestoneOngoing() external view returns (bool);

    function getMilestonesWithInvestment(
        address _investor
    ) external view returns (uint256[] memory);

    function gelatoChecker() external view returns (bool canExec, bytes memory execPayload);

    function startGelatoTask() external payable;

    function gelatoTerminateMilestoneStream(uint256 _milestoneId) external;

    function getCfaId() external pure returns (bytes32);

    function getPercentageDivider() external pure returns (uint256);

    function getCanceledProjectStateValue() external pure returns (uint256);

    function getBeforeFundraiserStateValue() external pure returns (uint256);

    function getFundraiserOngoingStateValue() external pure returns (uint256);

    function getFailedFundraiserStateValue() external pure returns (uint256);

    function getFundraiserEndedNoMilestonesOngoingStateValue() external pure returns (uint256);

    function getMilestonesOngoingBeforeLastStateValue() external pure returns (uint256);

    function getLastMilestoneOngoingStateValue() external pure returns (uint256);

    function getTerminatedByVotingStateValue() external pure returns (uint256);

    function getTerminatedByGelatoStateValue() external pure returns (uint256);

    function getSuccessfullyEndedStateValue() external pure returns (uint256);

    function getUnknownStateValue() external pure returns (uint256);

    function getAnyMilestoneOngoingStateValue() external pure returns (uint256);

    function getEthAddress() external pure returns (address);

    function getAcceptedToken() external view returns (address);

    function getCreator() external view returns (address);

    function getGelatoTaskCreated() external view returns (bool);

    function getGelatoOps() external view returns (address);

    function getGelato() external view returns (address payable);

    function getGelatoTask() external view returns (bytes32);

    function getGovernancePool() external view returns (address);

    function getSoftCap() external view returns (uint96);

    function getHardCap() external view returns (uint96);

    function getFundraiserStartTime() external view returns (uint48);

    function getFundraiserEndTime() external view returns (uint48);

    function getTotalStreamingDuration() external view returns (uint48);

    function getTerminationWindow() external view returns (uint48);

    function getAutomatedTerminationWindow() external view returns (uint48);

    function getEmergencyTerminationTimestamp() external view returns (uint48);

    function getTotalInvestedAmount() external view returns (uint256);

    function getInvestedAmount(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256);

    function getMilestonesCount() external view returns (uint256);

    function getMilestone(uint256 _milestoneId) external view returns (Milestone memory);

    function getInvestmentWithdrawPercentageFee() external view returns (uint256);

    function getSoftCapMultiplier() external view returns (uint256);

    function getHardCapMultiplier() external view returns (uint256);

    function getVotingTokensToMint(uint256 _amount) external view returns (uint256);

    function getInvestmentWeight(uint256 _amount) external view returns (uint256);

    function getVotingTokensSupplyCap() external view returns (uint256);

    function getMaximumWeightDivisor() external view returns (uint256);

    function getMilestonesPortionLeft(uint256 _milestoneId) external view returns (uint256);

    function getMilestoneDuration(uint256 _milestoneId) external view returns (uint256);
}

interface IInitializableInvestmentPool is IInvestmentPool {
    function initialize(
        ISuperfluid _host,
        address payable _gelatoOps,
        IInvestmentPool.ProjectInfo calldata _projectInfo,
        IInvestmentPool.VotingTokensMultipliers calldata _multipliers,
        uint256 _investmentWithdrawFee,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool,
        IDistributionPool _distributionPool
    ) external payable;
}
