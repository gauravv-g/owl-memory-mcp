"""
OSP Session Manager v1.0
==========================
High-level session management: establish, send, receive, rotate keys.
Wraps the crypto primitives into a usable messaging interface.
"""

import time
import struct
from dataclasses import dataclass, field
from typing import Optional, Callable, Dict, List
from src.crypto.primitives import (
    IdentityKeys,
    PreKeyBundle,
    SessionState,
    generate_identity_keys,
    generate_prekey_bundle,
    initiate_session,
    respond_session,
    osp_encrypt,
    osp_decrypt,
    generate_random,
    sha3_256,
    ed25519_sign,
    ed25519_verify,
)


@dataclass
class OSPConfig:
    """Protocol configuration."""
    pq_ratchet_interval: int = 10
    max_message_size: int = 4096
    prekey_rotation_days: int = 7
    one_time_prekey_count: int = 100
    cover_traffic_enabled: bool = True
    cover_traffic_interval: int = 30


@dataclass
class PeerInfo:
    """Information about a known peer."""
    address: str
    identity_key: bytes
    prekey_bundle: Optional[PreKeyBundle] = None
    session: Optional[SessionState] = None
    verified: bool = False  # Out-of-band verification done
    first_seen: float = field(default_factory=time.time)
    last_interaction: float = 0.0


class OSPPeer:
    """
    Main interface for an OSP peer (user).
    
    Usage:
        peer = OSPPeer()  # generates identity
        peer.add_peer(address, identity_key)
        peer.send_message(address, b"hello")
        messages = peer.receive_pending()
    """
    
    def __init__(self, config: Optional[OSPConfig] = None):
        self.config = config or OSPConfig()
        self.identity: IdentityKeys = generate_identity_keys()
        self.prekey_bundle: PreKeyBundle = generate_prekey_bundle(
            self.identity,
            self.config.one_time_prekey_count
        )
        self.peers: Dict[str, PeerInfo] = {}
        self.sessions: Dict[str, SessionState] = {}
        self.message_queue: List[dict] = []
        self.on_message: Optional[Callable] = None
        
        # Stats
        self.stats = {
            "messages_sent": 0,
            "messages_received": 0,
            "sessions_created": 0,
            "prekey_rotations": 0,
        }
    
    @property
    def address(self) -> str:
        """This peer's OSP address."""
        return self.identity.address
    
    def get_prekey_bundle_for_upload(self) -> PreKeyBundle:
        """Get the prekey bundle to upload to relay network."""
        return self.prekey_bundle
    
    def rotate_prekeys(self):
        """Generate fresh prekeys (call weekly)."""
        self.prekey_bundle = generate_prekey_bundle(
            self.identity,
            self.config.one_time_prekey_count
        )
        self.stats["prekey_rotations"] += 1
    
    def add_peer(
        self,
        address: str,
        identity_key: bytes,
        prekey_bundle: Optional[PreKeyBundle] = None
    ):
        """Add a known peer."""
        self.peers[address] = PeerInfo(
            address=address,
            identity_key=identity_key,
            prekey_bundle=prekey_bundle,
        )
    
    def establish_session(self, address: str) -> bool:
        """
        Establish an encrypted session with a peer.
        Fetches their prekey bundle from relay and executes X3DH+PQXDH.
        """
        if address not in self.peers:
            raise ValueError(f"Unknown peer: {address}")
        
        peer = self.peers[address]
        if peer.session and peer.session.initialized:
            return True  # Already have a session
        
        if not peer.prekey_bundle:
            # In real implementation: fetch from relay/DHT
            raise ValueError(f"No prekey bundle for {address}")
        
        # Initiate session
        session = initiate_session(self.identity, peer.prekey_bundle)
        session.remote_identity = peer.identity_key
        
        self.sessions[address] = session
        peer.session = session
        peer.last_interaction = time.time()
        self.stats["sessions_created"] += 1
        
        return True
    
    def accept_session(
        self,
        remote_address: str,
        remote_identity_key: bytes,
        ephemeral_pubkey: bytes,
        ephemeral_pq_ct: bytes,
        used_otk_index: Optional[int] = None
    ) -> SessionState:
        """
        Accept an incoming session request.
        Called when we receive an initial handshake message.
        """
        session = respond_session(
            self.identity,
            self.prekey_bundle,
            ephemeral_pubkey,
            ephemeral_pq_ct,
            used_otk_index
        )
        session.remote_identity = remote_identity_key
        
        # Consume the used one-time prekey
        if used_otk_index is not None:
            if used_otk_index < len(self.prekey_bundle.one_time_prekeys):
                self.prekey_bundle.one_time_prekeys.pop(used_otk_index)
        
        self.sessions[remote_address] = session
        
        if remote_address in self.peers:
            self.peers[remote_address].session = session
            self.peers[remote_address].last_interaction = time.time()
        
        self.stats["sessions_created"] += 1
        return session
    
    def encrypt_message(self, address: str, plaintext: bytes) -> bytes:
        """
        Encrypt a message for a peer.
        Returns padded, encrypted bytes ready for onion wrapping.
        """
        if address not in self.sessions:
            self.establish_session(address)
        
        session = self.sessions[address]
        padded = osp_encrypt(session, plaintext)
        
        self.stats["messages_sent"] += 1
        if address in self.peers:
            self.peers[address].last_interaction = time.time()
        
        return padded
    
    def decrypt_message(
        self, address: str, ciphertext: bytes
    ) -> Optional[bytes]:
        """Decrypt a message from a peer."""
        if address not in self.sessions:
            return None
        
        session = self.sessions[address]
        plaintext = osp_decrypt(session, ciphertext)
        
        if plaintext:
            self.stats["messages_received"] += 1
            if address in self.peers:
                self.peers[address].last_interaction = time.time()
        
        return plaintext
    
    def verify_peer(self, address: str, out_of_band_fingerprint: bytes) -> bool:
        """
        Verify a peer's identity via out-of-band channel.
        Compare fingerprints (e.g., displayed as QR code or read aloud).
        """
        if address not in self.peers:
            return False
        
        peer = self.peers[address]
        expected = sha3_256(peer.identity_key)
        
        if expected == out_of_band_fingerprint:
            peer.verified = True
            return True
        return False
    
    def get_fingerprint(self, address: str) -> Optional[bytes]:
        """Get the fingerprint for out-of-band verification."""
        if address not in self.peers:
            return None
        return sha3_256(self.peers[address].identity_key)
    
    def get_my_fingerprint(self) -> bytes:
        """Get this peer's own fingerprint for sharing."""
        return sha3_256(self.identity.ed25519.public_key)
    
    def create_group(self, group_id: str, members: List[str]) -> bytes:
        """
        Create a new group. Returns the group encryption key.
        Group key is distributed to all members via pairwise sessions.
        """
        group_key = generate_random(32)
        
        # Distribute to all members
        for member_addr in members:
            if member_addr in self.sessions:
                # In real implementation: send via pairwise session
                # with group membership proof
                pass
        
        return group_key
    
    def leave_group(self, group_id: str):
        """Leave a group — remove all group keys."""
        pass  # Implementation depends on group key storage
