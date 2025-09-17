// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Simple standalone team list. Renamed from `League` to avoid name collision.
contract TeamList {
    address public commissioner;
    uint256 public createdAt;
    string public name;
    uint256 public buyIn;

    constructor(address _commissioner, string memory _name, uint256 _buyIn) {
        require(_commissioner != address(0), "Zero commissioner");
        require(bytes(_name).length > 0, "Name required");
        commissioner = _commissioner;
        name = _name;
        buyIn = _buyIn;
        createdAt = block.timestamp;
    }

    struct Team {
        address owner;
        string name;
    }

    mapping(address => Team) public teams;
    Team[] public teamList;

    event TeamCreated(address indexed owner, string name);

    function createTeam(string calldata _teamName) external {
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists");

        Team memory newTeam = Team(msg.sender, _teamName);
        teams[msg.sender] = newTeam;
        teamList.push(newTeam);

        emit TeamCreated(msg.sender, _teamName);
    }

    function getTeams() external view returns (Team[] memory) {
        return teamList;
    }

    function getTeamByAddress(
        address user
    ) external view returns (string memory teamName) {
        return teams[user].name;
    }

    function getTeamCount() external view returns (uint256) {
        return teamList.length;
    }
}
