// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IInitializableDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";
import {Arrays} from "@buidlone/investment-pool/contracts/utils/Arrays.sol";

error DistributionPool__TokenTransferFailed();
error DistributionPool__ProjectTokensAlreadyLocked();
error DistributionPool__NotInvestmentPool();
error DistributionPool__NotProjectCreator();
error DistributionPool__NoAllocatedTokensLeft();
error DistributionPool__AllTokensAreAllocated();
error DistributionPool__StateIsInvalidForWithdrawal();
error DistributionPool__ProjectTokensNotLocked();
error DistributionPool__InvestmentPoolStateNotAllowed(uint24 state);

contract DistributionPool is IInitializableDistributionPool, Context, Initializable {
    using Arrays for uint16[];

    /** STATE VARIABLES */
    IERC20 internal projectToken;
    IInvestmentPool internal investmentPool;
    uint256 internal lockedTokens;
    uint256 internal totalAllocatedTokens;
    bool internal creatorLockedTokens;

    /**
     * @dev Holds amount of tokens that investor will own after all streams
     * @dev investor => tokens amount
     */
    mapping(address => uint256) internal allocatedTokens;

    /**
     * @dev Holds amount of tokens that investor has already claimed
     * @dev investor => tokens amount
     */
    mapping(address => uint256) internal claimedTokens;

    /**
     * @dev It's a memoization mapping for milestone tokens allocation
     * @dev n-th element describes how many tokens are allocated for the milestone
     * @dev It doesn't hold real allocation value, but a value, which will be used in other formulas.
     * @dev Memoization will never be used on it's own, to get allocated rewards value.
     * @dev investor => milestone id => memoized tokens allocated
     */
    mapping(address => mapping(uint16 => uint256)) internal memMilestoneAllocation;

    /**
     * @dev Mapping holds milestone ids, in which allocation size increased.
     * @dev It will be used with memMilestoneAllocation data to find the right nubmer
     * @dev investor => milestone ids list
     */
    mapping(address => uint16[]) internal milestonesWithAllocation;

    /** EVENTS */

    event LockedTokens();
    event WithdrewTokens();
    event Allocated(address indexed investor, uint16 milestoneId);
    event RemovedAllocation(address indexed investor, uint16 milestoneId);
    event Claimed(address indexed investor, uint256 tokensAmount);

    /** MODIFIERS */

    /// @notice Ensures that provided current project state is one of the provided. It uses bitwise operations in condition
    modifier allowedInvestmentPoolStates(uint24 _states) {
        uint24 currentInvestmentPoolState = investmentPool.getProjectStateValue();
        if (_states & currentInvestmentPoolState == 0)
            revert DistributionPool__InvestmentPoolStateNotAllowed(currentInvestmentPoolState);
        _;
    }

    modifier onlyInvestmentPool() {
        if (_msgSender() != getInvestmentPool()) revert DistributionPool__NotInvestmentPool();
        _;
    }

    modifier onlyCreator() {
        if (_msgSender() != investmentPool.getCreator())
            revert DistributionPool__NotProjectCreator();
        _;
    }

    /** EXTERNAL FUNCTIONS */

    /**
     * @notice Initializer receives token and amount that creator will need to transfer until fundraiser start
     */
    function initialize(
        IInvestmentPool _investmentPool,
        IERC20 _projectToken,
        uint256 _amountToLock
    ) external payable initializer {
        investmentPool = _investmentPool;
        projectToken = _projectToken;
        lockedTokens = _amountToLock;
    }

    /**
     * @notice Function allows to lock tokens for creator
     * @notice If until fundraiser start tokens are not transferred, fundraiser won't even start
     * @notice Prior approval is needed before this execution
     */
    function lockTokens() external onlyCreator {
        if (didCreatorLockTokens()) revert DistributionPool__ProjectTokensAlreadyLocked();
        creatorLockedTokens = true;

        bool success = projectToken.transferFrom(_msgSender(), address(this), lockedTokens);
        if (!success) revert DistributionPool__TokenTransferFailed();

        emit LockedTokens();
    }

    /**
     * @notice On investment distribution pool allocates project tokens
     * @param _milestoneId id of milestone in which investor invested
     * @param _investor investor address
     * @param _investmentWeight number of weight, which determines the size of project tokens allocation for investor
     * @param _weightDivisor maximum weight, which can be reached by all investors tokens
     * @param _allocationCoefficient the percentage that is left of the project.
     */
    function allocateTokens(
        uint16 _milestoneId,
        address _investor,
        uint256 _investmentWeight,
        uint256 _weightDivisor,
        uint256 _allocationCoefficient
    ) external onlyInvestmentPool {
        /// @dev Function is called only by investment pool that's why we don't check if data is valid

        uint256 tokenAllocation = (_investmentWeight * getLockedTokens()) / _weightDivisor;
        uint256 scaledAllocation = (tokenAllocation * getPercentageDivider()) /
            _allocationCoefficient;

        // This allows us to know the memoized amount of tokens that investor started owning from the provided milestone start.
        if (memMilestoneAllocation[_investor][_milestoneId] == 0) {
            // If it's first investment for this milestone, add milestone id to the array.
            milestonesWithAllocation[_investor].push(_milestoneId);
        }

        // Add the the current scaled allocation to the previous allocation.
        memMilestoneAllocation[_investor][_milestoneId] =
            _getMemoizedMilestoneAllocation(_investor, _milestoneId) +
            scaledAllocation;

        allocatedTokens[_investor] += tokenAllocation;
        totalAllocatedTokens += tokenAllocation;

        emit Allocated(_investor, _milestoneId);
    }

    /**
     * @notice On investment unpledge distribution pool removes tokens allocation
     * @param _milestoneId milestone is in which investor invested
     * @param _investor investor address
     */
    function removeTokensAllocation(
        uint16 _milestoneId,
        address _investor
    ) external onlyInvestmentPool {
        /// @dev Function is called only by investment pool that's why we don't check if data is valid

        uint256 tokenAllocation = getAllocatedAmount(_investor, _milestoneId);

        allocatedTokens[_investor] -= tokenAllocation;
        totalAllocatedTokens -= tokenAllocation;

        milestonesWithAllocation[_investor].pop();
        memMilestoneAllocation[_investor][_milestoneId] = 0;

        emit RemovedAllocation(_investor, _milestoneId);
    }

    /**
     * @notice Allows investors to claim allocation that is already dedicated to the user (by the passed time)
     * @notice Function is called directly from the distribution pool and not by investment pool
     */
    function claimAllocation() external {
        (uint256 previousMilestonesAllocation, uint256 flowRate) = getAllocationData(_msgSender());
        uint256 milestoneStartDate = investmentPool
            .getMilestone(investmentPool.getCurrentMilestoneId())
            .startDate;
        uint256 claimedAmount = getClaimedTokens(_msgSender());
        uint256 allocation;

        /**
         * @dev There can be situations (after milestone jump), in which milestone start is in the future, but milestone id has increased
         * @dev In situation like this, we should only get the allocation from previous milestones
         */
        if (_getNow() <= milestoneStartDate) {
            allocation = previousMilestonesAllocation;
        } else {
            uint256 duration = _getNow() - milestoneStartDate;
            allocation = previousMilestonesAllocation + (duration * flowRate);
        }

        /// @dev If allocation is calculated larger than total allocation for investor, set it to max amount
        if (allocation > getAllocatedTokens(_msgSender())) {
            allocation = getAllocatedTokens(_msgSender());
        }

        /// @dev Remove the claimed amount to get the allocation investor will get
        uint256 leftAllocation = allocation - claimedAmount;
        if (leftAllocation == 0) revert DistributionPool__NoAllocatedTokensLeft();

        claimedTokens[_msgSender()] += leftAllocation;

        bool success = projectToken.transfer(_msgSender(), leftAllocation);
        if (!success) revert DistributionPool__TokenTransferFailed();

        emit Claimed(_msgSender(), leftAllocation);
    }

    /**
     * @notice Allows creator to withdraw tokens that are not allocated if project fails
     * @notice Function is called directly from the distribution pool and not by investment pool
     */
    function withdrawTokens() external onlyCreator {
        if (!didCreatorLockTokens()) revert DistributionPool__ProjectTokensNotLocked();

        uint24 currentState = investmentPool.getProjectStateValue();
        uint256 withdrawAmount;

        if (
            currentState == getCanceledProjectStateValue() ||
            currentState == getFailedFundraiserStateValue()
        ) {
            withdrawAmount = getLockedTokens();
        } else if (
            currentState == getTerminatedByVotingStateValue() ||
            currentState == getTerminatedByGelatoStateValue()
        ) {
            withdrawAmount = getLockedTokens() - getTotalAllocatedTokens();
        } else {
            revert DistributionPool__StateIsInvalidForWithdrawal();
        }

        if (withdrawAmount == 0) revert DistributionPool__AllTokensAreAllocated();

        bool success = projectToken.transfer(_msgSender(), withdrawAmount);
        if (!success) revert DistributionPool__TokenTransferFailed();

        emit WithdrewTokens();
    }

    /** PUBLIC FUNCTIONS */

    /**
     * @notice Function is used to predict the amount of project tokens investor will receive.
     * @param _investedAmount Amount that investor would invest
     * @return project tokens amount that investor would receive
     */
    function calculateExpectedTokensAllocation(
        uint256 _investedAmount
    ) public view returns (uint256) {
        uint256 expectedWeight = investmentPool.getInvestmentWeight(_investedAmount);
        uint256 maxWeight = investmentPool.getMaximumWeightDivisor();
        return (getLockedTokens() * expectedWeight) / maxWeight;
    }

    /**
     * @notice Function calculates how many tokens are allocated to the provided milestone
     * @notice If investors invested, we can be sure that portion of tokens were allocated, else it will return 0.
     */
    function getAllocatedAmount(
        address _investor,
        uint16 _milestoneId
    ) public view returns (uint256) {
        IInvestmentPool.Milestone memory milestone = investmentPool.getMilestone(_milestoneId);
        return
            (_getMemoizedMilestoneAllocation(_investor, _milestoneId) *
                (milestone.intervalSeedPortion + milestone.intervalStreamingPortion)) /
            getPercentageDivider();
    }

    /**
     * @notice Function should be used by fronted to display user the available allocation to claim in real time
     * @notice Also this functionality is used when claiming allocation by investor
     * @return alreadyAllocated -> Amount of tokens that is 100% allocated from previous milestones
     * @return allocationFlowRate -> Flow rate of token allocation during the current milestone
     */
    function getAllocationData(
        address _investor
    ) public view returns (uint256 alreadyAllocated, uint256 allocationFlowRate) {
        uint16 currentMilestone = investmentPool.getCurrentMilestoneId();
        uint24 currentState = investmentPool.getProjectStateValue();

        // If no milestone is ongoing, always return 0
        if (
            currentState == getCanceledProjectStateValue() ||
            currentState == getBeforeFundraiserStateValue() ||
            currentState == getFundraiserOngoingStateValue() ||
            currentState == getFailedFundraiserStateValue() ||
            currentState == getFundraiserEndedNoMilestonesOngoingStateValue()
        ) {
            // Milestones haven't started, so return 0;
            return (0, 0);
        } else if (investmentPool.isStateAnyMilestoneOngoing()) {
            uint256 previousMilestonesAllocation = 0;
            for (uint16 i = 0; i < currentMilestone; i++) {
                previousMilestonesAllocation += getAllocatedAmount(_investor, i);
            }

            uint256 allocationPerSecond = getAllocatedAmount(_investor, currentMilestone) /
                investmentPool.getMilestoneDuration(currentMilestone);

            return (previousMilestonesAllocation, allocationPerSecond);
        } else if (
            currentState == getTerminatedByVotingStateValue() ||
            currentState == getTerminatedByGelatoStateValue()
        ) {
            uint48 milestoneStartDate = investmentPool.getMilestone(currentMilestone).startDate;
            uint48 terminationTimestamp = investmentPool.getEmergencyTerminationTimestamp();
            uint256 previousMilestonesAllocation = 0;
            for (uint16 i = 0; i < currentMilestone; i++) {
                previousMilestonesAllocation += getAllocatedAmount(_investor, i);
            }

            // There is and edge case, where project is terminated during the previous milestone period.
            // Thats why we check if milestone started before emergency termination.
            if (terminationTimestamp > milestoneStartDate) {
                uint48 timePassed = terminationTimestamp - milestoneStartDate;
                uint256 allocationPerSecond = getAllocatedAmount(_investor, currentMilestone) /
                    investmentPool.getMilestoneDuration(currentMilestone);
                previousMilestonesAllocation += uint256(timePassed) * allocationPerSecond;
            }

            return (previousMilestonesAllocation, 0);
        } else if (currentState == getSuccessfullyEndedStateValue()) {
            // Return full allocation
            uint256 fullAllocation = getAllocatedTokens(_investor);
            return (fullAllocation, 0);
        } else {
            return (0, 0);
        }
    }

    function getAllocatedTokens(address _investor) public view returns (uint256) {
        return allocatedTokens[_investor];
    }

    function getClaimedTokens(address _investor) public view returns (uint256) {
        return claimedTokens[_investor];
    }

    function getMilestonesWithAllocation(address _investor) public view returns (uint16[] memory) {
        return milestonesWithAllocation[_investor];
    }

    function getPercentageDivider() public view returns (uint48) {
        return investmentPool.getPercentageDivider();
    }

    function getInvestmentPool() public view returns (address) {
        return address(investmentPool);
    }

    function getToken() public view returns (address) {
        return address(projectToken);
    }

    function getLockedTokens() public view returns (uint256) {
        return lockedTokens;
    }

    function didCreatorLockTokens() public view returns (bool) {
        return creatorLockedTokens;
    }

    function getTotalAllocatedTokens() public view returns (uint256) {
        return totalAllocatedTokens;
    }

    function getCanceledProjectStateValue() public view returns (uint24) {
        return investmentPool.getCanceledProjectStateValue();
    }

    function getBeforeFundraiserStateValue() public view returns (uint24) {
        return investmentPool.getBeforeFundraiserStateValue();
    }

    function getFundraiserOngoingStateValue() public view returns (uint24) {
        return investmentPool.getFundraiserOngoingStateValue();
    }

    function getFailedFundraiserStateValue() public view returns (uint24) {
        return investmentPool.getFailedFundraiserStateValue();
    }

    function getFundraiserEndedNoMilestonesOngoingStateValue() public view returns (uint24) {
        return investmentPool.getFundraiserEndedNoMilestonesOngoingStateValue();
    }

    function getTerminatedByVotingStateValue() public view returns (uint24) {
        return investmentPool.getTerminatedByVotingStateValue();
    }

    function getTerminatedByGelatoStateValue() public view returns (uint24) {
        return investmentPool.getTerminatedByGelatoStateValue();
    }

    function getSuccessfullyEndedStateValue() public view returns (uint24) {
        return investmentPool.getSuccessfullyEndedStateValue();
    }

    /** INTERNAL FUNCTIONS */

    function _getMemoizedMilestoneAllocation(
        address _investor,
        uint16 _milestoneId
    ) internal view returns (uint256) {
        uint16[] memory milestonesIds = getMilestonesWithAllocation(_investor);

        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made
            // and no tokens were allocated. Return zero.
            return 0;
        } else if (_milestoneId == 0 || memMilestoneAllocation[_investor][_milestoneId] != 0) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the active tokens amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If active tokens allocation is not zero, that means investor invested in that milestone and tokens were allocated,
            // that is why we can get the value immediately, without any additional step.
            return memMilestoneAllocation[_investor][_milestoneId];
        } else if (memMilestoneAllocation[_investor][_milestoneId] == 0) {
            // If active tokens amount is zero, that means investment was MADE before it
            // or was NOT MADE at all. It also means that investment definitely was not made in the current milestone.

            // array.findUpperBound(element) searches a sorted array and returns the first index that contains a value greater or equal to element.
            // If no such index exists (i.e. all values in the array are strictly less than element), the array length is returned.
            // Because in previous condition we checked if investments were made to the milestone id,
            // we can be sure that findUpperBound function will return the value greater than element or length of the array,
            /// @dev not using milestonesIds variable because findUpperBound works only with storage variables.
            uint16 largerMilestoneIndex = milestonesIds.findUpperBound(_milestoneId);

            if (largerMilestoneIndex == milestonesIds.length) {
                // If length of an array was returned, it means
                // no milestone id in the array is greater than the current one.
                // Get the last value on milestonesIds array, because all the milestones after it
                // have the same active tokens amount.
                uint16 lastMilestone = milestonesIds[milestonesIds.length - 1];
                return memMilestoneAllocation[_investor][lastMilestone];
            } else if (
                largerMilestoneIndex == 0 && _milestoneId < milestonesIds[largerMilestoneIndex]
            ) {
                // If the index of milestone that was found is zero AND
                // current milestone is LESS than milestone retrieved from milestonesIds
                // it means no investments were made before the current milestone.
                // Thus, no voting tokens were minted at all.
                // This condition can be met when looking for tokens amount in past milestones
                return 0;
            } else if (milestonesIds.length > 1 && largerMilestoneIndex != 0) {
                // If more than 1 investment was made, nearestMilestoneIdFromTop will return
                // the index that is higher by 1 array element. That is we need to subtract 1, to get the right index
                // When we have the right index, we can return the active tokens amount
                // This condition can be met when looking for tokens amount in past milestones
                uint16 milestoneIdWithAllocation = milestonesIds[largerMilestoneIndex - 1];
                return memMilestoneAllocation[_investor][milestoneIdWithAllocation];
            }
        }

        // At this point all of the cases should be handled and value should already be returns
        // This part of code should never be reached, but for unknown cases we will return zero.
        return 0;
    }

    function _getNow() internal view returns (uint256) {
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }
}
