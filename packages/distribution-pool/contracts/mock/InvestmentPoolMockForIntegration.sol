// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {IDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";
import {IInitializableInvestmentPool, IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";

contract InvestmentPoolMockForIntegration is IInitializableInvestmentPool {
    IDistributionPool public distributionPool;
    uint48 internal emergencyTerminationTimestamp;
    address internal creator;
    uint256 internal currentMilestone = 0;
    uint256 internal investmentPoolStateValue;
    uint256 internal constant CANCELED_PROJECT_STATE_VALUE = 1;
    uint256 internal constant BEFORE_FUNDRAISER_STATE_VALUE = 2;
    uint256 internal constant FUNDRAISER_ONGOING_STATE_VALUE = 4;
    uint256 internal constant FAILED_FUNDRAISER_STATE_VALUE = 8;
    uint256 internal constant FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE = 16;
    uint256 internal constant MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE = 32;
    uint256 internal constant LAST_MILESTONE_ONGOING_STATE_VALUE = 64;
    uint256 internal constant TERMINATED_BY_VOTING_STATE_VALUE = 128;
    uint256 internal constant TERMINATED_BY_GELATO_STATE_VALUE = 256;
    uint256 internal constant SUCCESSFULLY_ENDED_STATE_VALUE = 512;
    uint256 internal constant UNKNOWN_STATE_VALUE = 1024;
    uint256 internal constant ANY_MILESTONE_ONGOING_STATE_VALUE =
        MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE | LAST_MILESTONE_ONGOING_STATE_VALUE;

    mapping(uint256 => IInvestmentPool.Milestone) internal milestones;

    constructor(
        IDistributionPool _distributionPool,
        address _creator,
        IInvestmentPool.MilestoneInterval[] memory _milestones
    ) {
        distributionPool = _distributionPool;
        creator = _creator;

        MilestoneInterval memory interval;
        for (uint32 i = 0; i < _milestones.length; ++i) {
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

    function initialize(
        ISuperfluid _host,
        address payable _gelatoOps,
        IInvestmentPool.ProjectInfo calldata _projectInfo,
        IInvestmentPool.VotingTokensMultipliers calldata _multipliers,
        uint256 _investmentWithdrawFee,
        MilestoneInterval[] calldata _milestones,
        IGovernancePool _governancePool,
        IDistributionPool _distributionPool
    ) external payable {}

    function allocateTokens(
        uint256 _milestoneId,
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

    function getCreator() external view returns (address) {
        return creator;
    }

    function calculateInvestmentWeight(uint256 _amount) external pure returns (uint256) {
        return _amount * 10;
    }

    function getMaximumWeightDivisor() external pure returns (uint256) {
        return 100000 ether;
    }

    function getCurrentMilestoneId() external view returns (uint256) {
        return currentMilestone;
    }

    function increaseMilestone() external {
        currentMilestone += 1;
    }

    function setMilestoneId(uint256 _id) external {
        currentMilestone = _id;
    }

    function setProjectState(uint256 _state) public {
        investmentPoolStateValue = _state;
    }

    function getProjectStateByteValue() public view returns (uint256 stateNumber) {
        return investmentPoolStateValue;
    }

    function getMilestoneDuration(uint256 _milestoneId) public view returns (uint256) {
        Milestone memory milestone = getMilestone(_milestoneId);
        return milestone.endDate - milestone.startDate;
    }

    function getMilestone(uint256 _milestoneId) public view returns (Milestone memory) {
        return milestones[_milestoneId];
    }

    function isStateAnyMilestoneOngoing() external view returns (bool) {
        if (investmentPoolStateValue & getAnyMilestoneOngoingStateValue() == 0) {
            return false;
        } else {
            return true;
        }
    }

    function getEmergencyTerminationTimestamp() external view returns (uint48) {
        return emergencyTerminationTimestamp;
    }

    function setEmergencyTerminationTimestamp(uint48 _timestamp) external {
        emergencyTerminationTimestamp = _timestamp;
    }

    function getCanceledProjectStateValue() public pure returns (uint256) {
        return CANCELED_PROJECT_STATE_VALUE;
    }

    function getBeforeFundraiserStateValue() public pure returns (uint256) {
        return BEFORE_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserOngoingStateValue() public pure returns (uint256) {
        return FUNDRAISER_ONGOING_STATE_VALUE;
    }

    function getFailedFundraiserStateValue() public pure returns (uint256) {
        return FAILED_FUNDRAISER_STATE_VALUE;
    }

    function getFundraiserEndedNoMilestonesOngoingStateValue() public pure returns (uint256) {
        return FUNDRAISER_ENDED_NO_MILESTONES_ONGOING_STATE_VALUE;
    }

    function getMilestonesOngoingBeforeLastStateValue() public pure returns (uint256) {
        return MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE;
    }

    function getLastMilestoneOngoingStateValue() public pure returns (uint256) {
        return LAST_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getTerminatedByVotingStateValue() public pure returns (uint256) {
        return TERMINATED_BY_VOTING_STATE_VALUE;
    }

    function getTerminatedByGelatoStateValue() public pure returns (uint256) {
        return TERMINATED_BY_GELATO_STATE_VALUE;
    }

    function getSuccessfullyEndedStateValue() public pure returns (uint256) {
        return SUCCESSFULLY_ENDED_STATE_VALUE;
    }

    function getUnknownStateValue() public pure returns (uint256) {
        return UNKNOWN_STATE_VALUE;
    }

    function getAnyMilestoneOngoingStateValue() public pure returns (uint256) {
        return ANY_MILESTONE_ONGOING_STATE_VALUE;
    }

    function getGovernancePool() public view returns (address) {}

    function invest(uint256 _amount, bool _strict) external {}

    function unpledge() external {}

    function refund() external {}

    function cancelBeforeFundraiserStart() external {}

    function cancelDuringMilestones() external {}

    function startFirstFundsStream() external {}

    function milestoneJumpOrFinalProjectTermination() external {}

    function withdrawRemainingEth() external {}

    function isEmergencyTerminated() external view returns (bool) {}

    function isCanceledBeforeFundraiserStart() external view returns (bool) {}

    function isCanceledDuringMilestones() external view returns (bool) {}

    function isSoftCapReached() external view returns (bool) {}

    function didFundraiserPeriodEnd() external view returns (bool) {}

    function isFundraiserNotStarted() external view returns (bool) {}

    function isFundraiserOngoingNow() external view returns (bool) {}

    function isFundraiserEndedButNoMilestoneIsActive() external view returns (bool) {}

    function isMilestoneOngoingNow(uint _id) external view returns (bool) {}

    function isAnyMilestoneOngoing() external view returns (bool) {}

    function isLastMilestoneOngoing() external view returns (bool) {}

    function isFailedFundraiser() external view returns (bool) {}

    function didProjectEnd() external view returns (bool) {}

    function canTerminateMilestoneStreamFinal(uint256 _milestoneId) external view returns (bool) {}

    function canGelatoTerminateMilestoneStreamFinal(
        uint256 _milestoneId
    ) external view returns (bool) {}

    function getMilestoneSeedAmount(uint256 _milestoneId) external view returns (uint256) {}

    function getTotalMilestoneTokenAllocation(uint _milestoneId) external returns (uint256) {}

    function getInvestorTokensAllocation(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256) {}

    function getUsedInvestmentsData(address _investor) external view returns (uint256, uint256) {}

    function getMilestonesWithInvestment(
        address _investor
    ) external view returns (uint256[] memory) {}

    function gelatoChecker() external view returns (bool canExec, bytes memory execPayload) {}

    function startGelatoTask() external payable {}

    function gelatoTerminateMilestoneStreamFinal(uint256 _milestoneId) external {}

    function getCfaId() external pure returns (bytes32) {}

    function getPercentageDivider() external pure returns (uint256) {}

    function getEthAddress() external pure returns (address) {}

    function getAcceptedToken() external view returns (address) {}

    function getGelatoTaskCreated() external view returns (bool) {}

    function getGelatoOps() external view returns (address) {}

    function getGelato() external view returns (address payable) {}

    function getGelatoTask() external view returns (bytes32) {}

    function getSoftCap() external view returns (uint96) {}

    function getHardCap() external view returns (uint96) {}

    function getFundraiserStartTime() external view returns (uint48) {}

    function getFundraiserEndTime() external view returns (uint48) {}

    function getTotalStreamingDuration() external view returns (uint48) {}

    function getTerminationWindow() external view returns (uint48) {}

    function getAutomatedTerminationWindow() external view returns (uint48) {}

    function getTotalInvestedAmount() external view returns (uint256) {}

    function getInvestedAmount(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256) {}

    function getMilestonesCount() external view returns (uint256) {}

    function getInvestmentWithdrawPercentageFee() external view returns (uint256) {}

    function getSoftCapMultiplier() external view returns (uint256) {}

    function getHardCapMultiplier() external view returns (uint256) {}

    function getVotingTokensAmountToMint(uint256 _amount) external view returns (uint256) {}

    function getVotingTokensSupplyCap() external view returns (uint256) {}

    function getMilestonesPortionLeft(uint256 _milestoneId) external view returns (uint256) {}

    function getFundsUsed() external view returns (uint256) {}

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
