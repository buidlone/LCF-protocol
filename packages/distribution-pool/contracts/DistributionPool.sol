// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";

import {IInvestmentPool} from "@buidlone/investment-pool/contracts/interfaces/IInvestmentPool.sol";
import {IInitializableDistributionPool} from "@buidlone/investment-pool/contracts/interfaces/IDistributionPool.sol";

error DistributionPool__SuperTokenTransferFailed();
error DistributionPool__ProjectTokensAlreadyLocked();
error DistributionPool__NotInvestmentPool();

contract DistributionPool is IInitializableDistributionPool, Context, Initializable {
    using Arrays for uint256[];

    uint256 internal constant PERCENTAGE_DIVIDER = 10 ** 6;

    IInvestmentPool internal investmentPool;
    ISuperToken internal projectToken;

    uint256 internal lockedTokens;
    bool internal creatorLockedTokens;

    /// @dev holds amount of tokens that investor will own after all streams (investor => tokens amount)
    mapping(address => uint256) totalAllocatedTokens;
    /// @dev tokens allocated on each milestone(investor => milestoneId => tokens amount)
    mapping(address => mapping(uint256 => uint256)) allocatedTokens;

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

    /**
     * @notice on investment distribution pool allocates project tokens
     * @param _milestoneId id of milestone in which investor invested
     * @param _investor investor address
     * @param _investmentWeight number of weight, which determines the size of project tokens allocation for investor
     */
    function allocateTokens(
        uint256 _milestoneId,
        address _investor,
        uint256 _investmentWeight
    ) external onlyInvestmentPool {
        uint256 weightDivisor = investmentPool.getMaximumWeightDivisor();
        uint256 allocation = (_investmentWeight * weightDivisor) / getLockedTokens();
        totalAllocatedTokens[_investor] += allocation;
        allocatedTokens[_investor][_milestoneId] += allocation;
    }

    /**
     * @notice on investment unpledge distribution pool removes tokens allocation
     * @param _milestoneId milestone is in which investor invested
     * @param _investor investor address
     */
    function removeTokensAllocation(
        uint256 _milestoneId,
        address _investor
    ) external onlyInvestmentPool {
        totalAllocatedTokens[_investor] -= getAllocatedTokens(_investor, _milestoneId);
        allocatedTokens[_investor][_milestoneId] = 0;
    }

    function milestoneJump(uint256 _milestoneId, address _investor) external onlyInvestmentPool {}

    function withdrawTokens() external {}

    /** PUBLIC FUNCTIONS */

    function openTokensStream(uint256 _milestoneId, address _investor) public onlyInvestmentPool {}

    function terminateTokensStream(
        uint256 _milestoneId,
        address _investor
    ) public onlyInvestmentPool {}

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
        return (expectedWeight * getLockedTokens()) / maxWeight;
    }

    function getTokensBalance() public view returns (uint256) {
        // TODO: need to decide how to get the amount that was streamed already in previous streams
    }

    function getAllocatedTokens(
        address _investor,
        uint256 _milestoneId
    ) public view returns (uint256) {
        return allocatedTokens[_investor][_milestoneId];
    }

    function getTotalAllocatedTokens(address _investor) public view returns (uint256) {
        return totalAllocatedTokens[_investor];
    }

    function getInvestmentPool() public view returns (address) {
        return address(investmentPool);
    }

    function getLockedTokens() public view returns (uint256) {
        return lockedTokens;
    }

    function getToken() public view returns (address) {
        return address(projectToken);
    }

    function getPercentageDivider() public pure returns (uint256) {
        return PERCENTAGE_DIVIDER;
    }
}
