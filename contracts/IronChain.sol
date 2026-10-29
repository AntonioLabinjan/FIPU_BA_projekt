// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IronChain - nepromjenjivi gym dnevnik s PR detekcijom, streakom i spotter potvrdama
contract IronChain {
    struct Lift {
        string exercise;      // npr. "bench press" (frontend normalizira u lowercase)
        uint32 weight10;      // kg * 10 (82.5 kg => 825)
        uint16 reps;
        uint64 timestamp;
        uint32 est1RM10;      // procijenjeni 1RM * 10 (Epley)
        bool isPR;            // je li rekord za tu vježbu u trenutku upisa
        uint32 attestations;  // broj spottera koji su potvrdili lift
    }

    struct Stats {
        uint32 currentStreak;
        uint32 longestStreak;
        uint32 totalLifts;
        uint32 totalPRs;
        uint64 lastDay; // dan (UTC) zadnjeg treninga
    }

    mapping(address => Lift[]) private _lifts;
    mapping(address => Stats) private _stats;
    mapping(address => mapping(bytes32 => uint32)) private _best1RM;
    mapping(address => mapping(uint256 => mapping(address => bool))) private _attested;

    event LiftLogged(address indexed lifter, uint256 indexed index, string exercise, uint32 weight10, uint16 reps, bool isPR);
    event LiftAttested(address indexed lifter, uint256 indexed index, address indexed spotter);

    function logLift(string calldata exercise, uint32 weight10, uint16 reps) external {
        require(bytes(exercise).length > 0 && bytes(exercise).length <= 32, "Exercise name 1-32 bytes");
        require(weight10 > 0 && weight10 <= 10000, "Weight out of range");
        require(reps > 0 && reps <= 100, "Reps out of range");

        // Epley: 1RM = w * (1 + reps/30)
        uint32 est = reps == 1 ? weight10 : uint32((uint256(weight10) * (30 + reps)) / 30);

        bytes32 key = keccak256(bytes(exercise));
        bool isPR = est > _best1RM[msg.sender][key];
        Stats storage s = _stats[msg.sender];

        if (isPR) {
            _best1RM[msg.sender][key] = est;
            s.totalPRs++;
        }

        // streak (UTC dani)
        uint64 today = uint64(block.timestamp / 1 days);
        if (s.lastDay == 0 || today > s.lastDay + 1) {
            s.currentStreak = 1;
        } else if (today == s.lastDay + 1) {
            s.currentStreak++;
        }
        s.lastDay = today;
        if (s.currentStreak > s.longestStreak) s.longestStreak = s.currentStreak;
        s.totalLifts++;

        _lifts[msg.sender].push(Lift(exercise, weight10, reps, uint64(block.timestamp), est, isPR, 0));
        emit LiftLogged(msg.sender, _lifts[msg.sender].length - 1, exercise, weight10, reps, isPR);
    }

    /// Spotter potvrđuje tuđi lift (jednom po adresi, ne vlastiti).
    function attest(address lifter, uint256 index) external {
        require(msg.sender != lifter, "Cannot attest own lift");
        require(index < _lifts[lifter].length, "No such lift");
        require(!_attested[lifter][index][msg.sender], "Already attested");

        _attested[lifter][index][msg.sender] = true;
        _lifts[lifter][index].attestations++;
        emit LiftAttested(lifter, index, msg.sender);
    }

    function getLifts(address lifter) external view returns (Lift[] memory) {
        return _lifts[lifter];
    }

    function getStats(address lifter) external view returns (Stats memory) {
        return _stats[lifter];
    }

    function hasAttested(address lifter, uint256 index, address spotter) external view returns (bool) {
        return _attested[lifter][index][spotter];
    }
}
