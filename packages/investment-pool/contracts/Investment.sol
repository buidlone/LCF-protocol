// @ DPATRON 2022
// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

// Superfluid imports
import {ISuperfluid, ISuperToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

// Openzepelin imports
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);

    function transferFrom(
        address,
        address,
        uint256
    ) external returns (bool);
}

// Should probably inherit from SuperAppBase
// Should register itself
// If necessary, should register callbacks for flow agreements status
contract Investment is SuperAppBase, Context{
    
    using CFAv1Library for CFAv1Library.InitData;

    // Events
    event Launch(
        uint256 id,
        address indexed creator,
        uint256 softCap,
        uint32 startAt,
        uint32 endAt
    );
    event Cancel(uint256 id);
    event Invest(uint256 indexed id, address indexed caller, uint256 amount);
    event Unpledge(uint256 indexed id, address indexed caller, uint256 amount);
    event Claim(uint256 id);
    event Refund(uint256 id, address indexed caller, uint256 amount);

    // TODO: Optimize the struct layout, giving a full storage slot(32 bytes) to a bool is unreasonable
    // Probably can shift around the dates and alter their types 
    // (uint48 for timestamps should be plenty, and all of them would fit into a single storage slot)
    struct Campaign {
        // Creator of campaign
        address creator;
        // Amount of tokens to raise (wei)
        uint96 softCap;
        // Total amount invested
        uint256 invested;
        // Milestone start date
        uint96 milestoneStartDate;
        // Milestone end date
        uint96 milestoneEndDate;
        // Timestamp of start of campaign
        uint32 startAt;
        // Timestamp of end of campaign
        uint32 endAt;
        // True if softCap was reached and creator has claimed the tokens.
        bool claimed;
    }

    // TODO: Add min/max durations for fundraiser campaign and milestone respectively
    uint constant public MILESTONE_MIN_DURATION = 30 days;
    uint constant public FUNDRAISER_MAX_DURATION = 90 days;
    bytes32 constant public CFA_ID = keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    
    /* WARNING: NEVER RE-ORDER VARIABLES! Always double-check that new
       variables are added APPEND-ONLY. Re-ordering variables can
       permanently BREAK the deployed proxy contract. */


    // Contains addresses of superfluid's host and ConstanFlowAgreement
    CFAv1Library.InitData public cfaV1Lib;

    // Contains the address of accepted investment token
    ISuperToken public acceptedToken;

    // Total count of campaigns created.
    // It is also used to generate id for new campaigns.
    uint256 public count;
    // Mapping from id to Campaign
    mapping(uint256 => Campaign) public campaigns;
    // Mapping from campaign id => pledger => amount invested
    mapping(uint256 => mapping(address => uint256)) public investedAmount;

    // Add mapping from campaignId to campaign milestones
    // Add mapping from creator address to actively streaming milestones



    constructor(
        ISuperfluid _host,
        ISuperToken _acceptedToken,
        string memory _registrationKey
    ) {
        assert(address(_host) != address(0));
        assert(address(_acceptedToken) != address(0));

        acceptedToken = _acceptedToken;
        
        // Resolve the agreement address and initialize the lib
        cfaV1Lib = CFAv1Library.InitData(
            _host,
            IConstantFlowAgreementV1(
                address(_host.getAgreementClass(CFA_ID))
            )
        );

        // TODO: Adjust this for the application needs
        // TODO: For right now we don't use callbacks, but will need them later to handle edge cases
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL
             | SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP
             | SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP
             | SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP
             | SuperAppDefinitions.AFTER_AGREEMENT_CREATED_NOOP
             | SuperAppDefinitions.AFTER_AGREEMENT_UPDATED_NOOP
             | SuperAppDefinitions.AFTER_AGREEMENT_TERMINATED_NOOP;

        if (bytes(_registrationKey).length > 0) {
            _host.registerAppWithKey(configWord, _registrationKey);
        } else {
            _host.registerApp(configWord);
        }
    }

    /** @notice Confirms that the investor's current investment is greater or equal to amount
        @param _investor Address of the investor to check
        @param _id Campaign ID
        @param _amount Amount of funds to check for
     */
    modifier hasInvestedSufficientAmount(address _investor, uint256 _id, uint256 _amount)
    {
        require(investedAmount[_id][_investor] >= _amount, "amount > invested");
        _;
    }

    /** @notice Confirms that the investment campaign has reached a soft capstartAt
        @param _id Campaign ID
     */
    modifier softCapReached(uint256 _id)
    {
        require(isSoftCapReached(_id), "total investment < softCap");
        _;
    }

    /** @notice Ensures that the campaign is not started yet
        @param _id Campaign ID
     */
    modifier campaignNotStartedYet(uint256 _id)
    {
        require(_getNow() < campaigns[_id].startAt, "campaign started already");
        _;
    }

    /** @notice Ensures that the fundraiser period for a given campaign is ongoing
        @param _id Campaign ID
     */
    modifier fundraiserOngoingNow(uint256 _id)
    {
        require(isFundraiserOngoingNow(_id), "not in fundraiser period");
        _;
    }

    /** @notice Ensures that the campaign has failed and investors are eligible for refunds
        @param _id Campaign ID
     */
    modifier failedCampaign(uint256 _id)
    {
        require(isFailedCampaign(_id), "is not a failed campaign");
        _;
    }

    /** @notice Ensures that the message sender is the campaign creator
        @param _id Campaign ID
     */
    modifier onlyCreator(uint256 _id)
    {
        require(campaigns[_id].creator == _msgSender(), "not creator");
        _;
    }


    /** @notice Check if in fundraiser period
        @param _id Campaign ID
        @return true if currently accepting investments
     */
    function isFundraiserOngoingNow(uint256 _id) public view returns(bool)
    {
        return _getNow() >= campaigns[_id].startAt && _getNow() < campaigns[_id].endAt;
    }

    /** @notice Check if in milestone period
        @param _id Campaign ID
        @return true if currently in milestone period
     */
    function isMilestoneOngoingNow(uint _id) public view returns(bool)
    {
        return _getNow() >= campaigns[_id].milestoneStartDate && _getNow() < campaigns[_id].milestoneEndDate;
    }

    /** @notice Check if the campaign has raised enough invested funds to reach soft cap
        @param _id Campaign ID
        @return true if campaign has raised enough invested funds to reach soft cap
     */
    function isSoftCapReached(uint256 _id) public view returns(bool)
    {
        return campaigns[_id].softCap <= campaigns[_id].invested;
    }

    /** @notice Check if the fundraiser period for a given campaign has ended
     */
    function didFundraiserPeriodEnd(uint256 _id) public view returns(bool)
    {
        return _getNow() >= campaigns[_id].endAt;
    }

    /** @notice Check if campaign has failed (didn't raise >= soft cap and ended)
        @param _id Campaign id
        @return true if the campaign is considered failed and investors are eligible for refunds
     */
    function isFailedCampaign(uint256 _id) public view returns(bool)
    {
        return didFundraiserPeriodEnd(_id) && !isSoftCapReached(_id);
    }

    /** @notice Creates an investment campaign
        @param _softCap Minimum amount of funds that needs to be raised for the campaign to be considered successful
        @param _milestoneStartDate When does the milestone start
        @param _milestoneEndDate When does the milestone end
        @param _startAt When does the fundraiser period start
        @param _endAt When does the fundraiser period end
     */
    function launch(
        uint96 _softCap,
        uint96 _milestoneStartDate,
        uint96 _milestoneEndDate,
        uint32 _startAt,
        uint32 _endAt
    ) external {
        require(_startAt >= _getNow(), "start at < now");
        require(_endAt >= _startAt, "end at < start at");
        require(_endAt - _startAt <= FUNDRAISER_MAX_DURATION, "fundraiser duration exceeds max duration");
        require(
            _endAt <= _milestoneStartDate,
            "milestone start date cannot start before campain ends"
        );
        require(
            _milestoneStartDate < _milestoneEndDate,
            "milestone start date > milestone end date "
        );
        require(
            _milestoneEndDate - _milestoneStartDate >= MILESTONE_MIN_DURATION,
            "milestone lenght must be at least 1 month "
        );

        count += 1;
        campaigns[count] = Campaign({
            creator: _msgSender(),
            softCap: _softCap,
            milestoneStartDate: _milestoneStartDate,
            milestoneEndDate: _milestoneEndDate,
            invested: 0,
            startAt: _startAt,
            endAt: _endAt,
            claimed: false
        });

        emit Launch(count, _msgSender(), _softCap, _startAt, _endAt);
    }

    /** @notice Deletes investment campaign
        @param _id Campaing ID
     */
    function cancel(uint256 _id) 
        external 
        onlyCreator(_id)
        campaignNotStartedYet(_id)
    {
        delete campaigns[_id];
        emit Cancel(_id);
    }

    /** @notice Allows to invest a specified amount of funds
        @dev Prior approval from _msgSender() to this contract is required
        @param _id Campaign ID
        @param _amount Amount of tokens to invest, must be <= approved amount
     */
    function invest(uint256 _id, uint256 _amount) 
        external 
        fundraiserOngoingNow(_id)
    {
        campaigns[_id].invested += _amount;
        investedAmount[_id][_msgSender()] += _amount;
        acceptedToken.transferFrom(_msgSender(), address(this), _amount);

        emit Invest(_id, _msgSender(), _amount);
    }

    /** @notice Allows investors to change their mind during the fundraiser period and get their funds back. All at once, or just a specified portion
        @param _id Campaign ID
        @param _amount Amount of funds to withdraw.
     */
    function unpledge(uint256 _id, uint256 _amount) 
        external
        fundraiserOngoingNow(_id)
        hasInvestedSufficientAmount(_msgSender(), _id, _amount)
    {
        campaigns[_id].invested -= _amount;
        investedAmount[_id][_msgSender()] -= _amount;
        acceptedToken.transfer(_msgSender(), _amount);

        emit Unpledge(_id, _msgSender(), _amount);
    }

    /** @notice Allows investors to withdraw all locked funds for a failed campaign(if the soft cap has not been raised by the campain end date)
        @param _id Campaign ID
     */
    function refund(uint256 _id) 
        external
        failedCampaign(_id)
    {
        uint256 bal = investedAmount[_id][_msgSender()];
        investedAmount[_id][_msgSender()] = 0;
        acceptedToken.transfer(_msgSender(), bal);

        emit Refund(_id, _msgSender(), bal);
    }

    function claim(uint256 _id) 
        external
        onlyCreator(_id) 
        softCapReached(_id)
    {
        Campaign storage campaign = campaigns[_id];
        require(
            _getNow() >= campaign.milestoneStartDate,
            "milestone not started yet"
        );

        // Potentially problematic, decide what to do with this
        require(!campaign.claimed, "claimed");


        // Potential problems here, as fund receiver can manually stop streaming of funds
        // for whatever reason
        campaign.claimed = true;

        uint96 milestonePeriod = campaign.milestoneEndDate -
            campaign.milestoneStartDate;

        // Need clarification on this, why softCap, why not total investedAmount?
        // Why 7 days specifically?
        // Creates flowRate with 7 days delay
        // Perhaps we need to take into account the milestone end date instead?
        // Because it'd make sense for campaign creator to receive all of the
        // funds before the milestone ends, regardless of the time when "claim()" was triggered
        int96 flowRate = int96(campaign.softCap) /
            int96(milestonePeriod + 7 days);


        (uint256 timestamp, int96 currentFlowRate, , ) = cfaV1Lib.cfa.getFlow(
            acceptedToken,
            address(this),
            campaign.creator
        );

        // Flow from this contract to the receiver does not exist, create
        if (timestamp == 0)
        {
            cfaV1Lib.createFlow(
                campaign.creator,
                acceptedToken,
                flowRate
            );
        }
        else
        {
            cfaV1Lib.updateFlow(
                campaign.creator,
                acceptedToken,
                currentFlowRate + flowRate
            );
        }

        // Create Linear Cash Flow to project account
        // NOTE: Should have cancellation mechanism to stop the expired stream
        // Otherwise - contract will become insolvent and SuperApp will be jailed
        

        emit Claim(_id);
    }

    function _onStreamingToCreatorStopped(address receiver) internal{
        // Primary use of this function is to handle the corner case, 
        // where creator stops money streaming for some reason

        // Find campaigns/milestones where money streaming is active
        // Calculate the amout of money that has been streamed out
        // Keep tabs on it, so we can restart the streaming with a correct flow rate
        // Update the streaming status for each campaign/milestone
    }

    function _getNow() internal view virtual returns(uint256) {
        // TODO: ISuperfluid host can provide time with .getNow(), investigate that
        // solhint-disable-next-line not-rely-on-time
        return block.timestamp;
    }

    // TODO: Insert SuperApp callbacks here

    // TODO: Insert termination checker and termination logic
    // once termination window is added
}
