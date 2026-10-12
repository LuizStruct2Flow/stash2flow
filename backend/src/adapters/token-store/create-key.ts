// Creates the key file of the token store, for the first run of the app.
// The path of the key file comes from the configuration, like every path.
// Run with: node src/adapters/token-store/create-key.ts <path of the key file>
import { writeNewKeyFile } from './encrypted-file-token-store.ts'

const path = process.argv[2]
if (!path) {
  console.error('Name the path of the key file.')
  process.exit(1)
}
try {
  await writeNewKeyFile(path)
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
    console.error('The key file already exists; it is not overwritten.')
    process.exit(1)
  }
  throw error
}
console.log('The key file was created. Keep it safe: the token store cannot be read without it.')
