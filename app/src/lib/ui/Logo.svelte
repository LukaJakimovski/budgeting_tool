<!--
  The Tally mark, drawn in the current theme's accent colour (the static
  icon.svg / PNGs stay blue: launchers and browser tabs can't follow themes).
-->
<script lang="ts">
  let { size = 28 }: { size?: number } = $props();
  const id = $props.id();
</script>

<svg class="logo" viewBox="0 0 512 512" width={size} height={size} aria-hidden="true">
  <defs>
    <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" class="light" />
      <stop offset="1" class="dark" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill={`url(#${id}-g)`} />
  <g class="marks" stroke-width="34" stroke-linecap="round">
    <path d="M158 140v232M222 140v232M286 140v232M350 140v232" />
    <path d="M112 330L398 182" stroke-width="30" opacity=".92" />
  </g>
</svg>

<style>
  .logo {
    flex-shrink: 0;
    display: block;
  }
  .light {
    stop-color: color-mix(in oklch, var(--accent) 82%, white);
  }
  .dark {
    stop-color: color-mix(in oklch, var(--accent) 78%, black);
  }
  .marks {
    stroke: var(--on-accent);
  }
  /* White marks like the app icon, unless the accent is too light for them. */
  @supports (color: oklch(from red l c h)) {
    .marks {
      stroke: oklch(from var(--accent) clamp(0.2, (0.78 - l) * 1000, 1) 0 0);
    }
  }
</style>
