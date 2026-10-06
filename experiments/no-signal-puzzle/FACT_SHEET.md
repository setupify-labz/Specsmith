# Fact sheet: "NO SIGNAL — which port?" (experiment, 2026-10-06)

## The setup the video illustrates

| Part | Exact model | What the manufacturer documentation says | Source |
|---|---|---|---|
| CPU | Intel Core i5-12400F | No Intel Processor Graphics: the "F" model has no integrated graphics and needs a discrete graphics card. Socket FCLGA1700. | Intel product specifications, https://www.intel.com/content/www/us/en/products/sku/134587/intel-core-i512400f-processor-18m-cache-up-to-4-40-ghz/specifications.html; Intel support article "Intel Boxed Desktop Processors with No Intel Processor Graphics", https://www.intel.com/content/www/us/en/support/articles/000027144/processors/intel-core-processors.html |
| Motherboard | MSI PRO B760M-A WIFI (DDR5) | LGA1700. Rear outputs: 2× HDMI (2.1, 4K 60 Hz) and 2× DisplayPort (1.4, 4K 60 Hz), "available only on processors featuring integrated graphics". | MSI specification page, https://us.msi.com/Motherboard/PRO-B760M-A-WIFI/Specification |
| Graphics card | MSI GeForce RTX 4060 VENTUS 2X BLACK 8G OC | Outputs: 3× DisplayPort 1.4a and 1× HDMI (2.1a features). | MSI specification page, https://www.msi.com/Graphics-Card/GeForce-RTX-4060-VENTUS-2X-BLACK-8G-OC/Specification; MSI datasheet, https://storage-asset.msi.com/datasheet/vga/global/GeForce-RTX-4060-VENTUS-2X-BLACK-8G-OC.pdf |

**How these were read.** These manufacturer pages could not be fetched directly from the build environment (egress blocked). The facts above come from web-search results restricted to intel.com and msi.com, which quoted or summarised those pages. Before release, a person should open the three links once and confirm the quoted lines.

## What the sources prove, and what the video claims

- **The claim:** with this CPU, a monitor plugged into the motherboard's HDMI (A) shows no picture, and the same monitor plugged into the graphics card's HDMI (B) does.
- **Why it holds:** Intel says the i5-12400F has no processor graphics. MSI says this board's display outputs work only with a CPU that has integrated graphics. MSI says the card has an HDMI output.
- **Port A, motherboard:** "Needs a CPU with built-in graphics". This is MSI's own condition, stated generally. The video never says a motherboard port never works.
- **Port B, graphics card:** "Plug the monitor in here". This is advice for this setup.
- **The closing line:** "Have a graphics card? Check where the monitor is plugged in." It is a prompt to check, not a diagnosis.

## What is illustration, not evidence

- **All hardware** (tower, ports, cable, monitor, desktop) is drawn in code. No photograph, no footage, no recorded test of a real PC.
- **Port layout:**
  - The order of ports on the I/O shield is illustrative; the board's real stack may differ.
  - The card's bracket shows its documented 3× DP + 1× HDMI, but the exact order is illustrative.
- **Picture and sound:** the "HDMI" input message and the generic desktop are illustrative, and there is no operating-system or monitor branding.
- **Out of scope:**
  - No benchmark numbers or prices appear.
  - SpecSmith appears only as a sign-off. Nothing says SpecSmith or its Builder detects cables.
  - SpecSmith's CPU catalog does not currently record integrated graphics, so no SpecSmith feature is claimed.

## Assets and sound

| Asset | Origin | License |
|---|---|---|
| Every shape, port, cable, monitor and desktop | Drawn in code here (`src/Puzzle.tsx`) | Original |
| Font: Inter 500/700/800 | `@fontsource/inter` npm package | SIL Open Font License 1.1 |
| Sound | Synthesised locally with ffmpeg from sine waves and noise (`sound/build.mjs`): power thump, fan bed, whoosh, three ticks, cable rustle, plug clicks, a low two-note "no", a rising wake swell and two-note chime | Original; no samples, music or voice |
| Renderer: Remotion 4.0.533 | npm | Free for individuals and companies of up to 3 people; larger companies need a paid Remotion company license |
