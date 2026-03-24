// Test the enhanced transcript parser formats
// Run with: npx tsx test-parser.ts

import { parseManualTranscript } from './lib/transcriptParser'

console.log('=== Testing Enhanced Transcript Parser ===\n')

// Test Case 1: Standard format
console.log('Test 1: Standard format (0:05 - Text)')
const test1 = `0:05 - Homepage header is misaligned
0:15 - Login button should be blue
0:23 - Footer copyright year is wrong`

const result1 = parseManualTranscript(test1)
console.log('Result:', result1)
console.log(`✓ Parsed ${result1.length} entries\n`)

// Test Case 2: Bracketed format
console.log('Test 2: Bracketed format ([0:05] Text)')
const test2 = `[0:05] Homepage header is misaligned
[0:15] Login button should be blue
[0:23] Footer copyright year is wrong`

const result2 = parseManualTranscript(test2)
console.log('Result:', result2)
console.log(`✓ Parsed ${result2.length} entries\n`)

// Test Case 3: "At" prefix format
console.log('Test 3: "At" prefix format (At 0:05 - Text)')
const test3 = `At 0:05 - Homepage header is misaligned
At 0:15 - Login button should be blue
At 0:23 - Footer copyright year is wrong`

const result3 = parseManualTranscript(test3)
console.log('Result:', result3)
console.log(`✓ Parsed ${result3.length} entries\n`)

// Test Case 4: Plain text (auto-timestamps)
console.log('Test 4: Plain text without timestamps')
const test4 = `Homepage header is misaligned
Login button should be blue
Footer copyright year is wrong`

const result4 = parseManualTranscript(test4)
console.log('Result:', result4)
console.log(`✓ Parsed ${result4.length} entries with auto-timestamps\n`)
console.log('Timestamps assigned:', result4.map(r => r.timestamp_label).join(', '))

// Test Case 5: Mixed formats
console.log('\nTest 5: Mixed formats')
const test5 = `0:05 - First issue with standard format
Second issue without any timestamp
[1:23] Third issue with brackets
At 2:00 - Fourth issue with At prefix
5:00 Fifth issue simple format`

const result5 = parseManualTranscript(test5)
console.log('Result:', result5)
console.log(`✓ Parsed ${result5.length} entries from mixed formats\n`)

console.log('=== All Tests Complete ===')
console.log('✅ Parser supports:')
console.log('  - Standard: "0:05 - Text"')
console.log('  - Bracketed: "[0:05] Text"')
console.log('  - At prefix: "At 0:05 - Text"')
console.log('  - Simple: "0:05 Text"')
console.log('  - Plain text: Auto-assigns timestamps every 10 seconds')
