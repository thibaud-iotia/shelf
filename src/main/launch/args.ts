/**
 * Splits a launch-arguments string like a shell would, without invoking one:
 * whitespace separates arguments, single/double quotes group, backslash escapes a quote.
 * `-windowed --profile "My Profile"` → ['-windowed', '--profile', 'My Profile'].
 */
export function parseArgs(input: string | null | undefined): string[] {
  if (!input) return []
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!
    if (quote) {
      if (char === '\\' && input[i + 1] === quote) {
        current += quote
        i++
      } else if (char === quote) {
        quote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) args.push(current)
  return args
}
