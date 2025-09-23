// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./League.sol";

contract LeagueFactory {
    address[] public leagues;
    mapping(address => address[]) public leaguesByCreator;

    event LeagueCreated(address indexed leagueAddress, address indexed creator);

    /// @notice Create a league that uses the native AVAX token for buy-ins.
    function createLeague(
        string memory _name,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external {
        require(bytes(_name).length > 0, "League name is required");
        require(_teamCount > 0 && _teamCount <= 255, "Team count 1..255");

        // The creator is the commissioner.
        League newLeague = new League(
            msg.sender,
            _name,
            address(0),
            _buyInAmount,
            _teamCount
        );

        address leagueAddr = address(newLeague);
        leagues.push(leagueAddr);
        leaguesByCreator[msg.sender].push(leagueAddr);

        emit LeagueCreated(leagueAddr, msg.sender);
    }

    /// @notice Create a league that uses an ERC20 token for buy-ins.
    function createLeagueERC20(
        string memory _name,
        address _token,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external {
        require(bytes(_name).length > 0, "League name is required");
        require(_teamCount > 0 && _teamCount <= 255, "Team count 1..255");
        require(_token != address(0), "Token address is zero");

        League newLeague = new League(
            msg.sender,
            _name,
            _token,
            _buyInAmount,
            _teamCount
        );

        address leagueAddr = address(newLeague);
        leagues.push(leagueAddr);
        leaguesByCreator[msg.sender].push(leagueAddr);

        emit LeagueCreated(leagueAddr, msg.sender);
    }

    function getLeagues() external view returns (address[] memory) {
        return leagues;
    }

    function getLeaguesByCreator(
        address creator
    ) external view returns (address[] memory) {
        return leaguesByCreator[creator];
    }

    function leaguesCount() external view returns (uint256) {
        return leagues.length;
    }

    function leaguesCountByCreator(
        address creator
    ) external view returns (uint256) {
        return leaguesByCreator[creator].length;
    }
}
