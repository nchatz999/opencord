# Opencord Theming Guidelines

## Overview

Opencord uses a unified theming system built on Tailwind CSS v4's `@theme` directive. All theme colors are defined as CSS variables in `src/index.css` and mapped to Tailwind utility classes.

## Architecture

- **CSS Variables**: Defined in `src/index.css` within the `@theme` directive
- **Color Format**: OKLCH for theme colors, hex values in variable definitions
- **Tailwind Integration**: Variables use `--color-*` naming convention, accessible as `bg-*`, `text-*`, `border-*` utilities

## Theme Variables Reference

### Backgrounds

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-background` | `#313338` | Main app background |
| `--color-background-dark` | `#1e1f22` | Darkest backgrounds, scrollbar |
| `--color-card` | `#2f3136` | Card/container surfaces |
| `--color-popover` | `#36393f` | Popover/modal backgrounds |
| `--color-muted` | `#383a40` | Hover states, message bubbles |
| `--color-accent` | `#404249` | Accent/highlight backgrounds |
| `--color-sidebar` | `#2b2d31` | Sidebar background |
| `--color-input` | `#202225` | Form input backgrounds |
| `--color-context-menu` | `#18191c` | Context menu background |

### Primary Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-primary` | `#5865f2` | Primary buttons, focus rings |
| `--color-primary-hover` | `#4752c4` | Primary hover state |
| `--color-primary-foreground` | `#ffffff` | Text on primary backgrounds |

### Secondary Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-secondary` | `#4f545c` | Secondary buttons |
| `--color-secondary-hover` | `#5d6269` | Secondary hover state |
| `--color-secondary-foreground` | `#ffffff` | Text on secondary backgrounds |

### Destructive Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-destructive` | `#f04747` | Destructive buttons |
| `--color-destructive-hover` | `#d84040` | Destructive hover state |
| `--color-destructive-foreground` | `#ffffff` | Text on destructive backgrounds |

### Text Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-foreground` | `#DBDEE1` | Primary text |
| `--color-foreground-bright` | `#f2f3f5` | Emphasized text |
| `--color-muted-foreground` | `#949ba4` | Secondary/muted text |
| `--color-muted-foreground-dark` | `#72767d` | Icons, hints, placeholders |
| `--color-secondary-text` | `#b9bbbe` | Tertiary text |
| `--color-tab-inactive` | `#8e9297` | Inactive tab text |

### Border Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-border` | `#1e1f22` | Default borders |
| `--color-border-subtle` | `#2b2d31` | Subtle borders |
| `--color-border-card` | `#4f545c` | Card/video borders |

### Special Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-ring` | `#5865f2` | Focus ring color |
| `--color-link` | `#00A8FC` | Links, accent highlights |

### Status Indicators

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-status-online` | `#22c55e` | Online status (green) |
| `--color-status-away` | `#eab308` | Away/idle status (yellow) |
| `--color-status-dnd` | `#ef4444` | Do Not Disturb (red) |
| `--color-status-offline` | `#6b7280` | Offline status (gray) |

### Action Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-action-positive` | `#16a34a` | Positive actions (green) |
| `--color-action-positive-hover` | `#15803d` | Positive hover |
| `--color-action-negative` | `#dc2626` | Negative actions (red) |
| `--color-action-negative-hover` | `#b91c1c` | Negative hover |

### Toast Colors

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-toast-success` | `#22c55e` | Success toast border |
| `--color-toast-error` | `#ef4444` | Error toast border |

### Syntax Highlighting

| Variable | Value | Usage |
|----------|-------|-------|
| `--color-syntax-string` | `#4ade80` | String values |
| `--color-syntax-number` | `#60a5fa` | Numbers |
| `--color-syntax-boolean` | `#c084fc` | Booleans |
| `--color-syntax-null` | `#9ca3af` | Null/undefined |
| `--color-syntax-date` | `#facc15` | Dates |

## Usage Examples

### Background Colors

```tsx
// Good - uses semantic classes
<div class="bg-background">        {/* Main app area */}
<div class="bg-sidebar">           {/* Sidebar */}
<div class="bg-card">              {/* Cards, forms */}
<div class="bg-popover">           {/* Modals, dropdowns */}
<div class="bg-muted">             {/* Hover states */}
<div class="bg-input">             {/* Input fields */}

// Bad - hardcoded colors
<div class="bg-[#313338]">
<div class="bg-[#2b2d31]">
```

### Text Colors

```tsx
// Good
<p class="text-foreground">Primary text</p>
<p class="text-muted-foreground">Secondary text</p>
<p class="text-foreground-bright">Emphasized text</p>

// Bad
<p class="text-[#DBDEE1]">
<p class="text-[#949ba4]">
```

### Button Variants

```tsx
// Primary button
<button class="bg-primary text-primary-foreground hover:bg-primary-hover">

// Secondary button
<button class="bg-secondary text-secondary-foreground hover:bg-secondary-hover">

// Destructive button
<button class="bg-destructive text-destructive-foreground hover:bg-destructive-hover">

// Ghost button
<button class="bg-transparent text-foreground hover:bg-secondary">
```

### Status Indicators

```tsx
const statusColors = {
  online: "bg-status-online",
  away: "bg-status-away",
  dnd: "bg-status-dnd",
  offline: "bg-status-offline",
};
```

### Focus States

```tsx
<input class="focus:ring-2 focus:ring-ring focus:border-transparent">
```

### Borders

```tsx
<div class="border border-border">          {/* Default border */}
<div class="border border-border-subtle">   {/* Subtle border */}
<div class="border border-input">           {/* Input border */}
```

## Component Patterns

### Cards

```tsx
<div class="bg-card rounded-lg p-4 border border-border">
  <h3 class="text-foreground font-semibold">Card Title</h3>
  <p class="text-muted-foreground">Description</p>
</div>
```

### Modals

```tsx
<div class="bg-popover rounded-lg shadow-lg">
  <div class="p-4 border-b border-border">
    <h2 class="text-foreground">Modal Header</h2>
  </div>
  <div class="p-4">
    {/* Content */}
  </div>
</div>
```

### Lists with Hover

```tsx
<button class="w-full px-2 py-1 rounded hover:bg-muted transition-all">
  <span class="text-foreground">Item text</span>
  <span class="text-muted-foreground text-sm">Description</span>
</button>
```

## Migration Guide

### Replacing Hardcoded Colors

| From | To |
|------|-----|
| `bg-[#313338]` | `bg-background` |
| `bg-[#1e1f22]` | `bg-background-dark` |
| `bg-[#2f3136]` | `bg-card` |
| `bg-[#36393f]` | `bg-popover` |
| `bg-[#383a40]` | `bg-muted` |
| `bg-[#2b2d31]` | `bg-sidebar` |
| `bg-[#202225]` | `bg-input` |
| `bg-[#5865f2]` | `bg-primary` |
| `bg-[#4752c4]` | `bg-primary-hover` |
| `bg-[#4f545c]` | `bg-secondary` |
| `bg-[#f04747]` | `bg-destructive` |
| `text-[#DBDEE1]` | `text-foreground` |
| `text-[#dcddde]` | `text-foreground` |
| `text-[#949ba4]` | `text-muted-foreground` |
| `text-[#72767d]` | `text-muted-foreground-dark` |
| `text-[#b9bbbe]` | `text-secondary-text` |
| `text-[#00A8FC]` | `text-link` |
| `text-white` | `text-primary-foreground` |
| `border-[#1e1f22]` | `border-border` |
| `border-[#2b2d31]` | `border-border-subtle` |
| `focus:ring-[#5865f2]` | `focus:ring-ring` |
| `bg-green-500` | `bg-status-online` |
| `bg-yellow-500` | `bg-status-away` |
| `bg-red-500` | `bg-status-dnd` |
| `bg-gray-500` | `bg-status-offline` |
| `hover:bg-gray-700` | `hover:bg-muted` |

### Standard Tailwind Colors

Some standard Tailwind colors are acceptable:
- `bg-black`, `bg-white` (for overlays)
- `bg-opacity-*` modifiers
- `shadow-*` utilities

## Do's and Don'ts

### Do

- Use semantic color classes from the theme
- Follow existing component patterns
- Test in dark mode (current default theme)
- Use the `cn()` utility for class merging

### Don't

- Hardcode hex colors in components
- Use arbitrary color values like `bg-[#123456]`
- Mix theme colors with standard Tailwind colors for the same purpose
- Override theme colors with inline styles

## Adding New Variables

1. Add the variable to `src/index.css` within the `@theme` directive:
   ```css
   @theme {
     --color-new-variable: #hexvalue;
   }
   ```

2. Use in components as `bg-new-variable`, `text-new-variable`, etc.

3. Document in this guide with usage context.
