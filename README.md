# Patchwork

An open source VR multiverse. One hub, many small worlds, and a little bit of everything.

**[Play it now](https://luke3683.github.io/patchwork/)** in your headset's browser or on a desktop. There's nothing to install.

You start at the Crossroads, a floating plaza ringed with portals. Each portal leads to a world in a different genre. Clear a world and its patch is stitched into the giant quilt hanging over the plaza. Finish the quilt and the Source Gate opens.

Every world is a single JavaScript file, so adding one is a small pull request. That is the whole idea: the multiverse grows because people add to it.

| World | Genre | Comfort | Goal |
| --- | --- | --- | --- |
| Ring Run | Racing | Intense | Fly a sled through 10 of 14 rings |
| Drone Range | Shooter | Comfortable | Shoot down 25 drones before your shields fail |
| Pulse Line | Rhythm | Comfortable | Punch 70% of the orbs in time with the song |
| Rune Hollow | Fantasy puzzle | Comfortable | Sing the stones' three verses back to wake the old tree |
| Block Yard | Creative sandbox | Comfortable | Place 12 blocks, then build whatever you like, together in a room |
| Orbit Hoops | Sports | Comfortable | Throw 5 baskets in low gravity before time runs out |
| Gloom Manor | Horror maze | Moderate | Find 3 keys in the dark and escape while something hunts you |
| Tide Cove | Cozy fishing | Comfortable | Cast, wait for a bite and catch 5 fish |

## Play with friends

Create a room on the title screen, copy the invite link and send it to your friends. Up to 8 people can share a room. You'll see each other's avatars and name tags in every world, and you'll build together in Block Yard. The other worlds are played side by side, with each person running their own game.

- **Voice is off until you turn it on.** Press **Turn on mic** on the title screen before entering VR. After that, A or X (or M on desktop) switches it on and off.
- **Voice follows you around.** People in your world sound like they're in the room with you, and friends elsewhere come through more quietly.
- **Each person has a mute button** on the room board in the Crossroads.
- **Names are picked from word lists**, so nobody can type something abusive onto a name tag.

**What to know about privacy and reliability:**

- There's no game server. Your browser finds friends through public [Nostr](https://nostr.com) relays, then connects to them directly. The connection info sent through the relays is encrypted with your room code.
- **People in your room can see your IP address**, because you connect directly. Only share a room code with people you trust. There are no public rooms, no moderators and no way to report anyone yet.
- Some networks block direct connections, such as some workplaces, schools and mobile carriers. If friends never appear, try another network. Fixing this properly would need a relay server (TURN), which costs money to run.
- Your solo Block Yard build is safe. Shared sessions don't save over it, but they also aren't saved anywhere once everyone leaves.

## Customize it

Walk into the **Avatar Studio** portal in the Crossroads.

| Tab | What you can change |
| --- | --- |
| Body | Head, body and hand shapes, head and body size, and your name |
| Style | Eyes, hat, back item (cape, wings, jetpack) and aura |
| Colors | Any color for your three avatar color slots |
| Gear | Blaster style and color, and the color of your sled, laser, gloves and ball |
| Plaza | Sky (including your own colors), floor pattern and stars |
| Comfort | Move speed, snap or smooth turning, snap angle, field of view, mouse speed, game and voice volume |

Some items cost coins. You earn coins by beating worlds, and you can try anything on for free first. Friends in your room see your avatar change as you edit it.

## Run it

There is no install or build step. Serve the folder with the included dev server, which turns off browser caching so you always see your latest code:

```bash
python tools/serve.py
```

Then open <http://localhost:8000>. It loads Three.js and fonts from CDNs, so you need to be online.

### Controls

| Action | VR | Desktop |
| --- | --- | --- |
| Aim | Point your controller | Mouse |
| Use, shoot, place | Trigger | Left click |
| Remove a block | Grip | Right click |
| Move | Left stick | WASD (Shift to run) |
| Turn | Right stick (snap) | Mouse, or Q and E |
| Back to the hub | B or Y | H |
| Mic on or off | A or X | M |

Portals also open when you walk into them. If the browser can't lock the mouse, hold the right button and drag to look.

### Play on a headset

WebXR only runs on HTTPS or `localhost`, so a plain address on your home network won't work.

- **Easiest:** push this repo to GitHub and turn on Pages with GitHub Actions as the source (Settings, then Pages). The included workflow publishes the game on every push. Open that URL in your headset's browser and press Enter VR.
- **While developing on a Quest:** connect it by USB, run `adb reverse tcp:8000 tcp:8000`, then open `http://localhost:8000` in the headset's browser.

### Develop without a headset

These URL options help when you are working on the game:

| Option | What it does |
| --- | --- |
| `?emulate` | Fakes a Quest 3 in your browser using [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime), so Enter VR runs the real VR code. From the console, control it through `xrDevice`. |
| `?world=ring-run` | Starts in that world when you press Play. |
| `?patches=all` | Marks every patch as earned, which opens the Source Gate. |
| `?net=local` | Rooms connect tabs in one browser, with no internet needed. Open two tabs to test multiplayer. Voice doesn't work in this mode. |

To play every world with a bot and get a pass or fail for each, run this in the browser console:

```js
const { run } = await import('/tools/smoke-test.js'); await run();
```

It resets your saved progress, so use it in a browser profile you don't play in.

## Add a world

Copy `src/worlds/_template.js`, make it yours and add one line to `src/worlds/index.js`. Your portal and quilt patch then appear in the hub. [CONTRIBUTING.md](CONTRIBUTING.md) explains the rest.

## Project status

This is an early prototype. Here is what it has been tested on, and what it hasn't:

- **Tested:** desktop play, the VR code path on an emulated Quest 3, and two players connected over the internet from one computer, including voice using a test tone.
- **Not yet tested:** a real headset, a real microphone, players on different networks, or more than two players at once. Expect to tune comfort, aim feel, text size and performance on real hardware.

## Roadmap

1. Test and tune on real headsets.
2. Shared gameplay in more worlds, such as racing each other or facing the same drones.
3. A teleport option for players who get motion sick with stick movement, and a seated mode.
4. Load each world only when it's entered, so the hub stays fast as worlds are added.
5. Keeping your Block Yard builds and customizations across devices, which needs accounts.
6. Community worlds loaded from outside this repo, with a safe way to run them.
7. A relay server so people on restrictive networks can connect, and public rooms with moderation.

## License

Code is under the [MIT License](LICENSE). All graphics and audio are generated by the code, so there are no separate asset licenses.
