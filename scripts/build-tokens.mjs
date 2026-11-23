import { readFile, writeFile } from 'node:fs/promises';
const tokens = JSON.parse(
  await readFile(new URL('../design/tokens.json', import.meta.url), 'utf8'),
);
const lines = ['/* Generated from design/tokens.json. Edit the source tokens. */', ':root {'];
for (const [group, values] of Object.entries(tokens)) {
  for (const [name, token] of Object.entries(values)) {
    const value = token.$value;
    const css = typeof value === 'string' ? value : `${value.value}${value.unit}`;
    lines.push(`  --${group}-${name}: ${css};`);
    if (group === 'color') lines.push(`  --${name}: var(--color-${name});`);
  }
}
lines.push('  --radius: var(--radius-panel);', '}');
await writeFile(new URL('../src/tokens.css', import.meta.url), lines.join('\n') + '\n');
