// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IGovernancePool} from "@buidlone/investment-pool/contracts/interfaces/IGovernancePool.sol";
import {IDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";
import {IInitializableInvestmentPool, IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";

contract InvestmentPoolMockForIntegration is IInitializableInvestmentPool {
    IGovernancePool public governancePool;
    uint256 internal currentMilestone = 0;
    uint256 internal investmentPoolStateValue;
    uint256 internal constant MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE = 32;
    uint256 internal constant LAST_MILESTONE_ONGOING_STATE_VALUE = 64;
    uint256 internal constant ANY_MILESTONE_ONGOING_STATE_VALUE =
        MILESTONES_ONGOING_BEFORE_LAST_STATE_VALUE | LAST_MILESTONE_ONGOING_STATE_VALUE;

    constructor(IGovernancePool _governancePool) {
        governancePool = _governancePool;
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

    function mintVotingTokens(uint256 _milestoneId, address _investor, uint256 _amount) public {
        governancePool.mintVotingTokens(_milestoneId, _investor, _amount);
    }

    function burnVotes(uint256 _milestoneId, address _investor) public {
        governancePool.burnVotes(_milestoneId, _investor);
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

    function getGovernancePool() public view returns (address) {
        return address(governancePool);
    }

    function isStateAnyMilestoneOngoing() external view returns (bool) {
        if (investmentPoolStateValue & ANY_MILESTONE_ONGOING_STATE_VALUE == 0) {
            return false;
        } else {
            return true;
        }
    }

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

    function getCanceledProjectStateValue() external pure returns (uint256) {}

    function getBeforeFundraiserStateValue() external pure returns (uint256) {}

    function getFundraiserOngoingStateValue() external pure returns (uint256) {}

    function getFailedFundraiserStateValue() external pure returns (uint256) {}

    function getFundraiserEndedNoMilestonesOngoingStateValue() external pure returns (uint256) {}

    function getMilestonesOngoingBeforeLastStateValue() external pure returns (uint256) {}

    function getLastMilestoneOngoingStateValue() external pure returns (uint256) {}

    function getTerminatedByVotingStateValue() external pure returns (uint256) {}

    function getTerminatedByGelatoStateValue() external pure returns (uint256) {}

    function getSuccessfullyEndedStateValue() external pure returns (uint256) {}

    function getUnknownStateValue() external pure returns (uint256) {}

    function getAnyMilestoneOngoingStateValue() external pure returns (uint256) {}

    function getEthAddress() external pure returns (address) {}

    function getAcceptedToken() external view returns (address) {}

    function getCreator() external view returns (address) {}

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

    function getEmergencyTerminationTimestamp() external view returns (uint48) {}

    function getTotalInvestedAmount() external view returns (uint256) {}

    function getInvestedAmount(
        address _investor,
        uint256 _milestoneId
    ) external view returns (uint256) {}

    function getMilestonesCount() external view returns (uint256) {}

    function getMilestone(uint256 _milestoneId) external view returns (Milestone memory) {}

    function getInvestmentWithdrawPercentageFee() external view returns (uint256) {}

    function getSoftCapMultiplier() external view returns (uint256) {}

    function getHardCapMultiplier() external view returns (uint256) {}

    function getVotingTokensAmountToMint(uint256 _amount) external view returns (uint256) {}

    function calculateInvestmentWeight(uint256 _amount) external view returns (uint256) {}

    function getVotingTokensSupplyCap() external view returns (uint256) {}

    function getMaximumWeightDivisor() external view returns (uint256) {}

    function getMilestonesPortionLeft(uint256 _milestoneId) external view returns (uint256) {}

    function getMilestoneDuration(uint256 _milestoneId) external view returns (uint256) {}

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
