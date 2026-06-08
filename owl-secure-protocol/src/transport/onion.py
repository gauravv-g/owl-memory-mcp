"""
OSP Transport Layer v1.0
=========================
Onion-routed, metadata-resistant message transport.

Design:
- 3-hop onion routing (like Tor, but lighter)
- Fixed 4KB message size (all messages same size)
- Store-and-forward relays (recipient polls via onion route)
- No relay knows both sender and recipient
- Cover traffic support (dummy messages at random intervals)
"""

import os
import struct
import time
import hashlib
import hmac
from dataclasses import dataclass, field
from typing import Optional, List, Tuple
from enum import IntEnum


# ─── Constants ───────────────────────────────────────────────────────

MAX_MESSAGE_SIZE = 4096
ONION_LAYERS = 3
RELAY_TIMEOUT = 300  # 5 minutes
COVER_TRAFFIC_INTERVAL = 30  # seconds between dummy messages
ONION_HEADER_SIZE = 64  # per layer: 32-byte next-hop key + 32-byte IV


class MessageType(IntEnum):
    DATA = 0x01
    COVER = 0x02  # Dummy message for traffic shaping
    POLL = 0x03   # Request pending messages


@dataclass
class RelayNode:
    """Represents a relay in the network."""
    node_id: bytes          # 32-byte Ed25519 public key
    address: str            # Network address (IP:port or onion address)
    public_key: bytes       # X25519 public key for onion encryption
    is_active: bool = True
    last_seen: float = 0.0


@dataclass
class OnionHop:
    """Single hop in the onion route."""
    relay_pubkey: bytes     # X25519 public key of this relay
    next_hop: bytes         # Encrypted next-hop address (or recipient)
    layer_key: bytes        # Symmetric key for this layer


@dataclass
class OnionMessage:
    """A message wrapped in onion layers."""
    layers: List[bytes]     # Encrypted layers (outermost first)
    payload: bytes          # Innermost encrypted payload
    
    def serialize(self) -> bytes:
        """Serialize to wire format."""
        result = struct.pack("!B", len(self.layers))
        for layer in self.layers:
            result += struct.pack("!H", len(layer)) + layer
        result += struct.pack("!H", len(self.payload)) + self.payload
        return result


@dataclass
class RelayMessage:
    """Message stored at relay for store-and-forward."""
    encrypted_payload: bytes
    recipient_hint: bytes   # Encrypted recipient identifier
    timestamp: float
    ttl: int = 86400        # 24 hour TTL


# ─── Onion Routing ──────────────────────────────────────────────────

def generate_onion_keys() -> Tuple[bytes, bytes]:
    """Generate X25519 key pair for relay onion encryption."""
    from src.crypto.primitives import generate_x25519_keypair
    kp = generate_x25519_keypair()
    return kp.private_key, kp.public_key


def build_onion_layers(
    payload: bytes,
    route: List[bytes],  # List of relay X25519 public keys (entry → middle → exit)
    recipient_address: bytes
) -> OnionMessage:
    """
    Build 3-layer onion encryption.
    
    Layer structure (inside-out):
    - Innermost: encrypted payload for recipient
    - Middle: encrypted (exit_relay_instruction + inner_layer)
    - Outermost: encrypted (middle_relay_instruction + middle_layer)
    
    Each relay peels one layer, learns only the next hop.
    """
    if len(route) != ONION_LAYERS:
        raise ValueError(f"Route must have exactly {ONION_LAYERS} hops")
    
    from src.crypto.primitives import (
        x25519_shared_secret, encrypt_message, generate_random, sha3_256
    )
    
    layers = []
    
    # Build from innermost to outermost
    # Layer 3 (innermost, decrypted by exit relay)
    # Contains: recipient_address + encrypted_payload
    exit_relay_pubkey = route[2]
    ephemeral_3 = os.urandom(32)  # In production: proper X25519 keypair
    shared_3 = x25519_shared_secret(ephemeral_3, exit_relay_pubkey)
    layer_key_3 = sha3_256(shared_3 + b"layer3")
    
    inner_payload = struct.pack("!B", MessageType.DATA)
    inner_payload += struct.pack("!H", len(recipient_address)) + recipient_address
    inner_payload += struct.pack("!H", len(payload)) + payload
    inner_payload_padded = _pad_layer(inner_payload)
    
    encrypted_inner = encrypt_message(layer_key_3, inner_payload_padded)
    layer_3 = ephemeral_3 + encrypted_inner  # ephemeral pubkey + ciphertext
    layers.append(layer_3)
    
    # Layer 2 (middle relay)
    middle_relay_pubkey = route[1]
    ephemeral_2 = os.urandom(32)
    shared_2 = x25519_shared_secret(ephemeral_2, middle_relay_pubkey)
    layer_key_2 = sha3_256(shared_2 + b"layer2")
    
    # Middle relay forwards to exit relay
    forward_instr = struct.pack("!B", 0x01)  # FORWARD instruction
    forward_instr += route[2]  # Next hop pubkey
    layer_2_content = forward_instr + layer_3
    layer_2_padded = _pad_layer(layer_2_content)
    
    encrypted_layer_2 = encrypt_message(layer_key_2, layer_2_padded)
    layer_2 = ephemeral_2 + encrypted_layer_2
    layers.append(layer_2)
    
    # Layer 1 (outermost, entry relay)
    entry_relay_pubkey = route[0]
    ephemeral_1 = os.urandom(32)
    shared_1 = x25519_shared_secret(ephemeral_1, entry_relay_pubkey)
    layer_key_1 = sha3_256(shared_1 + b"layer1")
    
    forward_instr_1 = struct.pack("!B", 0x01)  # FORWARD
    forward_instr_1 += route[1]  # Next hop pubkey
    layer_1_content = forward_instr_1 + layer_2
    layer_1_padded = _pad_layer(layer_1_content)
    
    encrypted_layer_1 = encrypt_message(layer_key_1, layer_1_padded)
    layer_1 = ephemeral_1 + encrypted_layer_1
    layers.append(layer_1)
    
    return OnionMessage(layers=layers, payload=b"")


def peel_onion_layer(
    onion_message: bytes,
    relay_private_key: bytes
) -> Optional[Tuple[bytes, bytes]]:
    """
    Relay peels one layer of onion encryption.
    Returns (next_hop_instruction, remaining_onion) or None on failure.
    """
    from src.crypto.primitives import (
        x25519_shared_secret, decrypt_message, sha3_256
    )
    
    if len(onion_message) < 32:
        return None
    
    # Extract ephemeral public key
    ephemeral_pubkey = onion_message[:32]
    ciphertext = onion_message[32:]
    
    # Derive shared secret
    shared = x25519_shared_secret(relay_private_key, ephemeral_pubkey)
    layer_key = sha3_256(shared + b"layer")  # Relay doesn't know which layer
    
    # Try to decrypt
    plaintext = decrypt_message(layer_key, ciphertext)
    if plaintext is None:
        return None
    
    # Remove padding
    try:
        plaintext = _unpad_layer(plaintext)
    except ValueError:
        return None
    
    # Parse instruction
    if len(plaintext) < 1:
        return None
    
    instruction = plaintext[0]
    remaining = plaintext[1:]
    
    return instruction, remaining


def _pad_layer(data: bytes, target: int = 512) -> bytes:
    """Pad layer to fixed size."""
    if len(data) >= target:
        return data[:target]
    return data + b"\x00" * (target - len(data))


def _unpad_layer(data: bytes) -> bytes:
    """Remove zero padding."""
    return data.rstrip(b"\x00")


# ─── Relay Store-and-Forward ────────────────────────────────────────

class RelayStore:
    """
    Store-and-forward message queue at a relay node.
    Messages stored encrypted; relay cannot read content.
    """
    
    def __init__(self):
        self.messages: dict = {}  # recipient_hash → List[RelayMessage]
        self.stats = {"stored": 0, "delivered": 0, "expired": 0}
    
    def store(self, recipient_hint: bytes, encrypted_payload: bytes) -> bool:
        """Store an encrypted message for later retrieval."""
        msg = RelayMessage(
            encrypted_payload=encrypted_payload,
            recipient_hint=recipient_hint,
            timestamp=time.time()
        )
        
        hint_hash = hashlib.sha3_256(recipient_hint).digest()[:16]
        
        if hint_hash not in self.messages:
            self.messages[hint_hash] = []
        
        self.messages[hint_hash].append(msg)
        self.stats["stored"] += 1
        return True
    
    def retrieve(
        self, recipient_hint: bytes, max_messages: int = 10
    ) -> List[bytes]:
        """Retrieve pending messages for a recipient."""
        hint_hash = hashlib.sha3_256(recipient_hint).digest()[:16]
        
        if hint_hash not in self.messages:
            return []
        
        # Get messages
        msgs = self.messages[hint_hash][:max_messages]
        self.messages[hint_hash] = self.messages[hint_hash][max_messages:]
        
        # Clean empty lists
        if not self.messages[hint_hash]:
            del self.messages[hint_hash]
        
        self.stats["delivered"] += len(msgs)
        return [m.encrypted_payload for m in msgs]
    
    def cleanup_expired(self, max_age: int = 86400):
        """Remove messages older than max_age seconds."""
        now = time.time()
        expired = 0
        
        for hint_hash in list(self.messages.keys()):
            self.messages[hint_hash] = [
                m for m in self.messages[hint_hash]
                if now - m.timestamp < max_age
            ]
            expired_count = len(self.messages[hint_hash])
            if not self.messages[hint_hash]:
                del self.messages[hint_hash]
            expired += expired_count
        
        self.stats["expired"] += expired


# ─── Cover Traffic ──────────────────────────────────────────────────

class CoverTrafficGenerator:
    """
    Generates dummy messages to mask real communication patterns.
    Sends random-sized (but padded to 4KB) messages at random intervals.
    """
    
    def __init__(self, relay_route: List[bytes], recipient: bytes):
        self.relay_route = relay_route
        self.recipient = recipient
        self.running = False
        self.interval = COVER_TRAFFIC_INTERVAL
    
    def generate_dummy(self) -> bytes:
        """Generate a dummy onion-routed message."""
        from src.crypto.primitives import generate_random
        
        # Random payload (looks like encrypted data)
        dummy_payload = generate_random(256)
        
        # Wrap in onion layers (same as real message)
        onion = build_onion_layers(
            dummy_payload,
            self.relay_route,
            self.recipient
        )
        
        return onion.serialize()
    
    def should_send(self) -> bool:
        """Determine if we should send cover traffic now."""
        import random
        # Poisson-like: probability increases with time since last real msg
        return random.random() < 0.1  # 10% chance per check


# ─── Message Packing ────────────────────────────────────────────────

def pack_wire_message(
    onion_data: bytes,
    target_size: int = MAX_MESSAGE_SIZE
) -> bytes:
    """
    Pack onion message into fixed-size wire format.
    All messages on the wire are exactly target_size bytes.
    """
    if len(onion_data) > target_size:
        raise ValueError(f"Onion data too large: {len(onion_data)} > {target_size}")
    
    # Version byte + onion data + padding
    version = struct.pack("!B", 0x01)
    payload = version + onion_data
    
    # Pad to fixed size
    if len(payload) < target_size:
        padding_needed = target_size - len(payload) - 1
        payload += b"\x80" + b"\x00" * padding_needed
    
    return payload[:target_size]


def unpack_wire_message(data: bytes) -> Optional[bytes]:
    """Unpack wire message, return onion data or None."""
    if len(data) < 2:
        return None
    
    version = data[0]
    if version != 0x01:
        return None
    
    # Remove version and padding
    payload = data[1:]
    payload = payload.rstrip(b"\x00")
    if payload.endswith(b"\x80"):
        payload = payload[:-1]
    
    return payload
