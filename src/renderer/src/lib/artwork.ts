// Gradient placeholder used by the mockups when no artwork is cached yet:
// a stable hue derived from the title, so a game always gets the same colors.

export function titleHue(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

export function placeholderGradient(title: string, angle = 160): string {
  const hue = titleHue(title)
  return `linear-gradient(${angle}deg,hsl(${hue} 70% 46%),hsl(${(hue + 50) % 360} 55% 15%))`
}

export function heroGradient(title: string): string {
  const hue = titleHue(title)
  return `radial-gradient(ellipse at 75% 20%,hsl(${hue} 80% 45%),transparent 60%),radial-gradient(ellipse at 15% 90%,hsl(${(hue + 32) % 360} 70% 30%),transparent 55%),var(--ink-900)`
}
