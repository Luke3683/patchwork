import * as THREE from 'three';
import { Avatar } from './avatar.js';
import { displayName, sanitizeLook, sanitizeName, NAME_A, NAME_B } from './prefs.js';

const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
const APP_ID = 'patchwork-vr-multiverse-v1';
const POSE_INTERVAL = 1 / 15;
const STATE_INTERVAL = 4; // state is re-sent now and then, so a lost message can't stick
const POSE_LENGTH = 22;
const MAX_PEERS = 7; // every player connects to every other, so rooms have to stay small
const MAX_WORLD_MESSAGES_PER_SECOND = 40;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SEATS = [[-2.3, 0.3], [2.3, 0.3], [-2.6, 1.6], [2.6, 1.6], [-1.5, 2.5], [1.5, 2.5], [0, 3]];

const v1 = new THREE.Vector3();
const q1 = new THREE.Quaternion();

/** Finds other players through public Nostr relays, then connects to them directly. */
async function joinTrystero(code) {
  const { joinRoom, selfId } = await import(TRYSTERO_URL);
  const room = joinRoom({ appId: APP_ID, password: code }, code);
  const action = room.makeAction('pw');
  const t = {
    selfId,
    on: {},
    send: (data, to) => action.send(data, to ? { target: to } : undefined),
    addStream: (stream, to) => room.addStream(stream, to ? { target: to } : undefined),
    leave: () => room.leave(),
  };
  action.onMessage = (data, { peerId }) => t.on.data?.(data, peerId);
  room.onPeerJoin = (id) => t.on.join?.(id);
  room.onPeerLeave = (id) => t.on.leave?.(id);
  room.onPeerStream = (stream, id) => t.on.stream?.(stream, id);
  return t;
}

/** With ?net=local, tabs in one browser talk directly. Useful for testing offline. */
function joinLocal(code) {
  const channel = new BroadcastChannel(`patchwork-${code}`);
  const selfId = Math.random().toString(36).slice(2, 10);
  const known = new Set();
  const post = (kind, data, to) => channel.postMessage({ from: selfId, kind, data, to });
  const t = {
    selfId,
    on: {},
    send: async (data, to) => post('data', data, to),
    addStream: () => {},
    leave: () => { post('bye'); channel.close(); },
  };
  channel.onmessage = ({ data: m }) => {
    if (m.to && m.to !== selfId) return;
    if (m.kind === 'hello') post('hi', null, m.from);
    if ((m.kind === 'hello' || m.kind === 'hi') && !known.has(m.from)) {
      known.add(m.from);
      t.on.join?.(m.from);
    }
    if (m.kind === 'bye' && known.delete(m.from)) t.on.leave?.(m.from);
    if (m.kind === 'data' && known.has(m.from)) t.on.data?.(m.data, m.from);
  };
  setTimeout(() => post('hello'), 50);
  addEventListener('pagehide', () => post('bye'));
  return t;
}

export class Net {
  constructor(game) {
    this.game = game;
    this.transport = null;
    this.code = null;
    this.status = 'offline'; // offline, connecting, online, failed
    this.error = '';
    this.peers = new Map();
    this.handlers = new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.poseOverride = null; // a world with its own camera supplies the body pose
    this.poseTimer = 0;
    this.stateTimer = 0;
    this.micStream = null;
    this.micOn = false;
    this.voiceMuted = false;
    this.rosterVersion = 0;
    this.onChange = null;
    this.profile = this.loadProfile();
  }

  loadProfile() {
    const saved = this.game.save.data.profile;
    if (saved?.name) return { name: sanitizeName(saved.name) };
    const name = [Math.floor(Math.random() * NAME_A.length), Math.floor(Math.random() * NAME_B.length)];
    this.game.save.data.profile = { name };
    this.game.save.persist();
    return { name };
  }

  setName(name) {
    this.profile.name = sanitizeName(name);
    this.game.save.data.profile = this.profile;
    this.game.save.persist();
    this.broadcastState();
    this.changed();
  }

  get myName() {
    return displayName(this.profile.name);
  }

  static makeCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  static cleanCode(raw) {
    const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return code.length === 6 ? code : null;
  }

  changed() {
    this.rosterVersion += 1;
    this.onChange?.();
  }

  async join(rawCode) {
    const code = Net.cleanCode(rawCode);
    if (!code) throw new Error('Room codes are 6 letters and numbers.');
    this.leave();
    this.code = code;
    this.status = 'connecting';
    this.error = '';
    this.changed();
    try {
      const local = new URLSearchParams(location.search).get('net') === 'local';
      const t = local ? joinLocal(code) : await joinTrystero(code);
      if (this.code !== code) {
        t.leave();
        return;
      }
      this.transport = t;
      t.on.join = (id) => this.onPeerJoin(id);
      t.on.leave = (id) => this.onPeerLeave(id);
      t.on.data = (data, id) => this.onData(data, id);
      t.on.stream = (stream, id) => this.onStream(stream, id);
      this.status = 'online';
    } catch (err) {
      console.error('Could not join the room', err);
      this.status = 'failed';
      this.error = 'Could not reach the connection service. Check your internet and try again.';
      this.code = null;
    }
    this.changed();
  }

  leave() {
    this.transport?.leave();
    this.transport = null;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.code = null;
    this.status = 'offline';
    this.changed();
  }

  get inRoom() {
    return !!this.transport;
  }

  // --- Sending ------------------------------------------------------------

  send(message, to) {
    if (!this.transport) return;
    Promise.resolve(this.transport.send(message, to)).catch(() => {});
  }

  stateMessage() {
    return ['s', {
      world: this.game.started ? this.game.currentId : null,
      name: this.profile.name,
      look: this.game.prefs.look,
      mic: this.micOn,
    }];
  }

  broadcastState() {
    this.send(this.stateMessage());
  }

  /** Called by a kit. Sends a message to the people in the same world. */
  sendWorld(type, payload, to) {
    this.send(['m', this.game.currentId, String(type), payload], to);
  }

  /** Called by a kit. Worlds subscribe to their own message types. */
  subscribe(type, fn) {
    this.handlers.set(type, fn);
    return () => {
      if (this.handlers.get(type) === fn) this.handlers.delete(type);
    };
  }

  /** People in the world the player is currently in. */
  peersHere() {
    return [...this.peers.values()].filter((p) => p.world === this.game.currentId);
  }

  // --- Receiving ----------------------------------------------------------

  onPeerJoin(id) {
    if (this.peers.size >= MAX_PEERS) return;
    this.peers.set(id, {
      id,
      name: [0, 0],
      nameText: 'Connecting',
      world: null,
      look: null,
      mic: false,
      muted: false,
      avatar: null,
      hasPose: false,
      seat: this.peers.size,
      audio: null,
      lastSecond: 0,
      messageCount: 0,
    });
    this.send(this.stateMessage(), id);
    if (this.micStream) Promise.resolve(this.transport.addStream(this.micStream, id)).catch(() => {});
    this.changed();
  }

  onPeerLeave(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.game.kit?.toast(`${peer.nameText} left`, '', '#f4efe2');
    this.removePeer(id);
    this.changed();
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (peer.avatar) {
      this.group.remove(peer.avatar.group);
      peer.avatar.dispose();
    }
    this.stopAudio(peer);
    this.peers.delete(id);
  }

  /** Other players' messages can contain anything, so each kind is checked before use. */
  onData(message, id) {
    // A message can arrive just before the notice that its sender joined.
    if (!this.peers.has(id)) this.onPeerJoin(id);
    const peer = this.peers.get(id);
    if (!peer || !Array.isArray(message)) return;
    const [kind] = message;
    if (kind === 'p') this.onPose(peer, message[1]);
    else if (kind === 's') this.onState(peer, message[1]);
    else if (kind === 'm') this.onWorldMessage(peer, message);
  }

  onState(peer, s) {
    if (!s || typeof s !== 'object') return;
    const firstTime = !peer.look;
    const world = typeof s.world === 'string' && this.game.worlds.has(s.world) ? s.world : null;
    const worldChanged = world !== peer.world;
    peer.world = world;
    peer.mic = !!s.mic;
    peer.name = sanitizeName(s.name);
    peer.nameText = displayName(peer.name);
    const look = sanitizeLook(s.look);
    if (!peer.avatar) {
      peer.avatar = new Avatar(look, peer.nameText);
      peer.avatar.group.visible = false;
      this.group.add(peer.avatar.group);
    } else if (JSON.stringify(look) !== JSON.stringify(peer.look)) {
      peer.avatar.setLook(look);
      peer.avatar.setName(peer.nameText);
    } else {
      peer.avatar.setName(peer.nameText);
    }
    peer.look = look;
    if (worldChanged) peer.hasPose = false;
    if (firstTime) this.game.kit?.toast(`${peer.nameText} joined`, '', '#b8e986');
    this.changed();
  }

  onPose(peer, pose) {
    if (!peer.avatar || !Array.isArray(pose) || pose.length !== POSE_LENGTH) return;
    for (const n of pose) {
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e5) return;
    }
    const t = peer.avatar.target;
    const [seatX, seatZ] = this.seatOffset(peer);
    t.head.set(pose[0] + seatX, pose[1], pose[2] + seatZ);
    setQuat(t.headQ, pose, 3);
    t.left.set(pose[7] + seatX, pose[8], pose[9] + seatZ);
    setQuat(t.leftQ, pose, 10);
    t.right.set(pose[14] + seatX, pose[15], pose[16] + seatZ);
    setQuat(t.rightQ, pose, 17);
    const flags = pose[21];
    t.showLeft = (flags & 1) !== 0;
    t.showRight = (flags & 2) !== 0;
    if (!peer.hasPose) {
      peer.hasPose = true;
      peer.avatar.snap();
    }
  }

  /** In stand-still worlds everyone shares one spot, so friends are drawn beside you. */
  seatOffset(peer) {
    const def = this.game.worlds.get(this.game.currentId);
    if (!def?.seats || peer.world !== this.game.currentId) return [0, 0];
    return SEATS[peer.seat % SEATS.length];
  }

  onWorldMessage(peer, [, world, type, payload]) {
    if (world !== this.game.currentId || peer.world !== world) return;
    const second = Math.floor(performance.now() / 1000);
    if (second !== peer.lastSecond) {
      peer.lastSecond = second;
      peer.messageCount = 0;
    }
    peer.messageCount += 1;
    if (peer.messageCount > MAX_WORLD_MESSAGES_PER_SECOND) return;
    try {
      this.handlers.get(type)?.(payload, peer.id);
    } catch (err) {
      console.warn('Ignored a bad message from another player', err);
    }
  }

  // --- Voice --------------------------------------------------------------

  /** Asks for the microphone once, then only switches it on and off. */
  async setMic(on) {
    if (on && !this.micStream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access.');
      await this.useMicStream(await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }));
    }
    this.micOn = on;
    this.micStream?.getAudioTracks().forEach((track) => { track.enabled = on; });
    this.broadcastState();
    this.changed();
  }

  async useMicStream(stream) {
    this.micStream = stream;
    if (this.transport) await Promise.resolve(this.transport.addStream(stream)).catch(() => {});
  }

  /** The X button in VR, or M on desktop. */
  async toggleMic() {
    const { kit, isXR } = this.game;
    if (!this.inRoom) {
      kit?.toast('Voice needs a room', 'Create or join a room from the title screen.', '#f4efe2');
      return;
    }
    if (!this.micOn && !this.micStream && isXR) {
      kit?.toast('Allow the mic first', 'Exit VR and press Turn on mic, so your browser can ask.', '#f4efe2');
      return;
    }
    try {
      await this.setMic(!this.micOn);
      kit?.toast(this.micOn ? 'Mic on' : 'Mic off', '', this.micOn ? '#b8e986' : '#f4efe2');
    } catch (err) {
      console.warn(err);
      kit?.toast('No microphone', 'Your browser blocked the mic or none was found.', '#ff8a4c');
    }
  }

  onStream(stream, id) {
    const peer = this.peers.get(id);
    const { sound } = this.game;
    if (!peer) return;
    this.stopAudio(peer);
    // Chrome only delivers remote audio to Web Audio if an element also holds the stream.
    const element = new Audio();
    element.srcObject = stream;
    element.muted = true;
    element.play?.().catch(() => {});
    peer.audio = { element };
    if (!sound.ctx) sound.unlock();
    if (!sound.ctx) {
      element.muted = false;
      return;
    }
    const source = sound.ctx.createMediaStreamSource(stream);
    const gain = sound.ctx.createGain();
    const panner = sound.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.maxDistance = 40;
    panner.rolloffFactor = 1;
    source.connect(gain).connect(panner).connect(sound.voiceBus);
    peer.audio = { element, source, gain, panner };
    this.updateVoice(peer);
  }

  stopAudio(peer) {
    if (!peer.audio) return;
    peer.audio.element.srcObject = null;
    peer.audio.source?.disconnect();
    peer.audio.gain?.disconnect();
    peer.audio.panner?.disconnect();
    peer.audio = null;
  }

  setPeerMuted(id, muted) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.muted = muted;
    this.updateVoice(peer);
    this.changed();
  }

  /** Friends in your world sound like they're in the room. Others are heard as a quieter party line. */
  updateVoice(peer) {
    const a = peer.audio;
    if (!a?.gain) return;
    const here = peer.world === this.game.currentId;
    a.gain.gain.value = peer.muted ? 0 : here ? 1 : 0.55;
    setPannerPosition(a.panner, here && peer.hasPose ? peer.avatar.head.position : this.game.camera.getWorldPosition(v1));
  }

  updateListener() {
    const ctx = this.game.sound.ctx;
    if (!ctx?.listener?.positionX) return;
    const { camera } = this.game;
    const l = ctx.listener;
    camera.getWorldPosition(v1);
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(v1.x, t);
    l.positionY.setValueAtTime(v1.y, t);
    l.positionZ.setValueAtTime(v1.z, t);
    camera.getWorldDirection(v1);
    l.forwardX.setValueAtTime(v1.x, t);
    l.forwardY.setValueAtTime(v1.y, t);
    l.forwardZ.setValueAtTime(v1.z, t);
  }

  // --- Every frame --------------------------------------------------------

  /** Worlds changed, so everyone needs to know where we went. */
  worldChanged() {
    this.broadcastState();
    for (const peer of this.peers.values()) peer.hasPose = peer.hasPose && peer.world === this.game.currentId;
  }

  update(dt) {
    if (!this.transport) return;
    const { camera } = this.game;
    const viewer = camera.getWorldPosition(new THREE.Vector3());
    for (const peer of this.peers.values()) {
      const av = peer.avatar;
      if (!av) continue;
      const show = peer.world === this.game.currentId && peer.hasPose;
      av.group.visible = show;
      if (show) av.update(dt, viewer);
      this.updateVoice(peer);
    }
    if (this.peers.size) this.updateListener();

    this.stateTimer += dt;
    if (this.stateTimer >= STATE_INTERVAL && this.peers.size) {
      this.stateTimer = 0;
      this.broadcastState();
    }

    this.poseTimer += dt;
    if (this.poseTimer >= POSE_INTERVAL && this.peers.size && this.game.started && !this.game.busy) {
      this.poseTimer = 0;
      this.send(['p', this.buildPose()]);
    }
  }

  buildPose() {
    if (this.poseOverride) return this.poseOverride();
    const { camera, input, isXR } = this.game;
    const out = [];
    const writeObj = (obj, active) => {
      if (active) {
        obj.updateWorldMatrix(true, false);
        v1.setFromMatrixPosition(obj.matrixWorld);
        obj.getWorldQuaternion(q1);
      } else {
        v1.set(0, -100, 0);
        q1.identity();
      }
      out.push(v1.x, v1.y, v1.z, q1.x, q1.y, q1.z, q1.w);
    };
    writeObj(camera, true);
    let left = null;
    let right = null;
    if (isXR) {
      for (const h of input.hands) {
        if (h.source?.handedness === 'left') left = h;
        else right = h;
      }
    } else {
      right = input.mouse;
    }
    writeObj(left?.obj, !!left);
    writeObj(right?.obj, !!right);
    const pose = out.map((n) => Math.round(n * 1000) / 1000);
    pose.push((left ? 1 : 0) | (right ? 2 : 0));
    return pose;
  }
}

function setQuat(q, a, i) {
  q.set(a[i], a[i + 1], a[i + 2], a[i + 3]);
  if (q.lengthSq() < 1e-6) q.identity();
  else q.normalize();
}

function setPannerPosition(panner, p) {
  if (panner.positionX) {
    const t = panner.context.currentTime;
    panner.positionX.setValueAtTime(p.x, t);
    panner.positionY.setValueAtTime(p.y, t);
    panner.positionZ.setValueAtTime(p.z, t);
  } else {
    panner.setPosition?.(p.x, p.y, p.z);
  }
}
