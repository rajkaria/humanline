// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ASCBase} from "@gluwa/asc-contracts/contracts/readability/ASCBase.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {WorldIDBridge} from "worldid/WorldIDBridge.sol";
contract Smoke is ASCBase { function _processAndEmitEvent(uint8, bytes32, bytes memory) internal override {} }
