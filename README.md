# Patchwork

An open source open-world crime and adventure game for VR and desktop. Explore a whole city and island on foot, by motorcycle, car, plane, helicopter or boat, steal cars, rob stores, fight rival crews and outrun the police, then step through portals into a little bit of everything.

It's meant for mature players: there's cartoon violence (fistfights with no blood) and crime as gameplay.

**[Play it now](https://luke3683.github.io/patchwork/)** in your headset's browser or on a desktop. There's nothing to install.

## Meridian, the open world

You start in the middle of Meridian, a 4 km island with a city, highway, airfield, snowy mountain, forests, beaches and far-off islets. The sun rises and sets, the city lights up at night, and traffic and crowds fill the streets.

- **Go anywhere, any way:** run, jump and swim, or take any parked motorcycle, car, supercar, plane, jet, helicopter or speedboat.
- **Steal anything:** take any car from traffic or the curb, or hold up a store for cash.
- **Fight:** rival crews hold their turf in the city and on the docks. Punch them out for cash. In VR you throw real punches with your hands.
- **Run from the law:** crime raises a five-star wanted level. Police cars chase you, officers on foot arrest you if they catch you, and staying out of range long enough cools things off.
- **Keep moving:** earn XP and coins from races, courier jobs with growing streak bonuses, stunts, 36 hidden shards and 10 places to discover.
- **Upgrade:** spend coins on engine, handling and nitro upgrades, jump boots, sprint, boxing, toughness and a jetpack, and unlock the helicopter, supercar and jet as you level up.
- **Play together:** friends in your room appear in your world, in the vehicles they're driving.

Press **U** (or **Y** in VR) for upgrades, vehicles, fast travel and time of day.

## The Crossroads

The golden portal beside the Spire leads to the Crossroads, a floating plaza ringed with eight smaller worlds. Clear a world and its patch is stitched into the giant quilt hanging over the plaza. Finish the quilt and the Source Gate opens.

Every Crossroads world is a single JavaScript file, so adding one is a small pull request. That is the whole idea: the multiverse grows because people add to it.

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

Create a room on the title screen, copy the invite link and send it to your friends. Up to 8 people can share a room. You'll see each other's avatars, name tags and vehicles in Meridian, and you'll build together in Block Yard. The other worlds are played side by side, with each person running their own game. Traffic, races and jobs are separate for each player for now.

- **Voice is off until you turn it on.** Press **Turn on mic** on the title screen before entering VR. After that, X (or M on desktop) switches it on and off.
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
| Comfort | Move speed, snap or smooth turning, snap angle, field of view, mouse speed, graphics quality, VR tunnel view, game and voice volume |

Some items cost coins. You earn coins by beating worlds, and you can try anything on for free first. Friends in your room see your avatar change as you edit it.

## Run it

There is no install or build step. Serve the folder with the included dev server, which turns off browser caching so you always see your latest code:

```bash
python tools/serve.py
```

Then open <http://localhost:8000>. It loads Three.js and fonts from CDNs, so you need to be online.

### Controls in Meridian

| Action | VR | Desktop |
| --- | --- | --- |
| Move | Left stick | WASD |
| Look or turn | Your head, right stick | Mouse |
| Run | Left grip | Shift |
| Punch | Swing your fists | Left click |
| Rob a store (hold) | Right grip | G |
| Jump, or jetpack when held | A | Space |
| Get in or out of a vehicle, or steal a car | B | F |
| Gas and brake | Right and left triggers | W and S |
| Steer | Left stick | A and D |
| Nitro | Right grip | Shift |
| Drift | A | Space |
| Plane pitch and bank | Left stick | W, S, A, D |
| Plane throttle up and down | Right and left triggers | Shift and Z |
| Helicopter up and down | Right and left triggers | Shift and Z |
| Menu | Y | U |
| First or third person | Always first person | V |
| Go to the Crossroads | Portal or menu | H |
| Mic on or off | X | M |

In VR you sit in the seat, the horizon stays level, and the edges of your view narrow at speed to help prevent motion sickness. You can turn the narrowing off under Comfort in the Avatar Studio.

### Controls in the Crossroads worlds

| Action | VR | Desktop |
| --- | --- | --- |
| Aim | Point your controller | Mouse |
| Use, shoot, place | Trigger | Left click |
| Remove a block | Grip | Right click |
| Move | Left stick | WASD (Shift to run) |
| Turn | Right stick (snap) | Mouse, or Q and E |
| Back to the Crossroads | B or Y | H |
| Mic on or off | X | M |

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
| `?lowgfx` | Skips the desktop glow and shadows, the same path a headset takes. Weak computers drop to this by themselves. |
| `?patches=all` | Marks every patch as earned, which opens the Source Gate. |
| `?net=local` | Rooms connect tabs in one browser, with no internet needed. Open two tabs to test multiplayer. Voice doesn't work in this mode. |

To play the game with a bot and get a pass or fail for each check, run one of these in the browser console. `meridian-test.js` covers the open world and `smoke-test.js` covers the Crossroads worlds:

```js
const { run } = await import('/tools/meridian-test.js'); await run();
```

```js
const { run } = await import('/tools/smoke-test.js'); await run();
```

They reset your saved progress, so use them in a browser profile you don't play in.

## Add a world

Copy `src/worlds/_template.js`, make it yours and add one line to `src/worlds/index.js`. Your portal and quilt patch then appear in the hub. [CONTRIBUTING.md](CONTRIBUTING.md) explains the rest.

## Project status

This is an early prototype. Here is what it has been tested on, and what it hasn't:

- **Tested:** desktop play, the VR code path on an emulated Quest 3, and two players connected over the internet from one computer, including voice using a test tone.
- **Not yet tested:** a real headset, a real microphone, players on different networks, or more than two players at once. Expect to tune comfort, vehicle feel, text size and performance on real hardware. Meridian is a big scene for a headset, and it may need trimming on a Quest 2.

## Roadmap

1. Test and tune on real headsets.
2. Racing your friends, with shared traffic and shared jobs in Meridian.
3. Interiors you can walk into, and more of the map: more towns, tunnels and bridges.
4. Hand-built character models and more animation, and weapons if the project wants them.
5. A teleport option for players who get motion sick with stick movement, and a seated mode.
6. Load each world only when it's entered, so startup stays fast as worlds are added.
7. Keeping your builds and customizations across devices, which needs accounts.
8. Community worlds loaded from outside this repo, with a safe way to run them.
9. A relay server so people on restrictive networks can connect, and public rooms with moderation.

## License

Code is under the [MIT License](LICENSE). Audio and models are generated by the code. The photo textures in `assets/textures` are CC0 from [Poly Haven](https://polyhaven.com), credited in [CREDITS.md](assets/textures/CREDITS.md).
