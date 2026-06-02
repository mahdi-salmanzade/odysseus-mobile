# Product

## Register

product

## Users

People self-hosting **Odysseus** (PewDiePie's local-first AI workspace) on a
machine at home, who want to use it from their phone. They are technically
capable and privacy-minded: they chose to run their own AI server precisely so
their data never leaves their network. Context of use is casual and mobile, on
the same Wi-Fi as the server: on the couch, in bed, in the kitchen, phone in one
hand. They are not at a desk and not in a hurry; they reach for the phone the way
they would reach for a messaging app, expecting it to just connect and work.

The job to be done: drive my own Odysseus, chat with my models, run agents, and
glance at my sessions, notes, tasks and memory, without opening a laptop and
without handing anything to a cloud.

## Product Purpose

Odysseus Mobile is a native iOS/Android remote control for a self-hosted Odysseus
server. It pairs to the server over the local network with a single scanned token
and then talks to it directly: streaming chat (with web, research and agent
modes), session management, and read views of notes, tasks and memory. There is
no account, no cloud relay, no telemetry. Everything happens on the user's own
hardware and LAN.

Success looks like: pairing takes one scan, the first message streams back within
seconds, and the app feels like a trustworthy extension of the server, not a
separate product trying to upsell or capture anything. It should be the obvious,
effortless way to reach your Odysseus when you are away from the keyboard.

## Brand Personality

Calm, trustworthy, utilitarian. The voice is plain and quietly competent: it
states what is happening and gets out of the way. It carries a hint of Odysseus's
own indie, local-first spirit (a little warmth, a little hacker pride) but never
at the expense of clarity. Three words: **calm, honest, yours**.

Emotional goal: the relief and quiet ownership of using something that is wholly
yours. Not the dopamine of a consumer app, not the sterility of enterprise
software. Closer to the feeling of a well-worn personal tool.

## Anti-references

- **Big-tech AI apps.** The official ChatGPT / Claude / Gemini look. The entire
  point is that this is the user's own server, not a rented seat in someone
  else's product. No sign-in walls, no model marketing, no assistant persona.
- **Corporate SaaS.** Linear/Stripe-clone coldness, cliche gradient hero
  sections, enterprise polish with no soul, upgrade prompts.
- **Generic dark dashboard.** AI-slop neon-on-black, glowing accent cards,
  endless identical icon-plus-title grids, fake data-viz chrome.
- **Childish / cartoonish.** Bubbly mascots, toy-like rounding, playful overload.
  Warmth is allowed; cuteness is not.

## Design Principles

1. **Companion, not clone.** This is a remote for *your* server, not an imitation
   of a big-tech chat app. Every screen should feel like it belongs to Odysseus
   and to the user, never like a generic AI product.
2. **The conversation is the hero.** Chrome recedes; content leads. Toolbars,
   labels and navigation stay quiet so the message stream and the user's own
   words carry the screen.
3. **Honest state, always.** Show connection, streaming, model and mode truthfully.
   Never fake progress, never hide an error behind a spinner. Trust is the product.
4. **Local-first, felt.** Make "this runs on your hardware, on your network" a
   visible reassurance, not fine print. The boundary of the network is the
   boundary of the app.
5. **Built for the thumb.** One-handed, touch-first, fast. Reachable actions,
   generous targets, no precision required.

## Accessibility & Inclusion

- Target **WCAG 2.2 AA** contrast for text and meaningful UI on the dark surface.
- Respect the OS: Dynamic Type / font scaling, and `prefers-reduced-motion`
  (streaming and the sidebar must degrade to no-motion gracefully).
- Touch targets at least 44x44pt; primary actions reachable one-handed.
- Never rely on color alone to convey state (connection, enabled/disabled,
  streaming): pair it with text, shape, or iconography.
- Support both light and dark system appearance over time; dark is the current
  primary because the typical use is low-light, glance-driven, at rest.
