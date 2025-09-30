// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./interfaces/ILeague.sol";

contract LeagueFactory {
    using Clones for address;

    error NameRequired();
    error TeamCountOutOfRange();
    error TokenZero();

    // Master implementation (logic) contract
    address public immutable implementation;

    address[] public leagues;
    mapping(address => address[]) public leaguesByCreator;

    event LeagueCreated(address indexed leagueAddress, address indexed creator);
    event ImplementationSet(address indexed impl);

    constructor(address _implementation) {
        require(_implementation != address(0), "Bad impl");
        implementation = _implementation;
        emit ImplementationSet(_implementation);
    }

    /// @notice Create a league that uses the native AVAX token for buy-ins.
    function createLeague(
        string calldata _name,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external returns (address leagueAddr) {
        if (bytes(_name).length == 0) revert NameRequired();
        if (!(_teamCount > 0 && _teamCount <= 255))
            revert TeamCountOutOfRange();

        leagueAddr = implementation.clone(); // EIP-1167 minimal proxy
        ILeague(leagueAddr).initialize(
            msg.sender,
            _name,
            address(0), // native
            _buyInAmount,
            _teamCount
        );

        leagues.push(leagueAddr);
        leaguesByCreator[msg.sender].push(leagueAddr);
        emit LeagueCreated(leagueAddr, msg.sender);
    }

    /// @notice Create a league that uses an ERC20 token for buy-ins.
    function createLeagueERC20(
        string calldata _name,
        address _token,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external returns (address leagueAddr) {
        if (bytes(_name).length == 0) revert NameRequired();
        if (!(_teamCount > 0 && _teamCount <= 255))
            revert TeamCountOutOfRange();
        if (_token == address(0)) revert TokenZero();

        leagueAddr = implementation.clone();
        ILeague(leagueAddr).initialize(
            msg.sender,
            _name,
            _token,
            _buyInAmount,
            _teamCount
        );

        leagues.push(leagueAddr);
        leaguesByCreator[msg.sender].push(leagueAddr);
        emit LeagueCreated(leagueAddr, msg.sender);
    }

    // Views
    function getLeagues() external view returns (address[] memory) {
        return leagues;
    }
    function getLeaguesByCreator(
        address c
    ) external view returns (address[] memory) {
        return leaguesByCreator[c];
    }
    function leaguesCount() external view returns (uint256) {
        return leagues.length;
    }
    function leaguesCountByCreator(address c) external view returns (uint256) {
        return leaguesByCreator[c].length;
    }
}
