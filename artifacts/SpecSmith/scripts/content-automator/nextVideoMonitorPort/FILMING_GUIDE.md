# Filming guide: monitor-port Short (your PC)

Four things to film, plus a few facts to note. It takes about 20 minutes. Film everything vertically on your phone.

## 1. Note the facts first (2 minutes)

| | Where to find it | Your answer |
|---|---|---|
| CPU model | Task Manager › Performance › CPU (top right) | |
| Does that CPU have integrated graphics? | The CPU maker's page for that exact model. Intel "F" models have none. | yes / no |
| Motherboard model | Start › "System Information" › BaseBoard Manufacturer + Product | |
| GPU model | Task Manager › Performance › GPU | |
| Port type you'll use | HDMI or DisplayPort. It must be the same type on both the motherboard and the card. | |

Use **one cable** for every shot, and make sure it fits a port on both the motherboard and the graphics card. If the motherboard has no matching port, tell me before filming.

## 2. Phone and light setup

**Phone:**
- Hold it **vertical**, at 1080p or 4K and 30 fps, on the **1× lens**. The ultra-wide lens bends the panel.
- Use a tripod, or prop the phone against something solid; the move shot must not wobble.
- Tap and hold on the ports to **lock focus and exposure**. Then drag the exposure down slightly so the metal doesn't turn white.
- Wipe the dust off the rear panel.

**Light:** the back of a PC sits in shadow, and its ports are dark holes in shiny metal.
- **One soft light from the side, about 45°.** A desk lamp works, or your phone torch bounced off a white sheet of paper.
- **Don't light it straight on:** that bounces glare off the metal and hides the port shapes.
- **A white card or paper on the other side** fills in the shadow inside the ports, so their shapes read.
- **Turn off any light pointing at the lens.**

**Framing, so the ports stay readable on a phone:**
- The panel stands vertically, with the motherboard ports near the top and the graphics card's ports lower down. That matches a vertical video.
- **Leave the top 15% and the bottom 20% of the frame without ports.** I'll put the labels and captions there.
- **The graphics card's row of ports should span at least half the frame width** in the wide shot. If it doesn't, move closer.
- **Keep the phone square to the panel,** not tilted, so each port's shape (HDMI's angled corners, DisplayPort's one clipped corner) is visible.

## 3. The shots

Start with the PC **on** and the monitor cable in the **motherboard** port. Moving a display cable while the PC is on is fine. Don't open the case.

| # | Shot | How | Length |
|---|---|---|---|
| A | **Rear panel, both port groups** | The tripod framing above. The cable in the motherboard port. No hands. | 5 s still |
| B | **Close: the cable in the motherboard port** | Move closer, or use the 2× lens, at the same angle. Keep one or two neighbouring USB ports in frame so it's clearly the motherboard. | 3 s still |
| C | **The move, one continuous take** | Back to shot A's exact framing. Your hand comes in, unplugs from the motherboard, plugs into the graphics card's port, and leaves. Use a normal, deliberate pace. **Film 3 takes** and I'll pick the cleanest. | 3–4 s each |
| D1 | **What the monitor shows: motherboard port** | Before shot C, film the monitor straight on, with the screen filling the frame and room lights low to cut reflections. Wait 10 s after plugging in. Film what really appears: the desktop, a black screen or a message. | 4 s |
| D2 | **What the monitor shows: graphics card port** | The same, after shot C. | 4 s |

**Also capture with the cable in each port,** as screenshots for the record, not the video:
- Settings › System › Display › Advanced display › **Display information.** It names the adapter driving the display.

**If the motherboard port shows the desktop,** that's the true result and the Short says so. "On this PC the motherboard port worked, through the CPU's graphics" is still a useful video. We don't stage NO SIGNAL.

## 4. Send me

- [ ] **The video clips** A, B, C (3 takes), D1 and D2, kept under 100 MB each; trim them if needed.
- [ ] **The two Display information screenshots.**
- [ ] **The facts table** from step 1.

Push them to a branch such as `footage/monitor-port` in this repo, or attach them to a draft GitHub release. Only GitHub is reachable from here.

## What I'll cut (8–10 s, silent)

| Time | Shot | On screen |
|---|---|---|
| 0–1.5 s | A: the cable already in the motherboard port | Large **MOTHERBOARD** and **GRAPHICS CARD** labels at their port groups. Caption: "Monitor plugged into the motherboard?" |
| 1.5–4 s | C: the move, done by about 4 s | The **GRAPHICS CARD** label lights up as the plug seats. |
| 4–7 s | D2, cut against D1 if it helps | Caption: what this PC actually showed, e.g. "On this PC: …" |
| 7–9.5 s | A or C's end frame | "If you have a dedicated GPU, check its display ports." Small `specsmithpc.com` in the scene. |

Shot B is used only if the wide shot doesn't make the motherboard port obvious at phone size.

**Claims stay within what your clips and screenshots show:**
- no FPS gain;
- no universal NO SIGNAL;
- no "your GPU is wasted".
