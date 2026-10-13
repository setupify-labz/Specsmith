# SpecSmith Master Product Blueprint

> **Living product vision — 2026-10-13.** This document preserves Aaron's ideas and a proposed order for exploring them. It is not a claim that every feature exists, has been approved for implementation, is legally or commercially feasible, or will be built in this order. Keep uncertain ideas visible; change priorities as user evidence, technical work, budget, and retailer terms become clearer. The current shipped state and approved work live in the repository roadmap and scoped issues. A feature is done only when its issue's completion evidence says so.

**How to use this document:** When asked for the full SpecSmith site plan, start here. For current implementation status, read the roadmap and recent merged work. To start work, create or select one scoped issue with acceptance criteria. Update this blueprint when Aaron changes the vision; record the reason for a material change instead of silently deleting an older idea.

**Scope tags used below:** Core product direction is Build, Buy, and Test. Later possibilities include community, creator earnings, physical cosmetics, professional tools, and the Goal Room. Their inclusion here records the idea, not a launch commitment.

## 1. North-star vision

SpecSmith is a gaming-first computer platform that helps a person **build, buy, compare, test, understand, improve, and share** a PC.

The finished product should connect activities that currently require several disconnected websites:

- Build a compatible custom PC.
- Visualize that computer in an approachable 3D workspace.
- Find a trustworthy gaming laptop or prebuilt gaming desktop.
- Compare parts and complete systems in terms beginners understand.
- See game-performance information with honest evidence labels.
- Benchmark the user's actual computer.
- Explain performance problems and useful next steps.
- Publish builds and benchmark results to a community.
- Buy components, computers, and eventually physical cosmetics.
- Allow creators to earn from eligible purchases attributed to links they personally shared.

The concise promise is:

> **SpecSmith helps gamers build it, buy it, test it, and improve it—with evidence they can understand.**

SpecSmith should not become a generic electronics store. Its advantage is the connection between compatibility, gaming performance, real measurements, understandable explanations, and shopping.

---

## 2. Product principles

Every feature should obey these rules.

### 2.1 Beginner clarity

- A new builder should not need to understand sockets, chipset names, GPU power limits, or frame-time percentiles before using the site.
- Advanced details remain available, but they should not dominate the first view.
- Warnings must explain what is wrong, why it matters, and how to fix it.
- The normal Builder must feel simpler than PCPartPicker.

### 2.2 Evidence before claims

- Never fabricate FPS, temperature, battery-life, compatibility, pricing, or performance data.
- Keep measured, externally sourced, modeled, and unavailable data visibly separate.
- Missing information stays missing.
- A confident-looking interface must not conceal uncertain evidence.

### 2.3 Deterministic facts

- Normal software rules decide compatibility, identity, permissions, balances, prices, and publication states.
- AI may explain facts, suggest options, draft content, and flag anomalies.
- AI must not invent or silently override factual records.

### 2.4 User-first monetization

- Recommendations should not be secretly ranked by commission.
- Affiliate relationships must be disclosed.
- The core consumer experience remains free.
- A bad-value product should not receive a positive recommendation merely because it is monetizable.

### 2.5 Fast and accessible by default

- Important shopping information must work without WebGL or animation.
- Pages should remain useful on ordinary phones and laptops.
- Motion, RGB, airflow particles, and 3D detail need reduced-quality or off modes.
- Core pages should be keyboard accessible and understandable with a screen reader.

### 2.6 Gaming-first focus

The initial complete-system expansion includes:

- Gaming laptops
- Gaming prebuilts
- Custom gaming PCs
- Creator systems that also game

The initial expansion does **not** include generic office laptops, Chromebooks, corporate procurement, or every specialist workstation category. Those can become a later `SpecSmith Work` experience if the gaming product succeeds.

---

## 3. Core audiences

### 3.1 First-time builder

Needs simple part choices, compatibility help, installation guidance, and reassurance.

### 3.2 Gamer buying a complete computer

Wants the best gaming laptop or prebuilt for a budget without decoding misleading listings.

### 3.3 Existing PC owner

Wants to know whether the computer performs normally, which settings to change, or what to upgrade.

### 3.4 Enthusiast

Wants deeper comparison controls, evidence, telemetry, build sharing, and customization.

### 3.5 Creator or community member

Wants to publish builds, make 3D creations, gain an audience, and eventually earn from personally attributed purchases.

### 3.6 Repair shop or professional user

A later audience that may value shareable diagnostics, history, cloud saves, and white-label reports. These professional features should not make the free consumer product worse.

---

## 4. The three primary user journeys

The homepage and navigation should organize the large vision around three understandable actions.

### 4.1 Build

For users who want a custom PC:

1. Choose a guided goal, budget, games, resolution, and visual theme—or start manually.
2. Select compatible components in the normal Builder.
3. See the build at all times in a persistent panel.
4. Receive inline compatibility, power, size, and configuration warnings.
5. Switch into the 3D Builder when a supported visual model exists.
6. Customize fans, airflow direction, RGB, cables, and cosmetics.
7. Review performance evidence, price, uncertainty, and alternatives.
8. Save, share, publish, or purchase the build.

### 4.2 Buy

For users who want a complete system:

1. Choose gaming laptop, gaming desktop, or “help me decide.”
2. Enter budget, games, desired performance, portability, screen, and upgrade preferences.
3. Receive a small set of explained recommendations.
4. Compare exact configurations, not vague product-family names.
5. Review verified offers and seller information.
6. Compare the complete system against a comparable custom build.
7. Follow an affiliate link to the chosen retailer.

### 4.3 Test

For users who already own a computer:

1. Download the free SpecSmith desktop application.
2. Detect hardware and installed games.
3. Run Quick Test, Guided Test, or AutoBench where supported.
4. Capture real frame-time and supporting telemetry evidence.
5. Validate the run.
6. Explain the result in beginner-friendly language.
7. Suggest settings, additional tests, or upgrades.
8. With permission, upload validated evidence to improve SpecSmith's public data.

---

## 5. Website information architecture

### 5.1 Main navigation

- **Build**
- **Gaming PCs**
- **Gaming Laptops**
- **Compare**
- **Performance**
- **Community**
- **Guides**

### 5.2 Suggested routes

#### Build

- `/build`
- `/build/3d`
- `/build/guided`
- `/upgrade`
- `/builds`

#### Complete systems

- `/gaming-pcs`
- `/gaming-pcs/[exact-configuration-slug]`
- `/gaming-laptops`
- `/gaming-laptops/[exact-configuration-slug]`
- `/gaming-laptops/best/[budget-or-use]`

#### Comparison and performance

- `/compare`
- `/compare/parts/[pair]`
- `/compare/laptops/[pair]`
- `/compare/prebuilts/[pair]`
- `/compare/system-options/[scenario]`
- `/games/[game]`
- `/benchmarks`
- `/test-my-pc`
- `/coach`

#### Community and education

- `/community/builds`
- `/community/creators/[creator]`
- `/guides`
- `/guides/[topic]`

### 5.3 Homepage goal

The homepage should make SpecSmith understandable within seconds.

Suggested hero:

> **Build it, buy it, or test it. Find the right gaming PC with evidence you can understand.**

Primary actions:

- Build a PC
- Find a Gaming Laptop
- Find a Gaming Desktop
- Test My PC

Suggested homepage sequence:

1. Hero and primary paths
2. Build, Buy, or Test explanation
3. “Find a PC for your games” entry point
4. Selected gaming laptops and prebuilts
5. Popular custom and community builds
6. Custom versus prebuilt versus laptop explainer
7. Search game performance
8. Benchmark-app introduction
9. Trust and evidence explanation
10. Helpful guides and qualifying deals

The homepage introduces the ecosystem; it should not attempt to contain every feature.

---

## 6. Normal PC Builder

The normal image-based Builder should be completed before the full 3D catalog. It is the dependable foundation that can support far more parts.

### 6.1 Main experience

- Persistent build panel on desktop
- Hide/open build control
- Compact mobile build drawer
- Categories that do not require repeated back-navigation
- Search and meaningful filters
- White-build and black-build discovery
- Images for every supported part when rights and data permit
- Simple and advanced modes
- Save, duplicate, export, and share

### 6.2 Guided start

The user can answer:

- Total budget
- Main games
- Desired resolution
- Desired frame-rate target
- Existing monitor
- Appearance preference
- Noise preference
- Wi-Fi requirement
- Storage requirement
- Whether the user is comfortable assembling a PC

SpecSmith can then produce a starting build with clear reasons. It must not claim this is the universally “best” build.

### 6.3 Compatibility engine

Deterministic rules should validate:

- CPU socket
- Chipset and BIOS support
- RAM generation, capacity, speed support, and slots
- Motherboard form factor
- Case motherboard support
- GPU length, height, thickness, and slots
- CPU-cooler height
- Radiator size and mounting position
- Radiator, RAM, GPU, and case clearance
- PSU form factor and capacity
- Required power connectors
- Storage slots and bays
- PCIe slot and lane constraints
- Front-panel, USB, RGB, and fan headers
- Fan sizes and mounting positions
- Vertical GPU support
- Cable and cosmetic obstruction where verified geometry exists

Every result should be one of:

- Confirmed compatible
- Confirmed incompatible
- Possible issue requiring verification
- Cannot confirm because required information is missing

### 6.4 Power and bottleneck guidance

- Power estimates should include methodology and safety headroom.
- Bottleneck language should be workload-specific, not one fake universal percentage.
- Recommendations should account for resolution, game, settings, and target frame rate.
- The Builder should say “likely CPU-limited in these conditions” rather than “12% bottleneck.”

### 6.5 Shopping behavior

- Show only qualifying, sufficiently fresh offers.
- Explain unavailable and overpriced states.
- Offer compatible alternatives.
- Preserve the selected technical product when switching retailer offers.
- Never let offer price determine product identity or verified specifications.

---

## 7. 3D Builder

The 3D Builder is the visual and emotional differentiator, while the normal Builder remains the broad catalog foundation.

### 7.1 Core modes

- **Explore:** freely design a computer.
- **Guided Build:** install components step by step.
- **Upgrade Mode:** load an existing PC and replace parts.
- **Copy Build:** begin from a community build.
- **Remix Build:** modify a public build while preserving attribution.
- **Showcase Mode:** present the finished computer without technical overlays.

### 7.2 Visual capabilities

- Realistic proportions and scale
- Correct position and orientation
- Animated installation and removal
- Camera rotate, zoom, and interior focus
- Transparent case panels
- Exploded view
- Part labels
- Installation-order guidance
- Supported cable connections
- Moving fan blades
- RGB zones and themes
- Light and dark room previews
- Finished shareable showcase

### 7.3 Airflow

Users should be able to:

- Choose normal or reverse-blade fans
- Set intake or exhaust
- Change approximate fan speed
- Turn airflow particles on or off
- Use Balanced, Quiet, Maximum Cooling, Positive Pressure, or Custom presets
- Receive warnings for poor arrangements

Possible warnings:

- No practical exhaust
- All fans set to exhaust
- Restricted GPU intake
- Radiator arrangement may recycle warm air
- Cosmetic appears to obstruct a fan
- Large intake/exhaust imbalance

The animation is educational, not computational fluid dynamics. It must not invent exact temperature improvements.

### 7.4 RGB and cosmetics

- Per-zone colors
- Gradients
- Brightness
- Effects
- Virtual synchronization
- Saved themes
- Reduced-motion mode
- Case ears, horns, wings, antennae, badges, decals, figures, GPU supports, fan grilles, cable combs, internal signs, and panel artwork

Cosmetics should be labeled:

- Virtual only
- Physical product available
- Community-created
- Verified to fit
- Possible airflow or clearance concern
- Fit unverified

Only original or properly licensed artwork should be public or sellable.

### 7.5 Physical products

Practical early products:

- Vinyl decals
- Magnetic badges
- Cable combs
- Decorative fan grilles
- Simple GPU supports
- Non-structural case ears

Required checks include heat resistance, electrical conductivity, attachment security, sharp edges, dimensions, tolerances, fan interference, airflow obstruction, and shipping durability.

### 7.6 3D asset pipeline

AI and tools such as Meshy may help generate draft assets, but verified manufacturer dimensions control compatibility.

Pipeline:

1. Identify a missing component.
2. Acquire permitted reference material.
3. Record authoritative dimensions and identity.
4. Generate or model a draft mesh.
5. Optimize geometry and textures.
6. Set scale, units, orientation, anchors, mounting points, moving parts, and RGB zones.
7. Compare renders against references.
8. Test in known builds.
9. Run geometry and performance checks.
10. Publish only after critical checks pass.

Outcomes:

- Green: eligible for publication
- Yellow: human review required
- Red: reject or regenerate
- Gray: insufficient evidence

AI-estimated dimensions can never become compatibility evidence.

---

## 8. Gaming laptops

Gaming laptops are the best first complete-system expansion because they match SpecSmith's gaming and performance identity.

### 8.1 Laptop finder

Ask for:

- Budget
- Games
- Resolution and frame-rate target
- Screen size
- Portability
- Battery importance
- Gaming-and-school or gaming-and-work use
- Content-creation needs
- Storage
- Upgradeability
- Noise tolerance
- New or refurbished preference later

Return a small explained set:

- Best overall match
- Best value
- Best performance
- Best portable choice
- Best gaming-and-school choice

### 8.2 Required exact-configuration data

- Manufacturer and family
- Exact model number
- Exact configuration and retailer SKU
- CPU
- GPU
- GPU power limit
- VRAM
- RAM capacity, channel configuration, speed, soldered amount, and slots
- Storage and available slots
- Display resolution, refresh rate, panel, brightness, response, and color coverage when verified
- Battery capacity and trustworthy tested life when available
- Weight and dimensions
- Ports and charging
- Webcam and keyboard information
- Cooling and noise evidence
- Performance modes
- Warranty and repairability
- Price, availability, seller, source, and verification time

Two laptops with the same family name or GPU name must not silently share results.

### 8.3 Exact laptop page

1. Short verdict
2. Verified offers
3. Reasons to buy
4. Reasons to avoid
5. Exact reviewed configuration
6. Gaming performance and evidence level
7. Display
8. Cooling and noise
9. Battery and portability
10. RAM and storage upgradeability
11. Better alternatives
12. Price history
13. Sources and last-updated information
14. Affiliate disclosure

### 8.4 Laptop page families

- Exact-configuration pages
- Laptop-versus-laptop pages
- Best laptops for a game
- Best laptops by budget
- Best laptops by use case
- Laptop GPU power-limit explainers
- Gaming desktop versus gaming laptop

Budget pages must fail closed when fresh qualifying prices are unavailable.

---

## 9. Gaming prebuilts

Prebuilts serve users who want desktop performance without assembly.

### 9.1 Required information

- Exact configuration and SKU
- CPU and GPU
- RAM capacity, speed, channel configuration, and upgradeability
- Storage and expansion
- Case and airflow
- CPU cooler
- Motherboard when disclosed
- PSU brand, model, wattage, and rating when disclosed
- Proprietary components
- Standard versus nonstandard connectors
- Warranty and support
- Seller and condition
- Current qualifying offers
- Comparable custom-build cost
- Measured or estimated performance with labels

Unknown components remain explicitly unknown.

### 9.2 Quality warnings

- Single-channel memory
- Weak or undisclosed PSU
- Proprietary motherboard or connectors
- Restricted airflow
- Insufficient cooling
- Very limited storage expansion
- Misleading configuration title
- Marketplace seller risk
- Poor value at the current price

### 9.3 Custom versus prebuilt versus laptop

SpecSmith should compare complete ownership choices, not only FPS:

- Price
- Performance
- Portability
- Included display and peripherals
- Warranty
- Assembly effort
- Upgradeability
- Thermals and noise
- Repairability
- Expected useful life

There is no universal winner; the recommendation depends on the user.

---

## 10. Product identity, catalog, and offers

The catalog must separate three layers.

### 10.1 Canonical product identity

The stable technical identity: for example, a GPU model, CPU model, laptop family, or exact prebuilt product.

### 10.2 Exact configuration

The purchasable technical configuration: CPU, GPU, memory, storage, display, power limits, and other per-unit facts.

### 10.3 Retailer offer

The seller-specific commercial listing: retailer, marketplace seller, URL, affiliate URL, price, shipping, stock, condition, SKU, last checked time, and qualification state.

An offer may disappear or change without changing the underlying product record. A retailer title may be wrong; it cannot overwrite verified identity.

### 10.4 Price states

- Loading
- Fresh and qualified
- Stale
- Listing disappeared
- Seller or configuration mismatch
- Unavailable
- Fetch failed

The interface should not show endless “Checking” states or preserve stale prices as if they are current.

### 10.5 Catalog admission

- Normalize identity before deduplication.
- Do not use arrival order as the product-quality ranking.
- Apply explicit offer qualification.
- Preserve reasons for rejection.
- Prefer exact SKU, UPC, MPN, and retailer identifiers where available.
- Perform periodic audits for configuration drift.

---

## 11. Performance evidence

Every displayed number must carry one of these levels.

### 11.1 SpecSmith measured

Captured through a controlled SpecSmith test with raw evidence and full provenance.

### 11.2 Validated community measurement

Captured through SpecSmith and accepted by automated and server-side validation.

### 11.3 Trusted external measurement

Properly attributed external testing with sufficiently comparable conditions.

### 11.4 Model estimate

Produced by a documented model and clearly labeled as an estimate rather than a benchmark.

### 11.5 Unavailable

Not enough comparable evidence.

Public aggregates must separate desktop and laptop hardware, resolution, preset, ray tracing, upscaler, Frame Generation, game version, driver context, power mode, and sufficiently different configurations.

---

## 12. Benchmark desktop application

### 12.1 Finished user experience

1. Install the free application.
2. Detect CPU, GPU, RAM, Windows, drivers, and installed games.
3. Choose one or several supported games.
4. Select Quick Test, Guided Test, or AutoBench.
5. Follow simple instructions or allow supported automation.
6. Receive a clear report.
7. Optionally contribute the validated result.

No terminal commands should be required in the finished app.

### 12.2 Testing modes

- **Quick Test:** the user plays normally while SpecSmith records.
- **Guided Test:** the user reaches a known location and follows instructions while SpecSmith controls capture.
- **AutoBench:** SpecSmith configures, launches, warms up, benchmarks, repeats, restores, and closes a supported game.

### 12.3 Support levels

- Certified AutoBench
- Guided Benchmark
- Universal Capture

The interface must not describe a guided or universal capture as fully automated.

### 12.4 AutoBench workflow

1. Confirm installation and launch access.
2. Detect the game version.
3. Read the graphics configuration.
4. Back up the user's settings.
5. Apply a verified test profile.
6. Launch through the proper launcher.
7. Wait for the real game process.
8. Allow shader and asset warmup.
9. Detect the benchmark section.
10. Start frame-time capture and telemetry.
11. Exclude menus, loading screens, and transitions.
12. Stop at the correct boundary.
13. Validate the run.
14. Repeat, normally three times.
15. Check agreement between runs.
16. Restore the original configuration.
17. Close the game safely.
18. Clean capture sessions, locks, and temporary files.
19. Cool down before the next game where necessary.
20. Produce a final report.

Multiple games run sequentially, never simultaneously.

### 12.5 Recorded route runner

For suitable offline games without a built-in benchmark:

- Start from a known save or checkpoint.
- Replay approved controller inputs.
- Verify visual checkpoints.
- Detect death, getting stuck, or route deviation.
- Reject invalid runs.
- Restrict early automation to offline and single-player contexts.
- Never bypass anti-cheat or automate competitive matches.

### 12.6 Measurements

- Average FPS
- 1% and 0.1% lows
- Frame-time distribution and consistency
- Stutters and spikes
- Duration and frame counts
- CPU and GPU utilization
- CPU and GPU temperatures
- Clock speeds
- Power when available
- VRAM and RAM usage
- Thermal-throttling indicators
- Background interference
- Driver, Windows, and game versions

Unavailable sensors stay unavailable.

### 12.7 Provenance

Every run should preserve:

- Unique run ID and timestamps
- Exact game and process
- Hardware identity and raw detected strings
- Desktop or laptop classification
- Resolution and settings
- Settings/configuration hash
- Driver, Windows, and game versions
- Capture-tool version and SHA-256
- Collector version and build identity
- Duration and frame counts
- Raw frame-time and telemetry archives
- Published segment boundaries
- Parsed statistics
- Detection methods
- User-attested fields
- Missing fields and reasons
- Warnings and rejection reasons
- Canonical SpecSmith identifiers

### 12.8 Validation outcomes

- Valid
- Warning
- Review required
- Rejected
- Insufficient evidence

Reasons include incorrect process, insufficient duration, too few frames, malformed data, loading-screen dominance, settings mismatch, identity uncertainty, thermal throttling, interference, route failure, tool mismatch, repeated-run disagreement, incomplete restoration, duplicates, manipulation, or corrupted evidence.

---

## 13. AI Performance Coach

The Coach translates evidence into understandable next steps.

It can:

- Explain averages, lows, frame times, and stutters.
- Identify likely CPU, GPU, memory, thermal, or background-process limitations.
- Explain uncertainty and competing causes.
- Recommend graphics-setting changes.
- Compare before-and-after tests.
- Suggest the next useful test.
- Estimate upgrade effects with explicit estimate labels.
- Explain whether performance resembles comparable systems.

It must not:

- Invent FPS or sensor values.
- Diagnose a precise cause without enough evidence.
- Treat correlation as proof.
- Diagnose thermal paste from temperature alone.
- Hide missing data.
- Prioritize affiliate revenue over an honest conclusion.

---

## 14. Community, sharing, and creators

### 14.1 Community features

- Public, private, and unlisted builds
- Likes, comments, replies, saves, and reports
- Creator profiles
- Build versions
- Copy and remix
- Parent-build attribution
- Verified-purchase badge later
- Shared benchmark results
- Trending, new, budget, high-end, small-form-factor, color-theme, quiet, and game-specific discovery

### 14.2 Remix rules

- Credit the original build.
- Recalculate compatibility and performance.
- Give the remix creator a separate link.
- Earnings follow the traffic each creator personally generated.
- The original creator does not automatically earn from an independently shared remix unless a separate royalty system is deliberately created later.

### 14.3 Creator share links

- Public SpecSmith build URL
- Unique attribution identifier
- Social preview image or video
- Campaign parameters
- Click analytics
- Purchase-attribution state
- QR code later

Creators should share the SpecSmith page, not raw retailer affiliate links.

### 14.4 Creator commissions

The intended rule is:

> A creator earns only from an eligible confirmed purchase attributed to the SpecSmith link that creator personally shared.

The flow:

1. Publish a qualifying build.
2. Assign a share identifier.
3. Record an eligible visit.
4. Record a qualifying retailer click.
5. Receive retailer confirmation.
6. Wait through cancellation and return periods.
7. Calculate eligible net commission actually received by SpecSmith.
8. Credit the permitted creator share.
9. Pay after the threshold and compliance checks.

Likes, views, estimated cart value, unconfirmed orders, returns, self-purchases, bots, cookie stuffing, and normal gallery discovery do not create earnings.

Commission sharing launches only after each affiliate program explicitly permits it and tax, age, guardian, payout, fraud, refund, disclosure, and audit requirements are resolved.

---

## 15. Content Machine

The Content Machine turns approved SpecSmith evidence into useful videos and posts without allowing AI to fabricate claims or publish unchecked material.

### 15.1 Inputs

- Mission and brand rules
- Approved facts
- Evidence records
- Allowed disclosures
- Page-render capabilities
- Available visual assets and their rights
- Platform requirements
- Prior creative fingerprints and performance

### 15.2 Workflow

1. Research a user problem or content opportunity.
2. Produce several meaningfully different concepts.
3. Reject unsupported claims.
4. Check whether every promised visual can actually be produced.
5. Select a concept with one clear learning objective.
6. Build script, storyboard, captions, voice, visuals, and disclosures.
7. Bind every claim to evidence.
8. Render a review artifact.
9. Verify the exact rendered bytes and timing.
10. Require genuine human review.
11. Publish only after all quality, rights, evidence, and platform gates pass.
12. Record analytics without pretending correlation proves causation.

### 15.3 Content formats

- Animated component races
- Game-specific laptop recommendations
- Custom versus prebuilt explanations
- Beginner compatibility lessons
- FPS and frame-time explanations
- Build transformations
- 3D installation animations
- Deal explanations using fresh qualifying prices
- Community build spotlights
- Benchmark result stories

### 15.4 Creative standards

- The opening communicates the problem or payoff quickly.
- Game names and labels remain readable on a phone.
- Animation supports comprehension rather than adding noise.
- Voice must be natural enough to retain viewers.
- Captions remain readable and synchronized.
- Measured and estimated figures receive visible labels.
- One video should teach or prove one main thing.

### 15.5 Publishing and learning

Track platform, hook, format, duration, edit density, captions, first visual, voice, sound density, CTA, hashtags, experiment, changed variable, creative lineage, freshness, asset mix, cost, time, and UTM attribution.

The system may become human-review-ready automatically. It must not treat that as human approval.

---

## 16. Goal Room and future AI team

Aaron's long-term idea is a shared Goal Room: give one outcome such as “fix the builder's mobile navigation,” then have specialist agents discuss the task, implement, review, test, and report the result without Aaron relaying messages or repeatedly saying “continue.” The same workflow could eventually help with website pages, benchmarks, 3D parts, and videos. This is an internal operating tool concept, not a feature that currently works unattended.

The Goal Room should show the goal, agent messages, owner of each step, evidence, costs, review findings, current blockers, and the exact meaning of “done.” Aaron can address the team or one agent, switch roles on or off, pause a goal, and inspect the work. The team should ask Aaron only for decisions that truly require him; a blocked step must not silently become “complete.”

**First proof:** Two roles—implementation engineer and independent reviewer—complete one small real issue through a durable record, code change, tests, review, revision if needed, and a verified result. Test this with a fresh session or process that actually resumes on its own. A green trigger, a posted comment, or a run ending `need_input` is not proof of unattended completion. Set round, runtime, and cost caps and a stop control.

**Later:** Add specialist roles only when a real task needs them and the first proof is dependable. A role does not require a distinct model provider. A 3D asset operator may control generation tools, but reference dimensions, geometry, licensing, and fit still require verification. The Goal Room can grow a shared chat and solo/team controls without granting every agent every permission.

Each AI needs a narrow role, permissions, and verifiable outputs.

### 16.1 Product and strategy reviewer

- Protect product focus
- Challenge low-value scope
- Review evidence and UX decisions
- Approve plans, not production deployments

### 16.2 Implementation engineer

- Build scoped features
- Write tests
- Produce commits and PRs
- Respond to review findings

### 16.3 Data-integrity and benchmark reviewer

- Audit identities, evidence, formulas, telemetry, and validation
- Block unsupported claims
- Maintain provenance rules

### 16.4 UX, accessibility, and performance reviewer

- Inspect desktop and mobile interfaces
- Test accessibility and performance budgets
- Prevent confusing or heavy experiences

### 16.5 Content and growth operator

- Research demand
- Create evidence-bound concepts
- Operate the Content Machine
- Analyze outcomes without fabricating insight

### 16.6 3D asset operator

- Coordinate references, draft generation, optimization, anchors, fit tests, and render review
- Never assign authoritative dimensions from AI guesses

### 16.7 Security and release reviewer later

- Dependency and secret scanning
- Permission review
- Release readiness
- Incident and rollback planning

Agents may communicate through a durable shared conversation plus structured briefs, findings, evidence references, and PR reviews. The coordinator must distinguish an agent's suggestion from a verified action. No agent should have unlimited ability to change code, publish content, spend money, or approve its own work. Tool permissions and standing authorization must be explicit and narrow; never hide a prompt for credentials, spending, publication, or an irreversible decision in a background loop.

---

## 17. SEO and discovery

### 17.1 Page requirements

- Self-referential canonical URL
- Unique useful title and description
- Server-rendered or prerendered primary content
- Fast static summary before interactive code
- Structured data only when accurate and eligible
- Internal links that reflect user journeys
- Static images and text fallbacks for 3D content
- Accurate update and evidence information

### 17.2 High-value search clusters

- Exact gaming-laptop models
- Laptop comparisons
- Laptop GPU power differences
- Best laptop for a specific game
- Best gaming laptop by honest budget
- Exact gaming prebuilts
- Prebuilt versus custom
- CPU/GPU game-performance comparisons
- Compatibility questions
- Upgrade decisions
- Benchmark and troubleshooting questions

### 17.3 Quality rules

- Do not index private, copied, empty, or thin build pages.
- Do not generate thousands of near-identical comparison pages without useful evidence.
- Do not promise live prices when the feed is stale or missing.
- Do not allow incorrect canonicals to collapse distinct pages into the homepage.

---

## 18. Monetization

### 18.1 Free core

- Normal Builder
- Basic 3D Builder
- Compatibility checking
- Gaming-laptop and prebuilt discovery
- Basic comparisons
- Airflow and RGB visualization
- Publishing and sharing builds
- Benchmark application
- Basic AI explanations

### 18.2 Revenue sources

- Retailer affiliate commissions
- Retained portion of permitted creator-attributed commissions
- Physical cosmetic margins
- System-integrator partnerships later
- Optional professional tools later
- White-label shop reports later

### 18.3 Monetization protections

- Disclose affiliate relationships.
- Rank by user fit and evidence, not commission.
- Record why a recommendation was made.
- Preserve retailer and seller identity.
- Adjust creator balances for returns and reversals.
- Never promise creator percentages before real commission, fee, refund, and compliance data exist.
- Before expanding a curated catalog, compare the real cost of keeping exact configurations and offers current with qualified clicks and confirmed commissions. Do not assume traffic or a low affiliate rate will pay for ongoing data work.

---

## 19. Privacy, safety, security, and accessibility

### 19.1 Privacy and security

- Benchmarking works locally without forced upload.
- Upload is opt-in and explains exactly what is sent.
- Avoid personal paths and usernames in public data.
- Do not collect unrelated files.
- Protect raw telemetry.
- Sign and securely update the desktop app.
- Pin and verify capture tools.
- Never bypass anti-cheat.
- Allow immediate cancellation.
- Validate uploads server-side; never trust the client automatically.

### 19.2 Accessibility

- Complete keyboard navigation outside 3D viewport
- Text equivalents for visual compatibility information
- High contrast
- Reduced motion
- Animation and airflow toggles
- Color-independent warnings
- Screen-reader labels
- Accessible social controls
- Captions and text for guided animations
- Complete non-3D path

### 19.3 Performance budgets

- Compressed GLB models and textures
- Level of detail
- Load assets only when needed
- Avoid rendering hidden components
- Low-quality mode
- No forced animation
- Keep shopping and SEO content independent of WebGL
- Measure SpecSmith's own benchmark overhead
- Treat measurable capture interference as a release blocker

---

## 20. Product roadmap and completion gates

This is a proposed dependency map, not a single mandatory sequence. Some small website, content, and automation work can proceed in parallel when scoped issues and evidence allow it. Each phase should produce a useful, reviewable result rather than a huge untestable branch. Do not mark phases complete from this document alone.

### Phase 0: Product definition

Deliverables:

- Approve this master blueprint.
- Define the Build/Buy/Test information architecture.
- Document evidence terminology.
- Define explicit non-goals.

Completion gate:

- A new visitor can understand what SpecSmith does from the planned homepage and navigation.

### Phase 1: Data and catalog integrity

Deliverables:

- Canonical identity separated from exact configuration and retailer offer.
- Optional UPC, MPN, SKU, and source references.
- Per-unit specifications cannot leak across variants.
- Reliable price and availability states.
- Offer qualification and rejection reasons.
- Tests for variant mismatch, stale offers, missing data, and catalog ordering.

Completion gate:

- A retailer listing cannot silently change a product's technical facts.
- Missing or failed price data cannot become a current shopping claim.

### Phase 2: Dependable normal Builder

Deliverables:

- Persistent desktop build panel and mobile drawer.
- Clear category browsing.
- Deterministic compatibility explanations.
- Saved builds.
- Shareable build pages.
- Basic retailer alternatives.

Completion gate:

- A beginner can create and understand one compatible build without leaving the main workflow.

### Phase 3: Site structure refresh

Deliverables:

- Build/Buy/Test homepage.
- New navigation.
- Gaming Laptops and Gaming PCs landing pages.
- Reusable product, comparison, evidence, and offer components.
- Mobile, accessibility, performance, and canonical checks.

Completion gate:

- The new sections feel like one gaming platform rather than unrelated websites.

### Phase 4: Gaming-laptop MVP

Deliverables:

- Exact-configuration schema.
- 20–30 curated products after the schema proves safe.
- Three polished initial product pages before bulk expansion.
- One laptop comparison.
- Small finder prototype.
- Verified offers and unavailable states.

Completion gate:

- The site can distinguish configurations with the same family or GPU name and make a useful recommendation without unsupported performance claims.

### Phase 5: Gaming-prebuilt MVP

Deliverables:

- Curated prebuilt catalog.
- Undisclosed-component handling.
- Proprietary-part and upgradeability warnings.
- Comparable custom-build view.
- Prebuilt comparison pages.

Completion gate:

- A user can understand what is known, unknown, good, and risky about an exact prebuilt.

### Phase 6: Comparison and recommendation engine

Deliverables:

- Custom versus prebuilt versus laptop flow.
- User-goal questionnaire.
- Explained recommendation categories.
- Workload-specific limitation guidance.
- Auditable recommendation reasons.

Completion gate:

- Two users with different portability and upgrade needs can receive different, explainable results.

### Phase 7: First polished 3D proof

Deliverables:

- One complete seven-part reference PC.
- Verified scale and anchors.
- Installation animation.
- Fan motion, basic airflow, and RGB.
- Accessible text fallback.
- Browser and mobile performance checks.

Completion gate:

- The reference build loads smoothly and its geometry is sufficiently accurate for the supported compatibility claims.

### Phase 8: Benchmark proof and expansion

Deliverables:

- One-command Windows test launcher.
- One controlled verified game benchmark.
- Three repeatable runs.
- Hardware telemetry.
- Reusable adapter framework.
- Simple desktop interface.
- Three to five supported games.
- Sequential testing.

Completion gate:

- One real PC can complete a controlled test, preserve raw evidence, restore state, and produce reproducible results without leftover capture sessions.

### Phase 9: Benchmark ingestion and public evidence

Deliverables:

- Consent-based upload.
- Server-side validation.
- Duplicate, corruption, outlier, and mismatch handling.
- Review queue.
- Privacy protection.
- Public aggregates with sample size and evidence tier.

Completion gate:

- One submitted result cannot automatically become “the FPS this hardware gets.”

### Phase 10: AI Coach

Deliverables:

- Beginner result explanation.
- Evidence-bound likely causes.
- Setting recommendations.
- Before-and-after comparisons.
- Additional-test suggestions.

Completion gate:

- Every factual statement can be traced to a measurement or labeled estimate, and uncertainty is visible.

### Phase 11: Community

Deliverables:

- Accounts and ownership.
- Public/private/unlisted builds.
- Likes, comments, saves, reports, moderation.
- Remix attribution.
- Creator profiles and share analytics.

Completion gate:

- A creator can publish, share, receive engagement, and have attribution recorded without payouts.

### Phase 12: Content Machine production readiness

Deliverables:

- Approved-fact ingestion.
- Divergent concept generation.
- Evidence and deliverability gates.
- Verified voice and visuals.
- Human review bound to exact media.
- Platform-specific publishing and analytics.

Completion gate:

- One genuinely reviewed piece of content can be produced, approved, published, and audited end to end without fabricated claims.

### Phase 13: Creator earnings pilot

Deliverables:

- Retailer permission.
- Fraud-resistant attribution.
- Terms, age and guardian rules, tax and payout process.
- Pending, confirmed, reversed, and paid balances.
- Small controlled creator cohort.

Completion gate:

- SpecSmith can prove that a qualifying commission was actually received and correctly attributed before crediting a creator.

### Phase 14: Physical cosmetics pilot

Deliverables:

- One or two low-risk accessory types.
- Design preview and fit rules.
- Manufacturing partner.
- Safety and quality validation.
- Fulfillment and refund handling.

Completion gate:

- A real product can be ordered, produced, shipped, and reviewed without claiming unverified fit or safety.

### Phase 15: Later expansion

Possible additions:

- Creator systems
- Streaming PCs
- Video-editing and Blender systems
- `SpecSmith Work`
- Professional workstations
- More games and laptop models
- More physical accessories
- System-integrator partnerships
- Optional professional reporting tools
- Goal Room beyond its two-agent proof, if the proof actually reduces supervision and cost

---

## 21. Candidate next product package

One candidate for the next focused product package is:

> **Define and prove the data foundation for complete gaming systems, then release one small high-quality gaming-laptop experience without weakening the existing Builder and performance systems.**

The first scoped package should contain:

1. Exact product/configuration/offer data specification.
2. Required laptop fields and missing-data behavior.
3. Evidence-level definitions.
4. URL and page-template specification.
5. Build/Buy/Test homepage wireframe.
6. Three exact laptop pages.
7. One useful laptop comparison.
8. A small laptop-finder prototype.
9. Tests for configuration leakage, stale pricing, unsupported performance claims, canonical URLs, accessibility, and mobile behavior.

Do not treat this candidate as automatic authorization to build laptop pages or reorder approved site work. Reconcile it with the current roadmap, live site problems, user research, and Aaron's priority before creating scoped issues. Only expand a catalog after exact configuration and offer data prove dependable.

---

## 22. Measures of success

### Product usefulness

- Builder completion rate
- Finder completion rate
- Comparison engagement
- Users who reach a qualified retailer offer
- Users who return to saved builds or results

### Trust and data quality

- Product identity mismatch rate
- Stale or rejected offer rate
- Percentage of claims with traceable evidence
- Benchmark acceptance and rejection reasons
- Settings-restoration success
- Rate of missing data incorrectly displayed as known: target zero

### Growth

- Indexed useful pages
- Search clicks by intent cluster
- Branded search growth
- Community shares
- Qualified retailer-click conversion
- Content-assisted visits

### Experience quality

- Core Web Vitals
- Mobile usability
- Accessibility findings
- 3D load time and smoothness
- Benchmark recorder overhead
- User understanding in short usability tests

### Monetization

- Qualified retailer clicks
- Confirmed commissions after returns
- Revenue per useful session
- Commission reversal rate
- Creator-attributed revenue later

Revenue must be evaluated alongside trust and user outcomes, not alone.

---

## 23. Final end state

At maturity, a user could tell SpecSmith:

> “I have $1,300, play Fortnite and Cyberpunk, need portability for school, and want at least 100 FPS in competitive games.”

SpecSmith could then:

1. Explain whether a custom desktop, prebuilt, or gaming laptop best fits.
2. Show a few exact options with verified specifications.
3. Separate measured results from estimates.
4. Explain display, cooling, battery, noise, warranty, and upgrade tradeoffs.
5. Show fresh qualifying retailer offers.
6. Let the user buy or save the choice.
7. Later benchmark the purchased system.
8. Explain whether it performs normally.
9. With permission, add the validated result to the public evidence.
10. Improve future recommendations using trustworthy aggregated data.

That closed loop—**choose, build or buy, test, explain, contribute, improve**—is the defensible long-term SpecSmith product.

---

## 24. Keeping the vision useful

New ideas belong in this blueprint or a linked idea issue, even when they are not ready to build. Preserve the original intent and note when an idea was changed or deferred. Before promoting one into the active roadmap, record:

1. **Who has the problem?** Describe the user and the job they are trying to finish.
2. **What evidence is there?** Separate observed user behavior, verified data, founder judgment, and a guess.
3. **What is the smallest useful proof?** Test one real journey before expanding a catalog, model library, agent team, or content format.
4. **What will it cost to keep working?** Include data updates, licenses, moderation, API usage, asset production, and support—not only build time.
5. **What would change the decision?** Name a result that would justify continuing, changing direction, or stopping.

Use a scoped issue for the chosen proof, then update its status from actual evidence. This blueprint keeps the endgame visible; it does not authorize an agent to start every idea in it.
