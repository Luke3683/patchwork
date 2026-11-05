# Contributing to Patchwork

The best contribution is a new world. A small, finished one is worth more than a big, unfinished one.

## Build a world in five steps

1. Copy `src/worlds/_template.js` to `src/worlds/your-world.js`.
2. Change the `id`, `name`, `genre`, `comfort` and `color`.
3. Import it in `src/worlds/index.js` and add it to the list. Your portal and quilt patch now appear in the hub.
4. Open `http://localhost:8000/?world=your-world` and press Play to jump straight in.
5. Build the world, call `k.complete()` when the player earns the patch, and open a pull request.

## Add to Meridian

The open world lives in `src/worlds/meridian/`, split by job:

| File | What it holds |
| --- | --- |
| `terrain.js` | The island's shape, roads, flat areas and water |
| `city.js` | Buildings, signs, street lights and landmarks |
| `models.js`, `vehicles.js` | What vehicles look like and how they handle |
| `player.js` | Walking, the jetpack, getting in and out, and the camera |
| `progress.js` | Levels, upgrades and unlocks |
| `activities.js` | Races, courier jobs, shards and places to discover |
| `crime.js`, `npc.js` | Stealing, fights, wanted levels, police, and everyone on the street |
| `textures.js`, `foliage.js` | Photo materials, trees and grass |
| `hud.js`, `index.js` | The on-screen display, the menu, traffic, crowds, and how it all fits together |

Good first additions: a new race in `activities.js`, a new upgrade in `progress.js`, or a new landmark in `city.js`. If you add something to the map, run `tools/meridian-test.js` to catch buried or walled-in vehicles.

## The rules

**Keep the violence cartoonish.** Fights knock people down, and they get back up. No gore, no sexual content, and nothing that targets real groups of people or makes sexual violence or attacks on sex workers part of the game.

**Everything must be original.** This is the one rule with no exceptions. Don't add characters, names, logos, music, maps or designs from movies, games, shows, books or brands, even as a tribute or a small cameo. A genre or a mechanic is fine: a racing world is welcome, a recreation of a specific racing game isn't. One borrowed character could put the whole project at legal risk.

**Only add assets you have the rights to.** Contribute only your own work or CC0 assets. Note the source of any file you didn't make, in the pull request. Generating art and sound in code, as the current worlds do, avoids the question entirely.

**Respect the player's body.**

- Set an honest `comfort` rating: `Comfortable` (you stand or walk at your own pace), `Moderate`, or `Intense` (the world moves you around).
- Never rotate the player's view without their input.
- If you move the player, give them a steady frame of reference, as the sled in `ring-run.js` does.
- Don't lock text or menus to the player's head. Place them in the world.
- Avoid large flashing areas.

**Make it work both ways.** A world must be playable in VR and with a mouse and keyboard, so contributors without a headset can test it.

**Stay within a headset's budget.** Aim for fewer than 100 draw calls and 100,000 triangles in view, and check with `patchwork.renderer.info.render` in the console. Use `k.instanced()` for repeated objects, and don't use real-time shadows.

## What the kit gives you

`create(k)` receives a kit, and everything added to `k.root` is cleaned up when the player leaves.

| Call | What it does |
| --- | --- |
| `k.spawn(x, z, yaw, y)` | Places the player |
| `k.setMove(true)`, `k.boundsCircle(radius)` | Enables walking and keeps the player inside a circle |
| `k.head()` | The player's head position in the world |
| `k.attachToRig(obj)` | Makes an object move with the player, like a vehicle |
| `k.sky({ top, mid, horizon, bottom, stars })` | Adds a gradient sky dome |
| `k.lights({ sky, ground, sun, ambient, direct, dir })`, `k.fog(hex, near, far)` | Sets the lighting and fog |
| `k.instanced(geometry, material, count, place)` | Scatters many copies of a shape cheaply |
| `k.menu({ title, body, buttons, at })` | Shows a card with buttons. Call `.close()` to remove it |
| `k.board({ width, height, at, scale })` | Adds a scoreboard. Update it with `.card({ title, body })` |
| `k.button(label, onSelect)` | Creates a single 3D button |
| `k.toast(title, body)` | Shows a message that fades away |
| `k.portal({...})`, `k.exitPortal(position)` | Adds a portal, or a portal back to the hub |
| `k.burst(position, color, count, speed)` | Throws a shower of shards |
| `k.spawnSocial(x, z, yaw)` | Places the player, leaving room when friends are in the world too |
| `k.complete()` | Awards this world's patch |
| `k.win(coins)` | Call when the player beats the world: the patch the first time, coins every time |
| `k.reward(coins, reason)` | Gives coins to spend in the Avatar Studio |
| `k.prefs` | The player's customizations, such as `k.prefs.gear.ballColor` |
| `k.ambience(frequencies, gain)` | Plays a soft background chord |
| `k.onDispose(fn)` | Runs your own cleanup when the player leaves |

**Input.** `k.input.hands` lists the active hands, and `k.input.primary` is the main one. The mouse counts as a hand on desktop, so the same code usually covers both. Each hand has:

- `origin` and `dir`: the aiming ray
- `pressed`, `down`, `released`: trigger state (`pressed` is true for one frame)
- `squeezed`: true for the frame the grip button (or right click) goes down
- `mount`: a group to attach held items to, with -Z pointing along the ray
- `hit`: the UI target being aimed at, if any
- `pulse(intensity, ms)`: controller vibration

For clickable objects, use `k.input.addTarget(mesh, { onSelect, onEnter, onLeave })`. For keys on desktop, use `k.input.keyPressed('KeyF')`.

**Sound.** `k.sound.play('select')` plays a named effect, and `k.sound.tone({ f, d, type, g })` and `k.sound.noise({ d, g, f })` synthesize new ones.

**Multiplayer.** Friends' avatars appear in your world automatically. To share gameplay too, use these. They're safe to call when the player is alone. `block-yard.js` is the working example.

- `k.net.peers()`: the other players in this world
- `k.net.send(type, data, to)`: sends a message to everyone here, or just to `to` if you give a player's id
- `k.net.on(type, (data, from) => {})`: receives a message

**Never trust a message from another player.** Check every value's type and range before you use it. Set `seats: true` on your world if everyone stands in one spot, and friends will be drawn beside you.

**Customization.** To add an avatar item, add it to `CATALOG` in `src/engine/prefs.js` and draw it in `src/engine/avatar.js`. A cost above zero makes it an unlock. To add a setting, add its default to `DEFAULT_PREFS`, clean it in `loadPrefs`, and add a row to `TABS` in `src/worlds/avatar-studio.js`.

**Saving.** `k.save.world(id)` and `k.save.setWorld(id, value)` store a small JSON value for your world, using the world's `id`.

## Before you open a pull request

- Win your world and lose it, on desktop and with `?emulate` or a real headset.
- Run the bot from the README to check you didn't break another world.
- If your world uses multiplayer, test it with two tabs using `?net=local`.
- Check the browser console for errors.
- Say in the pull request which device you tested on.

## Bigger work

Shared gameplay, comfort options, performance and engine changes are all welcome. Please open an issue to discuss the approach first.
