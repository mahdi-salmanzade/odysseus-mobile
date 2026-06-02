---
name: Odysseus Mobile
description: Native LAN remote for the self-hosted Odysseus AI workspace
colors:
  bg: "#16161a"
  surface: "#1f1f25"
  surface-alt: "#26262e"
  border: "#2c2c35"
  text: "#e8e8e8"
  text-dim: "#bdbdc7"
  text-faint: "#8a8a96"
  accent: "#e06c75"
  accent-dim: "#9e4d54"
  on-accent: "#0e0e12"
  user-bubble: "#5a2f37"
  assistant-bubble: "#1f1f25"
  danger: "#e0685e"
  warn: "#e0a85e"
  ok: "#5ec07c"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Roboto"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: "system-ui, -apple-system, Roboto"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, Roboto"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, Roboto"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
  mono:
    fontFamily: "Menlo, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "8px"
  md: "12px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    size: "42px"
  button-stop:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    size: "42px"
  toggle:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    padding: "6px 12px"
  toggle-active:
    backgroundColor: "{colors.accent-dim}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    typography: "{typography.body}"
    padding: "10px 14px"
  bubble-user:
    backgroundColor: "{colors.user-bubble}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  bubble-assistant:
    backgroundColor: "{colors.assistant-bubble}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
  nav-item-active:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
---

# Design System: Odysseus Mobile

## 1. Overview

**Creative North Star: "The Night Desk"**

Odysseus Mobile is the phone you pick up in low light to talk to your own AI
server. The whole system is built for that moment: dim room, one hand, a glance
rather than a session. The dark surface is not a style choice borrowed from
developer tools, it is functional. It keeps the screen quiet at night, lets the
conversation be the only thing that glows, and signals that this is a private
instrument resting on your own desk, not a storefront.

The room is cool and the lamp is warm. Neutrals are nearly black, tinted faintly
toward a cool blue, never a flat `#000`. Against them sits a single warm coral
accent (`#e06c75`): the one ember in the room. It marks the live action and
nothing else, and the user's own messages glow in warm maroon coals (`#5a2f37`),
so their words read as the lit thing on the desk. Depth comes from tonal layering
and hairline borders, never from drop shadows or glassy blur. Type is the
operating system's own font, because the user's words and the model's words are
the content, and branding has no business competing with them.

This system explicitly rejects the look of big-tech AI apps (no sign-in theatre,
no assistant persona, no model marketing), the cold gradient polish of corporate
SaaS, the neon-on-black glow of generic AI dashboards, and anything cartoonish.
Warmth is allowed; it comes from the ember and from restraint, not from decoration.

**Key Characteristics:**
- Cool dark neutrals, one warm coral accent (never pure black or white).
- One accent, used as an ember: rare, meaningful, never ambient.
- Flat by default: tonal layers + 1px borders carry depth, not shadows.
- System typography; the conversation is the type.
- Built for the thumb: pill actions, generous targets, one-handed reach.

## 2. Colors

Cool, near-monochrome dark neutrals lit by a single warm coral accent and a warm-maroon user voice.

### Primary
- **Ember Coral** (`#e06c75`): the single warm accent. Reserved for the one live
  or primary action on a screen: the send button, an active toggle, a link, the
  pairing reticle, the brand mark, a selected nav item. Its rarity is the point.
- **Ember Dim** (`#9e4d54`): the muted form of the accent. Fills the active
  composer toggle (under an Ember Coral border) and carries pressed accent states.
- **Lamp Ink** (`#0e0e12`): the near-black ink for glyphs that sit ON the ember
  (the send/stop button arrow and square). Never used as a surface.

### Neutral
- **Desk Black** (`#16161a`): the app background. The darkest surface, faintly
  blue-tinted, never `#000`. This is the night room.
- **Slate Surface** (`#1f1f25`): raised surfaces: cards, inputs, the composer,
  the assistant bubble, the sidebar.
- **Slate Raised** (`#26262e`): the next tonal step up, for active nav rows and
  pressed rows. Layering, not shadow, conveys this lift.
- **Hairline** (`#2c2c35`): all 1px borders and dividers. The only structural line.
- **Lamplit White** (`#e8e8e8`): primary text. Soft off-white, never `#fff`.
- **Dim Text** (`#bdbdc7`): secondary text, descriptions, supporting copy.
- **Faint Text** (`#8a8a96`): placeholders, captions, inactive labels, metadata, resting nav icons.
- **Night Scrim** (`rgba(11,11,14,0.66)`): the dimming layer behind the open
  sidebar. Tinted toward Desk Black, never a pure-black wash.

### Secondary (user voice)
- **Hearth Coals** (`#5a2f37`): the user's own message bubble. A warm desaturated
  maroon, kin to the ember, so the user's words sit warm and apart from the cool
  surfaces without shouting.

### Tertiary (status, used sparingly)
- **Warm Alarm** (`#e0685e`): errors and the stop-generation button only.
- **Amber Caution** (`#e0a85e`): warnings only.
- **Calm Green** (`#5ec07c`): success / connected / enabled confirmation only.

### Named Rules
**The One Ember Rule.** Ember Coral (`#e06c75`) marks the single live or primary
action in a region, plus the small brand mark. It is an ember, not ambient light:
if a screen reads as "coral everywhere", pull it back. The send button must always
be the brightest ember on the chat screen.

**The Tinted Neutral Rule.** Every neutral is tinted faintly toward cool blue.
Pure `#000` and `#fff` are forbidden; they read as flat and cheap against this palette.

**The Two Reds Rule.** Ember Coral (`#e06c75`, action) and Warm Alarm (`#e0685e`,
danger) are close cousins. Keep them legible apart by *role and placement*, never
by hue alone: danger appears only as error text and the stop button (which also
swaps the send button's position), so context disambiguates. If they ever sit
side by side as two buttons, push Warm Alarm warmer/oranger.

## 3. Typography

**Display / Body / Label Font:** the platform system font (San Francisco on iOS,
Roboto on Android) via `system-ui`. No custom font is loaded.
**Mono Font:** Menlo / `ui-monospace`, for tokens, hosts, ports, and code.

**Character:** invisible by design. The system font disappears into the OS so the
user never reads "an app", they read their conversation. Hierarchy is built from
scale and weight, not from a distinctive typeface.

### Hierarchy
- **Display** (700, 26px, 1.15): the pairing screen headline only. The one
  moment the app introduces itself.
- **Title** (700, 20px, 1.2): screen headers and the "Odysseus" wordmark.
- **Body** (400, 15px, 1.4): message text, list content. The workhorse. Keep
  readable measure on tablets; do not let lines run edge to edge.
- **Label** (600, 13px, 1.3): toggle text, field labels, metadata, nav labels.
  Quiet and supporting.
- **Mono** (400, 13px, Menlo): host, port, token, payload, and inline code. Signals
  "this is a literal machine value", which builds trust during pairing.

### Named Rules
**The System Voice Rule.** Type is the system font and nothing else. The content
is the type. Never reach for a display typeface to add "personality"; personality
comes from the words and the restraint around them.

## 4. Elevation

Flat by default. This system uses no drop shadows, no glow, no glassmorphism.
Depth is conveyed entirely by **tonal layering** (Desk Black → Slate Surface →
Slate Raised) and **1px Hairline borders**. A raised element is raised because it
is a step lighter and outlined by a hairline, the way objects separate on a real
desk under dim light, not because it casts a shadow. The one permitted overlay is
the sidebar, which dims the screen behind it with the Night Scrim, not a shadow.

### Named Rules
**The Flat Desk Rule.** Surfaces are flat at rest and flat in motion. If you are
reaching for `shadow`, `elevation` (as a visual effect), or `blur` to separate two
things, use a tonal step and a hairline border instead. The only thing allowed to
glow is the ember.

## 5. Components

### Buttons
- **Shape:** circular pill (`999px`) for the primary composer action; the rest of
  the UI uses text-and-icon pressables, not filled buttons.
- **Send:** a 42px Ember Coral (`#e06c75`) circle with a Lamp Ink (`#0e0e12`)
  arrow. The single brightest ember on the chat screen.
- **Disabled send:** same circle at ~40% opacity. Shape persists; only presence fades.
- **Stop:** the send circle recolored to Warm Alarm (`#e0685e`) while streaming.
  Same position, so the primary action's meaning swaps in place (see The Two Reds Rule).

### Chips / Toggles
- **Style:** pill (`999px`), Slate Surface background, 1px Hairline border, Dim
  Text label when off.
- **Active:** Ember Dim (`#9e4d54`) fill under an Ember Coral (`#e06c75`) border,
  Lamplit White text. The warm fill plus the readable label is the signal, never
  color alone.
- Used for Web, Research, and Agent/Chat mode in the composer toolbar.

### Cards / Rows
- **Corner Style:** gently rounded (`12px` for rows/cards, `18px` for bubbles and inputs).
- **Background:** Slate Surface (`#1f1f25`) on Desk Black.
- **Shadow Strategy:** none. See The Flat Desk Rule. Separation is a 1px Hairline border.
- **Internal Padding:** 14-16px. Rows breathe; lists are not cramped.
- Cards are used only for genuinely card-shaped content (a note, a task, a memory,
  a settings group). Never nest a card inside a card.

### Inputs / Fields
- **Style:** Slate Surface fill, 1px Hairline border, `18px` radius for the
  composer (`12px` for form fields), Lamplit White text, Faint Text placeholder.
- **Focus:** keep it quiet. A border shift toward the accent is the maximum; no glow.
- **Mono fields** (host/port/token) render in Menlo to read as literal values.

### Navigation
- **Sidebar:** a slide-in overlay from the left over the Night Scrim (a custom
  Reanimated drawer, not a tab bar). Slate Surface panel, Hairline right border,
  nav rows with a monochrome line icon + Label-weight text. The **active route**
  gets an Ember Coral icon, Lamplit White bold label, and a Slate Raised row. All
  motion honors `prefers-reduced-motion`. Closes on selection or backdrop tap.
- **Nav icons:** one line-icon family (24px grid, 2px stroke, round caps), drawn
  from `react-native-svg`, `currentColor`-driven. Never emoji.
- **Headers:** a hamburger (≡) at left opens the sidebar; a settings gear at right
  on the chat screen, a screen title on the rest. Flat, underlined by a hairline.

### Message Stream (signature)
The chat transcript is the heart of the app. User messages sit right-aligned in
Hearth Coals (`#5a2f37`) bubbles; assistant messages left-aligned in Slate Surface
bubbles with a hairline border, rendered through a lightweight markdown renderer
(code blocks, inline code, bold, lists, headings). When the server attaches web,
research, RAG, or memory sources, they hang in a hairline-topped citation block
under the assistant bubble. The stream auto-scrolls as tokens arrive. Nothing
decorates it: no avatars, no name tags, no timestamps competing with the words.

## 6. Do's and Don'ts

### Do:
- **Do** keep Ember Coral (`#e06c75`) to the live or primary action (plus the small
  brand mark) per region. Honor The One Ember Rule; the send button stays the brightest ember.
- **Do** convey depth with tonal steps (`#16161a` → `#1f1f25` → `#26262e`) and 1px
  `#2c2c35` borders. Honor The Flat Desk Rule.
- **Do** tint every neutral toward cool blue; keep text at `#e8e8e8`, not `#fff`,
  and scrims tinted toward `#16161a`, not `#000`.
- **Do** keep the warm family (Ember Coral, Ember Dim, Hearth Coals) for the user's
  voice and live actions; keep the cool neutrals for everything at rest.
- **Do** use the system font and let the conversation be the type.
- **Do** disambiguate Ember Coral and Warm Alarm by role and position, not hue (The Two Reds Rule).
- **Do** pair every state signal (connected, active, streaming, disabled) with text
  or shape, never color alone; size touch targets at least 44pt.

### Don't:
- **Don't** imitate **big-tech AI apps** (ChatGPT / Claude / Gemini): no assistant
  persona, no model marketing, no sign-in theatre. This is the user's own server.
- **Don't** drift toward **corporate SaaS**: no gradient hero sections, no cold
  enterprise polish, no upgrade prompts.
- **Don't** build a **generic dark dashboard**: no neon-on-black, no glowing accent
  cards, no endless identical icon-plus-title grids, no fake data-viz chrome.
- **Don't** go **childish or cartoonish**: no mascots, no toy-like rounding, no
  emoji as iconography, no playful overload. Warmth yes, cuteness no.
- **Don't** use drop shadows, `elevation` as a visual effect, or glassmorphism to separate surfaces.
- **Don't** use `#000` or `#fff` anywhere.
- **Don't** put a colored `border-left`/side-stripe on rows, cards, or alerts; use
  a full hairline border, a tonal tint, or a leading icon instead.
