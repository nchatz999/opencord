# Opencord Theming Guidelines

## Overview

Opencord uses a semantic theming system built on Tailwind CSS v4's `@theme` directive. Colors are named by visual depth and prominence, not by UI element names.

## Naming Convention

### Backgrounds (by visual depth)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-bg-base` | #313338 | Main app background |
| `--color-bg-subtle` | #1e1f22 | Darkest areas, inset elements |
| `--color-bg-elevated` | #2f3136 | Sidebars, panels, cards |
| `--color-bg-overlay` | #383a40 | Modals, dropdowns, hover states |
| `--color-bg-emphasis` | #404249 | Highlighted/active states |
| `--color-input` | #202225 | Form input backgrounds |
| `--color-context-menu` | #18191c | Context menu background |

### Foregrounds (by prominence)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-fg-base` | #E3E5E8 | Primary text, active users |
| `--color-fg-emphasis` | #F8F9FA | Emphasized/bright text |
| `--color-fg-muted` | #9DA3AD | Secondary text, descriptions |
| `--color-fg-subtle` | #858B95 | Inactive users, placeholders |

### Borders (by prominence)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-border-base` | #1e1f22 | Main dividers |
| `--color-border-subtle` | #2b2d31 | Fine separators |
| `--color-border-emphasis` | #4f545c | Prominent borders |

### Accent (interactive elements)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-accent-primary` | #5865f2 | Primary buttons, focus |
| `--color-accent-primary-hover` | #4752c4 | Primary hover state |
| `--color-accent-primary-fg` | #ffffff | Text on primary backgrounds |
| `--color-accent-secondary` | #4f545c | Secondary buttons |
| `--color-accent-secondary-hover` | #5d6269 | Secondary hover state |
| `--color-accent-secondary-fg` | #ffffff | Text on secondary backgrounds |
| `--color-accent-link` | #00A8FC | Links |
| `--color-focus-ring` | #5865f2 | Focus indicators |

### Status (feedback states)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-status-success` | #16a34a | Success actions |
| `--color-status-success-hover` | #15803d | Success hover |
| `--color-status-danger` | #f04747 | Danger/error |
| `--color-status-danger-hover` | #d84040 | Danger hover |
| `--color-status-danger-fg` | #ffffff | Text on danger backgrounds |
| `--color-status-warning` | #eab308 | Warning states |
| `--color-status-info` | #00A8FC | Info states |

### Presence (user status indicators)
| Variable | Default | Usage |
|----------|---------|-------|
| `--color-presence-online` | #22c55e | Online status |
| `--color-presence-away` | #eab308 | Away/idle status |
| `--color-presence-dnd` | #ef4444 | Do Not Disturb |
| `--color-presence-offline` | #6b7280 | Offline status |

### Syntax Highlighting
| Variable | Usage |
|----------|-------|
| `--color-syntax-keyword` | Keywords |
| `--color-syntax-string` | String values |
| `--color-syntax-number` | Numbers |
| `--color-syntax-boolean` | Booleans |
| `--color-syntax-null` | Null/undefined |
| `--color-syntax-comment` | Comments |
| `--color-syntax-function` | Functions |
| `--color-syntax-punctuation` | Punctuation |
| `--color-syntax-date` | Dates |

### Charts
| Variable | Usage |
|----------|-------|
| `--color-chart-1` through `--color-chart-5` | Chart colors |

## Usage Examples

### Background Colors

```tsx
<div class="bg-bg-base">        {/* Main app area */}
<div class="bg-bg-subtle">      {/* Darkest/inset areas */}
<div class="bg-bg-elevated">    {/* Sidebars, panels, cards */}
<div class="bg-bg-overlay">     {/* Modals, hover states */}
<div class="bg-bg-emphasis">    {/* Active/highlighted */}
<div class="bg-input">          {/* Input fields */}
```

### Text Colors

```tsx
<p class="text-fg-base">Primary text</p>
<p class="text-fg-emphasis">Emphasized text</p>
<p class="text-fg-muted">Secondary text</p>
<p class="text-fg-subtle">Inactive/placeholder text</p>
```

### User Status Pattern

```tsx
<span class={user.status === "offline" ? "text-fg-subtle" : "text-fg-base"}>
  {user.username}
</span>
```

### Button Variants

```tsx
// Primary button
<button class="bg-accent-primary text-accent-primary-fg hover:bg-accent-primary-hover">

// Secondary button
<button class="bg-accent-secondary text-accent-secondary-fg hover:bg-accent-secondary-hover">

// Danger button
<button class="bg-status-danger text-status-danger-fg hover:bg-status-danger-hover">

// Ghost button
<button class="bg-transparent text-fg-base hover:bg-bg-overlay">
```

### Presence Indicators

```tsx
const presenceColors = {
  online: "bg-presence-online",
  away: "bg-presence-away",
  dnd: "bg-presence-dnd",
  offline: "bg-presence-offline",
};
```

### Focus States

```tsx
<input class="focus:ring-2 focus:ring-focus-ring">
```

### Borders

```tsx
<div class="border border-border-base">      {/* Default */}
<div class="border border-border-subtle">    {/* Subtle */}
<div class="border border-border-emphasis">  {/* Prominent */}
```

## Component Patterns

### Panels/Sidebars

```tsx
<div class="bg-bg-elevated flex flex-col h-full">
  <div class="border-b border-border-base">Header</div>
  <div class="flex-1">Content</div>
</div>
```

### Cards

```tsx
<div class="bg-bg-elevated rounded-lg p-4 border border-border-base">
  <h3 class="text-fg-base font-semibold">Card Title</h3>
  <p class="text-fg-muted">Description</p>
</div>
```

### Modals

```tsx
<div class="bg-bg-overlay rounded-lg shadow-lg">
  <div class="p-4 border-b border-border-base">
    <h2 class="text-fg-base">Modal Header</h2>
  </div>
  <div class="p-4">{/* Content */}</div>
</div>
```

### Lists with Hover

```tsx
<button class="w-full px-2 py-1 rounded hover:bg-bg-overlay transition-all">
  <span class="text-fg-base">Item text</span>
  <span class="text-fg-muted text-sm">Description</span>
</button>
```

### Avatar Presence Indicator

```tsx
<div class="relative">
  <Avatar />
  <div class={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-elevated ${presenceColor}`} />
</div>
```

## Do's and Don'ts

### Do
- Use semantic color classes from the theme
- Use `fg-subtle` for inactive/offline users
- Use `fg-base` for active/online users
- Use `bg-bg-elevated` for panels that need status indicator borders
- Follow existing component patterns

### Don't
- Hardcode hex colors in components
- Use arbitrary color values like `bg-[#123456]`
- Override theme colors with inline styles

## Adding New Variables

1. Add the variable to `src/index.css` within `@theme`:
   ```css
   @theme {
     --color-new-variable: #hexvalue;
   }
   ```

2. Add to all themes in `src/store/theme.ts`

3. Use in components as `bg-new-variable`, `text-new-variable`, etc.

4. Document in this guide.
