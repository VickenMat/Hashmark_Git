// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILeague {
    function initialize(
        address _commissioner,
        string calldata _name,
        address _buyInToken, // address(0) = native AVAX
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external;
}
