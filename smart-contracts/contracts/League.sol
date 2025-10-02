// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * League (v6) — Multi-commissioner + Roster-cap enforcement + Snake Draft + Salary Cap Auction
 *
 * New in v6 (Salary Cap Auction):
 * - Auction runtime with 30s nomination window and 15s bid window (auto-reset on bid).
 * - Budgets initialized from draftExtras.salaryCapBudget.
 * - Budget rule: must retain >= $1 per unfilled roster spot after winning. Enforced on bids.
 * - Nomination order rotates like draft order; skip allowed if nominator times out.
 * - Auction closes on timer expiry -> winner charged; pick recorded; next nominator.
 *
 * Retains v5:
 * - EIP-1167 cloneable; initialize(...). Multi-commissioner (grant/revoke/set primary).
 * - Roster settings enforce a league-wide roster cap; picks increment per-team drafted count.
 * - Snake runtime (pause/resume, picks log, TRR-aware order, totalRounds). Autopick (snake only).
 * - Buy-in escrow (native/erc20), team profiles, unified league settings.
 */
contract League is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------- Core ----------
    address public commissioner;              // Primary commissioner
    mapping(address => bool) public isCommissioner;
    uint16 private _commissionerCount;

    uint256 public createdAt;
    string public name;

    // address(0) = native token (AVAX on Avalanche)
    address public buyInToken;
    uint256 public buyInAmount;

    // Mutable with bounds checks
    uint256 public teamCap;
    uint256 public teamsFilled;

    struct Team { address owner; string name; }
    mapping(address => Team) public teams;
    Team[] public teamList;
    // 1-based index (0 => not a member) to allow "not set" sentinel
    mapping(address => uint256) public teamIndex;

    // ---------- On-chain, league-scoped team profiles ----------
    struct TeamProfile { string name; string logoURI; uint64 updatedAt; }
    mapping(address => TeamProfile) private _profiles;

    // ---------- Buy-in escrow ----------
    mapping(address => uint256) public paid;
    uint256 public totalPaid;

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
        bytes32 digest = keccak256(abi.encode(address(this), joiner, keccak256(bytes(teamName)), deadline));
        bytes32 ethDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        return ECDSA.recover(ethDigest, sig) == joinSigner;
    }

    // ---------- DRAFT SETTINGS ----------
    enum DraftType { Snake, SalaryCap, Autopick, Offline }
    enum OrderMode { Random, Manual }

    struct DraftConfig {
        DraftType draftType;
        uint64 draftTimestamp; // seconds
        OrderMode orderMode;
        bool draftCompleted;
    }

    DraftConfig public draftConfig;
    address[] public manualDraftOrder;
    bool public draftPickTradingEnabled;

    // ---------- DRAFT EXTRAS (used by UI chips & timers) ----------
    enum PlayerPool { All, Rookies, Vets }

    struct DraftExtras {
        uint32 timePerPickSeconds; // 0 = no limit (Snake only)
        bool   thirdRoundReversal; // Snake nuance
        uint32 salaryCapBudget;    // Auction: per-team starting budget
        uint8  playerPool;         // PlayerPool as uint8
    }

    DraftExtras public draftExtras;
    event DraftExtrasUpdated(DraftExtras extras);

    // ---------- UNIFIED LEAGUE SETTINGS ----------
    enum WaiverType { Rolling, Reverse, FAAB }
    enum ClearanceDay { None, Tue, Wed, Thu }
    enum LeagueType { Redraft, Keeper, Dynasty }

    struct LeagueSettings {
        string leagueName;
        string leagueLogo;
        uint8  numberOfTeams;
        uint8  waiverType;
        uint64 waiverBudget;
        uint64 waiverMinBid;
        uint8  waiverClearance;
        uint8  waiversAfterDropDays;
        uint8  tradeReviewDays;
        uint8  tradeDeadlineWeek;
        uint8  leagueType;
        bool   extraGameVsMedian;
        bool   preventDropAfterKickoff;
        bool   lockAllMoves;
    }

    LeagueSettings private _settingsV2;

    // ---------- ROSTER SETTINGS ----------
    struct RosterSettings {
        uint8 qb; uint8 rb; uint8 wr; uint8 te;
        uint8 flexWRT; uint8 flexWR; uint8 flexWT; uint8 superFlexQWRT;
        uint8 idpFlex; uint8 k; uint8 dst; uint8 dl; uint8 lb; uint8 db;
        uint8 bench; uint8 ir; // IR NOT counted in cap
    }
    RosterSettings private _roster;

    // Derived draft cap (starters + bench, no IR)
    uint16 public rosterDraftCap;
    // Per-team drafted count (enforced at pick/auction win)
    mapping(address => uint16) public draftedCountByTeam;

    // ---------- Events ----------
    event TeamCreated(address indexed owner, string name, uint256 indexed index);
    event TeamRenamed(address indexed owner, string oldName, string newName);
    event LeagueJoined(address indexed player);

    event DraftSettingsUpdated(DraftConfig cfg, address[] manualOrder, bool draftPickTradingEnabled);
    event JoinPasswordSet(bytes32 hash);
    event BuyInReceived(address indexed payer, uint256 amount, address token);
    event WithdrawnNative(address indexed to, uint256 amount);
    event WithdrawnToken(address indexed to, uint256 amount);

    // Commissioner events
    event CommissionerTransferred(address indexed oldPrimary, address indexed newPrimary);
    event CommissionerGranted(address indexed who, address indexed by);
    event CommissionerRevoked(address indexed who, address indexed by);
    event PrimaryCommissionerChanged(address indexed oldPrimary, address indexed newPrimary);

    event TeamProfileUpdated(address indexed owner, string name, string logoURI, uint64 updatedAt);
    event LeagueSettingsUpdated(LeagueSettings s);
    event RosterSettingsUpdated(RosterSettings s, uint16 newDraftCap);

    // ---------- Modifiers ----------
    modifier onlyCommissioner() { require(isCommissioner[msg.sender], "Only commissioner"); _; }

    // ---------- Initializer guard (for clones) ----------
    bool private _initialized;
    modifier initializer() { require(!_initialized, "Already initialized"); _; _initialized = true; }

    // ---------- INITIALIZER ----------
    function initialize(
        address _commissioner,
        string memory _name,
        address _buyInToken,
        uint256 _buyInAmount,
        uint256 _teamCount
    ) external initializer {
        require(_commissioner != address(0), "Bad commissioner");
        require(bytes(_name).length > 0, "Name required");
        require(_teamCount > 0 && _teamCount <= 255, "Team count 1..255");

        commissioner = _commissioner;
        isCommissioner[_commissioner] = true;
        _commissionerCount = 1;

        name = _name;
        buyInToken = _buyInToken;
        buyInAmount = _buyInAmount;
        teamCap = _teamCount;
        createdAt = block.timestamp;

        // Create commissioner's team
        Team memory initialTeam = Team({owner: _commissioner, name: "Commissioner"});
        teams[_commissioner] = initialTeam;
        teamList.push(initialTeam);
        teamIndex[_commissioner] = 1;
        teamsFilled = 1;

        _profiles[_commissioner] = TeamProfile({name: "Commissioner", logoURI: "", updatedAt: uint64(block.timestamp)});

        // Defaults
        draftConfig = DraftConfig({draftType: DraftType.Snake, draftTimestamp: 0, orderMode: OrderMode.Random, draftCompleted: false});
        draftPickTradingEnabled = false;

        draftExtras = DraftExtras({timePerPickSeconds: 60, thirdRoundReversal: false, salaryCapBudget: 400, playerPool: uint8(PlayerPool.All)});

        _settingsV2 = LeagueSettings({
            leagueName: _name, leagueLogo: "", numberOfTeams: uint8(_teamCount),
            waiverType: uint8(WaiverType.Rolling), waiverBudget: 0, waiverMinBid: 0,
            waiverClearance: uint8(ClearanceDay.None), waiversAfterDropDays: 0, tradeReviewDays: 0,
            tradeDeadlineWeek: 0, leagueType: uint8(LeagueType.Redraft),
            extraGameVsMedian: false, preventDropAfterKickoff: true, lockAllMoves: false
        });

        _roster = RosterSettings({
            qb:1, rb:2, wr:2, te:1, flexWRT:1, flexWR:0, flexWT:0, superFlexQWRT:0,
            idpFlex:0, k:1, dst:1, dl:0, lb:0, db:0, bench:5, ir:1
        });

        rosterDraftCap = _computeDraftCap(_roster);
    }

    // ---------- Version ----------
    function version() external pure returns (uint16) { return 6; }

    // ---------- Commissioner management ----------
    function grantCommissioner(address who) external onlyCommissioner {
        require(teams[who].owner != address(0), "Not a member");
        require(!isCommissioner[who], "Already commissioner");
        isCommissioner[who] = true; _commissionerCount += 1;
        emit CommissionerGranted(who, msg.sender);
    }
    function revokeCommissioner(address who) external onlyCommissioner {
        require(isCommissioner[who], "Not a commissioner");
        require(_commissionerCount > 1, "Would remove last commissioner");
        isCommissioner[who] = false; _commissionerCount -= 1;
        emit CommissionerRevoked(who, msg.sender);
        if (who == commissioner && !isCommissioner[commissioner]) { /* UI can set new primary */ }
    }
    function setPrimaryCommissioner(address newPrimary) external onlyCommissioner {
        require(isCommissioner[newPrimary], "New primary not a commissioner");
        address old = commissioner; commissioner = newPrimary; emit PrimaryCommissionerChanged(old, newPrimary);
    }
    function transferCommissioner(address newCommissioner) external onlyCommissioner {
        require(isCommissioner[newCommissioner], "New primary not a commissioner");
        address old = commissioner; commissioner = newCommissioner; emit CommissionerTransferred(old, newCommissioner);
    }

    // ---------- Password / Signer ----------
    function setJoinPassword(bytes32 passwordHash) external onlyCommissioner { joinPasswordHash = passwordHash; emit JoinPasswordSet(passwordHash); }
    function clearJoinPassword() external onlyCommissioner { joinPasswordHash = bytes32(0); emit JoinPasswordSet(bytes32(0)); }
    function requiresPassword() external view returns (bool) { return joinPasswordHash != bytes32(0); }
    function _checkPassword(string calldata password) internal view {
        if (joinPasswordHash != bytes32(0)) require(keccak256(bytes(password)) == joinPasswordHash, "Bad password");
    }
    function setJoinSigner(address signer) external onlyCommissioner { joinSigner = signer; emit JoinSignerSet(signer); }

    // ---------- Escrow ----------
    function outstandingOf(address user) public view returns (uint256) {
        if (buyInAmount == 0) return 0;
        uint256 p = paid[user]; return p >= buyInAmount ? 0 : buyInAmount - p;
    }
    function _collectBuyIn(address payer, uint256 owed) internal {
        if (buyInToken == address(0)) {
            require(msg.value >= owed, "Insufficient native amount");
            if (owed > 0) { paid[payer] += owed; totalPaid += owed; emit BuyInReceived(payer, owed, address(0)); }
            uint256 extra = msg.value - owed; if (extra > 0) { (bool ok, ) = payable(payer).call{value: extra}(""); require(ok, "Refund failed"); }
        } else {
            require(msg.value == 0, "No native with ERC20 buy-in");
            if (owed > 0) { IERC20(buyInToken).safeTransferFrom(payer, address(this), owed); paid[payer] += owed; totalPaid += owed; emit BuyInReceived(payer, owed, buyInToken); }
        }
    }

    // ---------- Join/Create ----------
    function _createTeam(address owner, string memory teamName) internal returns (uint256 idx) {
        Team memory t = Team({owner: owner, name: teamName});
        teams[owner] = t; teamList.push(t); idx = teamList.length - 1; teamIndex[owner] = idx + 1; teamsFilled += 1;
        _profiles[owner] = TeamProfile({name: teamName, logoURI: "", updatedAt: uint64(block.timestamp)});
        emit TeamCreated(owner, teamName, idx); emit TeamProfileUpdated(owner, teamName, "", uint64(block.timestamp));
    }
    function joinLeague(string calldata _teamName, string calldata password) external payable nonReentrant {
        _checkPassword(password); require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists"); require(teamsFilled < teamCap, "League is full");
        uint256 owed = outstandingOf(msg.sender); _collectBuyIn(msg.sender, owed); _createTeam(msg.sender, _teamName); emit LeagueJoined(msg.sender);
    }
    function joinLeagueWithSig(string calldata _teamName, uint256 deadline, bytes calldata sig) external payable nonReentrant {
        require(_verifyJoinSig(msg.sender, _teamName, deadline, sig), "Bad join signature");
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists"); require(teamsFilled < teamCap, "League is full");
        uint256 owed = outstandingOf(msg.sender); _collectBuyIn(msg.sender, owed); _createTeam(msg.sender, _teamName); emit LeagueJoined(msg.sender);
    }
    function createTeam(string calldata _teamName, string calldata password) external {
        _checkPassword(password); require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists"); require(teamsFilled < teamCap, "League is full"); _createTeam(msg.sender, _teamName);
    }
    function createTeamWithSig(string calldata _teamName, uint256 deadline, bytes calldata sig) external {
        require(_verifyJoinSig(msg.sender, _teamName, deadline, sig), "Bad join signature");
        require(bytes(_teamName).length > 0, "Team name required");
        require(teams[msg.sender].owner == address(0), "Team already exists"); require(teamsFilled < teamCap, "League is full"); _createTeam(msg.sender, _teamName);
    }
    function payBuyIn() external payable nonReentrant { uint256 owed = outstandingOf(msg.sender); require(owed > 0, "Already paid"); _collectBuyIn(msg.sender, owed); }
    function hasPaid(address user) external view returns (bool) { return outstandingOf(user) == 0; }

    // ---------- Team profile ----------
    function setTeamName(string calldata newName) external {
        require(teams[msg.sender].owner != address(0), "Not a member"); require(bytes(newName).length > 0, "Empty name");
        string memory old = teams[msg.sender].name; teams[msg.sender].name = newName;
        uint256 idx1 = teamIndex[msg.sender]; if (idx1 > 0) teamList[idx1 - 1].name = newName;
        emit TeamRenamed(msg.sender, old, newName);
        TeamProfile storage p = _profiles[msg.sender]; p.name = newName; p.updatedAt = uint64(block.timestamp);
        emit TeamProfileUpdated(msg.sender, p.name, p.logoURI, p.updatedAt);
    }
    function setTeamProfile(string calldata newName, string calldata newLogoURI) external {
        require(teams[msg.sender].owner != address(0), "Not a member");
        TeamProfile storage p = _profiles[msg.sender];
        if (bytes(newName).length > 0) {
            string memory old = teams[msg.sender].name; teams[msg.sender].name = newName;
            uint256 idx1 = teamIndex[msg.sender]; if (idx1 > 0) teamList[idx1 - 1].name = newName;
            if (keccak256(bytes(old)) != keccak256(bytes(newName))) emit TeamRenamed(msg.sender, old, newName);
            p.name = newName;
        } else { p.name = ""; }
        if (bytes(newLogoURI).length > 0) { p.logoURI = newLogoURI; } else { p.logoURI = ""; }
        p.updatedAt = uint64(block.timestamp); emit TeamProfileUpdated(msg.sender, p.name, p.logoURI, p.updatedAt);
    }
    function adminSetTeamProfile(address owner, string calldata newName, string calldata newLogoURI) external onlyCommissioner {
        require(teams[owner].owner != address(0), "Not a member");
        TeamProfile storage p = _profiles[owner];
        if (bytes(newName).length > 0) {
            string memory old = teams[owner].name; teams[owner].name = newName;
            uint256 idx1 = teamIndex[owner]; if (idx1 > 0) teamList[idx1 - 1].name = newName;
            if (keccak256(bytes(old)) != keccak256(bytes(newName))) emit TeamRenamed(owner, old, newName);
            p.name = newName;
        } else { p.name = ""; }
        if (bytes(newLogoURI).length > 0) { p.logoURI = newLogoURI; } else { p.logoURI = ""; }
        p.updatedAt = uint64(block.timestamp); emit TeamProfileUpdated(owner, p.name, p.logoURI, p.updatedAt);
    }

    // ---------- Escrow withdrawals ----------
    function withdrawNative(address payable to, uint256 amount) external onlyCommissioner nonReentrant {
        require(buyInToken == address(0), "Not native pool"); require(to != address(0), "Zero address");
        require(amount <= address(this).balance, "Insufficient balance"); (bool ok, ) = to.call{value: amount}(""); require(ok, "Withdraw failed");
        emit WithdrawnNative(to, amount);
    }
    function withdrawToken(address to, uint256 amount) external onlyCommissioner nonReentrant {
        require(buyInToken != address(0), "Not ERC20 pool"); require(to != address(0), "Zero address");
        IERC20(buyInToken).safeTransfer(to, amount); emit WithdrawnToken(to, amount);
    }

    // ---------- Views ----------
    function getTeams() external view returns (Team[] memory) { return teamList; }
    function getTeamByAddress(address user) external view returns (string memory teamName) { return teams[user].name; }
    function getTeamProfile(address owner) external view returns (string memory, string memory, uint64) {
        TeamProfile storage p = _profiles[owner]; string memory nm = bytes(p.name).length > 0 ? p.name : teams[owner].name; return (nm, p.logoURI, p.updatedAt);
    }
    function isMember(address user) external view returns (bool) { return teams[user].owner != address(0); }
    function escrowBalances() external view returns (uint256 nativeBalance, uint256 tokenBalance) {
        nativeBalance = address(this).balance; if (buyInToken != address(0)) tokenBalance = IERC20(buyInToken).balanceOf(address(this));
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
                address a = _manualOrder[i]; if (a == address(0)) continue;
                require(teams[a].owner != address(0), "order addr not member"); require(!_seen[a], "order has duplicate");
                _seen[a] = true; manualDraftOrder.push(a);
            }
            for (uint256 j = 0; j < manualDraftOrder.length; j++) delete _seen[manualDraftOrder[j]];
        } else { delete manualDraftOrder; }

        draftConfig = DraftConfig({draftType: _draftType, draftTimestamp: _draftTimestamp, orderMode: _orderMode, draftCompleted: _draftCompleted});
        draftPickTradingEnabled = _draftPickTradingEnabled;
        emit DraftSettingsUpdated(draftConfig, manualDraftOrder, draftPickTradingEnabled);
    }
    function getDraftSettings() external view returns (DraftType, uint64, OrderMode, bool, address[] memory, bool) {
        return (draftConfig.draftType, draftConfig.draftTimestamp, draftConfig.orderMode, draftConfig.draftCompleted, manualDraftOrder, draftPickTradingEnabled);
    }

    // ---------- Draft extras ----------
    function setDraftExtras(uint32 _timePerPickSeconds, bool _thirdRoundReversal, uint32 _salaryCapBudget, uint8 _playerPool)
        external onlyCommissioner
    {
        require(_playerPool <= uint8(PlayerPool.Vets), "Bad playerPool");
        require(_timePerPickSeconds <= 86400, "tpp too large");
        draftExtras = DraftExtras({timePerPickSeconds:_timePerPickSeconds, thirdRoundReversal:_thirdRoundReversal, salaryCapBudget:_salaryCapBudget, playerPool:_playerPool});
        emit DraftExtrasUpdated(draftExtras);
    }
    function getDraftExtras() external view returns (DraftExtras memory) { return draftExtras; }

    /// Summary
    function getSummary() external view returns (string memory,address,uint256,uint256,uint256,bool,address) {
        return (name,buyInToken,buyInAmount,teamCap,teamsFilled,joinPasswordHash!=bytes32(0),commissioner);
    }

    // ---------- League settings ----------
    function getLeagueSettings() external view returns (LeagueSettings memory s) { s = _settingsV2; s.leagueName = name; s.numberOfTeams = uint8(teamCap); }
    function setLeagueSettings(LeagueSettings calldata s) external onlyCommissioner {
        require(bytes(s.leagueName).length > 0, "League name required");
        require(s.numberOfTeams > 0 && s.numberOfTeams <= 255, "Teams 1..255");
        require(uint256(s.numberOfTeams) >= teamsFilled, "Below current filled teams");
        require(s.waiversAfterDropDays <= 3, "waiversAfterDropDays 0..3");
        require(s.tradeReviewDays <= 3, "tradeReviewDays 0..3");
        if (s.tradeDeadlineWeek != 0) {
            require(s.tradeDeadlineWeek==9 || s.tradeDeadlineWeek==10 || s.tradeDeadlineWeek==11 || s.tradeDeadlineWeek==12 || s.tradeDeadlineWeek==13, "deadline 0 or 9..13");
        }
        require(s.waiverType <= uint8(WaiverType.FAAB), "Bad waiverType");
        require(s.waiverClearance <= uint8(ClearanceDay.Thu), "Bad clearance");
        require(s.leagueType <= uint8(LeagueType.Dynasty), "Bad leagueType");

        name = s.leagueName; teamCap = uint256(s.numberOfTeams);
        _settingsV2 = LeagueSettings({
            leagueName:s.leagueName, leagueLogo:s.leagueLogo, numberOfTeams:s.numberOfTeams,
            waiverType:s.waiverType, waiverBudget:s.waiverBudget, waiverMinBid:s.waiverMinBid,
            waiverClearance:s.waiverClearance, waiversAfterDropDays:s.waiversAfterDropDays,
            tradeReviewDays:s.tradeReviewDays, tradeDeadlineWeek:s.tradeDeadlineWeek, leagueType:s.leagueType,
            extraGameVsMedian:s.extraGameVsMedian, preventDropAfterKickoff:s.preventDropAfterKickoff, lockAllMoves:s.lockAllMoves
        });
        emit LeagueSettingsUpdated(_settingsV2);
    }

    // ---------- Roster settings ----------
    function getRosterSettings() external view returns (RosterSettings memory s) { s = _roster; }
    function rosterCap() external view returns (uint16) { return rosterDraftCap; }
    function setRosterSettings(RosterSettings calldata s) external onlyCommissioner {
        require(s.qb<=10 && s.rb<=10 && s.wr<=10 && s.te<=10, "pos 0..10");
        require(s.flexWRT<=10 && s.flexWR<=10 && s.flexWT<=10 && s.superFlexQWRT<=10, "flex 0..10");
        require(s.idpFlex<=10 && s.k<=10 && s.dst<=10, "misc 0..10");
        require(s.dl<=10 && s.lb<=10 && s.db<=10, "idp 0..10");
        require(s.bench<=50 && s.ir<=25, "bench/ir bound");
        uint16 newCap = _computeDraftCap(s);
        for (uint256 i=0;i<teamList.length;i++){ address owner=teamList[i].owner; require(draftedCountByTeam[owner] <= newCap, "Cap below existing drafted count"); }
        _roster = s; rosterDraftCap = newCap; emit RosterSettingsUpdated(_roster, newCap);
    }
    function _computeDraftCap(RosterSettings memory s) internal pure returns (uint16) {
        uint256 starters = uint256(s.qb)+s.rb+s.wr+s.te + s.flexWRT+s.flexWR+s.flexWT+s.superFlexQWRT + s.idpFlex+s.k+s.dst+s.dl+s.lb+s.db;
        uint256 cap = starters + s.bench; require(cap <= type(uint16).max, "Cap overflow"); return uint16(cap);
    }

    // ---------- Internal temp map for manual order duplicate checks ----------
    mapping(address => bool) private _seen;

    // =========================================================
    // ============== Snake Draft Runtime (v3/v5) ==============
    // =========================================================

    struct Pick { uint16 round; uint16 index; address drafter; uint32 playerId; uint32 pricePaid; uint64 pickedAt; }
    Pick[] public picks;
    mapping(uint32 => bool) public playerTaken;

    uint16 public currentRound;           // 1-based; 0 means "not started"
    uint16 public currentIndex;           // 0-based within round
    uint64 public currentPickStartedAt;   // snake timer start
    bool   public draftPaused;

    uint16 public totalRounds; // 0 = unbounded (snake)
    address public draftOperator;

    event DraftOperatorSet(address indexed operator);
    event DraftPaused(bool paused);
    event PickSubmitted(uint16 indexed round, uint16 indexed index, address indexed drafter, uint32 playerId, uint32 pricePaid, uint64 pickedAt);

    // Snake autopick queues (unchanged; disabled during SalaryCap)
    mapping(address => uint32[]) private _teamQueue;
    mapping(address => uint256)  private _teamQueuePtr;
    uint32[] private _globalRank;
    uint256  private _globalRankPtr;
    event TeamQueueSet(address indexed owner, uint256 length);
    event GlobalRankSet(uint256 length);
    event AutoPicked(uint16 indexed round, uint16 indexed index, address indexed drafter, uint32 playerId, uint64 pickedAt, bool fromTeamQueue);

    // ---- Admin/runtime controls ----
    function setDraftOperator(address op) external onlyCommissioner { draftOperator = op; emit DraftOperatorSet(op); }
    function pauseDraft() external onlyCommissioner { require(!draftPaused, "Already paused"); draftPaused = true; emit DraftPaused(true); }
    function resumeDraft() external onlyCommissioner { require(draftPaused, "Not paused"); draftPaused = false; _resetActiveTimer(); emit DraftPaused(false); }
    function setTotalRounds(uint16 rounds) external onlyCommissioner { require(rounds <= 1000, "rounds too large"); totalRounds = rounds; }

    // ---- Order helpers (shared) ----
    function _round1() internal view returns (address[] memory) {
        if (draftConfig.orderMode == OrderMode.Manual && manualDraftOrder.length > 0) return manualDraftOrder;
        uint256 n = teamList.length; address[] memory r = new address[](n);
        for (uint256 i=0;i<n;i++) r[i] = teamList[i].owner; return r;
    }
    function _orderForRound(uint16 roundNum) internal view returns (address[] memory) {
        address[] memory r1 = _round1(); uint256 n = r1.length; address[] memory out = new address[](n);
        bool reverse = (roundNum % 2 == 0); if (draftExtras.thirdRoundReversal && roundNum == 3) reverse = true;
        if (!reverse) { for (uint256 i=0;i<n;i++) out[i]=r1[i]; } else { for (uint256 i=0;i<n;i++) out[i]=r1[n-1-i]; }
        return out;
    }
    function currentDrafter() public view returns (address) {
        if (draftConfig.draftCompleted) return address(0);
        if (draftConfig.draftType == DraftType.SalaryCap) return _currentNominator();
        uint16 r = currentRound == 0 ? 1 : currentRound; uint256 idx = currentRound == 0 ? 0 : uint256(currentIndex);
        address[] memory ord = _orderForRound(r); if (ord.length == 0 || idx >= ord.length) return address(0); return ord[idx];
    }

    // ---- Snake Boot ----
    function startDraftIfNeeded() external {
        require(!draftConfig.draftCompleted, "Draft completed");
        if (draftConfig.draftType == DraftType.SalaryCap) {
            _startAuctionIfNeeded(); // dispatch to auction start
            return;
        }
        if (currentRound == 0) {
            require(teamList.length > 0, "No teams");
            if (draftConfig.draftTimestamp != 0) require(block.timestamp >= draftConfig.draftTimestamp, "Too early");
            currentRound = 1; currentIndex = 0; currentPickStartedAt = uint64(block.timestamp);
        }
    }

    // ---- Snake Submit/Autopick (no-op in SalaryCap mode) ----
    function submitPick(uint32 playerId, uint32 pricePaid) external nonReentrant {
        require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        _submitPickFrom(msg.sender, playerId, pricePaid);
    }
    function _submitPickFrom(address actor, uint32 playerId, uint32 pricePaid) internal {
        require(!draftConfig.draftCompleted, "Draft completed");
        require(!draftPaused, "Draft paused");
        require(playerId != 0 && !playerTaken[playerId], "Bad/taken player");

        address onClock = currentDrafter(); require(onClock != address(0), "No drafter");
        bool isDrafter = (actor == onClock); bool isCommish = isCommissioner[actor];
        bool isOperator = (draftOperator != address(0) && actor == draftOperator);
        require(isDrafter || isCommish || isOperator, "Not authorized");
        require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        require(pricePaid == 0, "Price only in SalaryCap"); // snake picks must be 0
        require(draftedCountByTeam[onClock] < rosterDraftCap, "Roster cap reached");

        _recordPickAndAdvance_Snake(onClock, playerId, 0, false);
    }
    function _recordPickAndAdvance_Snake(address drafter, uint32 playerId, uint32 pricePaid, bool isAuto) internal {
        uint16 madeRound = currentRound == 0 ? 1 : currentRound;
        uint16 madeIndex = currentRound == 0 ? 0 : currentIndex;

        picks.push(Pick({round:madeRound,index:madeIndex,drafter:drafter,playerId:playerId,pricePaid:pricePaid,pickedAt:uint64(block.timestamp)}));
        playerTaken[playerId] = true; draftedCountByTeam[drafter] += 1;

        if (isAuto) emit AutoPicked(madeRound, madeIndex, drafter, playerId, uint64(block.timestamp), true);
        else emit PickSubmitted(madeRound, madeIndex, drafter, playerId, pricePaid, uint64(block.timestamp));

        address[] memory ord = _orderForRound(madeRound);
        if (madeIndex + 1 < ord.length) { currentRound = madeRound; currentIndex = madeIndex + 1; }
        else { currentRound = madeRound + 1; currentIndex = 0; }

        currentPickStartedAt = uint64(block.timestamp);

        if (totalRounds != 0) {
            uint256 totalSlots = uint256(totalRounds) * _round1().length;
            if (picks.length >= totalSlots) draftConfig.draftCompleted = true;
        }
    }

    // Timer helpers (snake)
    function secondsSincePickStart() public view returns (uint256) { if (currentPickStartedAt == 0) return 0; return block.timestamp - uint256(currentPickStartedAt); }
    function isPickExpired() public view returns (bool) {
        if (draftConfig.draftType == DraftType.SalaryCap) return false;
        uint32 tpp = draftExtras.timePerPickSeconds; if (tpp == 0) return false; return secondsSincePickStart() >= tpp;
    }

    // Snake queues mgmt (disabled in SalaryCap)
    function setMyQueue(uint32[] calldata ids) external { require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        require(teams[msg.sender].owner != address(0), "Not a member");
        delete _teamQueue[msg.sender]; for (uint256 i=0;i<ids.length;i++) _teamQueue[msg.sender].push(ids[i]); _teamQueuePtr[msg.sender] = 0; emit TeamQueueSet(msg.sender, ids.length);
    }
    function adminSetTeamQueue(address owner, uint32[] calldata ids) external {
        require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        require(isCommissioner[msg.sender] || msg.sender == draftOperator, "Not allowed");
        require(teams[owner].owner != address(0), "Not a member");
        delete _teamQueue[owner]; for (uint256 i=0;i<ids.length;i++) _teamQueue[owner].push(ids[i]); _teamQueuePtr[owner] = 0; emit TeamQueueSet(owner, ids.length);
    }
    function setGlobalRank(uint32[] calldata ids) external {
        require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        require(isCommissioner[msg.sender] || msg.sender == draftOperator, "Not allowed");
        delete _globalRank; for (uint256 i=0;i<ids.length;i++) _globalRank.push(ids[i]); _globalRankPtr = 0; emit GlobalRankSet(ids.length);
    }
    function getMyQueue(address owner) external view returns (uint32[] memory list, uint256 nextIndex) { return (_teamQueue[owner], _teamQueuePtr[owner]); }
    function getGlobalRank() external view returns (uint32[] memory list, uint256 nextIndex) { return (_globalRank, _globalRankPtr); }

    function autopickIfExpired() external nonReentrant {
        require(draftConfig.draftType != DraftType.SalaryCap, "Auction mode");
        require(!draftConfig.draftCompleted && !draftPaused && isPickExpired(), "Not allowed");
        address onClock = currentDrafter(); require(onClock != address(0), "No drafter");
        require(draftedCountByTeam[onClock] < rosterDraftCap, "Roster cap reached");
        (bool found, uint32 pid) = _nextAvailableFromQueue(onClock); bool fromTeam = true;
        if (!found) { (found, pid) = _nextAvailableFromGlobal(); fromTeam = false; }
        require(found, "No autopick candidate");
        _recordPickAndAdvance_Snake(onClock, pid, 0, true);
    }
    function _nextAvailableFromQueue(address owner) internal returns (bool ok, uint32 pid) {
        uint32[] storage q = _teamQueue[owner]; uint256 p = _teamQueuePtr[owner]; uint256 n = q.length;
        while (p < n) { uint32 cand = q[p]; p++; if (cand != 0 && !playerTaken[cand]) { _teamQueuePtr[owner] = p; return (true, cand); } }
        _teamQueuePtr[owner] = p; return (false, 0);
    }
    function _nextAvailableFromGlobal() internal returns (bool ok, uint32 pid) {
        uint256 p = _globalRankPtr; uint256 n = _globalRank.length;
        while (p < n) { uint32 cand = _globalRank[p]; p++; if (cand != 0 && !playerTaken[cand]) { _globalRankPtr = p; return (true, cand); } }
        _globalRankPtr = p; return (false, 0);
    }

    // =========================================================
    // ======== SALARY CAP AUCTION (Nominate/Bid/Win) ==========
    // =========================================================

    // Constants for UX (seconds)
    uint32 private constant NOMINATION_SECONDS = 30;
    uint32 private constant BID_SECONDS = 15;

    enum AuctionPhase { Idle, Nomination, Bidding }
    AuctionPhase public auctionPhase;

    // Per-team budgets (remaining)
    mapping(address => uint256) public budgetRemaining;

    // Auction pointers
    uint16 public auctionRound;    // 1-based nomination cycles
    uint16 public auctionIndex;    // 0-based within cycle (nominator)
    uint64 public phaseEndsAt;     // timestamp when current phase ends

    // Current lot
    uint32 public currentPlayerId;        // 0 means no active lot
    uint32 public currentBid;             // highest bid so far
    address public currentBidder;         // highest bidder
    address public currentNominator;      // whose turn to nominate

    event AuctionStarted(uint32 budgetPerTeam);
    event NominationStarted(address indexed nominator, uint64 endsAt);
    event PlayerNominated(address indexed nominator, uint32 indexed playerId, uint32 openingBid, uint64 bidEndsAt);
    event BidPlaced(address indexed bidder, uint32 amount, uint64 bidEndsAt);
    event AuctionWon(uint32 indexed playerId, address indexed winner, uint32 amount, uint16 round, uint16 index, uint64 at);
    event NominationSkipped(address indexed nominator, uint16 round, uint16 index);

    // Boot (also called by startDraftIfNeeded if SalaryCap)
    function _startAuctionIfNeeded() internal {
        require(draftConfig.draftType == DraftType.SalaryCap, "Not auction mode");
        if (auctionPhase != AuctionPhase.Idle) return; // already started
        require(teamList.length > 0, "No teams");
        if (draftConfig.draftTimestamp != 0) require(block.timestamp >= draftConfig.draftTimestamp, "Too early");

        // Init budgets
        uint32 budget = draftExtras.salaryCapBudget;
        for (uint256 i=0;i<teamList.length;i++) budgetRemaining[teamList[i].owner] = budget;
        emit AuctionStarted(budget);

        // Init pointers
        auctionRound = 1; auctionIndex = 0;
        _beginNomination();
    }

    function beginAuctionNow() external onlyCommissioner { _startAuctionIfNeeded(); }

    // --- Phase helpers ---
    function _beginNomination() internal {
        require(!draftConfig.draftCompleted, "Draft completed");
        auctionPhase = AuctionPhase.Nomination;
        currentPlayerId = 0; currentBid = 0; currentBidder = address(0);

        address[] memory ord = _orderForRound(auctionRound);
        require(auctionIndex < ord.length, "Index OOB");
        currentNominator = ord[auctionIndex];

        phaseEndsAt = uint64(block.timestamp + NOMINATION_SECONDS);
        emit NominationStarted(currentNominator, phaseEndsAt);
    }

    function _beginBidding(uint32 playerId, uint32 openingBid) internal {
        auctionPhase = AuctionPhase.Bidding;
        currentPlayerId = playerId;
        currentBid = openingBid;
        currentBidder = currentNominator; // nominator holds high bid initially
        phaseEndsAt = uint64(block.timestamp + BID_SECONDS);
        emit PlayerNominated(currentNominator, playerId, openingBid, phaseEndsAt);
    }

    function _advanceNominator() internal {
        address[] memory ord = _orderForRound(auctionRound);
        if (auctionIndex + 1 < ord.length) { auctionIndex += 1; }
        else { auctionRound += 1; auctionIndex = 0; }
        _beginNomination();
    }

    function _resetActiveTimer() internal {
        if (draftConfig.draftType == DraftType.SalaryCap) {
            // Resume resets timer for clarity
            if (auctionPhase == AuctionPhase.Nomination) phaseEndsAt = uint64(block.timestamp + NOMINATION_SECONDS);
            else if (auctionPhase == AuctionPhase.Bidding) phaseEndsAt = uint64(block.timestamp + BID_SECONDS);
        } else {
            currentPickStartedAt = uint64(block.timestamp);
        }
    }

    // --- Public views for UI ---
    function getAuctionState()
        external
        view
        returns (
            AuctionPhase phase,
            uint16 round_, uint16 index_,
            address nominator,
            uint64 phaseEndsAt_,
            uint32 playerId, uint32 bid, address bidder
        )
    {
        phase = auctionPhase; round_ = auctionRound; index_ = auctionIndex;
        nominator = currentNominator; phaseEndsAt_ = phaseEndsAt;
        playerId = currentPlayerId; bid = currentBid; bidder = currentBidder;
    }

    // --- Rules helpers ---
    function _remainingSlotsAfterWin(address team) internal view returns (uint16) {
        uint16 drafted = draftedCountByTeam[team];
        if (drafted >= rosterDraftCap) return 0;
        // after winning, drafted becomes +1
        uint16 after = rosterDraftCap - (drafted + 1);
        return after;
    }
    function maxBidAllowed(address team) public view returns (uint256) {
        if (draftConfig.draftType != DraftType.SalaryCap) return 0;
        uint256 budget = budgetRemaining[team];
        uint16 reserveSlots = _remainingSlotsAfterWin(team); // $1 per remaining slot after this win
        if (budget <= reserveSlots) return 0;
        return budget - reserveSlots;
    }
    function _assertBidWithinBudgetRule(address team, uint32 amount) internal view {
        require(draftedCountByTeam[team] < rosterDraftCap, "Roster cap reached");
        uint256 maxBid = maxBidAllowed(team);
        require(amount >= 1 && amount <= maxBid, "Bid violates $1-per-slot rule");
    }

    // --- Nomination ---
    function nominate(uint32 playerId, uint32 openingBid) external nonReentrant {
        require(draftConfig.draftType == DraftType.SalaryCap, "Not auction mode");
        require(!draftConfig.draftCompleted && !draftPaused, "Draft paused/completed");
        require(auctionPhase == AuctionPhase.Nomination, "Not nomination phase");
        require(msg.sender == currentNominator, "Not your nomination");
        require(playerId != 0 && !playerTaken[playerId], "Bad/taken player");

        _assertBidWithinBudgetRule(msg.sender, openingBid);
        _beginBidding(playerId, openingBid);
    }

    // --- Bidding ---
    function placeBid(uint32 amount) external nonReentrant {
        require(draftConfig.draftType == DraftType.SalaryCap, "Not auction mode");
        require(!draftConfig.draftCompleted && !draftPaused, "Draft paused/completed");
        require(auctionPhase == AuctionPhase.Bidding, "Not bidding phase");
        require(playerTaken[currentPlayerId] == false, "Player taken");
        require(amount > currentBid, "Bid too low");

        _assertBidWithinBudgetRule(msg.sender, amount);

        currentBid = amount;
        currentBidder = msg.sender;
        phaseEndsAt = uint64(block.timestamp + BID_SECONDS); // reset timer on every bid
        emit BidPlaced(msg.sender, amount, phaseEndsAt);
    }

    // --- Timeouts ---
    function skipNominationIfExpired() external {
        require(draftConfig.draftType == DraftType.SalaryCap, "Not auction mode");
        require(!draftConfig.draftCompleted && !draftPaused, "Draft paused/completed");
        require(auctionPhase == AuctionPhase.Nomination, "Not nomination phase");
        require(block.timestamp >= phaseEndsAt, "Nomination not expired");
        emit NominationSkipped(currentNominator, auctionRound, auctionIndex);
        _advanceNominator();
    }

    function finalizeBidIfExpired() external nonReentrant {
        require(draftConfig.draftType == DraftType.SalaryCap, "Not auction mode");
        require(!draftConfig.draftCompleted && !draftPaused, "Draft paused/completed");
        require(auctionPhase == AuctionPhase.Bidding, "Not bidding phase");
        require(block.timestamp >= phaseEndsAt, "Bid not expired");

        // Award
        address winner = currentBidder;
        uint32 price = currentBid;
        require(winner != address(0), "No bids");

        // Final budget check (defensive)
        _assertBidWithinBudgetRule(winner, price);

        // Record pick
        uint16 madeRound = auctionRound;
        uint16 madeIndex = auctionIndex;

        picks.push(Pick({
            round: madeRound,
            index: madeIndex,
            drafter: winner,
            playerId: currentPlayerId,
            pricePaid: price,
            pickedAt: uint64(block.timestamp)
        }));
        playerTaken[currentPlayerId] = true;
        draftedCountByTeam[winner] += 1;

        // Debit budget
        uint256 b = budgetRemaining[winner];
        unchecked { budgetRemaining[winner] = b - price; }

        emit AuctionWon(currentPlayerId, winner, price, madeRound, madeIndex, uint64(block.timestamp));

        // Clear lot & move to next nominator
        currentPlayerId = 0; currentBid = 0; currentBidder = address(0);
        _advanceNominator();

        // Optional: auto-complete when all teams hit cap (or custom stop condition)
        if (_allTeamsAtCap()) draftConfig.draftCompleted = true;
    }

    function _allTeamsAtCap() internal view returns (bool) {
        for (uint256 i=0;i<teamList.length;i++) {
            if (draftedCountByTeam[teamList[i].owner] < rosterDraftCap) return false;
        }
        return true;
    }

    // ---- Views / hydration ----
    function getDraftState()
        external
        view
        returns (bool paused, uint16 round_, uint16 index_, address onClock, uint64 startedOrEndsAt, uint32 timePerPick, uint16 totalRounds_, uint16 rosterCap_)
    {
        paused = draftPaused;
        if (draftConfig.draftType == DraftType.SalaryCap) {
            round_ = auctionRound; index_ = auctionIndex; onClock = currentNominator;
            startedOrEndsAt = phaseEndsAt; timePerPick = BID_SECONDS; // for UI; nomination timer is NOMINATION_SECONDS
        } else {
            round_ = currentRound; index_ = currentIndex; onClock = currentDrafter();
            startedOrEndsAt = currentPickStartedAt; timePerPick = draftExtras.timePerPickSeconds;
        }
        totalRounds_ = totalRounds; rosterCap_ = rosterDraftCap;
    }

    // =========================================================
    // ================== END v6 ADDITIONS =====================
    // =========================================================

    receive() external payable {}
}
