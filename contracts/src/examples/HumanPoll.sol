// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {HumanGated} from "../sdk/HumanGated.sol";

/// @title HumanPoll
/// @notice One person, one vote. Any verified human can open a poll; every verified human gets exactly
///         one ballot per poll, however many wallets they own or move through.
/// @dev A consumer app on the Humanline registry, built only on `HumanGated` from `@humanline/sdk`.
///      Ballots are public and final: this is a sybil-resistance demo, not a secret ballot.
contract HumanPoll is HumanGated {
    uint256 public constant MAX_OPTIONS = 8;
    uint256 public constant MAX_QUESTION_BYTES = 280;
    uint256 public constant MAX_OPTION_BYTES = 64;
    uint64 public constant MIN_DURATION = 10 minutes;
    uint64 public constant MAX_DURATION = 90 days;

    struct Poll {
        address creator;
        uint256 creatorHuman;
        uint64 closesAt;
        string question;
        string[] options;
        uint256[] tally;
        uint256 voters;
    }

    Poll[] private _polls;

    /// @notice `option + 1` for a human's ballot in a poll, 0 when they have not voted.
    mapping(uint256 pollId => mapping(uint256 human => uint256)) public ballotOf;

    event PollCreated(uint256 indexed pollId, uint256 indexed creatorHuman, address creator, string question, string[] options, uint64 closesAt);
    event Voted(uint256 indexed pollId, uint256 indexed human, address wallet, uint256 option);

    error BadPoll();
    error UnknownPoll(uint256 pollId);
    error PollClosed(uint256 pollId, uint64 closedAt);
    error UnknownOption(uint256 option, uint256 optionCount);
    error AlreadyVoted(uint256 pollId, uint256 human);

    constructor(address registry) HumanGated(registry) {}

    /// @notice Open a poll that closes `duration` seconds from now.
    function createPoll(string calldata question, string[] calldata options, uint64 duration)
        external
        returns (uint256 pollId)
    {
        uint256 human = _requireHuman(msg.sender);
        uint256 n = options.length;
        bytes memory q = bytes(question);
        if (q.length == 0 || q.length > MAX_QUESTION_BYTES) revert BadPoll();
        if (n < 2 || n > MAX_OPTIONS) revert BadPoll();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadPoll();
        for (uint256 i; i < n; ++i) {
            uint256 len = bytes(options[i]).length;
            if (len == 0 || len > MAX_OPTION_BYTES) revert BadPoll();
        }

        pollId = _polls.length;
        Poll storage p = _polls.push();
        p.creator = msg.sender;
        p.creatorHuman = human;
        p.closesAt = uint64(block.timestamp) + duration;
        p.question = question;
        p.options = options;
        p.tally = new uint256[](n);

        emit PollCreated(pollId, human, msg.sender, question, options, p.closesAt);
    }

    /// @notice Cast this human's one ballot.
    function vote(uint256 pollId, uint256 option) external {
        if (pollId >= _polls.length) revert UnknownPoll(pollId);
        Poll storage p = _polls[pollId];
        if (block.timestamp >= p.closesAt) revert PollClosed(pollId, p.closesAt);
        if (option >= p.options.length) revert UnknownOption(option, p.options.length);
        uint256 human = _requireHuman(msg.sender);
        if (ballotOf[pollId][human] != 0) revert AlreadyVoted(pollId, human);

        ballotOf[pollId][human] = option + 1;
        p.tally[option] += 1;
        p.voters += 1;
        emit Voted(pollId, human, msg.sender, option);
    }

    function pollCount() external view returns (uint256) {
        return _polls.length;
    }

    /// @notice Everything about one poll, tally included.
    function getPoll(uint256 pollId)
        external
        view
        returns (
            address creator,
            uint256 creatorHuman,
            uint64 closesAt,
            string memory question,
            string[] memory options,
            uint256[] memory tally,
            uint256 voters
        )
    {
        if (pollId >= _polls.length) revert UnknownPoll(pollId);
        Poll storage p = _polls[pollId];
        return (p.creator, p.creatorHuman, p.closesAt, p.question, p.options, p.tally, p.voters);
    }
}
