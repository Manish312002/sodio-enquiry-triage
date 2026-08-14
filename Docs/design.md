# Sodio Enquiry Triage — UI/UX Design System

## 1. Design Direction

### Concept: “Signal Desk”

The product should feel like a specialist operations desk for sorting incoming commercial signals, not a conventional SaaS admin dashboard and not an AI chat application.

The UI is deliberately built around **source → interpretation → human decision**.

The original enquiry is the evidence.
The extraction is the machine interpretation.
The human correction is the final operational decision.

## 2. What To Avoid

Do not use:
- generic purple/blue AI gradients;
- oversized hero cards;
- glassmorphism;
- floating chatbot bubbles;
- generic “AI assistant” chat layouts;
- excessive rounded cards;
- decorative 3D illustrations;
- meaningless KPI cards;
- animated glowing AI icons;
- dashboard templates with identical four-card metric rows.

The task only asks for clean and usable styling, but this project intentionally uses a more distinctive workbench treatment. fileciteturn0file1L52-L54

## 3. Colour & Theme

### Base theme

Use a warm paper-like light background with deep ink text.

Suggested tokens:

```css
--bg: #F4F1EA;
--surface: #FBFAF6;
--surface-strong: #FFFFFF;
--ink: #171717;
--ink-muted: #68645D;
--line: #D8D3C8;
--line-strong: #AFA99D;
--accent: #E4572E;
--accent-soft: #F6D8CE;
--success: #2E6B4E;
--success-soft: #DCEBE1;
--warning: #9A6718;
--warning-soft: #F1E4C8;
--danger: #A33A32;
--danger-soft: #F0D8D5;
--low: #77736B;
```

The orange accent is intentionally closer to a physical annotation/highlighter colour than a typical software brand gradient.

## 4. Typography

### Primary font

`Inter`, with system fallback.

### Monospace / source text

`IBM Plex Mono`, with monospace fallback.

Use monospace for:
- email addresses;
- timestamps;
- extraction version IDs;
- raw source metadata;
- technical values.

### Type scale

```text
Display: 32px / 38px / 700
Page title: 24px / 30px / 700
Section title: 16px / 22px / 700
Body: 14px / 21px / 400
Small: 12px / 17px / 500
Micro: 11px / 14px / 600
```

Avoid excessively large typography.

## 5. Main Layout

Use a three-zone desktop composition:

```text
┌─────────────────────────────────────────────────────────────┐
│ SODIO / INBOX SIGNALS                         12 ENQUIRIES │
├───────────────┬───────────────────────────────┬─────────────┤
│ FILTER RAIL   │ ENQUIRY QUEUE                 │ QUICK INFO  │
│               │                               │             │
│ Service       │ 14:05  Rachel W.              │ Priority    │
│ Priority      │ WEB   £40K   HIGH             │ HIGH        │
│ Status        │ “Supplier document...”        │             │
│               │ ───────────────────────────   │ Status      │
│               │ 11:40  Deniz                  │ NEW         │
│               │ BLOCKCHAIN  FLEXIBLE  HIGH    │             │
└───────────────┴───────────────────────────────┴─────────────┘
```

On detail view, the queue remains visible as a narrow left rail while the selected enquiry opens in the main workspace.

## 6. Enquiry Row

Each row should feel like a compact operational record rather than a card.

Show:
- received time;
- contact;
- company;
- service line;
- budget;
- priority marker;
- status;
- one-line summary.

Use a thin priority rail on the left:
- high → accent/danger emphasis;
- medium → warning emphasis;
- low → muted.

Do not turn each row into a large rounded card.

## 7. Detail View

Use a split evidence layout:

### Left — Original

A paper/document-like surface:

```text
ORIGINAL MESSAGE
────────────────
Rachel Whitfield
r.whitfield@...

14 JUL 2026 · 09:22

Hi, we're a mid-sized logistics firm...
```

This section is immutable and visually labelled `SOURCE`.

### Right — Extraction

A structured field editor:

```text
EXTRACTED
────────────────
COMPANY
Northgate Logistics        [edit]

CONTACT
Rachel Whitfield            [edit]

SERVICE
WEB                         [edit]

BUDGET
£40,000                     [edit]

TIMELINE
September                   [edit]
```

Fields edited by a human get a small `CONFIRMED` marker.

## 8. Human vs Model Visual Language

Model-derived data:
- neutral background;
- subtle `MODEL` label.

Human-confirmed data:
- accent left border;
- `CONFIRMED` marker;
- no dramatic colour fill.

Conflict:
- warning marker;
- concise explanation;
- actions: `Keep confirmed` / `Use latest extraction`.

This makes the most important architectural decision visible in the UI.

## 9. Status Control

Represent status as a compact horizontal state track:

```text
NEW ───── CONTACTED ───── QUALIFIED ───── DROPPED
 ●             ○               ○             ○
```

Clicking a state changes the enquiry status.

Avoid large dropdown buttons when a simple state track communicates the workflow better.

## 10. Priority

Priority should be immediately legible but not visually overpowering.

Use:
- `HIGH` — strong accent marker;
- `MEDIUM` — amber marker;
- `LOW` — muted marker.

Also display the numeric score in the detail view:

```text
PRIORITY
HIGH · 11 pts
```

A small `Why?` affordance can expose:
- genuine enquiry +4;
- budget +4;
- timeline +3;
- service +1.

This supports the deterministic scoring requirement.

## 11. Import Experience

Avoid a generic giant drag-and-drop box.

Use a compact “feed intake” strip:

```text
IMPORT ENQUIRIES
Drop a source file here
or choose file

20 DETECTED
14 COMPLETE
2 FAILED
4 PROCESSING
```

During processing, individual rows can gain a small progress state.

## 12. Batch Progress

Use a horizontal segmented progress bar with counts rather than a spinner:

```text
20 ENQUIRIES
██████████████░░░░░░  14 / 20

14 completed · 2 failed · 4 processing
```

Failed items show directly in the queue.

## 13. Empty States

Do not use generic illustrations.

Examples:

### No enquiries

```text
NO SIGNAL YET

Paste an enquiry or import a source file.
Your first item will appear here.
```

### No filter results

```text
NO MATCHES

The current filter combination returned nothing.
Clear one filter to widen the queue.
```

## 14. Loading States

Use skeleton rows that preserve the table structure.

Avoid full-screen loading spinners.

## 15. Error States

Errors should appear close to the failed action.

Example:

```text
EXTRACTION FAILED
Provider timed out.

This enquiry was kept intact.
[Retry extraction]
```

Never expose raw stack traces.

## 16. Interaction Rules

- Keyboard navigation should be possible through table rows and editable fields.
- `Enter` confirms inline editing.
- `Esc` cancels editing.
- Re-extraction requires an explicit click.
- Destructive actions should not be hidden behind ambiguous icons.
- Toasts should be reserved for short confirmation messages.

## 17. Responsive Behaviour

Desktop-first because this is an internal operations tool.

At tablet width:
- collapse filter rail;
- keep queue and detail.

At narrow width:
- queue becomes the first screen;
- detail opens as a full-width view;
- original/extraction panels stack vertically.

## 18. Motion

Use minimal motion:
- 120–180ms transitions for selection and inline editing;
- progress changes can animate;
- no perpetual animations;
- no “AI thinking” animation.

## 19. Visual Principle

Every visual element must answer one operational question:

- What came in?
- What did the model extract?
- What did a human confirm?
- What needs attention?
- What failed?
- What happens next?

If an element does not help answer one of those questions, remove it.
