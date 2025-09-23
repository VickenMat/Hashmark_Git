// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * League (v2, unified settings)
 *
 * - The creator is ALWAYS the commissioner: LeagueFactory passes msg.sender to constructor.
 * - teamCap is mutable (validated) via setLeagueSettings.
 * - Password join (legacy) and optional signature-gated joins supported.
 * - Buy-in escrow supports native (AVAX) or ERC20; accounting is consistent for both.
 */
contract League is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------- Core ----------
    address public commissioner;
    uint256 public immutable createdAt;
    string public name;

    // address(0) = native token (AVAX on Avalanche)
    address public immutable buyInToken;
    uint256 public immutable buyInAmount;

    // Mutable with bounds checks
    uint256 public teamCap;
    uint256 public teamsFilled;

    struct Team {
        address owner;
        string name;
    }

    mapping(address => Team) public teams;
    Team[] public teamList;
    // 1-based index (0 => not a member) to allow "not set" sentinel
    mapping(address => uint256) public teamIndex;

    // ---------- On-chain, league-scoped team profiles ----------
    struct TeamProfile {
        string name; // optional; if empty, fall back to teams[owner].name
        string logoURI; // ipfs://... or https://...
        uint64 updatedAt;
    }
    mapping(address => TeamProfile) private _profiles;

    // ---------- Buy-in escrow ----------
    mapping(address => uint256) public paid;
    uint256 public totalPaid; // unified counter (native or ERC20)

    // ---------- Password (legacy) ----------
    bytes32 public joinPasswordHash;

    // ---------- Signature gate ----------
    address public joinSigner;
    event JoinSignerSet(address indexed signer);

    function _verifyJoinSig(
        address joiner,
        string memory teamName,
        uint256 deadline,
        bytes calldata sig
    ) internal view returns (bool) {
        if (joinSigner == address(0)) return true;
        require(block.timestamp <= deadline, "Join permit expired");
        bytes32 digest = keccak256(
            abi.encode(
                address(this),
                joiner,
                keccak256(bytes(teamName)),
                deadline
            )
        );
        bytes32 ethDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        return ECDSA.recover(ethDigest, sig) == joinSigner;
    }

    // ---------- DRAFT SETTINGS ----------
    enum DraftType {
        Snake,
        SalaryCap,
        Autopick,
        Offline
    }
    enum OrderMode {
        Random,
        Manual
    }

    struct DraftConfig {
        DraftType draftType;
        uint64 draftTimestamp; // seconds
        OrderMode orderMode;
        bool draftCompleted;
    }

    DraftConfig public draftConfig;
    address[] public manualDraftOrder;
    bool public draftPickTradingEnabled;

    mapping(address => bool) private _seen; // temp map used in setDraftSettings

    // ---------- UNIFIED LEAGUE SETTINGS (NEW) ----------
    enum WaiverType {
        Rolling,
        Reverse,
        FAAB
    }
    enum ClearanceDay {
        None,
        Tue,
        Wed,
        Thu
    }
    enum LeagueType {
        Redraft,
        Keeper,
        Dynasty
    }

    struct LeagueSettings {
        string leagueName; // mirrors `name`
        string leagueLogo; // URL/IPFS (stored only here)
        uint8 numberOfTeams; // mirrors `teamCap` (max 255)
        uint8 waiverType; // WaiverType
        uint64 waiverBudget; // for FAAB
        uint64 waiverMinBid; // for FAAB
        uint8 waiverClearance; // ClearanceDay
        uint8 waiversAfterDropDays; // 0..3
        uint8 tradeReviewDays; // 0..3
        uint8 tradeDeadlineWeek; // 0 or 9..13
        uint8 leagueType; // LeagueType
        bool extraGameVsMedian;
        bool preventDropAfterKickoff;
        bool lockAllMoves;
    }

    LeagueSettings private _settingsV2;

    // ---------- Events ----------
    event TeamCreated(
        address indexed owner,
        string name,
        uint256 indexed index
    );
    event TeamRenamed(address indexed owner, string oldName, string newName);
    event LeagueJoined(address indexed player);
    event DraftSettingsUpdated(
        DraftConfig cfg,
        address[] manualOrder,
        bool draftPickTradingEnabled
    );
    event JoinPasswordSet(bytes32 hash);
    event BuyInReceived(address indexed payer, uint256 amount, address token);
    event WithdrawnNative(address indexed to, uint256 amount);
    event WithdrawnToken(address indexed to, uint256 amount);
    event CommissionerTransferred(
        address indexed oldCommissioner,
        address indexed newCommissioner
    );
    event TeamProfileUpdated(
        address indexed owner,
        string name,
        string logoURI,
        uint64 updatedAt
    );
    event LeagueSettingsUpdated(LeagueSettings s);

    // ---------- Modifiers ----------
    modifier onlyCommissioner() {
        require(msg.sender == commissioner, "Only commissioner");
        _;
    }

    // ---------- Constructor ----------
    constructor(
        address _commissioner,
        string memory _name,
        address _buyInToken,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) {
        require(_commissioner != address(0), "Bad commissioner");
        require(bytes(_name).length > 0, "Name required");
        require(_teamCount > 0 && _teamCount <= 255, "Team count 1..255");

        commissioner = _commissioner;
        name = _name;
        buyInToken = _buyInToken;
        buyInAmount = _buyInAmount;
        teamCap = _teamCount;
        createdAt = block.timestamp;

        // Create the commissioner's team (index 0; teamIndex = 1)
        Team memory initialTeam = Team({
            owner: _commissioner,
            name: "Commissioner"
        });
        teams[_commissioner] = initialTeam;
        teamList.push(initialTeam);
        teamIndex[_commissioner] = 1;
        teamsFilled = 1;

        _profiles[_commissioner] = TeamProfile({
            name: "Commissioner",
            logoURI: "",
            updatedAt: uint64(block.timestamp)
        });

        // Defaults
        draftConfig = DraftConfig({
            draftType: DraftType.Snake,
            draftTimestamp: 0,
            orderMode: OrderMode.Random,
            draftCompleted: false
        });
        draftPickTradingEnabled = false;

        // Unified settings defaults
        _settingsV2 = LeagueSettings({
            leagueName: _name,
            leagueLogo: "",
            numberOfTeams: uint8(_teamCount),
            waiverType: uint8(WaiverType.Rolling),
            waiverBudget: 0,
            waiverMinBid: 0,
            waiverClearance: uint8(ClearanceDay.None),
            waiversAfterDropDays: 0,
            tradeReviewDays: 0,
            tradeDeadlineWeek: 0,
            leagueType: uint8(LeagueType.Redraft),
            extraGameVsMedian: false,
            preventDropAfterKickoff: true,
            lockAllMoves: false
        });
    }

    // ---------- Versioning ----------
    function version() external pure returns (uint16) {
        return 2;
    }

    // ---------- Admin ----------
    function transferCommissioner(
        address newCommissioner
    ) external onlyCommissioner {
        require(newCommissioner != address(0), "Zero address");
        emit CommissionerTransferred(commissioner, newCommissioner);
        commissioner = newCommissioner;
    }

    // ---------- Password controls (legacy) ----------
    function setJoinPassword(bytes32 passwordHash) external onlyCommissioner {
        joinPasswordHash = passwordHash;
        emit JoinPasswordSet(passwordHash);
    }

    function clearJoinPassword() external onlyCommissioner {
        joinPasswordHash = bytes32(0);
        emit JoinPasswordSet(bytes32(0));
    }

    function requiresPassword() external view returns (bool) {
        return joinPasswordHash != bytes32(0);
    }

    function _checkPassword(string calldata password) internal view {
        if (joinPasswordHash != bytes32(0)) {
            require(
                keccak256(bytes(password)) == joinPasswordHash,
                "Bad password"
            );
        }
    }

    // ---------- Signature gate ----------
    function setJoinSigner(address signer) external onlyCommissioner {
        joinSigner = signer; // address(0) disables
        emit JoinSignerSet(signer);
    }

    // ---------- Outstanding / escrow ----------
    function outstandingOf(address user) public view returns (uint256) {
        if (buyInAmount == 0) return 0;
        uint256 p = paid[user];
        return p >= buyInAmount ? 0 : buyInAmount - p;
    }

    function _createTeam(
        address owner,
        string memory teamName
    ) internal returns (uint256 idx) {
        Team memory newTeam = Team({owner: owner, name: teamName});
        teams[owner] = newTeam;
        teamList.push(newTeam);
        idx = teamList.length - 1; // 0-based index for array
        teamIndex[owner] = idx + 1; // 1-based index for map
        teamsFilled += 1;
        emit TeamCreated(owner, teamName, idx);

        _profiles[owner] = TeamProfile({
            name: teamName,
            logoURI: "",
            updatedAt: uint64(block.timestamp)
        });
        emit TeamProfileUpdated(owner, teamName, "", uint64(block.timestamp));
    }

    function _collectBuyIn(address payer, uint256 owed) internal {
        if (buyInToken == address(0)) {
            require(msg.value >= owed, "Insufficient native amount");
            if (owed > 0) {
                paid[payer] += owed;
                totalPaid += owed; // keep totals consistent
                emit BuyInReceived(payer, owed, address(0));
            }
            uint256 extra = msg.value - owed;
            if (extra > 0) {
                (bool ok, ) = payable(payer).call{value: extra}("");
                require(ok, "Refund failed");
            }
        } else {
            require(msg.value == 0, "No native with ERC20 buy-in");
            if (owed > 0) {
                // For fee-on-transfer tokens this might under-credit; use balance diff if you ever support those.
                IERC20(buyInToken).safeTransferFrom(payer, address(this), owed);
                paid[payer] += owed;
                totalPaid += owed; // ✅ FIX: previously missing
                emit BuyInReceived(payer, owed, buyInToken);
            }
        }
    }

    // ---------- Join/Create ----------
    function joinLeague(
        string calldata _teamName,
        string calldata password
    ) external payable nonReentrant {
        _checkPassword(password);
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists");
        require(teamsFilled < teamCap, "League is full");

        uint256 owed = outstandingOf(msg.sender);
        _collectBuyIn(msg.sender, owed);

        _createTeam(msg.sender, _teamName);
        emit LeagueJoined(msg.sender);
    }

    function joinLeagueWithSig(
        string calldata _teamName,
        uint256 deadline,
        bytes calldata sig
    ) external payable nonReentrant {
        require(
            _verifyJoinSig(msg.sender, _teamName, deadline, sig),
            "Bad join signature"
        );
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists");
        require(teamsFilled < teamCap, "League is full");

        uint256 owed = outstandingOf(msg.sender);
        _collectBuyIn(msg.sender, owed);

        _createTeam(msg.sender, _teamName);
        emit LeagueJoined(msg.sender);
    }

    function createTeam(
        string calldata _teamName,
        string calldata password
    ) external {
        _checkPassword(password);
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists");
        require(teamsFilled < teamCap, "League is full");
        _createTeam(msg.sender, _teamName);
    }

    function createTeamWithSig(
        string calldata _teamName,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(
            _verifyJoinSig(msg.sender, _teamName, deadline, sig),
            "Bad join signature"
        );
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists");
        require(teamsFilled < teamCap, "League is full");
        _createTeam(msg.sender, _teamName);
    }

    function payBuyIn() external payable nonReentrant {
        uint256 owed = outstandingOf(msg.sender);
        require(owed > 0, "Already paid");
        _collectBuyIn(msg.sender, owed);
    }

    function hasPaid(address user) external view returns (bool) {
        return outstandingOf(user) == 0;
    }

    // ---------- Team management ----------
    function setTeamName(string calldata newName) external {
        require(teams[msg.sender].owner != address(0), "Not a member");
        require(bytes(newName).length > 0, "Empty name");

        string memory old = teams[msg.sender].name;
        teams[msg.sender].name = newName;

        uint256 idx1 = teamIndex[msg.sender];
        if (idx1 > 0) {
            teamList[idx1 - 1].name = newName;
        }
        emit TeamRenamed(msg.sender, old, newName);

        TeamProfile storage p = _profiles[msg.sender];
        p.name = newName;
        p.updatedAt = uint64(block.timestamp);
        emit TeamProfileUpdated(msg.sender, p.name, p.logoURI, p.updatedAt);
    }

    function setTeamProfile(
        string calldata newName,
        string calldata newLogoURI
    ) external {
        require(teams[msg.sender].owner != address(0), "Not a member");
        TeamProfile storage p = _profiles[msg.sender];

        if (bytes(newName).length > 0) {
            string memory old = teams[msg.sender].name;
            teams[msg.sender].name = newName;
            uint256 idx1 = teamIndex[msg.sender];
            if (idx1 > 0) {
                teamList[idx1 - 1].name = newName;
            }
            if (keccak256(bytes(old)) != keccak256(bytes(newName))) {
                emit TeamRenamed(msg.sender, old, newName);
            }
            p.name = newName;
        } else {
            p.name = "";
        }

        if (bytes(newLogoURI).length > 0) {
            p.logoURI = newLogoURI;
        } else {
            p.logoURI = "";
        }

        p.updatedAt = uint64(block.timestamp);
        emit TeamProfileUpdated(msg.sender, p.name, p.logoURI, p.updatedAt);
    }

    function adminSetTeamProfile(
        address owner,
        string calldata newName,
        string calldata newLogoURI
    ) external onlyCommissioner {
        require(teams[owner].owner != address(0), "Not a member");
        TeamProfile storage p = _profiles[owner];

        if (bytes(newName).length > 0) {
            string memory old = teams[owner].name;
            teams[owner].name = newName;
            uint256 idx1 = teamIndex[owner];
            if (idx1 > 0) {
                teamList[idx1 - 1].name = newName;
            }
            if (keccak256(bytes(old)) != keccak256(bytes(newName))) {
                emit TeamRenamed(owner, old, newName);
            }
            p.name = newName;
        } else {
            p.name = "";
        }

        if (bytes(newLogoURI).length > 0) {
            p.logoURI = newLogoURI;
        } else {
            p.logoURI = "";
        }

        p.updatedAt = uint64(block.timestamp);
        emit TeamProfileUpdated(owner, p.name, p.logoURI, p.updatedAt);
    }

    // ---------- Escrow withdrawals ----------
    function withdrawNative(
        address payable to,
        uint256 amount
    ) external onlyCommissioner nonReentrant {
        require(buyInToken == address(0), "Not native pool");
        require(to != address(0), "Zero address");
        require(amount <= address(this).balance, "Insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit WithdrawnNative(to, amount);
    }

    function withdrawToken(
        address to,
        uint256 amount
    ) external onlyCommissioner nonReentrant {
        require(buyInToken != address(0), "Not ERC20 pool");
        require(to != address(0), "Zero address");
        IERC20(buyInToken).safeTransfer(to, amount);
        emit WithdrawnToken(to, amount);
    }

    // ---------- Views ----------
    function getTeams() external view returns (Team[] memory) {
        return teamList;
    }

    function getTeamByAddress(
        address user
    ) external view returns (string memory teamName) {
        return teams[user].name;
    }

    function getTeamProfile(
        address owner
    ) external view returns (string memory, string memory, uint64) {
        TeamProfile storage p = _profiles[owner];
        string memory nm = bytes(p.name).length > 0
            ? p.name
            : teams[owner].name;
        return (nm, p.logoURI, p.updatedAt);
    }

    function isMember(address user) external view returns (bool) {
        return teams[user].owner != address(0);
    }

    function escrowBalances()
        external
        view
        returns (uint256 nativeBalance, uint256 tokenBalance)
    {
        nativeBalance = address(this).balance;
        if (buyInToken != address(0)) {
            tokenBalance = IERC20(buyInToken).balanceOf(address(this));
        }
    }

    // ---------- Draft settings ----------
    function setDraftSettings(
        DraftType _draftType,
        uint64 _draftTimestamp,
        OrderMode _orderMode,
        address[] calldata _manualOrder,
        bool _draftCompleted,
        bool _draftPickTradingEnabled
    ) external onlyCommissioner {
        if (_orderMode == OrderMode.Manual) {
            delete manualDraftOrder;
            for (uint256 i = 0; i < _manualOrder.length; i++) {
                address a = _manualOrder[i];
                if (a == address(0)) continue;
                require(teams[a].owner != address(0), "order addr not member");
                require(!_seen[a], "order has duplicate");
                _seen[a] = true;
                manualDraftOrder.push(a);
            }
            for (uint256 j = 0; j < manualDraftOrder.length; j++) {
                delete _seen[manualDraftOrder[j]];
            }
        } else {
            delete manualDraftOrder;
        }

        draftConfig = DraftConfig({
            draftType: _draftType,
            draftTimestamp: _draftTimestamp,
            orderMode: _orderMode,
            draftCompleted: _draftCompleted
        });

        draftPickTradingEnabled = _draftPickTradingEnabled;
        emit DraftSettingsUpdated(
            draftConfig,
            manualDraftOrder,
            draftPickTradingEnabled
        );
    }

    function getDraftSettings()
        external
        view
        returns (DraftType, uint64, OrderMode, bool, address[] memory, bool)
    {
        return (
            draftConfig.draftType,
            draftConfig.draftTimestamp,
            draftConfig.orderMode,
            draftConfig.draftCompleted,
            manualDraftOrder,
            draftPickTradingEnabled
        );
    }

    /// Convenience summary (unchanged)
    function getSummary()
        external
        view
        returns (
            string memory _name,
            address _buyInToken,
            uint256 _buyInAmount,
            uint256 _teamCap,
            uint256 _teamsFilled,
            bool _requiresPassword,
            address _commissioner
        )
    {
        return (
            name,
            buyInToken,
            buyInAmount,
            teamCap,
            teamsFilled,
            joinPasswordHash != bytes32(0),
            commissioner
        );
    }

    // ---------- Unified settings API (NEW) ----------
    function getLeagueSettings()
        external
        view
        returns (LeagueSettings memory s)
    {
        s = _settingsV2;
        // keep mirrors authoritative
        s.leagueName = name;
        s.numberOfTeams = uint8(teamCap);
    }

    function setLeagueSettings(
        LeagueSettings calldata s
    ) external onlyCommissioner {
        // validate
        require(bytes(s.leagueName).length > 0, "League name required");
        require(s.numberOfTeams > 0 && s.numberOfTeams <= 255, "Teams 1..255");
        require(
            uint256(s.numberOfTeams) >= teamsFilled,
            "Below current filled teams"
        );
        require(s.waiversAfterDropDays <= 3, "waiversAfterDropDays 0..3");
        require(s.tradeReviewDays <= 3, "tradeReviewDays 0..3");

        if (s.tradeDeadlineWeek != 0) {
            require(
                s.tradeDeadlineWeek == 9 ||
                    s.tradeDeadlineWeek == 10 ||
                    s.tradeDeadlineWeek == 11 ||
                    s.tradeDeadlineWeek == 12 ||
                    s.tradeDeadlineWeek == 13,
                "deadline 0 or 9..13"
            );
        }
        require(s.waiverType <= uint8(WaiverType.FAAB), "Bad waiverType");
        require(s.waiverClearance <= uint8(ClearanceDay.Thu), "Bad clearance");
        require(s.leagueType <= uint8(LeagueType.Dynasty), "Bad leagueType");

        // Authoritative mirrors
        name = s.leagueName;
        teamCap = uint256(s.numberOfTeams);

        // Store struct (other fields live only here)
        _settingsV2 = LeagueSettings({
            leagueName: s.leagueName,
            leagueLogo: s.leagueLogo,
            numberOfTeams: s.numberOfTeams,
            waiverType: s.waiverType,
            waiverBudget: s.waiverBudget,
            waiverMinBid: s.waiverMinBid,
            waiverClearance: s.waiverClearance,
            waiversAfterDropDays: s.waiversAfterDropDays,
            tradeReviewDays: s.tradeReviewDays,
            tradeDeadlineWeek: s.tradeDeadlineWeek,
            leagueType: s.leagueType,
            extraGameVsMedian: s.extraGameVsMedian,
            preventDropAfterKickoff: s.preventDropAfterKickoff,
            lockAllMoves: s.lockAllMoves
        });

        emit LeagueSettingsUpdated(_settingsV2);
    }

    receive() external payable {}
}
