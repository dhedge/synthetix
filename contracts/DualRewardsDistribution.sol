pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";

// Libraires
import "./SafeDecimalMath.sol";
import "hardhat/console.sol";

// Internal references
import "./interfaces/IERC20.sol";
import "./interfaces/IFeePool.sol";
import "./interfaces/IDualRewardsDistribution.sol";

// https://docs.synthetix.io/contracts/source/contracts/rewardsdistribution
contract DualRewardsDistribution is Owned, IDualRewardsDistribution {
    using SafeMath for uint;
    using SafeDecimalMath for uint;

    /**
     * @notice Authorised address able to call distributeRewards
     */
    address public authority;

    /**
     * @notice Address of the Synthetix ProxyERC20
     */
    address public synthetixProxy;

        /**
     * @notice Address of the ProxyERC20
     */
    address public rewardTokenProxy;

    /**
     * @notice Address of the RewardEscrow contract
     */
    address public rewardEscrow;

    /**
     * @notice Address of the FeePoolProxy
     */
    address public feePoolProxy;

    /**
     * @notice An array of addresses and amounts to send
     */
    DualRewardsDistributionData[] public distributions;

    /**
     * @dev _authority maybe the underlying synthetix contract.
     * Remember to set the authority on a synthetix upgrade
     */
    constructor(
        address _owner,
        address _authority,
        address _synthetixProxy,
        address _rewardTokenProxy,
        address _rewardEscrow,
        address _feePoolProxy
    ) public Owned(_owner) {
        authority = _authority;
        synthetixProxy = _synthetixProxy;
        rewardTokenProxy = _rewardTokenProxy;
        rewardEscrow = _rewardEscrow;
        feePoolProxy = _feePoolProxy;
    }

    // ========== EXTERNAL SETTERS ==========

    function setSynthetixProxy(address _synthetixProxy) external onlyOwner {
        synthetixProxy = _synthetixProxy;
    }

    function setRewardTokenProxy(address _rewardTokenProxy) external onlyOwner {
        rewardTokenProxy = _rewardTokenProxy;
    }

    function setRewardEscrow(address _rewardEscrow) external onlyOwner {
        rewardEscrow = _rewardEscrow;
    }

    function setFeePoolProxy(address _feePoolProxy) external onlyOwner {
        feePoolProxy = _feePoolProxy;
    }

    /**
     * @notice Set the address of the contract authorised to call distributeRewards()
     * @param _authority Address of the authorised calling contract.
     */
    function setAuthority(address _authority) external onlyOwner {
        authority = _authority;
    }

    // ========== EXTERNAL FUNCTIONS ==========

    /**
     * @notice Adds a Rewards DualRewardsDistributionData struct to the distributions
     * array. Any entries here will be iterated and rewards distributed to
     * each address when tokens are sent to this contract and distributeRewards()
     * is called by the autority.
     * @param amountA The amount of rewardA-tokens to edit. Send the same number to keep or change the amount of tokens to send.
     * @param amountB The amount of rewardB-tokens to edit. Send the same number to keep or change the amount of tokens to send.
     * @param destination The destination address. Send the same address to keep or different address to change it.
     */

    function addDualRewardsDistribution(uint amountA, uint amountB, address destination) external onlyOwner returns (bool) {
        require(destination != address(0), "Cant add a zero address");
        require(amountA != 0, "Cant add a zero reward-amountA");
        require(amountB != 0, "Cant add a zero reward-amountB");

        console.log('addRewardDistribution for destination: %s', destination);

        DualRewardsDistributionData memory dualRewardsDistribution = 
        DualRewardsDistributionData(synthetixProxy, amountA, rewardTokenProxy, amountB, destination);
        distributions.push(dualRewardsDistribution);

        emit DualRewardDistributionAdded(distributions.length - 1, synthetixProxy, amountA, rewardTokenProxy, amountB, destination);
        return true;
    }

    /**
     * @notice Deletes a RewardDistribution from the distributions
     * so it will no longer be included in the call to distributeRewards()
     * @param index The index of the DualRewardsDistributionData to delete
     */
    function removeDualRewardsDistribution(uint index) external onlyOwner {
        require(index <= distributions.length - 1, "index out of bounds");

        // shift distributions indexes across
        for (uint i = index; i < distributions.length - 1; i++) {
            distributions[i] = distributions[i + 1];
        }
        distributions.length--;

        // Since this function must shift all later entries down to fill the
        // gap from the one it removed, it could in principle consume an
        // unbounded amount of gas. However, the number of entries will
        // presumably always be very low.
    }

    /**
     * @notice Edits a RewardDistribution in the distributions array.
     * @param index The index of the DualRewardsDistributionData to edit
     * @param amountA The amount of rewardA-tokens to edit. Send the same number to keep or change the amount of tokens to send.
     * @param amountB The amount of rewardB-tokens to edit. Send the same number to keep or change the amount of tokens to send.
     * @param destination The destination address. Send the same address to keep or different address to change it.
     */
    function editDualRewardsDistribution(
        uint index,
        uint amountA,
        uint amountB,
        address destination
    ) external onlyOwner returns (bool) {
        require(index <= distributions.length - 1, "index out of bounds");
        distributions[index].amountA = amountA;
        distributions[index].amountB = amountB;
        distributions[index].destination = destination;
        return true;
    }

    function distributeRewards(uint rewardAmountA, uint rewardAmountB) external returns (bool) {
        require(rewardAmountA > 0 || rewardAmountB > 0, "Nothing to distribute");
        require(msg.sender == authority, "Caller is not authorised");
        require(rewardEscrow != address(0), "RewardEscrow is not set");
        require(synthetixProxy != address(0), "SynthetixProxy is not set");
        require(feePoolProxy != address(0), "FeePoolProxy is not set");
        require(
            IERC20(synthetixProxy).balanceOf(address(this)) >= rewardAmountA,
            "RewardsDistribution contract does not have enough synthetixProxy tokens to distribute"
        );
        require(
            IERC20(rewardTokenProxy).balanceOf(address(this)) >= rewardAmountB,
            "RewardsDistribution contract does not have enough rewardTokenProxy tokens to distribute"
        );

        uint remainderA = rewardAmountA;
        uint remainderB = rewardAmountB;

        // Iterate the array of distributions sending the configured amounts
        for (uint i = 0; i < distributions.length; i++) {
            if (distributions[i].destination != address(0) || (distributions[i].amountA != 0 && distributions[i].amountB != 0) ){
                remainderA = remainderA.sub(distributions[i].amountA);
                remainderB = remainderB.sub(distributions[i].amountB);

                // Transfer the rewardTokenA
                IERC20(synthetixProxy).transfer(distributions[i].destination, distributions[i].amountA);

                // Transfer the rewardTokenB
                IERC20(rewardTokenProxy).transfer(distributions[i].destination, distributions[i].amountB);

                // If the contract implements RewardsDistributionRecipient.sol, inform it how many SNX its received.
                bytes memory payload = abi.encodeWithSignature("notifyRewardAmount(uint256,uint256)", distributions[i].amountA, distributions[i].amountB);

                // solhint-disable avoid-low-level-calls
                (bool success, ) = distributions[i].destination.call(payload);

                if (!success) {
                    // Note: we're ignoring the return value as it will fail for contracts that do not implement RewardsDistributionRecipient.sol
                }
            }
        }

        // After all ditributions have been sent, send the remainder to the RewardsEscrow contract
        IERC20(synthetixProxy).transfer(rewardEscrow, remainderA);

        // Tell the FeePool how much it has to distribute to the stakers
        //IFeePool(feePoolProxy).setDualRewardsToDistribute(remainderA);

        emit DualRewardsDistributed(rewardAmountA, rewardAmountB);
        return true;
    }
    

    /* ========== VIEWS ========== */

    /**
     * @notice Retrieve the length of the distributions array
     */
    function distributionsLength() external view returns (uint) {
        return distributions.length;
    }

    /* ========== Events ========== */
    event DualRewardDistributionAdded(uint index, address rewardTokenAProxy, uint amountA, address rewardTokenBProxy, uint amountB, address destination);
    event DualRewardsDistributed(uint amountA, uint amountB);
}
