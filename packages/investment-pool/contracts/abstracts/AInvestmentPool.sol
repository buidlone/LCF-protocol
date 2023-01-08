// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "../interfaces/IGovernancePool.sol";
import {IDistributionPool} from "../interfaces/IDistributionPool.sol";

import {IInvestmentPool, IInitializableInvestmentPool} from "../interfaces/IInvestmentPool.sol";

abstract contract AbstractInvestmentPool is IInitializableInvestmentPool {
    // Divider used for percentage calculations.
    uint48 internal constant PERCENTAGE_DIVIDER = 10 ** 6;

    /**
     * @dev Values are used for bitwise operations to determine current project state.
     * @dev Investment pool can't have multiple states at the same time.
     */
    uint24 internal constant CANCELED_PROJECT_STATE_VALUE = 1;
    uint24 internal constant BEFORE_FUNDRAISER_STATE_VALUE = 2;
    uint24 internal constant FUNDRAISER_ONGOING_STATE_VALUE = 4;
    uint24 internal constant FAILED_FUNDRAISER_STATE_VALUE = 8;
    uint24 internal constant FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE = 16;
    uint24 internal constant MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE = 32;
    uint24 internal constant LAST_MILESTONE_ONGOING_STATE_VALUE = 64;
    uint24 internal constant TERMINATED_BY_VOTING_STATE_VALUE = 128;
    uint24 internal constant TERMINATED_BY_GELATO_STATE_VALUE = 256;
    uint24 internal constant SUCCESSFULLY_ENDED_STATE_VALUE = 512;
    uint24 internal constant UNKNOWN_STATE_VALUE = 1024;
    uint24 internal constant ANY_MILESTONE_ONGOING_STATE_VALUE =
        MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE | LAST_MILESTONE_ONGOING_STATE_VALUE;

    function getPercentageDivider() public pure returns (uint48) {
        return PERCENTAGE_DIVIDER;
    }

    function getCanceledProjectStateValue() public pure returns (uint24) {
        return CANCELED_PROJECT_STATE_VALUE;
    }

    function getBeforeFundraiserStateValue() public pure returns (uint24) {
        return BEFORE_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserOngoingStateValue() public pure returns (uint24) {
        return FUNDRAISER_ONGOING_STATE_VALUE;
    }

    function getFailedFundraiserStateValue() public pure returns (uint24) {
        return FAILED_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserEndedNoMilestonesOngoingStateValue() public pure returns (uint24) {
        return FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE;
    }

    function getMilestonesOngoingBeforeLastStateValue() public pure returns (uint24) {
        return MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE;
    }

    function getLastMilestoneOngoingStateValue() public pure returns (uint24) {
        return LAST_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getTerminatedByVotingStateValue() public pure returns (uint24) {
        return TERMINATED_BY_VOTING_STATE_VALUE;
    }

    function getTerminatedByGelatoStateValue() public pure returns (uint24) {
        return TERMINATED_BY_GELATO_STATE_VALUE;
    }

    function getSuccessfullyEndedStateValue() public pure returns (uint24) {
        return SUCCESSFULLY_ENDED_STATE_VALUE;
    }

    function getUnknownStateValue() public pure returns (uint24) {
        return UNKNOWN_STATE_VALUE;
    }

    function getAnyMilestoneOngoingStateValue() public pure returns (uint24) {
        return ANY_MILESTONE_ONGOING_STATE_VALUE;
    }
}

abstract contract AbstractEmptyInvestmentPool is IInitializableInvestmentPool {
    function initialize(
        ISuperfluid _host,
        address payable _gelatoOps,
        IInvestmentPool.ProjectInfo calldata _projectInfo,
        IInvestmentPool.VotingTokensMultipliers calldata _multipliers,
        uint32 _investmentWithdrawFee,
        IInvestmentPool.MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool,
        IDistributionPool _distributionPool
    ) external payable virtual {}

    function invest(uint256 _amount, bool _strict) external virtual {}

    function unpledge() external virtual {}

    function refund() external virtual {}

    function cancelBeforeFundraiserStart() external virtual {}

    function cancelDuringMilestones() external virtual {}

    function startFirstFundsStream() external virtual {}

    function advanceToNextMilestone() external virtual {}

    function withdrawEther() external virtual {}

    function getCurrentMilestoneId() external view virtual returns (uint16) {}

    function isEmergencyTerminated() external view virtual returns (bool) {}

    function isCanceledBeforeFundraiserStart() external view virtual returns (bool) {}

    function isCanceledDuringMilestones() external view virtual returns (bool) {}

    function isSoftCapReached() external view virtual returns (bool) {}

    function isTimeAfterFundraiser() external view virtual returns (bool) {}

    function isTimeBeforeFundraiser() external view virtual returns (bool) {}

    function isTimeWithinFundraiser() external view virtual returns (bool) {}

    function isTimeBetweenFundraiserAndMilestones() external view virtual returns (bool) {}

    function isTimeWithinMilestone(uint16 _id) external view virtual returns (bool) {}

    function isTimeWithinAnyMilestone() external view virtual returns (bool) {}

    function isTimeWithinLastMilestone() external view virtual returns (bool) {}

    function isFailedFundraiser() external view virtual returns (bool) {}

    function isProjectCompleted() external view virtual returns (bool) {}

    function getProjectStateValue() external view virtual returns (uint24 stateNumber) {}

    function canTerminateMilestoneStream(
        uint16 _milestoneId
    ) external view virtual returns (bool) {}

    function canGelatoTerminateMilestoneStream(
        uint16 _milestoneId
    ) external view virtual returns (bool) {}

    function getMilestoneSeedAmount(uint16 _milestoneId) external view virtual returns (uint256) {}

    function getMilestoneTotalAllocation(uint16 _milestoneId) external virtual returns (uint256) {}

    function getInvestorTokensAllocation(
        address _investor,
        uint16 _milestoneId
    ) external view virtual returns (uint256) {}

    function getFundsUsed() external view virtual returns (uint256) {}

    function getUsedInvestmentsData(
        address _investor
    ) external view virtual returns (uint256, uint256) {}

    function isStateAnyMilestoneOngoing() external view virtual returns (bool) {}

    function getMilestonesWithInvestment(
        address _investor
    ) external view virtual returns (uint16[] memory) {}

    function gelatoChecker()
        external
        view
        virtual
        returns (bool canExec, bytes memory execPayload)
    {}

    function startGelatoTask() external payable virtual {}

    function gelatoTerminateMilestoneStream(uint16 _milestoneId) external virtual {}

    function getCfaId() external pure virtual returns (bytes32) {}

    function getEthAddress() external pure virtual returns (address) {}

    function getAcceptedToken() external view virtual returns (address) {}

    function getCreator() external view virtual returns (address) {}

    function getGelatoTaskCreated() external view virtual returns (bool) {}

    function getGelatoOps() external view virtual returns (address) {}

    function getGelato() external view virtual returns (address payable) {}

    function getGelatoTask() external view virtual returns (bytes32) {}

    function getGovernancePool() external view virtual returns (address) {}

    function getSoftCap() external view virtual returns (uint96) {}

    function getHardCap() external view virtual returns (uint96) {}

    function getFundraiserStartTime() external view virtual returns (uint48) {}

    function getFundraiserEndTime() external view virtual returns (uint48) {}

    function getTotalStreamingDuration() external view virtual returns (uint48) {}

    function getTerminationWindow() external view virtual returns (uint48) {}

    function getAutomatedTerminationWindow() external view virtual returns (uint48) {}

    function getEmergencyTerminationTimestamp() external view virtual returns (uint48) {}

    function getTotalInvestedAmount() external view virtual returns (uint256) {}

    function getInvestedAmount(
        address _investor,
        uint16 _milestoneId
    ) external view virtual returns (uint256) {}

    function getMilestonesCount() external view virtual returns (uint16) {}

    function getMilestone(
        uint16 _milestoneId
    ) external view virtual returns (IInvestmentPool.Milestone memory) {}

    function getInvestmentWithdrawPercentageFee() external view virtual returns (uint32) {}

    function getSoftCapMultiplier() external view virtual returns (uint16) {}

    function getHardCapMultiplier() external view virtual returns (uint16) {}

    function getVotingTokensToMint(uint256 _amount) external view virtual returns (uint256) {}

    function getInvestmentWeight(uint256 _amount) external view virtual returns (uint256) {}

    function getVotingTokensSupplyCap() external view virtual returns (uint256) {}

    function getMaximumWeightDivisor() external view virtual returns (uint256) {}

    function getMilestonesPortionLeft(
        uint16 _milestoneId
    ) external view virtual returns (uint48) {}

    function getMilestoneDuration(uint16 _milestoneId) external view virtual returns (uint256) {}

    function beforeAgreementCreated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata ctx
    ) external view returns (bytes memory cbdata) {}

    function afterAgreementCreated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata cbdata,
        bytes calldata ctx
    ) external returns (bytes memory newCtx) {}

    function beforeAgreementTerminated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata ctx
    ) external view returns (bytes memory cbdata) {}

    function afterAgreementTerminated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata cbdata,
        bytes calldata ctx
    ) external returns (bytes memory newCtx) {}

    function beforeAgreementUpdated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata ctx
    ) external view returns (bytes memory cbdata) {}

    function afterAgreementUpdated(
        ISuperToken superToken,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata agreementData,
        bytes calldata cbdata,
        bytes calldata ctx
    ) external returns (bytes memory newCtx) {}
}
