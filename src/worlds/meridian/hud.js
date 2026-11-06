import { Panel, DISPLAY, BODY, makeCard } from '../../engine/ui.js';
import { HALF } from './terrain.js';
import { xpForLevel } from './progress.js';

const MAP_INTERVAL = 0.2;

const CONTROLS = {
  foot: 'WASD move · Shift run · Space jump · Click punch · F steal or get in · G rob store · V view · U menu · H Crossroads',
  land: 'W gas · S brake · A D steer · Space drift · Shift nitro · R radio · F get out · U menu',
  boat: 'W gas · S reverse · A D steer · R radio · F get out · U menu',
  plane: 'Mouse to aim · W throttle up · S throttle down · A D turn · Space brakes · R radio · F get out',
  heli: 'Space or Shift up · Z down · W S forward and back · A D turn · R radio · F get out',
};

const toMap = (v, size) => ((v + HALF) / (HALF * 2)) * size;

/** On desktop, a page overlay. In a headset, a watch on your left wrist and floating prompts. */
export class Hud {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.mapImage = world.terrain.buildMapCanvas();
    this.timer = 0;
    this.flashes = [];
    this.buildDom();
    this.buildPrompt();
    this.buildWatch();
    this.k.onDispose(() => this.el.remove());
  }

  buildDom() {
    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <div class="hud-stats">
        <div class="hud-level"><span id="hud-lv">1</span><div class="hud-bar"><i id="hud-xp"></i></div></div>
        <div class="hud-coins">$<span id="hud-coins">0</span></div>
        <div class="hud-bar hud-health"><i id="hud-health"></i></div>
        <div class="hud-wanted" id="hud-wanted" aria-label="Wanted level"></div>
      </div>
      <div class="hud-goal" id="hud-goal" hidden><strong id="hud-goal-title"></strong><span id="hud-goal-line"></span><b id="hud-goal-timer"></b></div>
      <div class="hud-banner" id="hud-banner" hidden><strong id="hud-banner-title"></strong><span id="hud-banner-line"></span></div>
      <div class="hud-flashes" id="hud-flashes"></div>
      <div class="hud-prompt" id="hud-prompt" hidden></div>
      <div class="hud-dash">
        <div class="hud-speed" id="hud-speed-wrap" hidden><b id="hud-speed">0</b><small>km/h</small>
          <div class="hud-bar thin" id="hud-boost-wrap"><i id="hud-boost"></i></div></div>
        <div class="hud-bar thin" id="hud-fuel-wrap" hidden title="Jetpack fuel"><i id="hud-fuel"></i></div>
        <canvas id="hud-map" width="200" height="200"></canvas>
      </div>
      <div class="hud-legend" id="hud-legend"></div>`;
    document.body.append(el);
    this.el = el;
    this.$ = (id) => el.querySelector(`#${id}`);
    this.mapCtx = this.$('hud-map').getContext('2d');
  }

  buildPrompt() {
    this.promptCard = makeCard({ title: 'Get in', body: 'Press B', width: 1.5, accent: '#ff5c4d' });
    this.promptCard.visible = false;
    this.k.root.add(this.promptCard);
    this.promptKey = '';
  }

  /** A watch on the left wrist. Turn your wrist to read it. */
  buildWatch() {
    this.watch = new Panel({ width: 0.2, height: 0.2, ppm: 1280 });
    this.watch.position.set(-0.02, 0.05, 0.12);
    this.watch.rotation.set(-1.1, 0, 0.35);
  }

  flash(title, line) {
    const row = document.createElement('div');
    row.className = 'hud-flash';
    row.innerHTML = '<strong></strong><span></span>';
    row.children[0].textContent = title;
    row.children[1].textContent = line;
    this.$('hud-flashes').append(row);
    setTimeout(() => row.remove(), 4200);
    if (this.k.isXR) this.k.toast(title, line, '#ff5c4d');
  }

  banner(title, line) {
    this.$('hud-banner-title').textContent = title;
    this.$('hud-banner-line').textContent = line;
    this.$('hud-banner').hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.$('hud-banner').hidden = true; }, 3400);
    if (this.k.isXR) this.k.toast(title, line, '#35e0ff');
  }

  update(dt) {
    const { world, k } = this;
    const { player, progress, activities } = world;
    const v = player.vehicle;
    const xr = k.isXR;
    this.el.style.display = xr || !k.game.started || world.paused ? 'none' : 'block';

    this.updatePrompt(player, xr);
    this.timer += dt;
    if (this.timer < MAP_INTERVAL) return;
    this.timer = 0;

    const status = activities.status();
    if (xr) {
      this.paintWatch(status);
      return;
    }

    this.$('hud-lv').textContent = progress.level;
    this.$('hud-xp').style.width = `${progress.levelProgress * 100}%`;
    this.$('hud-coins').textContent = progress.coins;
    const { crime } = world;
    this.$('hud-health').style.width = `${crime.health}%`;
    this.$('hud-wanted').textContent = '★'.repeat(crime.wanted) + '☆'.repeat(5 - crime.wanted);
    this.$('hud-wanted').classList.toggle('hot', crime.wanted > 0);
    const goal = this.$('hud-goal');
    goal.hidden = !status;
    if (status) {
      this.$('hud-goal-title').textContent = status.title;
      this.$('hud-goal-line').textContent = status.line;
      this.$('hud-goal-timer').textContent = `${status.timer.toFixed(1)}s`;
      goal.classList.toggle('urgent', !!status.urgent);
    }
    this.$('hud-speed-wrap').hidden = !v;
    if (v) {
      this.$('hud-speed').textContent = Math.round(v.speed * 3.6);
      const hasNitro = v.def.cls === 'land';
      this.$('hud-boost-wrap').hidden = !hasNitro;
      if (hasNitro) this.$('hud-boost').style.width = `${v.nitro * 100}%`;
    }
    const jet = !v && progress.upgrades.jetpack > 0;
    this.$('hud-fuel-wrap').hidden = !jet;
    if (jet) this.$('hud-fuel').style.width = `${player.fuel * 100}%`;
    const legend = CONTROLS[v ? v.def.cls : 'foot'];
    if (legend !== this.legendText) {
      this.legendText = legend;
      this.$('hud-legend').textContent = legend;
      this.$('hud-legend').classList.remove('quiet');
      clearTimeout(this.legendTimer);
      this.legendTimer = setTimeout(() => this.$('hud-legend').classList.add('quiet'), 9000);
    }
    this.paintMap(this.mapCtx, 200, status);
  }

  updatePrompt(player, xr) {
    const n = player.nearby;
    const prompt = this.$('hud-prompt');
    const owned = n ? this.world.progress.owns(n.type) : true;
    let text = '';
    const { crime } = this.world;
    const key = xr ? 'B' : 'F';
    if (n && !player.vehicle) {
      text = owned || n.stolen ? `Press ${key} to take the ${n.def.label}` : `${n.def.label}: buy it in the menu to drive it`;
    } else if (player.nearbyCar && !player.vehicle) {
      text = player.nearbyCar.parked ? `Press ${key} to break into this car` : `Press ${key} to steal this car`;
    } else if (crime?.robbing) {
      text = `Robbing the store… ${Math.max(0, 5 - crime.robbing.time).toFixed(1)}s`;
    } else if (crime?.nearStore && !player.vehicle) {
      text = xr ? 'Hold right grip to rob this store' : 'Hold G to rob this store';
    }
    prompt.hidden = !text || xr;
    if (!xr) prompt.textContent = text;
    this.promptCard.visible = !!text && xr && !!n;
    if (xr && text && n) {
      if (text !== this.promptKey) {
        this.promptKey = text;
        this.promptCard.card({ title: owned ? n.def.label : 'Locked', body: text, accent: '#ff5c4d' });
      }
      this.promptCard.position.set(n.pos.x, n.pos.y + n.model.radius + 1.2, n.pos.z);
      this.promptCard.lookAt(this.k.head());
    }
  }

  paintMap(g, size, status) {
    const { world } = this;
    const { player, activities } = world;
    g.drawImage(this.mapImage, 0, 0, size, size);
    const dot = (x, z, color, r = 3) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(toMap(x, size), toMap(z, size), r, 0, Math.PI * 2);
      g.fill();
    };
    for (const race of activities.races) if (!activities.race && !activities.job) dot(race.at[0], race.at[1], '#ff7a2e', 3.4);
    if (!activities.job && !activities.race) dot(activities.hq.x, activities.hq.z, '#4dffd2', 3.4);
    for (const store of world.crime.stores) if (store.reset <= 0) dot(store.x, store.z, '#ff4040', 2.2);
    for (const turf of world.crime.turfs) if (!turf.cleared) dot(turf.x, turf.z, '#c060ff', 3.2);
    for (const cop of world.crime.cops) dot(cop.car.pos.x, cop.car.pos.z, '#3a7bff', 3);
    for (const shard of activities.shards) {
      if (!shard.taken && shard.mesh.position.distanceTo(player.pos) < 260) dot(shard.mesh.position.x, shard.mesh.position.z, '#b8fff0', 1.8);
    }
    for (const peer of world.peersOnMap()) dot(peer.x, peer.z, '#ff3d8b', 3.2);
    if (status?.target) {
      const t = status.target;
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(toMap(player.pos.x, size), toMap(player.pos.z, size));
      g.lineTo(toMap(t.x, size), toMap(t.z, size));
      g.stroke();
      dot(t.x, t.z, '#ffd23f', 4.2);
    }
    // You are the arrow.
    const x = toMap(player.pos.x, size);
    const y = toMap(player.pos.z, size);
    const yaw = player.bodyYaw;
    g.save();
    g.translate(x, y);
    g.rotate(-yaw);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(4.6, 5);
    g.lineTo(0, 2.6);
    g.lineTo(-4.6, 5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  paintWatch(status) {
    const { world, k } = this;
    const { player, progress } = world;
    const hand = k.input.hands.find((h) => h.source?.handedness === 'left');
    if (!hand) return;
    if (this.watch.parent !== hand.mount) hand.mount.add(this.watch);
    this.watch.paint((g, W, H) => {
      g.fillStyle = '#10101c';
      g.fillRect(0, 0, W, H);
      this.paintMapInset(g, W * 0.03, W * 0.03, W * 0.94);
      g.fillStyle = 'rgba(10,10,20,0.78)';
      g.fillRect(0, H * 0.72, W, H * 0.28);
      g.fillStyle = '#ff5c4d';
      g.font = `${H * 0.075}px ${DISPLAY}`;
      g.textBaseline = 'top';
      g.fillText(`LV ${progress.level}  $${progress.coins}  ${'*'.repeat(world.crime.wanted)}`, W * 0.04, H * 0.74);
      g.fillStyle = '#fff';
      g.font = `${H * 0.066}px ${BODY}`;
      const v = player.vehicle;
      const line = status ? `${status.title} ${status.timer.toFixed(0)}s` : v ? `${Math.round(v.speed * 3.6)} km/h` : 'Y for menu';
      g.fillText(line, W * 0.04, H * 0.85, W * 0.92);
    });
  }

  paintMapInset(g, x, y, size) {
    g.save();
    g.translate(x, y);
    this.paintMap(g, size, this.world.activities.status());
    g.restore();
  }

  /** Bars on the level display, reused in the menu. */
  xpText() {
    const p = this.world.progress;
    return `${p.data.xp} / ${xpForLevel(p.level)} XP`;
  }
}
