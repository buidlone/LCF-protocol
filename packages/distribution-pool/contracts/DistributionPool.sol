// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/utils/Arrays.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IInitializableDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";

error DistributionPool__TokenTransferFailed();
error DistributionPool__ProjectTokensAlreadyLocked();
error DistributionPool__NotInvestmentPool();
error DistributionPool__NotProjectCreator();
error DistributionPool__NoAllocatedTokensLeft();

contract DistributionPool is IInitializableDistributionPool, Context, Initializable {
    using Arrays for uint256[];

    /** STATE VARIABLES */

    uint256 internal constant PERCENTAGE_DIVIDER = 10 ** 6;

    IERC20 internal projectToken;
    IInvestmentPool internal investmentPool;
    uint256 internal lockedTokens;
    bool internal creatorLockedTokens;
    uint256 internal totalAllocatedTokens;

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
    mapping(address => mapping(uint256 => uint256)) internal memMilestoneAllocation;

    /**
     * @dev Mapping holds milestone ids, in which allocation size increased.
     * @dev It will be used with memMilestoneAllocation data to find the right nubmer
     * @dev investor => milestone ids list
     */
    mapping(address => uint256[]) internal milestonesWithAllocation;

    /** EVENTS */

    event LockedTokens();
    event Allocated(address indexed investor, uint256 milestoneId);
    event RemovedAllocation(address indexed investor, uint256 milestoneId);
    event Claimed(address indexed investor, uint256 tokensAmount);

    /** MODIFIERS */

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
        uint256 _milestoneId,
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
        uint256 _milestoneId,
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

    function claimAllocation() external {
        (
            uint256 previousMilestonesAllocation,
            uint256 flowRate,
            uint256 milestone
        ) = getAllocationData(_msgSender());
        uint256 milestoneStartDate = investmentPool.getMilestone(milestone).startDate;
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
        if (allocation > allocatedTokens[_msgSender()]) {
            allocation = allocatedTokens[_msgSender()];
        }

        /// @dev Remove the claimed amount to get the allocation investor will get
        uint256 leftAllocation = allocation - claimedAmount;
        if (leftAllocation == 0) revert DistributionPool__NoAllocatedTokensLeft();

        claimedTokens[_msgSender()] += leftAllocation;

        bool success = projectToken.transfer(_msgSender(), leftAllocation);
        if (!success) revert DistributionPool__TokenTransferFailed();

        emit Claimed(_msgSender(), leftAllocation);
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
        uint256 expectedWeight = investmentPool.calculateInvestmentWeight(_investedAmount);
        uint256 maxWeight = investmentPool.getMaximumWeightDivisor();
        return (getLockedTokens() * expectedWeight) / maxWeight;
    }

    /**
     * @notice Function calculates how many tokens where allocated during the provided milestone
     * @notice If investors invested, we can be sure that portion of tokens were allocated, else it will return 0.
     */
    function getAllocatedAmount(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return
            (_getMemoizedMilestoneAllocation(_investor, _milestoneId) *
                investmentPool.getMilestonesPortionLeft(_milestoneId)) / getPercentageDivider();
    }

    /**
     * @notice Function should be used by fronted to display user the available allocation to claim in real time
     * @notice Also this functionality is used when claiming allocation by investor
     * @return Amount of tokens that is 100% allocated from previous milestones
     * @return Flow rate of token allocation during the current milestone
     * @return Current milestone id
     */
    function getAllocationData(address _investor) public view returns (uint256, uint256, uint256) {
        uint256 currentMilestone = investmentPool.getCurrentMilestoneId();
        uint256 completedPortion = getPercentageDivider() -
            investmentPool.getMilestonesPortionLeft(currentMilestone);
        uint256 memAllocation = _getMemoizedMilestoneAllocation(_investor, currentMilestone);
        uint256 previousMilestonesAllocation = completedPortion * memAllocation;

        uint256 allocationPerSecond = getAllocatedAmount(_investor, currentMilestone) /
            investmentPool.getMilestoneDuration(currentMilestone);

        return (previousMilestonesAllocation, allocationPerSecond, currentMilestone);
    }

    function getAllocatedTokens(address _investor) public view returns (uint256) {
        return allocatedTokens[_investor];
    }

    function getClaimedTokens(address _investor) public view returns (uint256) {
        return claimedTokens[_investor];
    }

    function getMilestonesWithAllocation(
        address _investor
    ) public view returns (uint256[] memory) {
        return milestonesWithAllocation[_investor];
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
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

    /** INTERNAL FUNCTIONS */

    function _getMemoizedMilestoneAllocation(
        address _investor,
        uint256 _milestoneId
    ) internal view returns (uint256) {
        uint256[] memory milestonesIds = getMilestonesWithAllocation(_investor);

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
            uint256 largerMilestoneIndex = milestonesWithAllocation[_investor].findUpperBound(
                _milestoneId
            );

            if (largerMilestoneIndex == milestonesIds.length) {
                // If length of an array was returned, it means
                // no milestone id in the array is greater than the current one.
                // Get the last value on milestonesIds array, because all the milestones after it
                // have the same active tokens amount.
                uint256 lastMilestone = milestonesIds[milestonesIds.length - 1];
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
                uint256 milestoneIdWithAllocation = milestonesIds[largerMilestoneIndex - 1];
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
