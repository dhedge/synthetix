pragma solidity ^0.5.16;

// Inheritance
import "./Owned.sol";
import "./MixinResolver.sol";
import "./Proxyable.sol";
import "./interfaces/IFuturesMarketManager.sol";

// Libraries
import "openzeppelin-solidity-2.3.0/contracts/math/SafeMath.sol";
import "./AddressListLib.sol";

// Internal references
import "./interfaces/IFuturesMarket.sol";
import "./interfaces/ISynth.sol";


contract FuturesMarketManager is Owned, MixinResolver, Proxyable, IFuturesMarketManager {
    using SafeMath for uint;
    using AddressListLib for AddressListLib.AddressList;

    /* ========== STATE VARIABLES ========== */

    AddressListLib.AddressList internal _markets;
    mapping(bytes32 => address) public marketForAsset;

    /* ========== ADDRESS RESOLVER CONFIGURATION ========== */

    bytes32 internal constant CONTRACT_SYNTHSUSD = "SynthsUSD";

    bytes32[24] internal _addressesToCache = [CONTRACT_SYNTHSUSD];

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address payable _proxy,
        address _owner,
        address _resolver
    ) public Owned(_owner) Proxyable(_proxy) MixinResolver(_resolver, _addressesToCache) {}

    /* ========== VIEWS ========== */

    function _sUSD() internal view returns (ISynth) {
        return ISynth(requireAndGetAddress(CONTRACT_SYNTHSUSD, "Missing SynthsUSD"));
    }

    function markets(uint index, uint pageSize) external view returns (address[] memory) {
        return _markets.getPage(index, pageSize);
    }

    function numMarkets() external view returns (uint) {
        return _markets.elements.length;
    }

    function allMarkets() external view returns (address[] memory) {
        return _markets.getPage(0, _markets.elements.length);
    }

    function _marketsForAssets(bytes32[] memory assets) internal view returns (address[] memory) {
        uint numAssets = assets.length;
        address[] memory results = new address[](numAssets);
        for (uint i; i < numAssets; i++) {
            results[i] = marketForAsset[assets[i]];
        }
        return results;
    }

    function marketsForAssets(bytes32[] calldata assets) external view returns (address[] memory) {
        return _marketsForAssets(assets);
    }

    // TODO: Plug this into total system debt calculation
    // TODO: Caching
    function totalDebt() external view returns (uint debt, bool isInvalid) {
        uint total;
        bool anyIsInvalid;
        uint numOfMarkets = _markets.elements.length;
        for (uint i; i < numOfMarkets; i++) {
            (uint marketDebt, bool invalid) = IFuturesMarket(_markets.elements[i]).marketDebt();
            total = total.add(marketDebt);
            anyIsInvalid = anyIsInvalid || invalid;
        }
        return (total, anyIsInvalid);
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function addMarkets(address[] calldata marketsToAdd) external optionalProxy_onlyOwner {
        uint numOfMarkets = marketsToAdd.length;
        for (uint i; i < numOfMarkets; i++) {
            address market = marketsToAdd[i];
            require(!_markets.contains(market), "Market already exists");

            bytes32 key = IFuturesMarket(market).baseAsset();
            require(marketForAsset[key] == address(0), "Market already exists for this asset");
            marketForAsset[key] = market;
            _markets.push(market);
            emitMarketAdded(market, key);
        }
    }

    function _removeMarkets(address[] memory marketsToRemove) internal {
        uint numOfMarkets = marketsToRemove.length;
        for (uint i; i < numOfMarkets; i++) {
            address market = marketsToRemove[i];

            bytes32 key = IFuturesMarket(market).baseAsset();
            require(marketForAsset[key] != address(0), "No market exists for this asset");
            delete marketForAsset[key];
            _markets.remove(market);
            emitMarketRemoved(market, key);
        }
    }

    function removeMarkets(address[] calldata marketsToRemove) external optionalProxy_onlyOwner {
        return _removeMarkets(marketsToRemove);
    }

    function removeMarketsByAsset(bytes32[] calldata assetsToRemove) external optionalProxy_onlyOwner {
        _removeMarkets(_marketsForAssets(assetsToRemove));
    }

    // Issuing and burn functions can't be called through the proxy
    function issueSUSD(address account, uint amount) external onlyMarkets {
        _sUSD().issue(account, amount);
    }

    function burnSUSD(address account, uint amount) external onlyMarkets {
        _sUSD().burn(account, amount);
    }

    /* ========== MODIFIERS ========== */

    function _requireIsMarket() internal view {
        require(_markets.contains(messageSender) || _markets.contains(msg.sender), "Sender is not a market");
    }

    modifier onlyMarkets() {
        _requireIsMarket();
        _;
    }

    /* ========== EVENTS ========== */
    function addressToBytes32(address input) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(input)));
    }

    event MarketAdded(address market, bytes32 indexed asset);
    bytes32 internal constant MARKETADDED_SIG = keccak256("MarketAdded(address,bytes32)");

    function emitMarketAdded(address market, bytes32 asset) internal {
        proxy._emit(abi.encode(market), 2, MARKETADDED_SIG, asset, 0, 0);
    }

    event MarketRemoved(address market, bytes32 indexed asset);
    bytes32 internal constant MARKETREMOVED_SIG = keccak256("MarketAdded(address,bytes32)");

    function emitMarketRemoved(address market, bytes32 asset) internal {
        proxy._emit(abi.encode(market), 2, MARKETADDED_SIG, asset, 0, 0);
    }
}