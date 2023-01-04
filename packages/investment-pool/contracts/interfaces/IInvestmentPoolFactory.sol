// @ buidl.one 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import {ISuperToken, ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IInvestmentPool} from "./IInvestmentPool.sol";
import {IGovernancePool} from "./IGovernancePool.sol";

interface IInvestmentPoolFactory {
    /**
     * @dev ProxyType modes
     */
    enum ProxyType {
        CLONE_PROXY,
        // Not supported yet
        UUPS_PROXY
    }

    struct ProjectDetails {
        uint96 softCap;
        uint96 hardCap;
        uint48 fundraiserStartAt;
        uint48 fundraiserEndAt;
        ISuperToken acceptedToken;
        IERC20 projectToken;
        uint256 tokenRewards;
    }

    event Created(
        address indexed creator,
        address indexed ipContract,
        address gpContract,
        address dpContract,
        ProxyType proxyType
    );

    function createProjectPools(
        ProjectDetails calldata _projectDetails,
        ProxyType _proxyType,
        IInvestmentPool.MilestoneInterval[] calldata _milestones
    ) external payable returns (address);

    function getMaxMilestoneCount() external pure returns (uint32);

    function getTerminationWindow() external pure returns (uint48);

    function getAutomatedTerminationWindow() external pure returns (uint48);

    function getPercentageDivider() external pure returns (uint256);

    function getMilestoneMinDuration() external pure returns (uint256);

    function getMilestoneMaxDuration() external pure returns (uint256);

    function getFundraiserMinDuration() external pure returns (uint256);

    function getFundraiserMaxDuration() external pure returns (uint256);

    function getInvestmentWithdrawPercentageFee() external pure returns (uint256);

    function getSoftCapMultiplier() external pure returns (uint256);

    function getHardCapMultiplier() external pure returns (uint256);

    function getGelatoFee() external view returns (uint256);

    function getSuperfluidHost() external view returns (address);

    function getGelatoOps() external view returns (address payable);

    function getInvestmentPoolLogic() external view returns (address);

    function getGovernancePoolLogic() external view returns (address);

    function getVotingToken() external view returns (address);
}
