// The entry point of the command line stash: wires the adapters and runs the
// command of the command line. Run with: node src/stash.ts <command>
import { consoleIo, runStash } from './adapters/cli/stash-commands.ts'

process.exitCode = await runStash(process.argv.slice(2), consoleIo)
