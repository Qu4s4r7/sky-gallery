import readline from 'node:readline'
import { createUser } from './auth.js'
import { config } from './config.js'

function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    // muestra la pregunta pero no lo que se teclea
    ;(rl as any)._writeToOutput = (s: string) => { if (s.includes(q)) process.stdout.write(s) }
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a) })
  })
}

const [cmd, username, flag] = process.argv.slice(2)
if (cmd !== 'add' || !username) {
  console.log('uso: npm run user -- add <usuario> [--admin]')
  process.exit(1)
}

const pw = await askHidden('Contraseña (mín. 8): ')
try {
  await createUser(username, pw, flag === '--admin' ? 'admin' : 'user', config.defaultQuotaBytes)
  console.log(`Usuario "${username}" creado`)
  process.exit(0)   // el pool de Postgres mantendría el proceso vivo
} catch (e: any) {
  console.error('Error:', e.message)
  process.exit(1)
}
