// Stand-in for a game executable in tests: runs for argv[2] ms (default 1000), then exits.
// Launched as `node fake-game.cjs <ms>`.
const duration = Number(process.argv[2] ?? 1000)
setTimeout(() => process.exit(0), duration)
