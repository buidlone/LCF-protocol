// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";

error DistributionPool__SuperTokenTransferFailed();
error DistributionPool__ProjectTokensAlreadyLocked();
error DistributionPool__NotInvestmentPool();

contract DistributionPool is Context, Initializable {
    using Arrays for uint256[];

    uint256 internal constant PERCENTAGE_DIVIDER = 10 ** 6;

    IInvestmentPool internal investmentPool;
    ISuperToken internal projectToken;

    uint256 internal lockedTokens;
    bool internal creatorLockedTokens;

    /// @dev milestoneId => investor => investmentWeight
    mapping(uint256 => mapping(address => uint256)) internal memInvestmentWeight;
    /// @dev milestoneId => totalInvestmentWeight
    mapping(uint256 => uint256) internal memTotalInvestmentWeight;
    /// @dev investor => list of milestone ids in which investor made at least 1 investment
    mapping(address => uint256[]) internal milestonesWithInvestment;

    uint256[] internal allMilestonesWithInvestment;

    modifier onlyInvestmentPool() {
        if (getInvestmentPool() != _msgSender()) revert DistributionPool__NotInvestmentPool();
        _;
    }

    /** EXTERNAL FUNCTIONS */

    /**
     * @notice Initializer receives token and amount that creator will need to transfer until fundraiser start
     */
    function initialize(
        IInvestmentPool _investmentPool,
        ISuperToken _projectToken,
        uint256 _amountToLock
    ) external initializer {
        investmentPool = _investmentPool;
        projectToken = _projectToken;
        lockedTokens = _amountToLock;
    }

    /**
     * @notice Function allows to lock tokens for creator.
     * @notice If until fundraiser start tokens are not transferred, fundraiser won't even start
     */
    function lockTokens() external {
        if (creatorLockedTokens) revert DistributionPool__ProjectTokensAlreadyLocked();

        creatorLockedTokens = true;

        bool success = projectToken.transferFrom(_msgSender(), address(this), lockedTokens);
        if (!success) revert DistributionPool__SuperTokenTransferFailed();
    }

    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight
    ) external onlyInvestmentPool {
        // Get all milestones in which investor invested. This array allows us to know when investments were made.
        uint256[] memory investorMilestonesIds = getMilestonesIdsInWhichInvested(_investor);

        // Get all milestones in which at least one investor invested. This array allows us to know when investments were made.
        uint256[] memory allMilestonesIds = getAllMilestonesIdsInWhichInvested();

        if (investorMilestonesIds.length == 0) {
            // If array is zero, it means no investments exist and therefore investor investments weight is 0
            memInvestmentWeight[_milestoneId][_investor] = _investmentWeight;
            milestonesWithInvestment[_investor].push(_milestoneId);
        } else {
            // If array is not zero, it means investor has made investments before.
            // Now we should add the investments weight amount from previous investments and add the current amount.
            // This allows us to know the specific amount that investor started owning from the provided milestone start.
            if (memInvestmentWeight[_milestoneId][_investor] == 0) {
                // If it's first investment for this milestone, add milestone id to the array.
                milestonesWithInvestment[_investor].push(_milestoneId);
            }

            memInvestmentWeight[_milestoneId][_investor] =
                getInvestmentWeight(_milestoneId, _investor) +
                _investmentWeight;
        }

        if (allMilestonesIds.length == 0) {
            // If array is zero, it means no investments exist and therefore investor investments weight is 0
            memTotalInvestmentWeight[_milestoneId] = _investmentWeight;
            allMilestonesWithInvestment.push(_milestoneId);
        } else {
            // If array is not zero, it means at least investor has made investment before.
            // Now we should add the investments weight amount from previous investments and add the current amount.
            // This allows us to know the specific amount that investor started owning from the provided milestone start.
            if (memTotalInvestmentWeight[_milestoneId] == 0) {
                // If it's first investment for this milestone, add milestone id to the array.
                allMilestonesWithInvestment.push(_milestoneId);
            }

            memTotalInvestmentWeight[_milestoneId] =
                getTotalInvestmentWeight(_milestoneId) +
                _investmentWeight;
        }
    }

    function removeTokensAllocation(
        uint256 _milestoneId,
        address _investor
    ) external onlyInvestmentPool {
        memTotalInvestmentWeight[_milestoneId] -= getInvestmentWeight(_milestoneId, _investor);
        memInvestmentWeight[_milestoneId][_investor] = 0;

        milestonesWithInvestment[_investor].pop();
        allMilestonesWithInvestment.pop();
    }

    function openTokensStream(uint256 _milestoneId, address _investor) external {}

    function terminateTokensStream(uint256 _milestoneId, address _investor) external {}

    function withdrawAllTokens() external {}

    function openNextMilestoneTokensStreamOrEndProject(
        uint256 _milestoneId,
        address _investor
    ) external {}

    /** PUBLIC FUNCTIONS */

    /**
     * @notice Function is used in calculator to predict the amount of project tokens investor will receive.
     */
    function getExpectedProjectTokensAllocation(
        uint256 _investedAmount
    ) public view returns (uint256) {
        uint256 expectedWeight = investmentPool.calculateInvestmentWeight(_investedAmount);
        uint256 maxWeight = investmentPool.getMaximumWeightDivisor();
        return (expectedWeight / maxWeight) * getProjectTokensSupplyCap();
    }

    function getInvestmentWeight(
        uint256 _milestoneId,
        address _investor
    ) public view returns (uint256) {
        uint256[] memory milestonesIds = getMilestonesIdsInWhichInvested(_investor);

        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made
            // Return zero
            return 0;
        } else if (_milestoneId == 0 || memInvestmentWeight[_milestoneId][_investor] != 0) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the weight amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If active tokens amount is not zero, that means investor invested in that milestone,
            // that is why we can get the value immediately, without any additional step.
            return memInvestmentWeight[_milestoneId][_investor];
        } else if (memInvestmentWeight[_milestoneId][_investor] == 0) {
            // If weight amount is zero, that means investment was MADE before it
            // or was NOT MADE at all. It also means that investment definitely was not made in the current milestone.

            // array.findUpperBound(element) searches a sorted array and returns the first index that contains a value greater or equal to element.
            // If no such index exists (i.e. all values in the array are strictly less than element), the array length is returned.
            // Because in previous condition we checked if investments were made to the milestone id,
            // we can be sure that findUpperBound function will return the value greater than element of length of the array,
            // but not the value that is equal.
            /// @dev not using milestonesIds variable because findUpperBound works only with storage variables.
            uint256 nearestMilestoneIdFromTop = milestonesWithInvestment[_investor].findUpperBound(
                _milestoneId
            );

            if (
                nearestMilestoneIdFromTop == 0 &&
                _milestoneId < milestonesIds[nearestMilestoneIdFromTop]
            ) {
                // If the index of milestone that was found is zero AND
                // current milestone is LESS than milestone retrieved from milestonesIds
                // it means no investments were made before the current milestone.
                // This condition can be met when looking for tokens amount in past milestones
                return 0;
            } else if (milestonesIds.length > 1 && nearestMilestoneIdFromTop != 0) {
                // If more than 1 investment was made, nearestMilestoneIdFromTop will return
                // the index that is higher by 1 array element. That is we need to subtract 1, to get the right index
                // When we have the right index, we can return weight amount
                // This condition can be met when looking for tokens amount in past milestones
                uint256 milestoneIdWithInvestment = milestonesIds[nearestMilestoneIdFromTop - 1];
                return memInvestmentWeight[milestoneIdWithInvestment][_investor];
            }
        }

        // At this point all of the cases should be handled and value should already be returns
        // This part of code should never be reached, but for unknown cases we will return zero.
        return 0;
    }

    function getTotalInvestmentWeight(uint256 _milestoneId) public view returns (uint256) {
        uint256[] memory milestonesIds = getAllMilestonesIdsInWhichInvested();

        if (milestonesIds.length == 0) {
            // If milestonesIds array is empty that means that no investments were made
            // Return zero
            return 0;
        } else if (_milestoneId == 0 || memTotalInvestmentWeight[_milestoneId] != 0) {
            // Return the value that mapping holds.
            // If milestone is zero, no matter the weight amount (it can be 0 or more),
            // it is the correct one, as no investments were made before it.
            // If active tokens amount is not zero, that means investor invested in that milestone,
            // that is why we can get the value immediately, without any additional step.
            return memTotalInvestmentWeight[_milestoneId];
        } else if (memTotalInvestmentWeight[_milestoneId] == 0) {
            // If weight amount is zero, that means investment was MADE before it
            // or was NOT MADE at all. It also means that investment definitely was not made in the current milestone.

            // array.findUpperBound(element) searches a sorted array and returns the first index that contains a value greater or equal to element.
            // If no such index exists (i.e. all values in the array are strictly less than element), the array length is returned.
            // Because in previous condition we checked if investments were made to the milestone id,
            // we can be sure that findUpperBound function will return the value greater than element of length of the array,
            // but not the value that is equal.
            /// @dev not using milestonesIds variable because findUpperBound works only with storage variables.
            uint256 nearestMilestoneIdFromTop = allMilestonesWithInvestment.findUpperBound(
                _milestoneId
            );

            if (
                nearestMilestoneIdFromTop == 0 &&
                _milestoneId < milestonesIds[nearestMilestoneIdFromTop]
            ) {
                // If the index of milestone that was found is zero AND
                // current milestone is LESS than milestone retrieved from milestonesIds
                // it means no investments were made before the current milestone.
                // This condition can be met when looking for tokens amount in past milestones
                return 0;
            } else if (milestonesIds.length > 1 && nearestMilestoneIdFromTop != 0) {
                // If more than 1 investment was made, nearestMilestoneIdFromTop will return
                // the index that is higher by 1 array element. That is we need to subtract 1, to get the right index
                // When we have the right index, we can return weight amount
                // This condition can be met when looking for tokens amount in past milestones
                uint256 milestoneIdWithInvestment = milestonesIds[nearestMilestoneIdFromTop - 1];
                return memTotalInvestmentWeight[milestoneIdWithInvestment];
            }
        }

        // At this point all of the cases should be handled and value should already be returns
        // This part of code should never be reached, but for unknown cases we will return zero.
        return 0;
    }

    function getAllocatedProjectTokensAmount(
        uint256 _milestoneId,
        address _investor
    ) public view returns (uint256) {
        uint256 percentageAllocation = investmentPool
            .getMilestone(_milestoneId)
            .intervalSeedPortion +
            investmentPool.getMilestone(_milestoneId).intervalStreamingPortion;

        uint256 allocation = (getInvestmentWeight(_milestoneId, _investor) *
            percentageAllocation *
            getProjectTokensSupplyCap()) /
            (getTotalInvestmentWeight(_milestoneId) * getPercentageDivider());

        return allocation;
    }

    function getTotalAllocatedProjectTokensAmount(
        address _investor
    ) public view returns (uint256) {
        // TODO: implement
    }

    function getProjectTokensBalance() public view returns (uint256) {
        // TODO: implement
    }

    function getInvestmentPool() public view returns (address) {
        return address(investmentPool);
    }

    function getMilestonesIdsInWhichInvested(
        address _investor
    ) public view returns (uint256[] memory) {
        return milestonesWithInvestment[_investor];
    }

    function getAllMilestonesIdsInWhichInvested() public view returns (uint256[] memory) {
        return allMilestonesWithInvestment;
    }

    function getProjectTokensSupplyCap() public view returns (uint256) {
        return lockedTokens;
    }

    function getProjectToken() public view returns (address) {
        return address(projectToken);
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
    }
}
