const sql = `CREATE TABLE IF NOT EXISTS \`team_member_access\` (
\t\`id\` text PRIMARY KEY NOT NULL,
\t\`team_member_id\` text NOT NULL,
\t\`role\` text NOT NULL,
\t\`scope_type\` text NOT NULL,
\t\`plan_type\` text,
\t\`track_type\` text DEFAULT 'all' NOT NULL,
\t\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
\t\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
\tFOREIGN KEY (\`team_member_id\`) REFERENCES \`team_members\`(\`id\`) ON UPDATE no action ON DELETE cascade
)`

const ID = '(?:`[^`]+`|"[^"]+"|\\w+)'
const ON = '(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+(?:CASCADE|SET\\s+NULL|SET\\s+DEFAULT|RESTRICT|NO\\s+ACTION))'

let s = sql
s = s.replace(new RegExp(`,\\s*FOREIGN\\s+KEY\\s*\\([^)]+\\)\\s+REFERENCES\\s+${ID}\\s*\\([^)]+\\)${ON}*`, 'gi'), '')
s = s.replace(new RegExp(`\\s+REFERENCES\\s+${ID}\\s*\\([^)]+\\)${ON}*`, 'gi'), '')

console.log('=== AFTER STRIP ===')
console.log(s)
console.log('\nHas FK:', s.includes('FOREIGN KEY') || s.includes('REFERENCES'))
